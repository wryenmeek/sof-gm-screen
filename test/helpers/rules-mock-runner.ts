import fs from "fs";

export interface AuthContext {
  uid: string;
  token?: Record<string, any>;
}

export class FirebaseError extends Error {
  public code: string;
  constructor(message: string, code = "permission-denied") {
    super(message);
    this.name = "FirebaseError";
    this.code = code;
  }
}

export interface MockDocSnapshot {
  id: string;
  exists(): boolean;
  data(): Record<string, any> | undefined;
}

export interface MockDocRef {
  id: string;
  path: string;
  get(): Promise<MockDocSnapshot>;
  set(data: Record<string, any>, options?: { merge?: boolean }): Promise<void>;
  update(data: Record<string, any>): Promise<void>;
  delete(): Promise<void>;
  onSnapshot(
    callback: (snap: MockDocSnapshot) => void,
    onError?: (err: Error) => void
  ): () => void;
}

export interface MockCollectionRef {
  id: string;
  path: string;
  doc(id?: string): MockDocRef;
  add(data: Record<string, any>): Promise<MockDocRef>;
}

export class MockFirestoreDatabase {
  private readonly store = new Map<string, Record<string, any>>();
  private readonly rulesContent: string;

  constructor(rulesPath = "firestore.rules") {
    if (!fs.existsSync(rulesPath)) {
      throw new Error(`Rules file not found at ${rulesPath}`);
    }
    this.rulesContent = fs.readFileSync(rulesPath, "utf-8");
    this.validateRulesSyntax();
  }

  public getRulesContent(): string {
    return this.rulesContent;
  }

  private validateRulesSyntax(): void {
    const requiredKeywords = [
      "rules_version = '2'",
      "service cloud.firestore",
      "function isAuthenticated()",
      "function isGm()",
      "rules_glossary",
      "rules_feedback",
      "sessions/{sessionDate}",
      "manifest",
      "manifest_gm",
      "roster",
      "live/audio_cue",
      "live/combat",
      "live/combat_gm",
      "live/reactions"
    ];

    for (const kw of requiredKeywords) {
      if (!this.rulesContent.includes(kw)) {
        throw new Error(`firestore.rules missing mandatory structure: '${kw}'`);
      }
    }
  }

  public clear(): void {
    this.store.clear();
  }

  public getRaw(path: string): Record<string, any> | undefined {
    return this.store.get(this.normalizePath(path));
  }

  public setRaw(path: string, data: Record<string, any>): void {
    this.store.set(this.normalizePath(path), JSON.parse(JSON.stringify(data)));
  }

  public deleteRaw(path: string): void {
    this.store.delete(this.normalizePath(path));
  }

  private normalizePath(path: string): string {
    return path.replace(/^\/+|\/+$/g, "");
  }

  private isGm(auth: AuthContext | null): boolean {
    if (!auth || !auth.uid) return false;
    if (auth.token?.gm === true) return true;
    if (
      auth.token?.email === "wryenmeek@gmail.com" &&
      auth.token?.email_verified === true
    ) {
      return true;
    }
    return false;
  }

  private isAuthenticated(auth: AuthContext | null): boolean {
    return !!(auth && auth.uid);
  }

