/**
 * Replay the real World Cup 2026 results through the ledger.
 * Every match here is a real fixture with a real final and half-time score.
 * The agent seals a pick, then writes the grade, in chronological order —
 * so each pick only ever sees receipts from matches already played.
 */
import { worldCup2026 } from "../server/football.js";
import { sealPick, gradePick } from "../server/agent.js";
import { all } from "../server/store.js";
import { memwalReady } from "../server/env.js";

const LIMIT = Number(process.env.SEED_LIMIT ?? 40);
const OFFSET = Number(process.env.SEED_OFFSET ?? 0);

if (!memwalReady()) {
  console.error("MEMWAL_KEY missing in .env");
  process.exit(1);
}

const matches = (await worldCup2026())
  .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
  .slice(OFFSET, OFFSET + LIMIT);

const existing = new Set((await all()).map((p) => p.fixtureId));
console.log(`${matches.length} replay fixtures queued (${existing.size} already in ledger)`);

for (const [i, fx] of matches.entries()) {
  const tag = `[${i + 1}/${matches.length}] ${fx.home} v ${fx.away} ${fx.ft?.join("-")}`;
  if (existing.has(fx.id)) {
    console.log(`${tag} — already sealed`);
    continue;
  }
  try {
    const pick = await sealPick(fx);
    const graded = await gradePick(pick, { ft: fx.ft!, ht: fx.ht! });
    console.log(
      `${tag} — ${pick.market} conf ${pick.confidence} ${pick.verdict} -> ${graded.grade?.result}` +
        ` | blob ${pick.sealedBlobId.slice(0, 10)}`,
    );
  } catch (e) {
    console.error(`${tag} — FAILED: ${(e as Error).message}`);
  }
}
console.log("done");
