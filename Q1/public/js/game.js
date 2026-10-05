/**
 * Game UI Manager — handles game state display, scoreboard, timer, overlays
 */

class GameUI {
  constructor() {
    this.scoreboard = document.getElementById('scoreboard');
    this.roundDisplay = document.getElementById('game-round');
    this.totalRoundsDisplay = document.getElementById('game-total-rounds');
    this.wordHint = document.getElementById('word-hint');
    this.timerText = document.getElementById('timer-text');
    this.timerRing = document.getElementById('timer-ring-progress');
    this.drawingTools = document.getElementById('drawing-tools');
    this.wordSelectOverlay = document.getElementById('word-select-overlay');
    this.wordChoices = document.getElementById('word-choices');
    this.roundEndOverlay = document.getElementById('round-end-overlay');
    this.roundEndTitle = document.getElementById('round-end-title');
    this.roundEndWord = document.getElementById('round-end-word');

    this.totalTime = 80;
    this.currentDrawerId = null;

    this.onWordChosen = null; // callback when drawer picks a word
  }

  /**
   * Update the scoreboard
   * @param {Array} players - [{ id, name, score, connected, isHost }]
   * @param {string} drawerId - current drawer's ID
   * @param {Set} guessedIds - IDs of players who guessed correctly
   */
  updateScoreboard(players, drawerId, guessedIds = new Set()) {
    this.currentDrawerId = drawerId;
    this.scoreboard.innerHTML = '';

    // Sort by score descending
    const sorted = [...players].sort((a, b) => b.score - a.score);

    for (const player of sorted) {
      const div = document.createElement('div');
      div.className = 'score-item';

      if (player.id === drawerId) div.classList.add('drawing');
      if (guessedIds.has(player.id)) div.classList.add('guessed');
      if (!player.connected) div.classList.add('disconnected');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'score-name';

      let icon = '';
      if (player.id === drawerId) icon = '🎨 ';
      else if (guessedIds.has(player.id)) icon = '✅ ';

      nameSpan.textContent = icon + player.name;

      if (!player.connected) {
        const status = document.createElement('span');
        status.className = 'score-status';
        status.textContent = '(offline)';
        nameSpan.appendChild(status);
      }

      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'score-points';
      scoreSpan.textContent = player.score;

      div.appendChild(nameSpan);
      div.appendChild(scoreSpan);
      this.scoreboard.appendChild(div);
    }
  }

  /**
   * Set round info
   */
  setRound(round, total) {
    this.roundDisplay.textContent = round;
    this.totalRoundsDisplay.textContent = total;
  }

  /**
   * Set the word hint display
   */
  setHint(hint) {
    this.wordHint.textContent = hint;
  }

  /**
   * Set the word (for drawer only)
   */
  setWord(word) {
    this.wordHint.textContent = word;
    this.wordHint.style.color = '#7c3aed';
  }

  /**
   * Reset word display to default style
   */
  resetWordDisplay() {
    this.wordHint.style.color = '';
  }

  /**
   * Update the timer
   */
  updateTimer(timeLeft, totalTime) {
    this.totalTime = totalTime || this.totalTime;
    this.timerText.textContent = timeLeft;

    // Update ring progress
    const circumference = 2 * Math.PI * 20; // r=20
    const progress = (timeLeft / this.totalTime) * circumference;
    this.timerRing.style.strokeDashoffset = circumference - progress;

    // Color changes
    this.timerRing.classList.remove('warning', 'danger');
    if (timeLeft <= 10) {
      this.timerRing.classList.add('danger');
    } else if (timeLeft <= 20) {
      this.timerRing.classList.add('warning');
    }
  }

  /**
   * Show/hide drawing tools
   */
  showDrawingTools(show) {
    this.drawingTools.classList.toggle('hidden', !show);
  }

  /**
   * Show word selection overlay
   */
  showWordSelection(words) {
    this.wordChoices.innerHTML = '';

    words.forEach((word, index) => {
      const btn = document.createElement('button');
      btn.className = 'word-choice-btn';
      btn.textContent = word;
      btn.addEventListener('click', () => {
        if (this.onWordChosen) this.onWordChosen(index);
        this.hideWordSelection();
      });
      this.wordChoices.appendChild(btn);
    });

    this.wordSelectOverlay.classList.remove('hidden');
  }

  /**
   * Hide word selection overlay
   */
  hideWordSelection() {
    this.wordSelectOverlay.classList.add('hidden');
  }

  /**
   * Show round end overlay
   */
  showRoundEnd(word, allGuessed) {
    this.roundEndTitle.textContent = allGuessed ? 'Everyone guessed it!' : "Time's up!";
    this.roundEndWord.textContent = word;
    this.roundEndOverlay.classList.remove('hidden');
  }

  /**
   * Hide round end overlay
   */
  hideRoundEnd() {
    this.roundEndOverlay.classList.add('hidden');
  }

  /**
   * Reset all game UI elements
   */
  reset() {
    this.scoreboard.innerHTML = '';
    this.wordHint.textContent = '_ _ _ _ _';
    this.wordHint.style.color = '';
    this.timerText.textContent = '--';
    this.timerRing.style.strokeDashoffset = 0;
    this.timerRing.classList.remove('warning', 'danger');
    this.hideWordSelection();
    this.hideRoundEnd();
    this.showDrawingTools(false);
  }
}