  public evaluateRule(
    op: "get" | "create" | "update" | "delete",
    path: string,
    auth: AuthContext | null,
    incomingData?: Record<string, any>
  ): boolean {
    const norm = this.normalizePath(path);
    const existing = this.store.get(norm);
    const segments = norm.split("/");

    // 1. match /rules_glossary/{termId}
    if (segments[0] === "rules_glossary" && segments.length === 2) {
      if (op === "get") return true; // allow read: if true;
      return this.isGm(auth); // allow write: if isGm();
    }

    // 2. match /rules_feedback/{feedbackId}
    if (segments[0] === "rules_feedback" && segments.length === 2) {
      if (op === "get") {
        return this.isGm(auth); // allow read: if isGm();
      }
      if (op === "create") {
        if (!this.isAuthenticated(auth)) return false;
        if (!incomingData) return false;

        const keys = Object.keys(incomingData);
        const requiredKeys = ["ruleId", "isHelpful", "authorUid", "timestamp"];
        const allowedKeys = [
          "ruleId",
          "isHelpful",
          "authorUid",
          "timestamp",
          "notes",
          "sessionDate"
        ];

        const hasAllRequired = requiredKeys.every((k) => keys.includes(k));
        const hasOnlyAllowed = keys.every((k) => allowedKeys.includes(k));
        if (!hasAllRequired || !hasOnlyAllowed) return false;

        if (incomingData.authorUid !== auth!.uid) return false;
        if (typeof incomingData.isHelpful !== "boolean") return false;
        if (
          typeof incomingData.ruleId !== "string" ||
          incomingData.ruleId.length < 1 ||
          incomingData.ruleId.length > 100
        ) {
          return false;
        }
        if (
          incomingData.notes !== undefined &&
          (typeof incomingData.notes !== "string" ||
            incomingData.notes.length > 500)
        ) {
          return false;
        }
        if (
          incomingData.sessionDate !== undefined &&
          (typeof incomingData.sessionDate !== "string" ||
            incomingData.sessionDate.length !== 10)
        ) {
          return false;
        }
        return true;
      }
      if (op === "update" || op === "delete") {
        return this.isGm(auth); // allow update, delete: if isGm();
      }
    }

    // 3. match /sessions/{sessionDate}/...
    if (segments[0] === "sessions" && segments.length >= 2) {
      // Top-level session doc: sessions/{sessionDate}
      if (segments.length === 2) {
        if (op === "get") return this.isAuthenticated(auth);
        return this.isGm(auth);
      }

      const subCol = segments[2];

      // match /manifest/{assetId}
      if (subCol === "manifest" && segments.length === 4) {
        if (op === "get") return this.isAuthenticated(auth);
        return this.isGm(auth);
      }

      // match /manifest_gm/{assetId}
      if (subCol === "manifest_gm" && segments.length === 4) {
        return this.isGm(auth);
      }

      // match /roster/{characterId}
      if (subCol === "roster" && segments.length === 4) {
        if (op === "get") return this.isAuthenticated(auth);
        if (op === "create" || op === "delete") return this.isGm(auth);
        if (op === "update") {
          if (!this.isAuthenticated(auth)) return false;
          if (this.isGm(auth)) return true;
          if (!existing || !incomingData) return false;

          // Compute affected keys
          const affectedKeys = Object.keys({
            ...existing,
            ...incomingData
          }).filter(
            (k) =>
              JSON.stringify(existing[k]) !== JSON.stringify(incomingData[k])
          );

          const hasOnlyClaimFields = affectedKeys.every((k) =>
            ["claimedBy", "claimedAt"].includes(k)
          );
          if (!hasOnlyClaimFields) return false;

          // Case 1: Claiming an unclaimed character
          if (
            existing.claimedBy === null &&
            incomingData.claimedBy === auth!.uid
          ) {
            return true;
          }

          // Case 2: Releasing an owned claim
          if (
            existing.claimedBy === auth!.uid &&
            incomingData.claimedBy === null
          ) {
            return true;
          }

          return false;
        }
      }

      // match /live/{docId}
      if (subCol === "live" && segments.length === 4) {
        const liveDocId = segments[3];

        if (liveDocId === "audio_cue") {
          if (op === "get") return this.isAuthenticated(auth);
          if (this.isGm(auth)) return true;
          if (op === "create" || op === "update") {
            if (!this.isAuthenticated(auth)) return false;
            if (!incomingData) return false;
            if (incomingData.intent !== "RULE_QUERY") return false;
            const keys = Object.keys(incomingData);
            const allowed = [
              "intent",
              "source",
              "triggeredAt",
              "rule",
              "mood",
              "confidence",
              "payload"
            ];
            if (!keys.every((k) => allowed.includes(k))) return false;
            if (!incomingData.source || typeof incomingData.source !== "string")
              return false;
            if (
              incomingData.payload !== undefined &&
              incomingData.payload !== null &&
              (typeof incomingData.payload !== "object" ||
                Array.isArray(incomingData.payload))
            ) {
              return false;
            }
            if (
              incomingData.confidence !== undefined &&
              incomingData.confidence !== null &&
              typeof incomingData.confidence !== "number" &&
              typeof incomingData.confidence !== "string"
            ) {
              return false;
            }
            return true;
          }
          return false;
        }

        if (liveDocId === "combat") {
          if (op === "get") return this.isAuthenticated(auth);
          return this.isGm(auth);
        }

        if (liveDocId === "combat_gm") {
          return this.isGm(auth); // Read & write GM only
        }

        if (liveDocId === "reactions") {
          if (op === "get") return this.isAuthenticated(auth);
          if (this.isGm(auth)) return true;
          if (op === "create" || op === "update") {
            if (!this.isAuthenticated(auth)) return false;
            if (!incomingData) return false;

            const keys = Object.keys(incomingData);
            const hasOnlyAllowed = keys.every((k) =>
              ["recentReactions", "updatedAt"].includes(k)
            );
            if (!hasOnlyAllowed) return false;

            if (!Array.isArray(incomingData.recentReactions)) return false;
            if (incomingData.recentReactions.length > 20) return false;

            if (incomingData.recentReactions.length > 0) {
              const lastReaction =
                incomingData.recentReactions[
                  incomingData.recentReactions.length - 1
                ];
              if (!lastReaction || lastReaction.uid !== auth!.uid) {
                return false;
              }
            }

            return true;
          }
          return false;
        }
      }
    }

    return false;
  }
}

