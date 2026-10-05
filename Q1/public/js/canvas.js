/**
 * Canvas Manager — handles all drawing operations
 * Drawing tools: pen, eraser, fill, undo, clear
 * Stroke capture & rendering, remote stroke playback
 */

class CanvasManager {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.isDrawing = false;
    this.isEnabled = false;
    this.currentTool = 'pen';
    this.currentColor = '#000000';
    this.brushSize = 5;
    this.lastX = 0;
    this.lastY = 0;

    // Undo stack
    this.strokes = [];       // completed strokes (for undo)
    this.currentStroke = null; // stroke being drawn

    // Live streaming: points are batched and flushed every FLUSH_MS while drawing
    this.FLUSH_MS = 25;
    this.MAX_BATCH_POINTS = 40;
    this._pendingPoints = [];
    this._lastFlush = 0;
    this._segSeq = 0;
    // strokeId -> stroke object, for remote strokes still being drawn
    this.remoteActive = new Map();

    // Callbacks
    this.onStrokeSegment = null; // called with each live point batch (send to server)
    this.onUndo = null;
    this.onClear = null;
    this.onFill = null;

    this._setupEvents();
  }

  /**
   * Enable or disable drawing on this canvas
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    this.canvas.style.cursor = enabled ? 'crosshair' : 'default';
  }

  /**
   * Set the active tool
   */
  setTool(tool) {
    this.currentTool = tool;
    if (tool === 'eraser') {
      this.canvas.style.cursor = 'crosshair';
    } else if (tool === 'fill') {
      this.canvas.style.cursor = 'crosshair';
    } else {
      this.canvas.style.cursor = 'crosshair';
    }
  }

  /**
   * Set brush color
   */
  setColor(color) {
    this.currentColor = color;
    if (this.currentTool === 'eraser') {
      this.currentTool = 'pen';
    }
  }

  /**
   * Set brush size
   */
  setSize(size) {
    this.brushSize = size;
  }

  /**
   * Clear the entire canvas
   */
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.strokes = [];
    this.currentStroke = null;
    this.isDrawing = false;
    this._pendingPoints = [];
    this.remoteActive.clear();
  }

  /**
   * Undo the last stroke
   */
  undo() {
    if (this.strokes.length === 0) return;
    this.strokes.pop();
    this._redraw();
    if (this.onUndo) this.onUndo();
  }

  /**
   * Redraw all strokes (used after undo)
   */
  _redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (const stroke of this.strokes) {
      if (stroke.type === 'clear') {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      } else if (stroke.type === 'fill') {
        this._executeFill(stroke.x, stroke.y, stroke.color);
      } else {
        this._renderStroke(stroke);
      }
    }
  }

  /**
   * Render a single stroke on the canvas
   */
  _renderStroke(stroke) {
    if (!stroke.points || stroke.points.length === 0) return;

    this.ctx.beginPath();
    this.ctx.strokeStyle = stroke.tool === 'eraser' ? '#ffffff' : stroke.color;
    this.ctx.lineWidth = stroke.size;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    if (stroke.points.length === 1) {
      // Single dot
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
   * Render a remote stroke (received from server)
   */
  renderRemoteStroke(stroke) {
    if (stroke.type === 'clear') {
      this.clear();
      return;
    }
    if (stroke.type === 'fill') {
      this._executeFill(stroke.x, stroke.y, stroke.color);
      this.strokes.push(stroke);
      return;
    }
    this._renderStroke(stroke);
    this.strokes.push(stroke);
  }

  /**
   * Render a live point batch of a remote stroke as it arrives.
   * seg = { id, seq, color, size, tool, points: [{x,y}], end? }
   * Batches of the same stroke share an id; each batch continues from the
   * last point already drawn, so the line appears while the drawer draws.
   */
  renderRemoteSegment(seg) {
    if (!seg || !seg.id || !Array.isArray(seg.points)) return;

    let stroke = this.remoteActive.get(seg.id);
    if (!stroke) {
      stroke = { id: seg.id, color: seg.color, size: seg.size, tool: seg.tool, points: [] };
      this.remoteActive.set(seg.id, stroke);
      this.strokes.push(stroke);
    }

    const prev = stroke.points[stroke.points.length - 1] || null;
    this._drawSegment(stroke, prev, seg.points);
    for (const p of seg.points) stroke.points.push(p);

    if (seg.end) this.remoteActive.delete(seg.id);
  }

  /**
   * Draw a run of points, continuing from `prev` (if any)
   */
  _drawSegment(stroke, prev, pts) {
    if (!pts || pts.length === 0) return;
    const color = stroke.tool === 'eraser' ? '#ffffff' : stroke.color;

    if (!prev && pts.length === 1) {
      this.ctx.beginPath();
      this.ctx.fillStyle = color;
      this.ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2);
      this.ctx.fill();
      return;
    }

    this.ctx.beginPath();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = stroke.size;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    const start = prev || pts[0];
    this.ctx.moveTo(start.x, start.y);
    for (const p of pts) this.ctx.lineTo(p.x, p.y);
    this.ctx.stroke();
  }

  /**
   * Handle remote undo
   */
  remoteUndo() {
    if (this.strokes.length === 0) return;
    this.strokes.pop();
    this._redraw();
  }

  /**
   * Replay all strokes from history (for mid-round joiners)
   */
  replayHistory(strokes) {
    this.clear();
    for (const stroke of strokes) {
      if (stroke.type === 'clear') {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      } else if (stroke.type === 'fill') {
        this._executeFill(stroke.x, stroke.y, stroke.color);
      } else {
        this._renderStroke(stroke);
        // A stroke still in progress keeps receiving live batches
        if (stroke.id && !stroke.ended) this.remoteActive.set(stroke.id, stroke);
      }
    }
    this.strokes = [...strokes];
  }

  /**
   * Flood fill implementation
   */
  _executeFill(startX, startY, fillColor) {
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imageData.data;
    const w = this.canvas.width;
    const h = this.canvas.height;

    const sx = Math.round(startX);
    const sy = Math.round(startY);

    if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;

    // Parse fill color
    const fc = this._hexToRgb(fillColor);
    if (!fc) return;

    // Get target color
    const targetIdx = (sy * w + sx) * 4;
    const targetR = data[targetIdx];
    const targetG = data[targetIdx + 1];
    const targetB = data[targetIdx + 2];
    const targetA = data[targetIdx + 3];

    // If target matches fill color, nothing to do
    if (targetR === fc.r && targetG === fc.g && targetB === fc.b && targetA === 255) return;

    const stack = [[sx, sy]];
    const visited = new Set();

    const colorMatch = (idx) => {
      return Math.abs(data[idx] - targetR) < 15 &&
             Math.abs(data[idx + 1] - targetG) < 15 &&
             Math.abs(data[idx + 2] - targetB) < 15 &&
             Math.abs(data[idx + 3] - targetA) < 30;
    };

    let iterations = 0;
    const maxIterations = w * h;

    while (stack.length > 0 && iterations < maxIterations) {
      iterations++;
      const [x, y] = stack.pop();
      const key = y * w + x;

      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      if (visited.has(key)) continue;

      const idx = key * 4;
      if (!colorMatch(idx)) continue;

      visited.add(key);
      data[idx] = fc.r;
      data[idx + 1] = fc.g;
      data[idx + 2] = fc.b;
      data[idx + 3] = 255;

      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    this.ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Convert hex color to RGB
   */
  _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  /**
   * Get canvas coordinates from mouse/touch event
   */
  _getCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    let clientX, clientY;
    if (e.touches) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  /**
   * Set up mouse and touch event listeners
   */
  _setupEvents() {
    // Mouse events
    this.canvas.addEventListener('mousedown', (e) => this._startDraw(e));
    this.canvas.addEventListener('mousemove', (e) => this._draw(e));
    this.canvas.addEventListener('mouseup', () => this._endDraw());
    this.canvas.addEventListener('mouseleave', () => this._endDraw());

    // Touch events
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this._startDraw(e);
    });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      this._draw(e);
    });
    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this._endDraw();
    });
  }

  _startDraw(e) {
    if (!this.isEnabled) return;

    const coords = this._getCoords(e);

    // Fill tool
    if (this.currentTool === 'fill') {
      const fillData = { x: coords.x, y: coords.y, color: this.currentColor };
      this._executeFill(coords.x, coords.y, this.currentColor);
      this.strokes.push({ type: 'fill', ...fillData });
      if (this.onFill) this.onFill(fillData);
      return;
    }

    this.isDrawing = true;
    this.lastX = coords.x;
    this.lastY = coords.y;

    const first = { x: Math.round(coords.x), y: Math.round(coords.y) };
    this.currentStroke = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      points: [first],
      color: this.currentColor,
      size: this.brushSize,
      tool: this.currentTool
    };
    this._segSeq = 0;
    this._pendingPoints = [first];
    this._flush(false); // send the first point immediately so the dot appears for others

    // Draw a dot for single clicks
    this.ctx.beginPath();
    this.ctx.fillStyle = this.currentTool === 'eraser' ? '#ffffff' : this.currentColor;
    this.ctx.arc(coords.x, coords.y, this.brushSize / 2, 0, Math.PI * 2);
    this.ctx.fill();
  }

  _draw(e) {
    if (!this.isDrawing || !this.isEnabled) return;

    const coords = this._getCoords(e);

    this.ctx.beginPath();
    this.ctx.strokeStyle = this.currentTool === 'eraser' ? '#ffffff' : this.currentColor;
    this.ctx.lineWidth = this.brushSize;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.moveTo(this.lastX, this.lastY);
    this.ctx.lineTo(coords.x, coords.y);
    this.ctx.stroke();

    this.lastX = coords.x;
    this.lastY = coords.y;

    if (this.currentStroke) {
      const p = { x: Math.round(coords.x), y: Math.round(coords.y) };
      this.currentStroke.points.push(p);
      this._pendingPoints.push(p);

      const now = performance.now();
      if (now - this._lastFlush >= this.FLUSH_MS || this._pendingPoints.length >= this.MAX_BATCH_POINTS) {
        this._flush(false);
      }
    }
  }

  /**
   * Send pending points of the current stroke as one live batch
   */
  _flush(isEnd) {
    if (!this.currentStroke) return;
    if (this._pendingPoints.length === 0 && !isEnd) return;

    const s = this.currentStroke;
    if (this.onStrokeSegment) {
      this.onStrokeSegment({
        id: s.id,
        seq: this._segSeq++,
        color: s.color,
        size: s.size,
        tool: s.tool,
        points: this._pendingPoints,
        end: !!isEnd
      });
    }
    this._pendingPoints = [];
    this._lastFlush = performance.now();
  }

  _endDraw() {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.currentStroke) {
      this._flush(true);
      this.strokes.push(this.currentStroke);
      this.currentStroke = null;
    }
  }
}
