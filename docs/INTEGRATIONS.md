# Integrations

English Sidecar reads **only user-authored natural language** by default. It never sends explanations or control directives back to the main Agent.

## Hook runner behavior

`node /absolute/path/to/english-learning-sidecar/bin/hook.cjs <agent>` receives the Agent's native JSON via `stdin`. It posts a normalized event to the local collector and **always exits 0**. Its stdout is empty for Codex, Claude Code and Grok Build; for Cursor only, it returns `{"continue":true}` as required by Cursor's hook schema.

The collector must already be running so its local authentication token exists. Failed requests are silently discarded to protect the main Agent. The runner has a 220ms local request budget (plus Node startup), not a hard end-to-end latency guarantee.

**Install safely:**

```sh
node bin/install-hooks.cjs codex --scope=user        # preview only
node bin/install-hooks.cjs codex --scope=user --apply
node bin/install-hooks.cjs cursor --scope=user --apply
node bin/install-hooks.cjs claude --scope=user --apply
node bin/install-hooks.cjs grok --scope=user        # dry run
node bin/install-hooks.cjs grok --scope=user --apply
```

`--scope=project` (default) writes `.codex/hooks.json`, `.cursor/hooks.json`, `.claude/settings.json`, or `.grok/hooks/english-sidecar.json` in the current working directory. `--scope=user` writes to the equivalent user-level config in your home directory. Existing files get timestamped backups and other hooks are retained. **Global hooks may see private work conversations; use project-level hooks whenever possible.** Never install both scopes for the same Agent unless duplicate events are understood.

After installing Codex hooks, open `/hooks` in Codex to review and trust the new hook. Restart other Agents if necessary. This installer does not bypass any hook permissions.

## Codex / Claude Code

Both support `UserPromptSubmit` command hooks. The saved config follows their documented shape:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node /absolute/path/to/bin/hook.cjs codex", "timeout": 2 } ] }
    ]
  }
}
```

When integrating Claude Code, replace `codex` with `claude`. Remember that untrusted stdout would inject context into the agent; this runner writes **nothing** to stdout for either Agent.

## Cursor

`beforeSubmitPrompt` passes `{"prompt":"..."}` on stdin. The installer writes:

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [ { "command": "node /absolute/path/to/bin/hook.cjs cursor" } ]
  }
}
```

Its command's stdout is **only** `{"continue":true}` and never contains learning content.

## Grok Build (xAI)

Grok Build has a **native `UserPromptSubmit` Hook**. This adapter does not need model prompts, an external MCP service, or filesystem polling. The installer writes a dedicated `english-sidecar.json` so it never changes other Grok hooks:

```sh
# Run inside the English Sidecar repository; preview first
node bin/install-hooks.cjs grok
node bin/install-hooks.cjs grok --apply

# Or use a global user-scoped hook if you want it active in all trusted sessions
node bin/install-hooks.cjs grok --scope=user --apply
```

The saved file at `<project>/.grok/hooks/english-sidecar.json` (or `~/.grok/hooks/english-sidecar.json`) has the following structure:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{ "type": "command", "command": "node /absolute/path/to/bin/hook.cjs grok", "timeout": 2 }]
    }]
  }
}
```

The runner parses `prompt`, `sessionId`, and `promptId` (camelCase), normalizes the source as **`grok`**, and writes nothing to stdout or stderr. It sends a copy to the authenticated collector with a short local deadline, and **never decides whether Grok may continue**.

After installation, open `/hooks` in Grok Build to review installed hooks; trust the project with `/hooks-trust` if using project scope. Native Grok hooks are discovered in `.grok/hooks/*.json` and `~/.grok/hooks/*.json` (project hooks require trust). Grok also loads Claude and Cursor hook files by default for compatibility. **If you have a global Cursor hook already installed, it can be executed by Grok too**, generating duplicate or incorrectly labeled events. Review the `/hooks` UI and Grok's `[compat.cursor] hooks = false` option before deciding whether to disable compatibility; the installer does not change this setting, since it may affect unrelated hooks.

Source: [Grok Build official Hooks guide](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md). **Integration is tested with an emulated Hook event; a real Grok Build session still needs verification on your machine.**

## Pi

Pi uses a TypeScript `input` extension rather than a shell Hook. Copy `extensions/pi/english-sidecar.ts` to `~/.pi/agent/extensions/english-sidecar.ts`, then run `/reload` inside Pi. The extension skips extension-generated messages, posts in a fire-and-forget fashion, and returns no input transformation.

## Qoder / DSH

Both are candidates for the normalized collector protocol, but per-product integration installers are **not yet implemented or validated**. An external Hook can call `bin/hook.cjs qoder` or `bin/hook.cjs dsh` if its input is JSON containing a `prompt` or `text` field. Do not assume that one product's hook path is portable to another.

## API contract for any future Adapter

```http
POST http://127.0.0.1:4317/api/events
Content-Type: application/json
X-Sidecar-Token: <contents of ~/.english-sidecar/ingest-token>

{
  "source": "my-agent",
  "eventType": "user.prompt.submitted",
  "sessionId": "opaque-session-id",
  "turnId": "opaque-turn-id",
  "content": "帮我解释这段代码的目的"
}
```

The Sidecar responds `202` immediately, performs redaction and processing asynchronously, and deduplicates retransmissions with the same source, session, and turn. `assistant.reply` is accepted but **not analyzed** until a future explicit opt-in is implemented.

## References

- [Codex Hooks](https://learn.chatgpt.com/docs/hooks)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Cursor Hooks](https://cursor.com/docs/hooks)
- [Pi Extensions](https://pi.dev/docs/latest/extensions)
- [Grok Build Hooks](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md)
