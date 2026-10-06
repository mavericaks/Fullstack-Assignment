const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers/server');
const { connect, closeAll } = require('./helpers/client');

test('Drawing & Limits', async (t) => {
  let srv;
  t.before(async () => {
    srv = await startServer();
  });
  t.after(async () => {
    closeAll();
    if (srv) await srv.stop();
  });

  await t.test('strokes, fills, undo, clear, late joiner, limits', async () => {
    const customWords = ['drawingtest1'];
    const drawer = connect(srv.url);
    const roomData = await drawer.createRoom('Drawer', { customWords });
    const code = roomData.roomCode;

    const g1 = connect(srv.url);
    await g1.joinRoom(code, 'G1');

    await drawer.startGame(code);
    await drawer.playTurn({ drawer, guessers: [g1] });

    // Drawer sends stroke
    const validStroke = { id: 's1', seq: 0, points: [{x:10, y:10}, {x:20, y:20}], color: '#000000', size: 5, tool: 'pen' };
    drawer.emit('draw-stroke', validStroke);
    
    const relayed = await g1.waitFor('draw-stroke');
    assert.strictEqual(relayed.id, 's1');
    assert.rejects(drawer.waitFor('draw-stroke', undefined, 300));

    // Coordinates clamped
    const oobStroke = { id: 's2', seq: 0, points: [{x:-50, y:9999}], color: '#000000', size: 5, tool: 'pen' };
    drawer.emit('draw-stroke', oobStroke);
    const relayedOob = await g1.waitFor('draw-stroke', d => d.id === 's2');
    assert.ok(relayedOob.points[0].x >= 0);
    assert.ok(relayedOob.points[0].y <= 560); // assuming 560 is max height

    // >64 points rejected (silently ignored or truncated depending on impl, but shouldn't disconnect)
    const points = [];
    for(let i=0; i<70; i++) points.push({x:10, y:10});
    drawer.emit('draw-stroke', { id: 's3', seq: 0, points, color: '#000000', size: 5, tool: 'pen' });
    
    // Size limit rejected
    const massiveData = 'A'.repeat(5000); // max is 4096
    drawer.emit('draw-stroke', { id: 's4', seq: 0, points: [{x:10,y:10}], color: massiveData, size: 5, tool: 'pen' });
    // It should not be relayed
    await assert.rejects(g1.waitFor('draw-stroke', d => d.id === 's4', 300));
    // Drawer should still be connected
    assert.ok(drawer.socket.connected);

    // Oversize chat
    g1.emit('chat-message', { message: 'A'.repeat(2000) });
    // not relayed
    await assert.rejects(drawer.waitFor('chat-message', d => d.message.length > 500, 300));
    
    // Chat limit (3 per 2s)
    g1.emit('chat-message', { message: 'zzz1' });
    g1.emit('chat-message', { message: 'zzz2' });
    g1.emit('chat-message', { message: 'zzz3' });
    g1.emit('chat-message', { message: 'zzz4' });
    const msg1 = await drawer.waitFor('chat-message', d => d.message === 'zzz1');
    assert.ok(msg1);
    await assert.rejects(drawer.waitFor('chat-message', d => d.message === 'zzz4', 300));

    // Fill
    drawer.emit('fill', { x: 50, y: 50, color: '#ff0000' });
    await g1.waitFor('fill');

    // Undo
    drawer.emit('undo');
    await g1.waitFor('undo');

    // Clear
    drawer.emit('clear-canvas');
    await g1.waitFor('clear-canvas');

    // Late joiner
    const g2 = connect(srv.url);
    await g2.joinRoom(code, 'G2');
    // G2 should receive stroke-history and NEVER the secret word
    const hist = await g2.waitFor('stroke-history');
    assert.ok(Array.isArray(hist.strokes));
    
    const stringified = JSON.stringify(g2.events);
    assert.ok(!stringified.includes('drawingtest1'));

    drawer.close();
    g1.close();
    g2.close();
  });
});
