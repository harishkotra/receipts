/**
 * Seal the agent's picks for real, upcoming fixtures.
 *
 * This is the live end of the demo: every pick here is written to Walrus
 * Memory hours before kickoff, so the receipt provably predates the result.
 * Grading happens later through `npm run grade` once the matches finish.
 *
 * SEAL_LIMIT=6 by default so we do not burn the slate on fixtures too far out.
 */
import { upcomingFixtures } from "../server/football.js";
import { sealPick } from "../server/agent.js";
import { all } from "../server/store.js";
import { memwalReady } from "../server/env.js";

const LIMIT = Number(process.env.SEAL_LIMIT ?? 6);

if (!memwalReady()) {
  console.error("memory is not ready: paste MEMWAL_KEY in .env (or set MEMWAL_FAKE=1 for a dry run)");
  process.exit(1);
}

const ledger = await all();
const sealed = new Set(ledger.map((p) => p.fixtureId));

const fixtures = (await upcomingFixtures())
  .filter((f) => !sealed.has(f.id))
  .sort((a, b) => +new Date(a.kickoff) - +new Date(b.kickoff));

if (!fixtures.length) {
  console.log("no upcoming fixtures left to seal");
  process.exit(0);
}

const batch = fixtures.slice(0, LIMIT);
console.log(`sealing ${batch.length} upcoming picks (of ${fixtures.length} unplayed fixtures)`);

for (let i = 0; i < batch.length; i++) {
  const f = batch[i];
  try {
    const p = await sealPick(f);
    const lead = (new Date(f.kickoff).getTime() - Date.now()) / 3_600_000;
    console.log(
      `[${i + 1}/${batch.length}] ${f.home} v ${f.away} · ${p.market} ${p.side} · ` +
        `conf ${p.confidence} · ${p.verdict} · sealed ${lead.toFixed(1)}h before kickoff · ${p.sealedBlobId.slice(0, 16)}`,
    );
  } catch (e) {
    console.error(`[${i + 1}/${batch.length}] ${f.home} v ${f.away} failed: ${(e as Error).message}`);
  }
}
