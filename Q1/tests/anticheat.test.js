const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers/server');
const { connect, closeAll } = require('./helpers/client');
const ocrWorker = require('../server/antiCheat/ocrWorker');

test('AntiCheat', async (t) => {
  let srv;
  let ocrReady = false;
  
  t.before(async () => {
    try {
      await ocrWorker.init();
      ocrReady = true;
    } catch (e) {
      console.log('Tesseract failed to init, will skip tests');
    }
    
    if (ocrReady) {
      srv = await startServer({ antiCheat: true, env: { ANTI_CHEAT_INTERVAL: '1000' } });
    }
  });

  t.after(async () => {
    if (ocrReady) await ocrWorker.cleanup();
    if (srv) closeAll();
    if (srv) await srv.stop();
  });

  await t.test('detects thick block letters', { timeout: 15000 }, async (t) => {
    if (!ocrReady) {
      return t.skip('Tesseract cannot initialise, skipping anti-cheat test');
    }
    
    const customWords = ['tent'];
    const h = connect(srv.url);
    const hostData = await h.createRoom('Host', { customWords });
    const code = hostData.roomCode;
    
    const g = connect(srv.url);
    await g.joinRoom(code, 'Guesser');

    await h.startGame(code);
    await h.playTurn({ drawer: h, guessers: [g] });

    // Draw "tent" in block letters
    const strokes = [];
    const addLine = (id, pts) => {
      strokes.push({ id, seq: 0, color: '#000000', size: 25, tool: 'pen', points: pts });
    };
    
    // T (x: 50 to 200)
    addLine('t1', [{x:50, y:100}, {x:200, y:100}]);
    addLine('t2', [{x:125, y:100}, {x:125, y:400}]);
    
    // E (x: 250 to 400)
    addLine('t3', [{x:250, y:100}, {x:400, y:100}]);
    addLine('t4', [{x:250, y:100}, {x:250, y:400}]);
    addLine('t5', [{x:250, y:250}, {x:350, y:250}]);
    addLine('t6', [{x:250, y:400}, {x:400, y:400}]);
    
    // N (x: 450 to 600)
    addLine('t7', [{x:450, y:400}, {x:450, y:100}]);
    addLine('t8', [{x:450, y:100}, {x:600, y:400}]);
    addLine('t9', [{x:600, y:400}, {x:600, y:100}]);
    
    // T (x: 650 to 800)
    addLine('t10', [{x:650, y:100}, {x:800, y:100}]);
    addLine('t11', [{x:725, y:100}, {x:725, y:400}]);

    for (const stroke of strokes) {
      h.emit('draw-stroke', stroke);
    }
    
    const warn = await h.waitFor('error-msg', d => d.message.includes('Do not write the word'), 10000);
    assert.ok(warn);
    
    await g.waitFor('clear-canvas', undefined, 2000);

    h.close();
    g.close();
  });
  
  await t.test('ignores drawings', { timeout: 15000 }, async (t) => {
    if (!ocrReady) {
      return t.skip('Tesseract cannot initialise, skipping anti-cheat test');
    }
    
    const customWords = ['football'];
    const h = connect(srv.url);
    const hostData = await h.createRoom('Host', { customWords });
    const code = hostData.roomCode;
    
    const g = connect(srv.url);
    await g.joinRoom(code, 'Guesser');

    await h.startGame(code);
    await h.playTurn({ drawer: h, guessers: [g] });

    // Draw wheels and a body
    const strokes = [];
    strokes.push({ id: 's1', seq: 0, color: '#000000', size: 10, tool: 'pen', points: [{x:10, y:50}, {x:30, y:50}, {x:30, y:70}, {x:10, y:70}, {x:10, y:50}] });
    strokes.push({ id: 's2', seq: 0, color: '#000000', size: 10, tool: 'pen', points: [{x:60, y:50}, {x:80, y:50}, {x:80, y:70}, {x:60, y:70}, {x:60, y:50}] });
    strokes.push({ id: 's3', seq: 0, color: '#000000', size: 10, tool: 'pen', points: [{x:5, y:40}, {x:85, y:40}, {x:85, y:50}, {x:5, y:50}, {x:5, y:40}] });

    for (const stroke of strokes) {
      h.emit('draw-stroke', stroke);
    }
    
    await assert.rejects(h.waitFor('error-msg', d => d.message.includes('Do not write'), 8000));

    h.close();
    g.close();
  });
});
