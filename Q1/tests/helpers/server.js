const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
const path = require('path');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function waitForMetrics(port, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const tryGet = () => {
      if (Date.now() - startTime > timeout) return reject(new Error('Timeout waiting for server'));
      const req = http.get(`http://127.0.0.1:${port}/metrics`, (res) => {
        if (res.statusCode === 200) return resolve();
        setTimeout(tryGet, 100);
      });
      req.on('error', () => setTimeout(tryGet, 100));
    };
    tryGet();
  });
}

async function startServer({ antiCheat = false, env = {} } = {}) {
  const port = await getFreePort();
  const logs = [];
  const serverPath = path.resolve(__dirname, '../../server/index.js');
  const childEnv = { ...process.env, PORT: port.toString(), ANTI_CHEAT: antiCheat ? 'true' : 'false', ...env };
  
  const child = spawn(process.execPath, [serverPath], { env: childEnv, cwd: path.resolve(__dirname, '../../') });
  
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));

  try {
    await waitForMetrics(port, 10000);
  } catch (err) {
    child.kill();
    throw new Error(`Server failed to start on port ${port}:\n${logs.join('')}`);
  }

  let stopped = false;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    logs: () => logs,
    stop: () => new Promise((resolve) => {
      if (stopped) return resolve();
      stopped = true;
      child.on('exit', () => resolve());
      child.kill('SIGKILL');
    })
  };
}

module.exports = { startServer };
