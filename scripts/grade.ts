/**
 * Grade every pick whose match has finished, and seal the grade.
 *
 * Run this after full time. Live picks sealed by `seal:upcoming` get their
 * result written as a second receipt, so the pick blob and the grade blob
 * both exist on Walrus and neither can be edited afterwards.
 */
import { gradeFinished } from "../server/agent.js";
import { all } from "../server/store.js";
import { memwalReady } from "../server/env.js";

if (!memwalReady()) {
  console.error("memory is not ready: paste MEMWAL_KEY in .env (or set MEMWAL_FAKE=1 for a dry run)");
  process.exit(1);
}

const before = await all();
const open = before.filter((p) => !p.grade);
console.log(`${before.length} receipts, ${open.length} still waiting on full time`);

const res = await gradeFinished(before);
console.log(`graded ${res.graded.length} just now, ${res.pending} still pending`);
for (const id of res.graded) {
  const p = (await all()).find((x) => x.id === id);
  const g = p?.grade;
  if (p && g) console.log(`  ${p.fixtureId} · ${p.market} · ${g.result} · ft ${g.ft.join("-")} · ${g.blobId.slice(0, 16)}`);
}
