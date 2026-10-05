/**
 * Guess Checker — validates guesses and detects near-misses
 * All checking happens server-side for security
 */

class GuessChecker {
  /**
   * Compute Levenshtein distance between two strings
   */
  static levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b[i - 1] === a[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  /**
   * Check a guess against the secret word
   * @param {string} guess - The player's guess
   * @param {string} word - The secret word
   * @returns {{ correct: boolean, close: boolean, containsAnswer: boolean }}
   */
  static check(guess, word) {
    const normalizedGuess = guess.trim().toLowerCase();
    const normalizedWord = word.trim().toLowerCase();

    // Exact match
    if (normalizedGuess === normalizedWord) {
      return { correct: true, close: false, containsAnswer: true };
    }

    // Check if guess contains the answer (to filter from chat)
    const containsAnswer = normalizedGuess.includes(normalizedWord) ||
                           normalizedWord.includes(normalizedGuess);

    // Near-miss detection (Levenshtein distance ≤ 2 for words >= 4 chars)
    let close = false;
    if (normalizedWord.length >= 4) {
      const distance = GuessChecker.levenshtein(normalizedGuess, normalizedWord);
      close = distance <= 2 && distance > 0;
    } else {
      // For short words, only distance of 1 counts as close
      const distance = GuessChecker.levenshtein(normalizedGuess, normalizedWord);
      close = distance === 1;
    }

    return { correct: false, close, containsAnswer };
  }

  /**
   * Calculate points for a correct guess based on time remaining
   * @param {number} elapsedSeconds - seconds since round started
   * @param {number} totalSeconds - total round time
   * @param {number} guessOrder - order of correct guess (1 = first, 2 = second, etc.)
   * @returns {number} points awarded
   */
  static calculatePoints(elapsedSeconds, totalSeconds, guessOrder) {
    // Base points decrease over time: 500 → 100 minimum
    const timeRatio = 1 - (elapsedSeconds / totalSeconds);
    const basePoints = Math.round(100 + (400 * timeRatio));

    // Small bonus for being earlier (first guesser gets slight edge)
    const orderBonus = Math.max(0, 50 - (guessOrder - 1) * 10);

    return Math.max(100, basePoints + orderBonus);
  }

  /**
   * Calculate drawer points (average of guessers' points)
   * @param {number[]} guesserPoints - array of points awarded to guessers
   * @returns {number}
   */
  static calculateDrawerPoints(guesserPoints) {
    if (guesserPoints.length === 0) return 0;
    const avg = guesserPoints.reduce((a, b) => a + b, 0) / guesserPoints.length;
    // Drawer gets 75% of the average points awarded to guessers
    return Math.round(avg * 0.75);
  }
}

module.exports = GuessChecker;
