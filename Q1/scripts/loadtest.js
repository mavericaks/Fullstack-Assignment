#!/usr/bin/env node
/**
 * scripts/loadtest.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Capacity measurement for the Pictionary server.
 *
 * What it does:
 *   • Spawns N rooms, each with 3 virtual players (1 host + 2 joiners)
 *   • The host starts the game; the drawer streams synthetic stroke batches
 *     at the same rate (≈40 strokes/s) as a real player
 *   • After RAMP_SECS the test polls /metrics and records CPU, RAM and
 *     event-loop lag; it then tries more rooms and repeats
 *   • Stops when event-loop p99 latency exceeds LATENCY_THRESHOLD_MS or
 *     CPU exceeds CPU_THRESHOLD_PCT
 *   • Prints a final markdown table you can paste into the README
 *
 * Usage:
 *   node scripts/loadtest.js [--rooms 10] [--step 10] [--url http://localhost:3000]
 *
 * Dependencies: socket.io-client (install with: npm install socket.io-client)
 */

'use strict';

const { io } = require('socket.io-client');
const http    = require('http');

// ── Config (override via CLI flags) ──────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const BASE_URL           = flag('--url',   'http://localhost:3000');
const START_ROOMS        = parseInt(flag('--start',  '10'),  10);
const STEP_ROOMS         = parseInt(flag('--step',   '10'),  10);
const MAX_ROOMS          = parseInt(flag('--max',    '200'), 10);
const RAMP_SECS          = parseInt(flag('--ramp',   '8'),   10);
const LATENCY_THRESHOLD  = parseFloat(flag('--lat-ms', '50'));
const CPU_THRESHOLD      = parseFloat(flag('--cpu-pct','80'));
const STROKE_HZ          = parseInt(flag('--stroke-hz','40'), 10);

