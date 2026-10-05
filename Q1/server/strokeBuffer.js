/**
 * Stroke Buffer — stores all strokes per round for:
 * 1. Mid-round joiners (canvas reconstruction)
 * 2. End-of-game replay
 */

class StrokeBuffer {
  constructor() {
    // roundIndex -> { strokes: [], undoStack: [], startTime: number }
    this.rounds = new Map();
    this.currentRound = 0;
  }

  /**
   * Start a new round buffer
   */
  startRound(roundIndex) {
    this.currentRound = roundIndex;
    this.rounds.set(roundIndex, {
      strokes: [],
      undoStack: [],
      active: new Map(), // strokeId -> stroke still being drawn
      totalPoints: 0,
      startTime: Date.now(),
      word: null,
      drawer: null
    });
  }

  /**
   * Set metadata for the current round (for replay)
   */
  setRoundMeta(roundIndex, word, drawerName) {
    const round = this.rounds.get(roundIndex);
    if (round) {
      round.word = word;
      round.drawer = drawerName;
    }
  }

  /**
   * Append a live point batch. Batches with the same id are merged into one
   * stroke so undo / mid-round join / replay operate on whole strokes.
   * @param {object} seg - { id, seq, color, size, tool, points, end }
   * @returns {boolean} false if the turn's memory cap was hit
   */
  addSegment(seg) {
    const round = this.rounds.get(this.currentRound);
    if (!round) return false;

    // Hard caps per turn to bound server memory
    if (round.totalPoints + seg.points.length > StrokeBuffer.MAX_POINTS_PER_TURN) return false;

    const now = Date.now() - round.startTime;
    let stroke = round.active.get(seg.id);

    if (!stroke) {
      if (round.strokes.length >= StrokeBuffer.MAX_STROKES_PER_TURN) return false;
      stroke = {
        id: seg.id,
        color: seg.color,
        size: seg.size,
        tool: seg.tool,
        points: [],
        timestamp: now,
        endTimestamp: now,
        ended: false
      };
      round.active.set(seg.id, stroke);
      round.strokes.push(stroke);
    }

    for (const p of seg.points) stroke.points.push(p);
    round.totalPoints += seg.points.length;
    stroke.endTimestamp = now;

    if (seg.end) {
      stroke.ended = true;
      round.active.delete(seg.id);
    }
    return true;
  }

  /**
   * Record an undo action (never undoes past a clear, matching the client)
   */
  addUndo() {
    const round = this.rounds.get(this.currentRound);
    if (!round) return;

    const last = round.strokes[round.strokes.length - 1];
    if (!last || last.type === 'clear') return;

    round.strokes.pop();
    if (last.id) round.active.delete(last.id);
    round.undoStack.push(last);
  }

  /**
   * Record a clear canvas action
   */
  addClear() {
    const round = this.rounds.get(this.currentRound);
    if (!round) return;

    // Store a special "clear" marker
    round.strokes.push({
      type: 'clear',
      timestamp: Date.now() - round.startTime
    });
    round.active.clear();
  }

  /**
   * Record a fill action
   */
  addFill(fillData) {
    const round = this.rounds.get(this.currentRound);
    if (!round) return;

    round.strokes.push({
      type: 'fill',
      ...fillData,
      timestamp: Date.now() - round.startTime
    });
  }

  /**
   * Get all strokes for the current round (for mid-round joiners)
   * @returns {object[]} array of strokes
   */
  getCurrentStrokes() {
    const round = this.rounds.get(this.currentRound);
    return round ? round.strokes : [];
  }

  /**
   * Get all rounds data for replay
   * @returns {object[]} array of round data
   */
  getAllRounds() {
    const replays = [];
    for (const [index, data] of this.rounds) {
      const last = data.strokes[data.strokes.length - 1];
      replays.push({
        round: index,
        word: data.word,
        drawer: data.drawer,
        strokes: data.strokes,
        duration: last ? (last.endTimestamp || last.timestamp) : 0
      });
    }
    return replays;
  }

  /**
   * Reset all buffers
   */
  reset() {
    this.rounds.clear();
    this.currentRound = 0;
  }
}

module.exports = StrokeBuffer;

// Per-turn memory caps (a busy 3-minute drawing is typically < 10k points)
StrokeBuffer.MAX_STROKES_PER_TURN = 3000;
StrokeBuffer.MAX_POINTS_PER_TURN = 60000;
