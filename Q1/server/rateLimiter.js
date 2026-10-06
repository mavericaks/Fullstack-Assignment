/**
 * Rate Limiter — server-side abuse protection
 * Limits chat messages and stroke events per player
 */

const config = require('./config');

class RateLimiter {
  constructor() {
    // playerID -> { chat: [timestamps], stroke: [timestamps] }
    this.buckets = new Map();
  }

  /**
   * Get or create bucket for a player
   */
  _getBucket(playerId) {
    if (!this.buckets.has(playerId)) {
      this.buckets.set(playerId, { chat: [], stroke: [], room: [], reconnect: [], control: [] });
    }
    return this.buckets.get(playerId);
  }

  /**
   * Check if action is allowed under rate limit
   * @param {string} playerId
   * @param {string} type - 'chat' or 'stroke'
   * @returns {boolean} true if allowed
   */
  check(playerId, type) {
    const bucket = this._getBucket(playerId);
    const now = Date.now();

    const limit = config.rateLimits[type];
    if (!limit) return true;

    // Clean old entries outside the window
    bucket[type] = bucket[type].filter(t => now - t < limit.windowMs);

    if (bucket[type].length >= limit.max) {
      return false;
    }

    bucket[type].push(now);
    return true;
  }

  /**
   * Validate payload size
   * @param {*} data
   * @param {string} type - 'chat' or 'stroke'
   * @returns {boolean} true if within limits
   */
  checkSize(data, type) {
    const json = JSON.stringify(data);
    const sizeBytes = Buffer.byteLength(json, 'utf-8');

    return sizeBytes <= (config.payloadLimits[type] || 1024);
  }

  /**
   * Remove player's rate limit data
   */
  remove(playerId) {
    this.buckets.delete(playerId);
  }
}

module.exports = RateLimiter;
