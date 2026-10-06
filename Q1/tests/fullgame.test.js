const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers/server');
const { connect, closeAll } = require('./helpers/client');

test('Full Game', async (t) => {
  let srv;
  t.before(async () => {
    srv = await startServer();
  });
  t.after(async () => {
    closeAll();
    if (srv) await srv.stop();
  });

  await t.test('3 players, 2 rounds', async () => {
    const customWords = ['w1','w2','w3','w4','w5','w6','w7','w8'];
    const p1 = connect(srv.url);
    p1.playerName = 'P1';
    const hostData = await p1.createRoom('P1', { rounds: 2, customWords });
    const code = hostData.roomCode;

    const p2 = connect(srv.url);
    p2.playerName = 'P2';
    await p2.joinRoom(code, 'P2');
    
    const p3 = connect(srv.url);
    p3.playerName = 'P3';
    await p3.joinRoom(code, 'P3');

    await p1.startGame(code);

    const players = [p1, p2, p3];
    const drawCounts = { 'P1': 0, 'P2': 0, 'P3': 0 };

    for (let turn = 0; turn < 6; turn++) {
      if (turn > 0) for (const p of players) p.events.length = 0;
      // Find who is drawing
      const drawerProm = Promise.any(players.map(p => p.waitFor('choose-word', undefined, 8000).then(() => p)));
      const drawer = await drawerProm;
      const drawerName = drawer.playerName;
      drawCounts[drawerName]++;

      const guessers = players.filter(p => p !== drawer);
      
      const secret = await drawer.playTurn({ drawer, guessers });
      
      drawer.emit('draw-stroke', { id: `s${turn}`, seq: 0, points: [{x:1,y:1}], color: '#000000', size: 5, tool: 'pen' });

      // Guessers guess correctly
      for (const g of guessers) {
        g.emit('chat-message', { message: secret });
        await g.waitFor('correct-guess');
      }

      if (turn < 5) {
        // wait for turn-end and next turn
        await drawer.waitFor('round-ended');
      }
    }

    // Wait for game over
    const gameOver = await p1.waitFor('game-over', undefined, 8000);
    assert.ok(gameOver);
    
    // Validate assertions
    assert.strictEqual(drawCounts['P1'], 2);
    assert.strictEqual(drawCounts['P2'], 2);
    assert.strictEqual(drawCounts['P3'], 2);

    // Final scores sorted descending
    const scores = gameOver.finalScores.map(p => p.score);
    const sortedScores = [...scores].sort((a, b) => b - a);
    assert.deepStrictEqual(scores, sortedScores);

    // Replays
    const replays = gameOver.replays;
    assert.strictEqual(replays.length, 6);
    for (const rep of replays) {
      assert.ok(rep.word);
      assert.ok(rep.strokes.length > 0);
    }

    // Start game after GAME_OVER restarts with scores reset
    await p1.startGame(code);
    await p1.waitFor('game-started');
    const newJoinEvent = p1.all('player-joined').pop(); // when scores update, usually via player-joined or game-start
    const scoresReset = p1.events.find(e => e.name === 'game-started').data.players;
    for (const p of scoresReset) {
      assert.strictEqual(p.score, 0);
    }

    p1.close();
    p2.close();
    p3.close();
  });
});
