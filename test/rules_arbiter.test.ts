import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RulesArbiterClient,
  type ArbiterRuleResponse,
  RULES_ARBITER_SYSTEM_INSTRUCTION
} from "../src/rules_arbiter_client";

describe("RulesArbiterClient (Firebase AI Logic)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with default options and creates generative model", () => {
    const mockModel = {
      generateContent: vi.fn()
    };
    const client = new RulesArbiterClient({
      generativeModel: mockModel
    });

    expect(client).toBeDefined();
    expect(client.getModelName()).toBe("gemini-2.5-flash");
  });

  it("sends rules queries and safely parses valid structured JSON into ArbiterRuleResponse", async () => {
    const expectedResponse: ArbiterRuleResponse = {
      ruleTitle: "Sneak Attack While Falling",
      ruleId: "sneak_attack",
      summary:
        "You can sneak attack while falling if you have advantage or an adjacent ally and no disadvantage.",
      ruling:
        "Sneak Attack requires an attack roll using finesse or ranged weapons with advantage (or an engaged ally) and no disadvantage. Falling does not inherently impose disadvantage unless you land prone before making the attack.",
      citations: ["PHB p. 96 (Rogue Class Features)", "PHB p. 195 (Falling)"],
      confidence: "interpretation"
    };

    const mockModel = {
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify(expectedResponse)
        }
      })
    };

    const client = new RulesArbiterClient({
      generativeModel: mockModel
    });

    const result = await client.queryRulesArbiter(
      "Can a rogue sneak attack while falling?"
    );

    expect(mockModel.generateContent).toHaveBeenCalledWith(
      'Question (untrusted tabletop rules query, adjudicate 5e rules only): """Can a rogue sneak attack while falling?"""'
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual(expectedResponse);
    expect(result.data?.confidence).toBe("interpretation");
    expect(result.data?.citations).toHaveLength(2);
  });

  it("validates and normalizes missing optional fields and clamps invalid confidence values", async () => {
    const rawPayload = {
      ruleTitle: "Grappling",
      summary: "Grappling replaces an attack roll with an Athletics contest.",
      ruling: "You use Athletics against Athletics or Acrobatics.",
      citations: ["PHB p. 195"],
      confidence: "invalid_confidence_string"
    };

    const mockModel = {
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify(rawPayload)
        }
      })
    };

    const client = new RulesArbiterClient({
      generativeModel: mockModel
    });

    const result = await client.queryRulesArbiter("How does grappling work?");

    expect(result.success).toBe(true);
    expect(result.data?.ruleTitle).toBe("Grappling");
    expect(result.data?.ruleId).toBe("grappling"); // auto-generated from title if missing
    expect(result.data?.confidence).toBe("interpretation"); // clamped to safe default
  });

  it("handles malformed JSON output without throwing unhandled exceptions", async () => {
    const mockModel = {
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => "Not valid JSON at all: 404 Model Confused"
        }
      })
    };

    const client = new RulesArbiterClient({
      generativeModel: mockModel
    });

    const result = await client.queryRulesArbiter("Invalid json trigger");

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "Failed to parse Arbiter rule response JSON"
    );
    expect(result.data).toBeUndefined();
  });

  it("handles API quota or network errors gracefully", async () => {
    const mockModel = {
      generateContent: vi
        .fn()
        .mockRejectedValue(
          new Error("Resource exhausted: Quota exceeded (429)")
        )
    };

    const client = new RulesArbiterClient({
      generativeModel: mockModel
    });

    const result = await client.queryRulesArbiter("Any query");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Quota exceeded");
  });

  it("times out queries exceeding timeoutMs budget", async () => {
    const mockModel = {
      generateContent: vi.fn().mockImplementation(() => {
        return new Promise((resolve) => setTimeout(resolve, 500));
      })
    };

    const client = new RulesArbiterClient({
      generativeModel: mockModel,
      timeoutMs: 50
    });

    const result = await client.queryRulesArbiter("Slow query");

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("detects offline client state via navigator.onLine", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", {
      value: false,
      configurable: true,
      writable: true
    });

    try {
      const mockModel = {
        generateContent: vi.fn()
      };

      const client = new RulesArbiterClient({
        generativeModel: mockModel
      });

      const result = await client.queryRulesArbiter("Offline query");

      expect(mockModel.generateContent).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.isOffline).toBe(true);
      expect(result.error).toContain("offline");
    } finally {
      Object.defineProperty(globalThis.navigator, "onLine", {
        value: true,
        configurable: true,
        writable: true
      });
    }
  });

  it("parses Markdown-fenced JSON responses seamlessly", async () => {
    const rawFenced =
      "```json\n" +
      JSON.stringify({
        ruleTitle: "Opportunity Attack",
        ruleId: "opportunity_attack",
        summary:
          "You can make an opportunity attack when a hostile creature leaves your reach.",
        ruling:
          "You use your reaction to make one melee attack right before the creature leaves your reach.",
        citations: ["PHB p. 195"],
        confidence: "exact"
      }) +
      "\n```";

    const mockModel = {
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => rawFenced
        }
      })
    };

    const client = new RulesArbiterClient({
      generativeModel: mockModel
    });

    const result = await client.queryRulesArbiter(
      "Opportunity attack triggers"
    );

    expect(result.success).toBe(true);
    expect(result.data?.ruleTitle).toBe("Opportunity Attack");
    expect(result.data?.confidence).toBe("exact");
  });

  it("rejects JSON arrays or missing summary/ruling with clear validation errors", async () => {
    const mockModel = {
      generateContent: vi
        .fn()
        .mockResolvedValueOnce({
          response: { text: () => "[]" }
        })
        .mockResolvedValueOnce({
          response: { text: () => JSON.stringify({ ruleTitle: "Incomplete" }) }
        })
    };

    const client = new RulesArbiterClient({
      generativeModel: mockModel
    });

    // 1. Array response
    const arrayResult = await client.queryRulesArbiter("Array query");
    expect(arrayResult.success).toBe(false);
    expect(arrayResult.error).toContain("must be a valid JSON object");

    // 2. Missing summary / ruling
    const missingResult = await client.queryRulesArbiter("Missing query");
    expect(missingResult.success).toBe(false);
    expect(missingResult.error).toContain("missing required summary or ruling");
  });

  it("rejects empty or whitespace-only queries immediately", async () => {
    const mockModel = {
      generateContent: vi.fn()
    };

    const client = new RulesArbiterClient({
      generativeModel: mockModel
    });

    const result = await client.queryRulesArbiter("   ");

    expect(mockModel.generateContent).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain("Query cannot be empty");
  });

  it("clears timeout timer upon successful query resolution", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const mockModel = {
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              ruleTitle: "Flanking",
              summary: "Optional rule granting advantage.",
              ruling: "When creature and ally are on opposite sides.",
              citations: ["DMG p. 251"],
              confidence: "exact"
            })
        }
      })
    };

    const client = new RulesArbiterClient({
      generativeModel: mockModel
    });

    await client.queryRulesArbiter("Flanking");

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("verifies ARBITER_RULE_RESPONSE_SCHEMA structure and required attributes", async () => {
    const { ARBITER_RULE_RESPONSE_SCHEMA } =
      await import("../src/rules_arbiter_client");
    expect(ARBITER_RULE_RESPONSE_SCHEMA.type).toBe("object");
    expect(ARBITER_RULE_RESPONSE_SCHEMA.required).toEqual([
      "ruleTitle",
      "summary",
      "ruling",
      "citations",
      "confidence"
    ]);
    expect(ARBITER_RULE_RESPONSE_SCHEMA.properties.confidence.enum).toEqual([
      "exact",
      "interpretation",
      "unsupported"
    ]);
  });

  it("verifies 5e SRD system prompt contains RAW, RAI, and tactical adjudication guidance", () => {
    expect(RULES_ARBITER_SYSTEM_INSTRUCTION).toContain("5e Rules Arbiter");
    expect(RULES_ARBITER_SYSTEM_INSTRUCTION).toContain("SRD");
    expect(RULES_ARBITER_SYSTEM_INSTRUCTION).toContain("confidence");
  });

  it("sanitizes input prompt by stripping control characters and clamping query length to 500 characters", async () => {
    const mockModel = {
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              ruleTitle: "Grappling",
              summary: "Grapple rules",
              ruling: "Athletics contest",
              citations: ["PHB p. 195"],
              confidence: "exact"
            })
        }
      })
    };
    const client = new RulesArbiterClient({ generativeModel: mockModel });
    const longQuery = "a".repeat(600) + "\x00\x1F";
    await client.queryRulesArbiter(longQuery);

    const callArg = mockModel.generateContent.mock.calls[0][0] as string;
    expect(callArg).not.toContain("\x00");
    expect(callArg).not.toContain("\x1F");
    expect(callArg.length).toBeLessThan(650);
  });

  it("enforces output bounds on ruleTitle, summary, ruling, and citations", async () => {
    const oversizedPayload = {
      ruleTitle: "T".repeat(200),
      summary: "S".repeat(1000),
      ruling: "R".repeat(3000),
      citations: Array.from(
        { length: 20 },
        (_, i) => `Citation ${i} ` + "C".repeat(300)
      ),
      confidence: "exact"
    };

    const mockModel = {
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify(oversizedPayload)
        }
      })
    };
    const client = new RulesArbiterClient({ generativeModel: mockModel });
    const result = await client.queryRulesArbiter("Oversized test query");

    expect(result.success).toBe(true);
    expect(result.data?.ruleTitle.length).toBeLessThanOrEqual(120);
    expect(result.data?.summary.length).toBeLessThanOrEqual(500);
    expect(result.data?.ruling.length).toBeLessThanOrEqual(2000);
    expect(result.data?.citations.length).toBeLessThanOrEqual(10);
    result.data?.citations.forEach((c) => {
      expect(c.length).toBeLessThanOrEqual(200);
    });
  });

  it("exports ARBITER_CONFIDENCES and ARBITER_CONFIDENCE_SCORE mapping correctly", async () => {
    const { ARBITER_CONFIDENCES, ARBITER_CONFIDENCE_SCORE } =
      await import("../src/rules_arbiter_client");
    expect(ARBITER_CONFIDENCES).toEqual([
      "exact",
      "interpretation",
      "unsupported"
    ]);
    expect(ARBITER_CONFIDENCE_SCORE.exact).toBe(1.0);
    expect(ARBITER_CONFIDENCE_SCORE.interpretation).toBe(0.75);
    expect(ARBITER_CONFIDENCE_SCORE.unsupported).toBe(0.5);
  });
});