const STROKE_INTERVAL_MS = Math.round(1000 / STROKE_HZ);

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMetrics() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}/metrics?reset=1`, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function makeStrokeSegment(roomW, roomH, strokeId, seq, isEnd) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    pts.push({
      x: Math.round(Math.random() * roomW),
      y: Math.round(Math.random() * roomH)
    });
  }
  return {
    id:     strokeId,
    seq,
    color:  '#000000',
    size:   5,
    tool:   'pen',
    points: pts,
    end:    !!isEnd
  };
}

// ── Room factory ──────────────────────────────────────────────────────────────

/**
 * Spins up one room: 1 host, 2 guests.
 * Returns cleanup function.
 */
function spawnRoom(index) {
  const sockets = [];
  let strokeTimer  = null;
  let strokeId     = `load-${index}-0`;
  let strokeSeq    = 0;
  let strokeCount  = 0;

  return new Promise((resolve, reject) => {
    const host = io(BASE_URL, { transports: ['websocket'], forceNew: true });
    sockets.push(host);

    host.on('connect', () => {
      host.emit('create-room', {
        playerName: `Bot-H-${index}`,
        settings: { rounds: 99, drawTime: 600, customWords: [] }
      });
    });

    host.on('room-created', ({ roomCode }) => {
      let joinedCount = 0;

      const tryStart = () => {
        if (++joinedCount < 2) return;
        host.emit('start-game');
      };

      for (let j = 0; j < 2; j++) {
        const guest = io(BASE_URL, { transports: ['websocket'], forceNew: true });
        sockets.push(guest);
        guest.on('connect', () => {
          guest.emit('join-room', { roomCode, playerName: `Bot-G-${index}-${j}` });
        });
        guest.on('room-joined', tryStart);
        guest.on('error-msg', e => console.warn(`Guest join error: ${e.message}`));
      }

      // Drawer: stream synthetic strokes after word is chosen
      host.on('choose-word', () => {
        host.emit('word-chosen', { wordIndex: 0 });
      });

      host.on('round-started', ({ isDrawer }) => {
        if (!isDrawer) return;
        clearInterval(strokeTimer);
        strokeId  = `load-${index}-${Date.now()}`;
        strokeSeq = 0;

        strokeTimer = setInterval(() => {
          strokeCount++;
          // Simulate natural drawing: end stroke every ~20 batches
          const isEnd = (strokeSeq % 20 === 19);
          const seg = makeStrokeSegment(800, 560, strokeId, strokeSeq, isEnd);
          host.emit('draw-stroke', seg);
          strokeSeq++;
          if (isEnd) {
            strokeId  = `load-${index}-${Date.now()}`;
            strokeSeq = 0;
          }
        }, STROKE_INTERVAL_MS);
      });

      resolve({
        cleanup: () => {
          clearInterval(strokeTimer);
          sockets.forEach(s => s.disconnect());
        }
      });
    });

    host.on('error-msg', e => {
      console.warn(`Room ${index} create error: ${e.message}`);
      reject(new Error(e.message));
    });

    // Timeout if room never gets created
    setTimeout(() => reject(new Error(`Room ${index} timed out`)), 15000);
  });
}

// ── Main test loop ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔬 Drawly Load Test`);
  console.log(`   Target : ${BASE_URL}`);
  console.log(`   Ramp   : ${RAMP_SECS}s per step | Step: +${STEP_ROOMS} rooms`);
  console.log(`   Stop   : p99 latency > ${LATENCY_THRESHOLD}ms  OR  CPU > ${CPU_THRESHOLD}%\n`);

  const results = [];
  const cleanups = [];
  let totalRooms = 0;
  let passed = true;

  // Verify server is reachable
  try {
    await getMetrics();
  } catch {
    console.error(`❌ Cannot reach ${BASE_URL}/metrics — is the server running?\n`);
    process.exit(1);
  }

  while (passed && totalRooms < MAX_ROOMS) {
    const target = Math.min(totalRooms + STEP_ROOMS, MAX_ROOMS);
    const batch  = target - totalRooms;
    process.stdout.write(`Spawning ${batch} rooms (total → ${target}) …`);

    const batchCleanups = [];
    for (let i = totalRooms; i < target; i++) {
      try {
        const room = await spawnRoom(i);
        batchCleanups.push(room.cleanup);
        cleanups.push(room.cleanup);
      } catch (e) {
        console.warn(` ⚠️ Room ${i} failed: ${e.message}`);
      }
    }
    totalRooms = target;
    console.log(` done. Waiting ${RAMP_SECS}s for steady state…`);
    await sleep(RAMP_SECS * 1000);

    let m;
    try {
      m = await getMetrics();
    } catch (e) {
      console.error(`\n❌ /metrics failed: ${e.message}`);
      break;
    }

    const row = {
      rooms:    m.rooms,
      sockets:  m.sockets,
      cpu:      m.cpuPercent,
      rssMB:    m.rssMB,
      heapMB:   m.heapUsedMB,
      p50ms:    m.eventLoopLagMs.p50,
      p99ms:    m.eventLoopLagMs.p99,
      maxMs:    m.eventLoopLagMs.max,
      strokes:  m.strokeEventsIn
    };
    results.push(row);

    console.log(
      `   rooms=${row.rooms} sockets=${row.sockets} ` +
      `cpu=${row.cpu}% rss=${row.rssMB}MB heap=${row.heapMB}MB ` +
      `lag p50=${row.p50ms}ms p99=${row.p99ms}ms max=${row.maxMs}ms`
    );

    if (row.p99ms > LATENCY_THRESHOLD || row.cpu > CPU_THRESHOLD) {
      console.log(`\n🛑 Threshold breached at ${row.rooms} rooms.`);
      passed = false;
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  console.log('\nCleaning up sockets…');
  cleanups.forEach(fn => { try { fn(); } catch { /* ignore */ } });
  await sleep(500);

  // ── Report ────────────────────────────────────────────────────────────────
  if (results.length === 0) {
    console.log('No data collected.');
    process.exit(1);
  }

  const last = results[results.length - 1];
  const safe = results.filter(r => r.p99ms <= LATENCY_THRESHOLD && r.cpu <= CPU_THRESHOLD);
  const peak = safe.length ? safe[safe.length - 1] : null;

  console.log('\n\n══════════════════════════════════════════════════════════');
  console.log('  CAPACITY REPORT — paste into README.md');
  console.log('══════════════════════════════════════════════════════════\n');
  console.log('| rooms | sockets | CPU% | RSS MB | heap MB | p50 ms | p99 ms |');
  console.log('|------:|--------:|-----:|-------:|--------:|-------:|-------:|');
  for (const r of results) {
    console.log(
      `| ${String(r.rooms).padStart(5)} | ${String(r.sockets).padStart(7)} | ` +
      `${String(r.cpu).padStart(4)} | ${String(r.rssMB).padStart(6)} | ` +
      `${String(r.heapMB).padStart(7)} | ${String(r.p50ms).padStart(6)} | ` +
      `${String(r.p99ms).padStart(6)} |`
    );
  }
  console.log();
  if (peak) {
    console.log(`✅ Safe operating range: up to **${peak.rooms} rooms** (${peak.sockets} sockets)`);
    console.log(`   at that point: CPU ${peak.cpu}%, RSS ${peak.rssMB} MB, p99 lag ${peak.p99ms} ms`);
  }
  console.log(`🔴 First breach: ${last.rooms} rooms — p99 ${last.p99ms}ms, CPU ${last.cpu}%\n`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
