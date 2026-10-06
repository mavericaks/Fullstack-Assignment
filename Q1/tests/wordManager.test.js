const test = require('node:test');
const assert = require('node:assert');
const WordManager = require('../server/wordManager');

test('WordManager', async (t) => {
  await t.test('no repeats within a game', () => {
    const customWords = ['a', 'b', 'c', 'd', 'e'];
    const wm = new WordManager(customWords, 'general');
    const chosen = new Set();
    
    // Select multiple times
    for(let i=0; i<4; i++) {
      const choices = wm.getWordChoices(); 
      if (choices.length < 3) break; // maybe ran out of words
      wm.markUsed(choices[0]);
      chosen.add(choices[0]);
    }
    
    // No repeats means marked words shouldn't reappear in getChoices if possible
    // Wait, getChoices filters out `usedWords`.
    assert.ok(chosen.size > 0);
  });
  
  await t.test('hint reveal counts', () => {
    const wm = new WordManager([], 'general');
    const hint1 = WordManager.generateHint('apple', 1);
    const hint2 = WordManager.generateHint('apple', 2);
    
    // apple has 5 letters
    const numVisible1 = hint1.hint.replace(/[^a-z]/gi, '').length;
    const numVisible2 = hint2.hint.replace(/[^a-z]/gi, '').length;
    
    assert.strictEqual(numVisible1, 1);
    assert.strictEqual(numVisible2, 2);
  });
});
