/**
 * Word Manager — handles word selection, hints, and custom word lists
 */

const defaultWords = require('./words.json');
const config = require('./config');

class WordManager {
  constructor(customWords = null, category = 'general') {
    if (customWords && customWords.length > 0) {
      this.words = customWords;
    } else {
      this.words = defaultWords[category] || defaultWords['general'];
    }
    this.usedWords = new Set();
  }

  /**
   * Get 3 random words for the drawer to pick from
   * Avoids repeating words within the same game
   * @returns {string[]} array of 3 words
   */
  getWordChoices() {
    const available = this.words.filter(w => !this.usedWords.has(w));

    // If we've used too many, reset the used set
    if (available.length < config.game.wordChoices) {
      this.usedWords.clear();
      return this._pickRandom(this.words, config.game.wordChoices);
    }

    return this._pickRandom(available, config.game.wordChoices);
  }

  /**
   * Mark a word as used
   * @param {string} word
   */
  markUsed(word) {
    this.usedWords.add(word);
  }

  /**
   * Generate hint string with progressively revealed letters
   * @param {string} word - the secret word
   * @param {number} revealCount - number of letters to reveal
   * @returns {{ hint: string, revealedIndices: number[] }}
   */
  static generateHint(word, revealCount) {
    const chars = word.split('');
    const letterIndices = [];

    // Find indices of actual letters (not spaces)
    chars.forEach((ch, i) => {
      if (ch !== ' ') letterIndices.push(i);
    });

    // Shuffle and pick indices to reveal
    const shuffled = [...letterIndices].sort(() => Math.random() - 0.5);
    const revealedIndices = shuffled.slice(0, Math.min(revealCount, letterIndices.length));

    const hint = chars.map((ch, i) => {
      if (ch === ' ') return '  ';
      if (revealedIndices.includes(i)) return ch;
      return '_';
    }).join(' ');

    return { hint, revealedIndices };
  }

  /**
   * Compute how many letters to reveal based on time elapsed
   * @param {number} elapsed - seconds elapsed
   * @param {number} total - total round time
   * @param {number} wordLength - length of the word (excluding spaces)
   * @returns {number} number of letters to reveal
   */
  static getRevealCount(elapsed, total, wordLength) {
    const ratio = elapsed / total;
    let reveal = 0;
    for (const step of config.game.hintSchedule) {
      if (ratio >= step.at) reveal = step.reveal;
    }
    return Math.min(reveal, Math.floor(wordLength * config.game.maxHintFraction));
  }

  /**
   * Pick N random items from an array
   */
  _pickRandom(arr, n) {
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
  }

  /**
   * Reset for a new game
   */
  reset() {
    this.usedWords.clear();
  }
}

module.exports = WordManager;
