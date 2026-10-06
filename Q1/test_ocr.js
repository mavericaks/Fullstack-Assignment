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

  console.log('Running OCR...');
  const result = await ocrWorker.recognize(strokes);
  console.log('Result:', result);
  process.exit(0);
}
run();
