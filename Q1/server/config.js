/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  server/config.js — Central configuration
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  PURPOSE
 *    Every "magic number" the server uses lives here: timers, limits, canvas
 *    size, rate limits and anti-cheat thresholds. No other module hard-codes
 *    these values; they all `require('./config')` (or receive it injected).
 *
 *  WHY IT MATTERS (extensibility)
 *    • Changing game balance (e.g. a 15-second word-pick timeout) is a
 *      one-line change here, not a hunt through five files.
 *    • A few values can be overridden with environment variables so the same
 *      build can run in dev, in a load test, or in production.
 *    • The object is deep-frozen, so a bug elsewhere can never mutate config
 *      at runtime (that would silently change behaviour for every room).
 *
 *  HOW TO OVERRIDE (PowerShell examples)
 *    $env:PORT=4000; npm start               → listen on another port
 *    $env:ANTI_CHEAT="off"; npm start        → disable OCR anti-cheat
 *    $env:OCR_LANG_PATH="./tessdata"; ...    → load OCR model from a local folder
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

/** Read an integer env var, falling back to `def` when missing/invalid. */
function envInt(name, def) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : def;
}

/** Read a boolean-ish env var ("off", "false", "0" → false). */
function envBool(name, def) {
  const v = process.env[name];
  if (v === undefined) return def;
  return !['off', 'false', '0', 'no'].includes(String(v).toLowerCase());
}

/** Recursively freeze an object so nothing can change config at runtime. */
function deepFreeze(obj) {
  Object.values(obj).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); });
  return Object.freeze(obj);
}

const config = {
  // ── HTTP / Socket.IO transport ────────────────────────────────────────────
  server: {
    port: envInt('PORT', 3000),
    host: process.env.HOST || '0.0.0.0',   // 0.0.0.0 = reachable from other devices on the LAN
    // Socket.IO heartbeat: a silently-dropped client is detected in ≤ interval + timeout (~15 s)
    pingIntervalMs: 5000,
    pingTimeoutMs: 10000,
    // Hard cap on any single incoming socket message (bytes). Big enough for a
    // create-room with a long custom word list, small enough to stop floods.
    maxHttpBufferSize: 32 * 1024
  },

  // ── Rooms & players ───────────────────────────────────────────────────────
  room: {
    codeLength: 6,
    codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // no 0/O or 1/I to avoid confusion
    maxRooms: envInt('MAX_ROOMS', 2000),                // safety valve for one instance
    maxPlayers: 12,
    minPlayersToStart: 2,
    nameMaxLength: 20,
    reconnectGraceMs: 30000,      // a dropped/refreshed player keeps their seat + score this long
    drawerReturnGraceMs: 8000,    // a disconnected drawer gets this long to come back before the turn is skipped
    emptyRoomTtlMs: 5 * 60 * 1000 // a room with nobody connected is deleted after this
  },

  // ── Host-configurable settings (min / max / default) ──────────────────────
  settings: {
    rounds:   { min: 1,  max: 10,  default: 3 },
    drawTime: { min: 30, max: 180, default: 80 },
    customWords: { maxCount: 300, maxLength: 30, minToUseExclusively: 3 }
  },

  // ── Turn flow ─────────────────────────────────────────────────────────────
  game: {
    wordChoices: 3,             // drawer picks from this many words
    pickTimeoutMs: 15000,       // auto-pick if the drawer doesn't choose in time
    roundEndDelayMs: 5000,      // "the word was…" screen duration between turns
    // Hint schedule: fraction of draw time elapsed → letters revealed
    hintSchedule: [
      { at: 0.40, reveal: 1 },
      { at: 0.60, reveal: 2 },
      { at: 0.80, reveal: 3 }
    ],
    maxHintFraction: 0.5        // never reveal more than half the letters
  },

  // ── Canvas & stroke data ──────────────────────────────────────────────────
  canvas: {
    width: 800,
    height: 560,
    maxPointsPerSegment: 64,    // one live batch (client flushes every 25 ms)
    maxBrushSize: 50,
    maxStrokesPerTurn: 3000,    // memory cap per turn
    maxPointsPerTurn: 60000,    // memory cap per turn
    maxReplayPoints: 250000     // total points sent in the end-of-game replay (decimated above this)
  },

  // ── Abuse protection (sliding-window rate limits) ─────────────────────────
  rateLimits: {
    chat:      { max: 3,   windowMs: 2000 },   // 3 messages / 2 s
    stroke:    { max: 120, windowMs: 1000 },   // 120 stroke/fill events / s (client sends ~40)
    room:      { max: 5,   windowMs: 10000 },  // create/join attempts per socket
    reconnect: { max: 5,   windowMs: 10000 },
    control:   { max: 20,  windowMs: 5000 }    // undo / clear / word-pick / start
  },
  payloadLimits: {             // bytes, measured on JSON.stringify(payload)
    chat: 1024,
    stroke: 4096
  },
  chat: {
    maxLength: 200
  },

  // ── Anti word-writing system (see server/antiCheat/*) ─────────────────────
  antiCheat: {
    enabled: envBool('ANTI_CHEAT', true),
    checkIntervalMs: 2500,         // how often each room's canvas is re-examined (only if it changed)
    minStrokesForCheck: 2,         // fewer pen strokes than this is never treated as text
    heuristicThreshold: 0.55,      // 0..1 "looks like handwriting" score needed before OCR runs
    similarityThreshold: 0.80,     // OCR text vs secret word similarity that counts as cheating
    exactMatchBelowLength: 4,      // words shorter than this must be read *exactly* (avoids false hits)
    maxRegionsPerCheck: 2,         // OCR at most this many text-like lines per check
    maxStrikes: 3,                 // 3rd violation ends the drawer's turn
    penaltyPoints: 50,             // deducted from the 2nd strike onwards (score never < 0)
    ocr: {
      workers: envInt('OCR_WORKERS', 1),
      timeoutMs: 8000,
      maxQueue: 20,                // if OCR is overloaded, new checks are skipped (fail-open)
      langPath: process.env.OCR_LANG_PATH || undefined, // undefined → tesseract.js default CDN
      minConfidence: 35            // ignore OCR reads below this confidence (0-100)
    }
  }
};

module.exports = deepFreeze(config);
