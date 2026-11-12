import { createHash } from 'node:crypto';
import path from 'node:path';

// All redaction and extraction happens before storing or forwarding to a model.
const credentialName = '(?:api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|id[_-]?token|client[_-]?secret|password|passwd|pwd|token|secret|authorization|cookie|set-cookie|private[_-]?key)';
const credentialAssignment = new RegExp(`(["']?\\b${credentialName}\\b["']?\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\\[REDACTED[^\\]]*\\]|[^\\s,;}\\]\\x60]+)`, 'gi');
const patterns = [
  [/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]'],
  [/\b(?:sk-(?:proj-|ant-)?|gh[pousr]_|github_pat_|glpat-|xox[baprs]-|npm_)[A-Za-z0-9_-]{8,}\b/g, '[REDACTED KEY]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED AWS KEY]'],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '[REDACTED AUTH]'],
  [credentialAssignment, '$1[REDACTED]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED EMAIL]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]'],
  // Opaque, unlabelled credentials: avoid treating ordinary long words as tokens.
  [/\b(?=[A-Za-z0-9_/-]{32,}\b)(?=[A-Za-z0-9_/-]*[A-Za-z])(?=[A-Za-z0-9_/-]*\d)[A-Za-z0-9_/-]{32,}\b/g, '[REDACTED TOKEN]'],
];
const omittedContent = '[No learnable natural language]';

export function redactSensitive(value) {
  let text = String(value ?? '');
  for (const [regex, replacement] of patterns) text = text.replace(regex, replacement);
  return text;
}

