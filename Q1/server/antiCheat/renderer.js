/**
 * Simple Pure-JS Canvas Renderer
 * Renders stroke data into a portable bitmap buffer for OCR.
 */

class CanvasGrid {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height);
  }

  clear() {
    this.data.fill(0);
  }

  drawCircle(cx, cy, r, isEraser = false) {
    const val = isEraser ? 0 : 1;
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + r));
    
    const rSq = r * r;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= rSq) {
          this.data[y * this.width + x] = val;
        }
      }
    }
  }

  drawLine(x0, y0, x1, y1, r, isEraser = false) {
    // Distance between points
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist === 0) {
      this.drawCircle(x0, y0, r, isEraser);
      return;
    }
    
    // Draw circles along the path
    const steps = Math.ceil(dist / (r * 0.5)); // Step size half of radius
    const stepX = dx / steps;
    const stepY = dy / steps;
    
    for (let i = 0; i <= steps; i++) {
      this.drawCircle(x0 + stepX * i, y0 + stepY * i, r, isEraser);
    }
  }

  renderStrokes(strokes) {
    this.clear();
    for (const stroke of strokes) {
      if (stroke.type === 'clear') {
        this.clear();
        continue;
      }
      if (stroke.type === 'fill') {
        // Ignore fill for OCR purposes, mostly just a background
        continue;
      }
      if (!stroke.points || stroke.points.length === 0) continue;
      
      const isEraser = stroke.tool === 'eraser';
      const r = stroke.size / 2;
      
      if (stroke.points.length === 1) {
        this.drawCircle(stroke.points[0].x, stroke.points[0].y, r, isEraser);
      } else {
        for (let i = 1; i < stroke.points.length; i++) {
          const p1 = stroke.points[i - 1];
          const p2 = stroke.points[i];
          this.drawLine(p1.x, p1.y, p2.x, p2.y, r, isEraser);
        }
      }
    }
  }

  /**
   * Convert to Netpbm format (P4 - binary bitmap)
   * This is universally supported by image tools and Tesseract.
   */
  toPBM() {
    const header = Buffer.from(`P4\n${this.width} ${this.height}\n`);
    
    const rowBytes = Math.ceil(this.width / 8);
    const body = Buffer.alloc(rowBytes * this.height);
    
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.data[y * this.width + x] === 1) {
          const byteIdx = y * rowBytes + Math.floor(x / 8);
          const bitIdx = 7 - (x % 8);
          body[byteIdx] |= (1 << bitIdx);
        }
      }
    }
    
    return Buffer.concat([header, body]);
  }
}

module.exports = CanvasGrid;
