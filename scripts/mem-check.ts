import { env, memwalReady } from "../server/env.js";
import { health, recall, seal, mem } from "../server/mem.js";

if (!memwalReady()) {
  console.error("MEMWAL_KEY missing in .env — paste the delegate private key.");
  process.exit(1);
}

const h = await health();
console.log("health:", h.ok ? "ok" : "FAIL", h.detail.slice(0, 160));
if (!h.ok) process.exit(1);

const text = `PICK selftest-${Date.now()} | comp self-test | home Alpha | away Beta | market btts | side - | base 0.520 | confidence 0.520 | verdict play | reasoning connectivity probe | sealed ${new Date().toISOString()}`;
const written = await seal(text, `selftest:${text.slice(-30)}`);
console.log("sealed blob:", written.blob_id);

const hits = await recall("PICK self-test Alpha Beta btts", 5);
console.log(`recalled ${hits.length} hits`);
for (const x of hits.slice(0, 3)) console.log(" -", x.blob_id.slice(0, 12), x.distance.toFixed(3), x.text.slice(0, 60));

const list = await mem().listMemories({ limit: 5 });
console.log("memories:", JSON.stringify(list).slice(0, 200));
mem().destroy();
