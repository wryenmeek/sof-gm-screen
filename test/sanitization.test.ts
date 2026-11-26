import { describe, it, expect } from "vitest";
import { sanitizePromptInput } from "../src/utils/sanitization";

describe("sanitizePromptInput", () => {
  it("strips disallowed ASCII control characters while preserving valid whitespace", () => {
    const disallowed =
      "\x00\x01\x02\x03\x04\x05\x06\x07\x08" +
      "\x0B\x0C" +
      "\x0E\x0F\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1A\x1B\x1C\x1D\x1E\x1F" +
      "\x7F";
    const input = `Sneak${disallowed} Attack\n\trequires advantage.`;

    expect(sanitizePromptInput(input)).toBe(
      "Sneak Attack\n\trequires advantage."
    );
  });

  it("preserves multi-language Unicode, emoji, and standard punctuation", () => {
    const input =
      "Café grappling rule: 「組み付き」 & Fireball! 🔥 (PHB p. 195) — 100% RAW?";

    expect(sanitizePromptInput(input)).toBe(
      "Café grappling rule: 「組み付き」 & Fireball! 🔥 (PHB p. 195) — 100% RAW?"
    );
  });

  it("clamps output length to default 500 characters", () => {
    const input = "x".repeat(650);
    const result = sanitizePromptInput(input);

    expect(result).toBe("x".repeat(500));
    expect(result).toHaveLength(500);
  });

  it("respects an explicit maxLength parameter", () => {
    const input = "\x00Can a rogue sneak attack while falling?\x1F";

    expect(sanitizePromptInput(input, 12)).toBe("Can a rogue ");
    expect(sanitizePromptInput("hello", 0)).toBe("");
  });

  it("handles empty strings safely", () => {
    expect(sanitizePromptInput("")).toBe("");
    expect(sanitizePromptInput("", 100)).toBe("");
  });
});
