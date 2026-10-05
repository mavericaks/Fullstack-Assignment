/**
 * Replay Player — stroke-by-stroke replay of all drawings at end of game
 */

class ReplayPlayer {
  constructor() {
    this.canvas = document.getElementById('replay-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.wordDisplay = document.getElementById('replay-word-display');
    this.roundInfo = document.getElementById('replay-round-info');
    this.playBtn = document.getElementById('replay-play');
    this.prevBtn = document.getElementById('replay-prev');
    this.nextBtn = document.getElementById('replay-next');
    this.speedSelect = document.getElementById('replay-speed-select');
    this.closeBtn = document.getElementById('replay-close');

    this.rounds = [];
    this.currentRoundIndex = 0;
    this.currentStrokeIndex = 0;
    this.isPlaying = false;
    this.speed = 1;
    this.animationTimer = null;

    this.onClose = null;

    this._setupEvents();
  }

  _setupEvents() {
    this.playBtn.addEventListener('click', () => {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    });

    this.prevBtn.addEventListener('click', () => {
      this.pause();
      this.currentRoundIndex = Math.max(0, this.currentRoundIndex - 1);
      this._loadRound();
    });

    this.nextBtn.addEventListener('click', () => {
      this.pause();
      this.currentRoundIndex = Math.min(this.rounds.length - 1, this.currentRoundIndex + 1);
      this._loadRound();
    });

    this.speedSelect.addEventListener('change', () => {
      this.speed = parseFloat(this.speedSelect.value);
      if (this.isPlaying) {
        this.pause();
        this.play();
      }
    });

    this.closeBtn.addEventListener('click', () => {
      this.pause();
      if (this.onClose) this.onClose();
    });
  }

  /**
   * Load replay data and start
   */
  loadReplays(replays) {
    this.rounds = replays.filter(r => r.strokes && r.strokes.length > 0);
    this.currentRoundIndex = 0;

    if (this.rounds.length === 0) {
      this.wordDisplay.textContent = 'No drawings to replay';
      return;
    }

    this._loadRound();
  }

  /**
   * Load a specific round for replay
   */
  _loadRound() {
    this.currentStrokeIndex = 0;
    this._clearCanvas();

    const round = this.rounds[this.currentRoundIndex];
    if (!round) return;

    this.wordDisplay.textContent = `"${round.word}" by ${round.drawer}`;
    this.roundInfo.textContent = `Round ${this.currentRoundIndex + 1} / ${this.rounds.length}`;
  }

  /**
   * Clear the replay canvas
   */
  _clearCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Start playback
   */
  play() {
    this.isPlaying = true;
    this.playBtn.textContent = '⏸️';

    const round = this.rounds[this.currentRoundIndex];
    if (!round || !round.strokes) return;

    this._playNextStroke();
  }

  /**
   * Pause playback
   */
  pause() {
    this.isPlaying = false;
    this.playBtn.textContent = '▶️';
    if (this.animationTimer) {
      clearTimeout(this.animationTimer);
      this.animationTimer = null;
    }
  }

  /**
   * Play the next stroke in the sequence
   */
  _playNextStroke() {
    if (!this.isPlaying) return;

    const round = this.rounds[this.currentRoundIndex];
    if (!round || this.currentStrokeIndex >= round.strokes.length) {
      // Round finished — move to next or stop
      if (this.currentRoundIndex < this.rounds.length - 1) {
        this.currentRoundIndex++;
        this._loadRound();
        this.animationTimer = setTimeout(() => {
          this.play();
        }, 1000 / this.speed);
      } else {
        this.pause();
      }
      return;
    }

    const stroke = round.strokes[this.currentStrokeIndex];
    this._renderReplayStroke(stroke);
    this.currentStrokeIndex++;

    // Calculate delay until next stroke
    let delay = 50; // default minimum delay
    if (this.currentStrokeIndex < round.strokes.length) {
      const nextStroke = round.strokes[this.currentStrokeIndex];
      const timeDiff = (nextStroke.timestamp || 0) - (stroke.timestamp || 0);
      delay = Math.max(16, Math.min(500, timeDiff)); // clamp between 16ms and 500ms
    }

    this.animationTimer = setTimeout(() => {
      this._playNextStroke();
    }, delay / this.speed);
  }

  /**
   * Render a single stroke on the replay canvas
   */
  _renderReplayStroke(stroke) {
    if (stroke.type === 'clear') {
      this._clearCanvas();
      return;
    }

    if (stroke.type === 'fill') {
      this._executeFill(stroke.x, stroke.y, stroke.color);
      return;
    }

    if (!stroke.points || stroke.points.length === 0) return;

    this.ctx.beginPath();
    this.ctx.strokeStyle = stroke.tool === 'eraser' ? '#ffffff' : stroke.color;
    this.ctx.lineWidth = stroke.size;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    if (stroke.points.length === 1) {
      this.ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
      this.ctx.fillStyle = stroke.tool === 'eraser' ? '#ffffff' : stroke.color;
      this.ctx.fill();
    } else {
      this.ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        this.ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      this.ctx.stroke();
    }
  }

  /**
   * Flood fill for replay (simplified copy from CanvasManager)
   */
  _executeFill(startX, startY, fillColor) {
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imageData.data;
    const w = this.canvas.width;
    const h = this.canvas.height;

    const sx = Math.round(startX);
    const sy = Math.round(startY);
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;

    const fc = this._hexToRgb(fillColor);
    if (!fc) return;

    const targetIdx = (sy * w + sx) * 4;
    const targetR = data[targetIdx];
    const targetG = data[targetIdx + 1];
    const targetB = data[targetIdx + 2];
    const targetA = data[targetIdx + 3];

    if (targetR === fc.r && targetG === fc.g && targetB === fc.b) return;

    const stack = [[sx, sy]];
    const visited = new Set();

    while (stack.length > 0) {
      const [x, y] = stack.pop();
      const key = y * w + x;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      if (visited.has(key)) continue;
      const idx = key * 4;
      if (Math.abs(data[idx] - targetR) > 15 || Math.abs(data[idx+1] - targetG) > 15 ||
          Math.abs(data[idx+2] - targetB) > 15 || Math.abs(data[idx+3] - targetA) > 30) continue;
      visited.add(key);
      data[idx] = fc.r; data[idx+1] = fc.g; data[idx+2] = fc.b; data[idx+3] = 255;
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    this.ctx.putImageData(imageData, 0, 0);
  }

  _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16)
    } : null;
  }
}
