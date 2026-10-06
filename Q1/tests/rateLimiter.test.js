const test = require('node:test');
const assert = require('node:assert');
const RateLimiter = require('../server/rateLimiter');

test('RateLimiter - sliding window allows under limit', (t) => {
  const limiter = new RateLimiter();
  const id = 'user1';
  // Check chat limit (3 per 2 seconds)
  assert.strictEqual(limiter.check(id, 'chat'), true);
  assert.strictEqual(limiter.check(id, 'chat'), true);
  assert.strictEqual(limiter.check(id, 'chat'), true);
});

test('RateLimiter - sliding window blocks over limit', (t) => {
  const limiter = new RateLimiter();
  const id = 'user2';
  
  assert.strictEqual(limiter.check(id, 'chat'), true);
  assert.strictEqual(limiter.check(id, 'chat'), true);
  assert.strictEqual(limiter.check(id, 'chat'), true);
  
  // 4th should be blocked
  assert.strictEqual(limiter.check(id, 'chat'), false);
});

test('RateLimiter - limits reset after window expires', async (t) => {
  // We can't mock time easily in node:test without extra libs, so we'll just test the core logic or wait.
  // Wait is 2 seconds, which is a bit long for a unit test, but acceptable for this basic suite.
  const limiter = new RateLimiter();
  const id = 'user3';
  
  limiter.check(id, 'chat');
  limiter.check(id, 'chat');
  limiter.check(id, 'chat');
  assert.strictEqual(limiter.check(id, 'chat'), false);
  
  await new Promise(resolve => setTimeout(resolve, 2100)); // wait for window to clear
  
  assert.strictEqual(limiter.check(id, 'chat'), true);
});

test('RateLimiter - checkSize limits', (t) => {
  const limiter = new RateLimiter();
  
  // Stroke max is 32768
  const largeStroke = { data: 'a'.repeat(33000) };
  assert.strictEqual(limiter.checkSize(largeStroke, 'stroke'), false);
  
  const validStroke = { data: 'a' };
  assert.strictEqual(limiter.checkSize(validStroke, 'stroke'), true);
  
  // Chat max is 1024
  const largeChat = { message: 'a'.repeat(2000) };
  assert.strictEqual(limiter.checkSize(largeChat, 'chat'), false);
});
