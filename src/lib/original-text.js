// Display-only cleanup; never rewrite captured or persisted content with this.
// No Node or DOM dependencies: this module is shared with the browser.
const removed = '\0';
const redaction = /^(?:\[REDACTED(?:[ _-][^\]\r\n]*)?\]|<REDACTED(?:[ _-][^>\r\n]*)?>)/i;

function stripUrls(text) {
  // No word boundary: Chinese prose is often glued directly to a URL.
  return text.replace(/(?:https?:\/\/|www\.)[^\r\n]*/gi, (rest) => {
    const prefix = /^(?:https?:\/\/|www\.)/i.exec(rest)[0];
    let end = prefix.length;
    let parentheses = 0;
    while (end < rest.length) {
      const placeholder = redaction.exec(rest.slice(end));
      if (placeholder) {
        end += placeholder[0].length;
        continue;
      }
      const char = rest[end];
      // Stop before adjacent Chinese prose, whitespace, or markup. URL-encoded
      // non-ASCII paths are still consumed, without swallowing the next sentence.
      if (!/[\x21-\x7e]/.test(char) || /[<>"'`\[\]{}]/.test(char)) break;
      if (char === '(') parentheses += 1;
      if (char === ')') {
        if (!parentheses) break;
        parentheses -= 1;
      }
      end += 1;
    }
    while (end > prefix.length && /[.,!?;:]/.test(rest[end - 1])) end -= 1;
    return removed + stripUrls(rest.slice(end));
  });
}

function closingDelimiter(text, start, open, close) {
  let depth = 1;
  let quote = '';
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (open === '(' && (char === '"' || char === "'")) {
      if (!quote) quote = char;
      else if (quote === char) quote = '';
      continue;
    }
    if (quote) continue;
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function stripMarkdown(text) {
  let result = '';
  for (let index = 0; index < text.length;) {
    const image = text[index] === '!' && text[index + 1] === '[';
    const start = image ? index + 1 : index;
    if (text[start] !== '[') {
      result += text[index++];
      continue;
    }
    const labelEnd = closingDelimiter(text, start, '[', ']');
    if (labelEnd < 0) {
      result += text[index++];
      continue;
    }
    const destination = labelEnd + 1;
    const delimiter = text[destination];
    const destinationEnd = delimiter === '(' || delimiter === '['
      ? closingDelimiter(text, destination, delimiter, delimiter === '(' ? ')' : ']')
      : -1;
    if (destinationEnd >= 0) {
      result += image ? removed : stripMarkdown(text.slice(start + 1, labelEnd));
      index = destinationEnd + 1;
    } else {
      result += text[index++];
    }
  }
  return result;
}

function stripFences(text) {
  let fence;
  return text.split(/(\r?\n)/).map((line) => {
    if (/^\r?\n$/.test(line)) return line;
    if (fence) {
      const closing = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = undefined;
      return removed;
    }
    const opening = /^\s*(`{3,}|~{3,})/.exec(line);
    if (opening) {
      fence = opening[1];
      return removed;
    }
    return line;
  }).join('');
}

/** Return natural display text without links, image/attachment noise or fences. */
export function cleanOriginalText(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let text = stripFences(value);
  text = text.replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, removed);
  text = stripMarkdown(text);
  // Reference definitions are destinations, not visible labels.
  text = text.replace(/^[ \t]{0,3}\[[^\]\r\n]+\]:[^\r\n]*/gm, removed);
  text = stripUrls(text);
  text = text.replace(/\[REDACTED(?:[ _-][^\]\r\n]*)?\]|<REDACTED(?:[ _-][^>\r\n]*)?>/gi, removed);
  text = text.replace(/\[(?:image|attachment|图片|图像|附件)(?:[ _:-][^\]\r\n]*)?\]|【(?:图片|图像|附件)(?:[：:][^】\r\n]*)?】|<(?:image|attachment)\b[^>]*>/gi, removed);
  // Only whitespace touching a removed fragment is coalesced; ordinary user
  // spacing, numbers, identifiers, punctuation and line breaks remain intact.
  return text.replace(/[ \t]*\0(?:[ \t]*\0)*[ \t]*/g, (match) => /[ \t]/.test(match) ? ' ' : '').trim();
}

/** Explicit originalText (including '') is authoritative; legacy values use content. */
export function getOriginalText(content, originalText) {
  return cleanOriginalText(typeof originalText === 'string' ? originalText : content);
}
