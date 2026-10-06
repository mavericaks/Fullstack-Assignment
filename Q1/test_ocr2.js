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
  console.log('Keys:', Object.keys(result));
  if (result.data) {
    console.log('Data keys:', Object.keys(result.data));
    console.log('Has words?', !!result.data.words);
    if (result.data.words) {
      console.log('Words length:', result.data.words.length);
      console.log('Words[0] keys:', Object.keys(result.data.words[0]));
    }
  }
  process.exit(0);
}
run();
