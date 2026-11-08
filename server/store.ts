import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { PickRecord } from "./ledger.js";

const FILE = path.join(process.cwd(), "data", "ledger.json");

let cache: PickRecord[] | null = null;

export async function all(): Promise<PickRecord[]> {
  if (cache) return cache;
  try {
    const j = JSON.parse(await readFile(FILE, "utf8"));
    cache = Array.isArray(j.picks) ? j.picks : [];
  } catch {
    cache = [];
  }
  return cache;
}

export async function save(picks: PickRecord[]): Promise<void> {
  cache = picks;
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify({ updatedAt: new Date().toISOString(), picks }, null, 2));
}

export async function upsert(p: PickRecord): Promise<void> {
  const picks = await all();
  const i = picks.findIndex((x) => x.id === p.id);
  if (i === -1) picks.push(p);
  else picks[i] = p;
  await save(picks);
}

export async function byId(id: string): Promise<PickRecord | undefined> {
  return (await all()).find((p) => p.id === id);
}
