import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { loadConfigFromFile } from 'vite';

test('dev proxy rewrites only its own local Origin, never hostile web origins', async () => {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, path.resolve('vite.config.ts'));
  const proxy = new EventEmitter();
  const options = loaded.config.server.proxy['/api'];
  options.configure(proxy);
  for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173', 'https://attacker.invalid', 'http://localhost:9999', undefined]) {
    const headers = { origin };
    proxy.emit('proxyReq', { setHeader(name, value) { headers[name] = value; } }, { headers: { origin } });
    assert.equal(headers.origin, ['http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin) ? 'http://127.0.0.1:4317' : origin);
  }
  assert.equal(loaded.config.server.host, '127.0.0.1');
  assert.equal(loaded.config.server.strictPort, true);
});
