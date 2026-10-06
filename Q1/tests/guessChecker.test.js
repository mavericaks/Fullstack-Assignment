const test = require('node:test');
const assert = require('node:assert');
const GuessChecker = require('../server/guessChecker');

test('GuessChecker - exact match', (t) => {
  const result = GuessChecker.check('football', 'football');
  assert.strictEqual(result.correct, true);
  assert.strictEqual(result.close, false);
});

test('GuessChecker - case insensitivity', (t) => {
  const result = GuessChecker.check('FOOtball', 'football');
  assert.strictEqual(result.correct, true);
});

test('GuessChecker - close match', (t) => {
  const result = GuessChecker.check('footbal', 'football');
  assert.strictEqual(result.correct, false);
  assert.strictEqual(result.close, true);
});

test('GuessChecker - contains answer', (t) => {
  const result = GuessChecker.check('i think it is football', 'football');
  assert.strictEqual(result.correct, false);
  assert.strictEqual(result.close, false);
  assert.strictEqual(result.containsAnswer, true);
});

test('GuessChecker - completely wrong', (t) => {
  const result = GuessChecker.check('apple', 'football');
  assert.strictEqual(result.correct, false);
  assert.strictEqual(result.close, false);
  assert.strictEqual(result.containsAnswer, false);
});