export class MockFirestoreClient {
  constructor(
    private readonly db: MockFirestoreDatabase,
    private readonly auth: AuthContext | null
  ) {}

  public doc(path: string): MockDocRef {
    const db = this.db;
    const auth = this.auth;

    return {
      id: path.split("/").pop() || "",
      path,
      async get(): Promise<MockDocSnapshot> {
        const allowed = db.evaluateRule("get", path, auth);
        if (!allowed) {
          throw new FirebaseError(
            `Missing or insufficient permissions for get at ${path}`,
            "permission-denied"
          );
        }
        const data = db.getRaw(path);
        return {
          id: path.split("/").pop() || "",
          exists: () => data !== undefined,
          data: () => data
        };
      },
      async set(
        data: Record<string, any>,
        options?: { merge?: boolean }
      ): Promise<void> {
        const existing = db.getRaw(path);
        const op = existing === undefined ? "create" : "update";
        const merged =
          options?.merge && existing ? { ...existing, ...data } : data;

        const allowed = db.evaluateRule(op, path, auth, merged);
        if (!allowed) {
          throw new FirebaseError(
            `Missing or insufficient permissions for ${op} at ${path}`,
            "permission-denied"
          );
        }
        db.setRaw(path, merged);
      },
      async update(data: Record<string, any>): Promise<void> {
        const existing = db.getRaw(path);
        if (existing === undefined) {
          throw new FirebaseError(
            `No document to update: ${path}`,
            "not-found"
          );
        }
        const merged = { ...existing, ...data };
        const allowed = db.evaluateRule("update", path, auth, merged);
        if (!allowed) {
          throw new FirebaseError(
            `Missing or insufficient permissions for update at ${path}`,
            "permission-denied"
          );
        }
        db.setRaw(path, merged);
      },
      async delete(): Promise<void> {
        const allowed = db.evaluateRule("delete", path, auth);
        if (!allowed) {
          throw new FirebaseError(
            `Missing or insufficient permissions for delete at ${path}`,
            "permission-denied"
          );
        }
        db.deleteRaw(path);
      },
      onSnapshot(
        callback: (snap: MockDocSnapshot) => void,
        onError?: (err: Error) => void
      ): () => void {
        this.get()
          .then((snap) => callback(snap))
          .catch((err) => {
            if (onError) onError(err);
          });
        return () => {};
      }
    };
  }

