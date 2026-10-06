const test = require('node:test');
const assert = require('node:assert');
const StrokeBuffer = require('../server/strokeBuffer');

test('StrokeBuffer', async (t) => {
  await t.test('merge by stroke id', () => {
    const sb = new StrokeBuffer();
    
    sb.startRound(1);
    sb.addSegment({ id: 's1', seq: 0, points: [{x:1, y:1}], tool: 'pen' });
    assert.strictEqual(sb.getCurrentStrokes().length, 1);
    assert.strictEqual(sb.getCurrentStrokes()[0].points.length, 1);

    sb.addSegment({ id: 's1', seq: 1, points: [{x:2, y:2}], tool: 'pen' });
    assert.strictEqual(sb.getCurrentStrokes().length, 1);
    assert.strictEqual(sb.getCurrentStrokes()[0].points.length, 2); // merged!
  });

  await t.test('undo never passes a clear', () => {
    const sb = new StrokeBuffer();
    sb.startRound(1);
    sb.addSegment({ id: 's1', seq: 0, points: [], tool: 'pen', end: true });
    sb.addSegment({ id: 's2', seq: 0, points: [], tool: 'pen', end: true });
    sb.addClear();
    sb.addSegment({ id: 's3', seq: 0, points: [], tool: 'pen', end: true });
    
    // Undo once removes s3
    sb.addUndo();
    assert.strictEqual(sb.getCurrentStrokes().length, 3); // s1, s2, clear
    
    // Undo again should NOT remove s2 (clear blocks undo)
    sb.addUndo();
    assert.strictEqual(sb.getCurrentStrokes().length, 3); // s1, s2, clear
    
    const hist = sb.getCurrentStrokes();
    // history should contain s1, s2, clear
    assert.strictEqual(hist.length, 3);
    assert.strictEqual(hist[2].type, 'clear');
  });
  
  await t.test('per-turn caps', () => {
    const sb = new StrokeBuffer();
    sb.startRound(1);
    // Simulate exceeding limit (3000 max strokes)
    for(let i=0; i<3005; i++) {
      sb.addSegment({ id: `s${i}`, seq: 0, points: [{x:1, y:1}], tool: 'pen' });
    }
    const strokes = sb.getCurrentStrokes();
    // It should clamp to maxStrokesPerTurn (3000)
    assert.ok(strokes.length <= 3000);
  });
});