// Remove balanced serialized objects even when embedded between natural sentences.
function stripStructuredBlocks(text) {
  let output = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if ((char !== '{' && char !== '[') || !/^(?:\{\s*(?:["'}]|[\w$-]+\s*:)|\[\s*(?:\{|\[|"|\d|true\b|false\b|null\b))/.test(text.slice(i))) {
      output += char;
      continue;
    }
    const stack = [char];
    let quote = '', escaped = false, end = i + 1;
    for (; end < text.length && stack.length; end++) {
      const next = text[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (next === '\\') escaped = true;
        else if (next === quote) quote = '';
      } else if (next === '"' || next === "'") quote = next;
      else if (next === '{' || next === '[') stack.push(next);
      else if (next === '}' || next === ']') stack.pop();
    }
    output += ' ';
    i = end - 1;
  }
  return output;
}

function isTechnicalLine(line) {
  return /^\s*(?:\$ |#!|\/\/|\/\*|\*\/|<!--|-->|[{}\[\]]\s*[,;]?\s*$)/.test(line)
    || /^\s*(?:const|let|var|function|class|import|export|return|throw|def|from|package|public|private|async\s+function)\b.*(?:[=;{}()]|\b(?:import|from)\b)/.test(line)
    || /^\s*(?:return|throw|raise|yield|await)\s+\S/.test(line)
    || /^\s*(?:class\s+\w+\s*[:{]|(?:if|for|while|switch|catch|try|else)\s*[(\{:])/.test(line)
    || /^\s*(?:SELECT\s|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b|CREATE\s+TABLE\b)/.test(line)
    || /^\s*(?:(?:sudo\s+)?(?:curl|wget|npm|pnpm|yarn|pip|git|docker|kubectl|chmod|mkdir|echo)\s|<\/?[A-Za-z][\w:-]*(?:\s+[^>]*|\/?)>)/.test(line)
    || /^\s*(?:[\w$.[\]'"-]+\s*(?:=|:=|=>)|[\w$.]+\([^\n]*\)\s*;?\s*$)/.test(line)
    || /^\s*(?:["']?[\w.-]+["']?\s*:\s*(?:["'\d{\[]|true\b|false\b|null\b))/.test(line)
    || /^\s*(?:Traceback\b|File ["']|at\s+(?:async\s+)?\S+|Caused by:|(?:\w*Error|Exception)(?::|\b.*\bat\b))/.test(line)
    || /^\s*(?:\[?(?:TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\]?(?:\s|:)|\d{4}-\d\d-\d\d[T ][\d:.+-]+|\[\d\d?:\d\d(?::\d\d)?\])/.test(line)
    || /^\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+\/\S*\s+\d{3}\b/.test(line)
    || /^\s*(?:npm (?:ERR!|WARN)|\^+\s*$|[└├│]──)/.test(line);
}

/** Return only redacted natural-language text, never the original code/log payload. */
export function extractLearningText(value) {
  let text = String(value ?? '');
  // Opening fences without a closing fence also suppress the rest of the block.
  text = text.replace(/(^|\n)[ \t]*(?:`{3,}|~{3,})[^\n]*(?:\n|$)[\s\S]*?(?:(?:\n[ \t]*(?:`{3,}|~{3,})[^\n]*(?=\n|$))|$)/g, '$1');
  text = stripStructuredBlocks(text);
  text = redactSensitive(text).replace(/`([^`\n]*)`/g, (_match, inline) => {
    // Named concepts are language too; paths, calls, assignments and markers are not.
    const term = inline.trim();
    return /^[\p{L}][\p{L}\p{N}_]*(?:[ -][\p{L}][\p{L}\p{N}_]*)*$/u.test(term) ? term : ' ';
  });
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    if (isTechnicalLine(line)) continue;
    const clean = line.trim().replace(/[ \t]+/g, ' ');
    // Redaction markers/credential labels alone do not constitute language.
    const meaningful = clean.replace(/\[REDACTED[^\]]*\]/g, '')
      .replace(new RegExp(`["']?\\b${credentialName}\\b["']?\\s*[:=]`, 'gi'), '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (meaningful.length >= 2 && /\p{L}/u.test(meaningful)) lines.push(clean);
  }
  return lines.join('\n').trim();
}

export function isWorthLearning(text) {
  return Boolean(extractLearningText(text));
}

function normalizeProject(project) {
  if (typeof project !== 'string' || !project.trim() || project.includes('\0')) return '';
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(project);
  const paths = windows ? path.win32 : path.posix;
  if (!paths.isAbsolute(project)) return '';
  let normalized = paths.normalize(project);
  if (windows) normalized = normalized.replace(/\\/g, '/').toLowerCase();
  if (windows && /^[a-z]:\/$/.test(normalized)) return normalized;
  return normalized.replace(/\/+$/, '') || '/';
}

/** Legacy/unconfigured users capture all projects; exclusions always take precedence. */
export function normalizeCapturePolicy(policy, { strict = false } = {}) {
  const isObject = policy && typeof policy === 'object' && !Array.isArray(policy);
  if (strict && !isObject) throw new Error('Capture policy must be an object');
  const input = isObject ? policy : {};
  if (strict) {
    if (input.mode !== undefined && !['all', 'allowlist'].includes(input.mode)) {
      throw new Error('Capture policy mode must be all or allowlist');
    }
    for (const key of ['allowedProjects', 'excludedProjects']) {
      if (input[key] === undefined) continue;
      if (!Array.isArray(input[key])) throw new Error(`${key} must be an array of absolute paths`);
      if (input[key].some(project => !normalizeProject(project))) {
        throw new Error(`${key} must contain only absolute project paths`);
      }
    }
  }
  const normalizeList = list => [...new Set((Array.isArray(list) ? list : []).map(normalizeProject).filter(Boolean))];
  return {
    mode: input.mode === 'allowlist' ? 'allowlist' : 'all',
    allowedProjects: normalizeList(input.allowedProjects),
    excludedProjects: normalizeList(input.excludedProjects),
  };
}

export function isProjectAllowed(project, policy) {
  const normalized = normalizeProject(project);
  const { mode, allowedProjects, excludedProjects } = normalizeCapturePolicy(policy);
  const matches = root => normalized === root || normalized.startsWith(root.endsWith('/') ? root : `${root}/`);
  if (normalized && excludedProjects.some(matches)) return false;
  return mode === 'all' || Boolean(normalized && allowedProjects.some(matches));
}

function hashMetadata(value) {
  return typeof value === 'string' && value ? `sha256:${createHash('sha256').update(value).digest('hex')}` : '';
}

export function normalizeIncomingEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected JSON object');
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!content || content.length > 12000) throw new Error('Prompt must be 1–12000 characters');
  const source = typeof input.source === 'string' ? input.source.toLowerCase() : '';
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(source)) throw new Error('Invalid source');
  const eventType = input.eventType ?? 'user.prompt.submitted';
  if (!['user.prompt.submitted', 'assistant.reply'].includes(eventType)) throw new Error('Unsupported eventType');
  // Cursor's Build action submits this generated wrapper, not a learner-authored
  // prompt. Match its distinctive opening before extraction/truncation, never a
  // generic word like "plan" (or quoted templates in a normal question).
  const cursorPlanImplementation = source === 'cursor' && eventType === 'user.prompt.submitted'
    && /^Implement the plan as specified,?\s*it is attached for your reference\.\s*Do NOT edit the plan file itself\.(?:\s|$)/i.test(content.replace(/\s+/gu, ' '));
  const learningText = cursorPlanImplementation ? '' : extractLearningText(content).slice(0, 6000);
  return {
    ...(cursorPlanImplementation ? { ignoredReason: 'cursor-plan-implementation' } : {}),
    source, eventType,
    sessionId: hashMetadata(input.sessionId),
    turnId: hashMetadata(input.turnId),
    projectId: hashMetadata(normalizeProject(input.projectPath)),
    // Never retain the raw prompt, identifiers, or project path, even if ineligible.
    content: learningText || omittedContent,
    eligible: eventType === 'user.prompt.submitted' && Boolean(learningText),
  };
}
