/** Pure, browser-safe display cleanup. Non-string values return ''. */
export function cleanOriginalText(value: unknown): string;

/**
 * Clean an explicit originalText string (including an intentional empty string).
 * Only absent/non-string originalText falls back to cleaned legacy content.
 * Neither input is mutated; this helper must not rewrite persisted data.
 */
export function getOriginalText(content: unknown, originalText?: unknown): string;
