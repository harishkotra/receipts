/** Re-read every receipt from Walrus Memory and check the hash still matches. */
import { all } from "../server/store.js";
import { recall } from "../server/mem.js";
import { hashOf, parseRecord } from "../server/ledger.js";

const picks = await all();
let ok = 0;
let bad = 0;
let missing = 0;

for (const p of picks) {
  const hits = await recall(p.recordText, 5);
  const hit = hits.find((h) => parseRecord(h.text).PICK === p.id);
  if (!hit) {
    missing++;
    console.log(`MISSING ${p.id} ${p.home} v ${p.away}`);
    continue;
  }
  const match = hashOf(hit.text) === p.contentHash && hit.text === p.recordText;
  if (match) ok++;
  else {
    bad++;
    console.log(`MISMATCH ${p.id}`);
  }
}
console.log(`verified ${ok}/${picks.length} receipts, ${missing} missing, ${bad} mismatched`);
