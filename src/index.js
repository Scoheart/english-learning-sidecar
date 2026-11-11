import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './lib/config.js';
import { createSidecar } from './lib/server.js';

if (fs.existsSync(path.resolve('.env'))) process.loadEnvFile(path.resolve('.env'));
const config = loadConfig();
const sidecar = createSidecar(config);
const address = await sidecar.start();
console.log(`\nEnglish Learning Sidecar · http://127.0.0.1:${address.port}`);
console.log(`Mode: ${config.mode} · Data: ${config.dataDir}`);
console.log('Hook token is stored locally. No main-Agent model calls are modified.\n');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => { await sidecar.close(); process.exit(0); });
}
