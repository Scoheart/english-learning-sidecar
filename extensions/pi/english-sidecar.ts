// Place in ~/.pi/agent/extensions/english-sidecar.ts and run /reload.
// This is a self-contained Pi extension with no third-party imports.
// It intentionally does not change, augment, or handle the original input.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export default function (pi: any) {
  pi.on('input', (event: { text?: string; source?: string }, ctx: any) => {
    // Avoid a feedback loop from other extensions programmatically adding prompts.
    if (event.source === 'extension' || typeof event.text !== 'string' || !event.text.trim()) return;
    try {
      const dataDir = process.env.SIDECAR_DATA_DIR || join(homedir(), '.english-sidecar');
      const token = readFileSync(join(dataDir, 'ingest-token'), 'utf8').trim();
      const port = process.env.SIDECAR_PORT || '4317';
      const sessionId = String(ctx.sessionManager?.getSessionId?.() || '');
      // Deliberately fire-and-forget. Never await the Sidecar on the main agent path.
      void fetch(`http://127.0.0.1:${port}/api/events`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-sidecar-token': token },
        body: JSON.stringify({ source: 'pi', sessionId, content: event.text,
          eventType: 'user.prompt.submitted' }),
        signal: AbortSignal.timeout(250),
      }).catch(() => {});
    } catch { /* fail-open */ }
    // No return value means the original input proceeds unchanged.
  });
}
