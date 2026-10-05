/**
 * Anti-Cheat Heuristics
 * Quickly determines if canvas strokes might be text before invoking heavy OCR.
 */

class Heuristics {
  static isTextLike(strokes) {
    if (!strokes || strokes.length === 0) return false;
    
    let penStrokes = strokes.filter(s => s.tool !== 'eraser' && s.type !== 'clear' && s.type !== 'fill' && s.points?.length > 0);
    
    // Tesseract is extremely CPU intensive. We must filter aggressively.
    if (penStrokes.length < 3) return false;
    
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    
    for (const s of penStrokes) {
      for (const p of s.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    
    const width = maxX - minX;
    const height = maxY - minY;
    if (width === 0 || height === 0) return false;
    
    const aspectRatio = width / height;
    
    // Words are generally horizontal
    if (aspectRatio > 1.2) {
      return true;
    }
    
    return false;
  }
}

module.exports = Heuristics;
