import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MemWal } from "@mysten-incubation/memwal";
import type { RecallMemory, RememberResult } from "@mysten-incubation/memwal";
import { env, memwalReady } from "./env.js";

let client: MemWal | null = null;

/* ---------------- local test double ----------------
   Same interface as the relayer, blobs kept in data/fake-memory.json.
   Set MEMWAL_FAKE=1 to develop without the delegate key. Never a real write. */
type FakeBlob = { blob_id: string; text: string; created_at: string };

function fakeStore(): FakeBlob[] {
  const p = path.join(process.cwd(), "data", "fake-memory.json");
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

function fakeSave(blobs: FakeBlob[]) {
  mkdirSync(path.dirname(path.join(process.cwd(), "data", "x")), { recursive: true });
  writeFileSync(path.join(process.cwd(), "data", "fake-memory.json"), JSON.stringify(blobs, null, 1));
}

const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

export function mem(): MemWal {
  if (!memwalReady()) {
    throw new Error(
      "MEMWAL_KEY is empty. Paste the Ed25519 delegate private key (hex) into .env as MEMWAL_KEY=...",
    );
  }
  if (!client) {
    client = MemWal.create({
      key: env.memwalKey,
      accountId: env.memwalAccountId,
      serverUrl: env.memwalServerUrl,
      namespace: env.namespace,
    });
  }
  return client;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Write a record and wait until Walrus has it. Returns the blob id — the receipt. */
export async function seal(text: string, idempotencyKey?: string): Promise<RememberResult> {
  if (env.memwalFake) {
    const blobs = fakeStore();
    const existing = idempotencyKey ? blobs.find((b) => sha256(b.text) === sha256(text)) : undefined;
    if (existing) return { blob_id: existing.blob_id, status: "already_exists" } as unknown as RememberResult;
    const blob = { blob_id: `fake${sha256(text).slice(0, 30)}`, text, created_at: new Date().toISOString() };
    blobs.push(blob);
    fakeSave(blobs);
    return { blob_id: blob.blob_id, status: "stored" } as unknown as RememberResult;
  }
  return mem().rememberAndWait(text, {
    idempotencyKey,
    timeoutMs: 120_000,
    pollIntervalMs: 1_500,
  });
}

export async function recall(query: string, limit = 25): Promise<RecallMemory[]> {
  if (env.memwalFake) {
    const q = tokens(query);
    return fakeStore()
      .map((b) => {
        const t = tokens(b.text);
        let hit = 0;
        for (const w of q) if (t.has(w)) hit++;
        return { blob_id: b.blob_id, text: b.text, distance: 1 - hit / Math.max(6, q.size), created_at: b.created_at };
      })
      .filter((b) => b.distance < 0.92)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit) as unknown as RecallMemory[];
  }
  const res = await mem().recall({ query, limit });
  return res.results;
}

export async function health(): Promise<{ ok: boolean; detail: string }> {
  if (env.memwalFake) return { ok: true, detail: `local test double, ${fakeStore().length} blobs on disk` };
  try {
    const h = await mem().health();
    return { ok: true, detail: JSON.stringify(h) };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
