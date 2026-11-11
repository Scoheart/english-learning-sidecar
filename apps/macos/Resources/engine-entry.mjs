// Desktop-only entrypoint. Existing web/server sources are copied, never edited.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { loadConfig } from './src/lib/config.js';
import { createSidecar } from './src/lib/server.js';

const dataDir = path.resolve(process.env.SIDECAR_DATA_DIR || path.join(os.homedir(), '.english-sidecar'));
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const lock = path.join(dataDir, 'native-engine.lock');
let lockOwned = false;
let guardServer;
let service;
function releaseLock() {
  if (lockOwned) {
    try { if (fs.readFileSync(lock, 'utf8').trim() === String(process.pid)) fs.unlinkSync(lock); } catch {}
    lockOwned = false;
  }
}
process.on('exit', releaseLock);
try {
  // Only native-owned stale locks can be removed; never kill any existing PID.
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, 'utf8').trim());
    let alive = true;
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); } catch (e) { alive = e.code !== 'ESRCH'; }
    }
    if (alive) throw new Error('A native engine is already running or the lock needs inspection');
    fs.unlinkSync(lock);
  }
  const fd = fs.openSync(lock, 'wx', 0o600);
  fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd); lockOwned = true;
  const config = loadConfig({ ...process.env, SIDECAR_DATA_DIR: dataDir, SIDECAR_HOST: '127.0.0.1' });
  // Reserve the port BEFORE opening SQLite (its recovery changes processing rows).
  guardServer = net.createServer();
  await new Promise((resolve, reject) => { guardServer.once('error', reject); guardServer.listen(config.port, '127.0.0.1', resolve); });
  service = createSidecar(config);
  await new Promise(resolve => guardServer.close(resolve)); guardServer = null;
  await service.start();
  console.log(`Native Sidecar engine listening on loopback port ${config.port}`);
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (stopping) return; stopping = true;
    await service.close(); releaseLock(); process.exit(0);
  });
} catch (error) {
  guardServer?.close();
  // No prompt, provider response, credential or model configuration in logs.
  console.error('Native engine startup failed:', error.code || error.message);
  releaseLock(); process.exit(1);
}
