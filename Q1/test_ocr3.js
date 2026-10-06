const ocrWorker = require('./server/antiCheat/ocrWorker');

async function run() {
  const strokes = [
    {
      id: 'test-stroke', seq: 0, color: '#000000', size: 10, tool: 'pen',
      points: [
        {x: 10, y: 10}, {x: 10, y: 50},
        {x: 10, y: 30}, {x: 30, y: 30},
        {x: 30, y: 10}, {x: 30, y: 50},
        {x: 40, y: 10}, {x: 40, y: 50},
        {x: 40, y: 10}, {x: 60, y: 10},
        {x: 40, y: 30}, {x: 60, y: 30},
        {x: 40, y: 50}, {x: 60, y: 50}
      ], end: true
    }
  ];

  await ocrWorker.init();
  const renderer = new (require('./server/antiCheat/renderer'))(800, 600);
  renderer.renderStrokes(strokes);
  const pbmBuffer = renderer.toPBM();

  const result = await ocrWorker.worker.recognize(pbmBuffer);
  if (result.data && result.data.blocks && result.data.blocks.length > 0) {
    const block = result.data.blocks[0];
    console.log('Block keys:', Object.keys(block));
    if (block.paragraphs && block.paragraphs.length > 0) {
      console.log('Paragraph keys:', Object.keys(block.paragraphs[0]));
      if (block.paragraphs[0].lines && block.paragraphs[0].lines.length > 0) {
        console.log('Line keys:', Object.keys(block.paragraphs[0].lines[0]));
        if (block.paragraphs[0].lines[0].words && block.paragraphs[0].lines[0].words.length > 0) {
          console.log('Word keys:', Object.keys(block.paragraphs[0].lines[0].words[0]));
        }
      }
    }
  } else {
    console.log('No blocks');
  }
  process.exit(0);
}
run();
