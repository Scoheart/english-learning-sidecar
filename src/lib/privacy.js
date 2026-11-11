// All redaction happens before storing or forwarding to an independent model.
const patterns = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]'],
  [/\b(?:sk-(?:proj-)?|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{12,}\b/g, '[REDACTED KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED AWS KEY]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=?=?/gi, 'Bearer [REDACTED TOKEN]'],
  [/(\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|secret)\b\s*[:=]\s*)(?:"[^"]+"|'[^']+'|[^\s,;]+)/gi, '$1[REDACTED]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED EMAIL]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]'],
];

export function redactSensitive(value) {
  let text = String(value ?? '');
  for (const [regex, replacement] of patterns) text = text.replace(regex, replacement);
  return text;
}

export function isWorthLearning(text) {
  const t = String(text ?? '').trim();
  if (t.length < 2 || !/[\p{L}]/u.test(t)) return false;
  // Skip messages consisting almost entirely of code or serialized payloads.
  if (/^\s*(?:```|\{|\[|<\?xml|#!\/bin\/)/.test(t)) return false;
  if (t.split('\n').length > 20 && /[{;=<>}]/.test(t)) return false;
  return true;
}

export function normalizeIncomingEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected JSON object');
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!content || content.length > 12000) throw new Error('Prompt must be 1–12000 characters');
  const source = typeof input.source === 'string' ? input.source.toLowerCase() : '';
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(source)) throw new Error('Invalid source');
  const eventType = input.eventType ?? 'user.prompt.submitted';
  if (!['user.prompt.submitted', 'assistant.reply'].includes(eventType)) throw new Error('Unsupported eventType');
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.slice(0, 128) : '';
  const turnId = typeof input.turnId === 'string' ? input.turnId.slice(0, 128) : '';
  return {
    source, eventType, sessionId, turnId,
    // Never save the raw unredacted version.
    content: redactSensitive(content).slice(0, 6000),
    eligible: eventType === 'user.prompt.submitted' && isWorthLearning(content),
  };
}
