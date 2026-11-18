import {
  initializeApp,
  getApps,
  type FirebaseApp,
  type FirebaseOptions
} from "firebase/app";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  SchemaType,
  type GenerativeModel
} from "firebase/ai";

export type ArbiterConfidence = "exact" | "interpretation" | "unsupported";

export interface ArbiterRuleResponse {
  ruleTitle: string;
  ruleId?: string;
  summary: string;
  ruling: string;
  citations: string[];
  confidence: ArbiterConfidence;
}

export interface RulesArbiterResult {
  success: boolean;
  data?: ArbiterRuleResponse;
  error?: string;
  isOffline?: boolean;
}

export interface RulesArbiterClientOptions {
  app?: FirebaseApp;
  firebaseConfig?: FirebaseOptions;
  model?: string;
  timeoutMs?: number;
  generativeModel?: any;
}

export const DEFAULT_ARBITER_MODEL = "gemini-2.5-flash";
export const DEFAULT_ARBITER_TIMEOUT_MS = 10000;

export const RULES_ARBITER_SYSTEM_INSTRUCTION = `You are the official D&D 5e Rules Arbiter for the Sea of Fortune tabletop campaign.
Your responsibility is to adjudicate tabletop rules questions with tactical accuracy, clarity, and brevity.
Follow Rules as Written (RAW) from the official 5e SRD / core rulebooks first.
If a scenario is ambiguous, explicitly state that your ruling is an "interpretation" and explain the RAI (Rules as Intended) or common DM adjudication.
If an action is completely unsupported by 5e rules, mark confidence as "unsupported".
Always return your answer in valid JSON strictly adhering to the schema:
- ruleTitle: The canonical rule, mechanic, spell, or condition name.
- ruleId: A lowercase snake_case identifier matching standard glossary slugs if known (e.g. "grappled", "sneak_attack", "counterspell"), or empty.
- summary: A single clear sentence summarizing the direct answer to the player's question.
- ruling: A concise explanation (2-3 sentences max) detailing the mechanics, requirements, and consequences.
- citations: An array of specific rulebook or SRD references (e.g. ["PHB p. 195", "SRD 5.1 Combat - Melee Attacks"]).
- confidence: "exact" (for codified rules), "interpretation" (for ambiguous rulings), or "unsupported" (for invalid actions).`;

export const ARBITER_RULE_RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    ruleTitle: {
      type: SchemaType.STRING,
      description: "Canonical name of the rule, spell, or mechanic"
    },
    ruleId: {
      type: SchemaType.STRING,
      description: "Lowercase slug identifier for the rule"
    },
    summary: {
      type: SchemaType.STRING,
      description: "A single sentence direct ruling answer"
    },
    ruling: {
      type: SchemaType.STRING,
      description:
        "Concise tactical explanation of the mechanics and consequences"
    },
    citations: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "List of rulebook or SRD citations"
    },
    confidence: {
      type: SchemaType.STRING,
      enum: ["exact", "interpretation", "unsupported"],
      description: "Confidence level of the ruling"
    }
  },
  required: ["ruleTitle", "summary", "ruling", "citations", "confidence"]
};

/**
 * RulesArbiterClient encapsulates Firebase AI Logic (Gemini 2.5 Flash),
 * providing structured 5e rules adjudication with schema validation,
 * timeout protection, and offline detection.
 */
export class RulesArbiterClient {
  private readonly app: FirebaseApp;
  private readonly modelName: string;
  private readonly timeoutMs: number;
  private readonly generativeModel: GenerativeModel | any;

  constructor(options: RulesArbiterClientOptions = {}) {
    this.modelName = options.model || DEFAULT_ARBITER_MODEL;
    this.timeoutMs = options.timeoutMs || DEFAULT_ARBITER_TIMEOUT_MS;

    if (options.generativeModel) {
      this.generativeModel = options.generativeModel;
      this.app = options.app || ({} as FirebaseApp);
      return;
    }

    if (options.app) {
      this.app = options.app;
    } else {
      const existingApps = getApps();
      if (existingApps.length > 0 && existingApps[0]) {
        this.app = existingApps[0];
      } else {
        const config = options.firebaseConfig || {
          apiKey: "demo-api-key",
          authDomain: "sea-of-fortune-gm.firebaseapp.com",
          projectId: "sof-gm-screen",
          storageBucket: "sof-gm-screen.firebasestorage.app",
          messagingSenderId: "1234567890",
          appId: "1:1234567890:web:abcdef123456"
        };
        this.app = initializeApp(config);
      }
    }

    const ai = getAI(this.app, { backend: new GoogleAIBackend() });
    this.generativeModel = getGenerativeModel(ai, {
      model: this.modelName,
      systemInstruction: RULES_ARBITER_SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: ARBITER_RULE_RESPONSE_SCHEMA
      }
    });
  }

  public getModelName(): string {
    return this.modelName;
  }

  public getTimeoutMs(): number {
    return this.timeoutMs;
  }

  /**
   * Queries the 5e Rules Arbiter with a natural language rules question.
   * Returns a validated, strictly typed ArbiterRuleResponse or safe fallback.
   */
  public async queryRulesArbiter(query: string): Promise<RulesArbiterResult> {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      return {
        success: false,
        error: "Query cannot be empty"
      };
    }

    // 1. Offline detection
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return {
        success: false,
        isOffline: true,
        error: "Device is currently offline. Consulting local rules glossary."
      };
    }

    // 2. Call generative model with timeout guard
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(`Rules Arbiter query timed out after ${this.timeoutMs}ms`)
          );
        }, this.timeoutMs);
      });

      const generatePromise = (async () => {
        const result = await this.generativeModel.generateContent(trimmed);
        const response = await result.response;
        return typeof response.text === "function"
          ? response.text()
          : String(response.text || "");
      })();

      const rawJson = await Promise.race([generatePromise, timeoutPromise]);
      const parsed = this.parseAndValidateResponse(rawJson, trimmed);
      return {
        success: true,
        data: parsed
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || "Failed to query Rules Arbiter"
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Safely parses and normalizes JSON text from the generative model.
   */
  private parseAndValidateResponse(
    rawText: string,
    originalQuery: string
  ): ArbiterRuleResponse {
    let parsed: any;
    const cleaned = String(rawText || "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(
        `Failed to parse Arbiter rule response JSON: "${rawText.slice(0, 100)}"`
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Arbiter response must be a valid JSON object");
    }

    const ruleTitle = String(
      parsed.ruleTitle || originalQuery.slice(0, 40)
    ).trim();
    const ruleId =
      parsed.ruleId && typeof parsed.ruleId === "string"
        ? parsed.ruleId.trim()
        : ruleTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_");

    const summary = String(parsed.summary || "").trim();
    const ruling = String(parsed.ruling || "").trim();

    if (!summary || !ruling) {
      throw new Error("Arbiter response missing required summary or ruling");
    }

    const citations: string[] = Array.isArray(parsed.citations)
      ? parsed.citations
          .map((c: any) => String(c).trim())
          .filter((c: string) => c.length > 0)
      : [];

    let confidence: ArbiterConfidence = "interpretation";
    if (
      parsed.confidence === "exact" ||
      parsed.confidence === "interpretation" ||
      parsed.confidence === "unsupported"
    ) {
      confidence = parsed.confidence;
    }

    return {
      ruleTitle,
      ruleId,
      summary,
      ruling,
      citations,
      confidence
    };
  }
}