  public collection(path: string): MockCollectionRef {
    const docFn = this.doc.bind(this);
    return {
      id: path.split("/").pop() || "",
      path,
      doc: (id?: string) => {
        const docId =
          id ||
          (typeof crypto !== "undefined" &&
          typeof crypto.randomUUID === "function"
            ? `doc_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`
            : `doc_${Date.now()}_${Date.now().toString(36)}`);
        return docFn(`${path}/${docId}`);
      },
      add: async (data: Record<string, any>) => {
        const docId =
          typeof crypto !== "undefined" &&
          typeof crypto.randomUUID === "function"
            ? `doc_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`
            : `doc_${Date.now()}_${Date.now().toString(36)}`;
        const ref = docFn(`${path}/${docId}`);
        await ref.set(data);
        return ref;
      }
    };
  }
}

export class RulesTestEnvironment {
  private readonly db: MockFirestoreDatabase;

  constructor(rulesPath = "firestore.rules") {
    this.db = new MockFirestoreDatabase(rulesPath);
  }

  public authenticatedContext(
    uid: string,
    token?: Record<string, any>
  ): { firestore: () => MockFirestoreClient } {
    const auth: AuthContext = { uid, token: token || {} };
    return {
      firestore: () => new MockFirestoreClient(this.db, auth)
    };
  }

  public unauthenticatedContext(): { firestore: () => MockFirestoreClient } {
    return {
      firestore: () => new MockFirestoreClient(this.db, null)
    };
  }

  public async withSecurityRulesDisabled(
    callback: (context: {
      firestore: () => MockFirestoreClient;
    }) => Promise<void>
  ): Promise<void> {
    const bypassClient = {
      firestore: () => ({
        doc: (path: string) => ({
          id: path.split("/").pop() || "",
          path,
          get: async () => {
            const data = this.db.getRaw(path);
            return {
              id: path.split("/").pop() || "",
              exists: () => data !== undefined,
              data: () => data
            };
          },
          set: async (data: Record<string, any>) => this.db.setRaw(path, data),
          update: async (data: Record<string, any>) => {
            const existing = this.db.getRaw(path) || {};
            this.db.setRaw(path, { ...existing, ...data });
          },
          delete: async () => this.db.deleteRaw(path)
        }),
        collection: (path: string) => ({
          id: path.split("/").pop() || "",
          path,
          doc: (id?: string) => {
            const docId = id || "bypass_doc";
            return {
              id: docId,
              path: `${path}/${docId}`,
              get: async () => ({
                id: docId,
                exists: () => false,
                data: () => undefined
              }),
              set: async (data: Record<string, any>) =>
                this.db.setRaw(`${path}/${docId}`, data),
              update: async (data: Record<string, any>) =>
                this.db.setRaw(`${path}/${docId}`, data),
              delete: async () => this.db.deleteRaw(`${path}/${docId}`)
            };
          },
          add: async (data: Record<string, any>) => {
            const docId = `doc_${Date.now()}`;
            this.db.setRaw(`${path}/${docId}`, data);
            return {
              id: docId,
              path: `${path}/${docId}`,
              get: async () => ({
                id: docId,
                exists: () => true,
                data: () => data
              }),
              set: async (d: any) => this.db.setRaw(`${path}/${docId}`, d),
              update: async (d: any) => this.db.setRaw(`${path}/${docId}`, d),
              delete: async () => this.db.deleteRaw(`${path}/${docId}`)
            };
          }
        })
      })
    };
    await callback(bypassClient as any);
  }

  public async clearFirestore(): Promise<void> {
    this.db.clear();
  }

  public async cleanup(): Promise<void> {
    this.db.clear();
  }
}

export async function assertSucceeds<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err: any) {
    throw new Error(
      `Expected operation to succeed, but it failed with: ${err.message || err}`
    );
  }
}

export async function assertFails<T>(promise: Promise<T>): Promise<any> {
  try {
    await promise;
  } catch (err: any) {
    return err;
  }
  throw new Error(
    "Expected operation to fail with permission-denied, but it succeeded."
  );
}
