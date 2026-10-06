const { createWorker } = require('tesseract.js');
const CanvasGrid = require('./renderer');
const config = require('../config');

class OCRService {
  constructor() {
    this.worker = null;
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    try {
      this.worker = await createWorker('eng');
      this.ready = true;
    } catch (e) {
      console.error('Failed to initialize Tesseract:', e);
    }
  }

  /**
   * Run OCR on strokes
   * @param {Array} strokes 
   * @returns {Promise<string>}
   */
  async recognize(strokes) {
    if (!this.ready) await this.init();
    if (!this.ready) return '';

    // Render strokes to a binary PBM image
    const renderer = new CanvasGrid(config.canvas.width, config.canvas.height);
    renderer.renderStrokes(strokes);
    const pbmBuffer = renderer.toPBM();

    try {
      const { data } = await this.worker.recognize(pbmBuffer);
      const text = data.text.trim().toLowerCase();
      if (!text) return [];
      
      // Split into words, applying the global confidence
      const words = text.split(/\s+/).map(w => ({ text: w, confidence: data.confidence }));
      words.push({ text, confidence: data.confidence });
      return words;
    } catch (e) {
      console.error('OCR Recognition failed:', e);
      return '';
    }
  }

  async cleanup() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.ready = false;
    }
  }
}

module.exports = new OCRService();
