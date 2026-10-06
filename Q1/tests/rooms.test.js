const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers/server');
const { connect, closeAll } = require('./helpers/client');

test('Rooms', async (t) => {
  let srv;
  t.before(async () => {
    srv = await startServer({ env: { MAX_ROOMS: 100 } });
  });
  t.after(async () => {
    closeAll();
    if (srv) await srv.stop();
  });

  await t.test('create returns a 6-char code and host flag, settings honored', async () => {
    const c1 = connect(srv.url);
    const data = await c1.createRoom('Host', { rounds: 5, drawTime: 120 });
    assert.strictEqual(typeof data.roomCode, 'string');
    assert.strictEqual(data.roomCode.length, 6);
    assert.strictEqual(data.player.isHost, true);
    assert.strictEqual(data.settings.rounds, 5);
    assert.strictEqual(data.settings.drawTime, 120);
    c1.close();
  });

  await t.test('lower-case code joins, duplicate name rejected', async () => {
    const c1 = connect(srv.url);
    const data = await c1.createRoom('Alice');
    
    const c2 = connect(srv.url);
    const data2 = await c2.joinRoom(data.roomCode.toLowerCase(), 'Bob');
    assert.strictEqual(data2.roomCode, data.roomCode);
    
    const c3 = connect(srv.url);
    await assert.rejects(
      c3.joinRoom(data.roomCode, 'Alice'),
      /Name already taken/
    );

    c1.close();
    c2.close();
    c3.close();
  });

  await t.test('non-host cannot start, needs >= 2 players', async () => {
    const c1 = connect(srv.url);
    const data = await c1.createRoom('Alice');
    
    // 1 player, host tries to start -> error
    c1.emit('start-game', { code: data.roomCode });
    const err = await c1.waitFor('error-msg', (d) => d.message.includes('Need at least'));
    assert.ok(err);

    const c2 = connect(srv.url);
    await c2.joinRoom(data.roomCode, 'Bob');

    // non-host tries to start -> ignored or error
    c2.emit('start-game', { code: data.roomCode });
    // Should not receive game-start
    await assert.rejects(c2.waitFor('game-started', undefined, 500));

    // host tries to start with 2 players -> succeeds
    c1.emit('start-game', { code: data.roomCode });
    await c1.waitFor('game-started');
    await c2.waitFor('game-started');

    c1.close();
    c2.close();
  });

  await t.test('unknown room errors', async () => {
    const c1 = connect(srv.url);
    await assert.rejects(
      c1.joinRoom('INVALID', 'Alice'),
      /Room not found/
    );
    c1.close();
  });

  await t.test('more than 5 creates in 10 s from one socket yields at most 5 rooms', async () => {
    const c1 = connect(srv.url);
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < 7; i++) {
      c1.events.length = 0; // Clear past events so waitFor doesn't resolve immediately
      try {
        await c1.createRoom(`Alice${i}`);
        successCount++;
      } catch (e) {
        failCount++;
      }
    }
    
    assert.strictEqual(successCount, 5);
    assert.ok(failCount >= 2);
    
    c1.close();
  });
});
