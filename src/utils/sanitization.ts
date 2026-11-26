/**
 * Sanitizes untrusted prompt input by stripping disallowed ASCII control
 * characters while preserving valid whitespace (`\n`, `\t`) and clamping
 * length to `maxLength`.
 */
export function sanitizePromptInput(input: string, maxLength = 500): string {
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .slice(0, maxLength);
}
