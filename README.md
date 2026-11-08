# Receipts

A sports handicapper that cannot rewrite its own history.

Every pick is sealed into Walrus Memory before kickoff, with its reasoning and its confidence. Every grade is sealed after full time. The blob hash of the pick never moves, so the only way to look good in hindsight is to have been right at the time.

---

## The problem this is aimed at

Tipsters are unfalsifiable. They post the wins, delete the losses, and quietly raise the confidence number in the screenshot. Nothing in the format stops them, because the record lives wherever the tipster says it lives.

Receipts makes the record live somewhere the tipster does not control. Walrus Memory stores each pick as a content addressed blob, signed by a delegate key. Change one character and the hash changes. That is the whole design constraint, and everything else falls out of it.

## What it actually does

1. Takes the fixture on the board.
2. Slates one market for it by rotation, so the agent cannot shop for its easiest market after the fact.
3. Recalls its own graded history for that market and that team from memory.
4. Shrinks the market prior toward that record. This is where a 0.70 becomes a 0.34.
5. Seals the pick, the reasoning and the confidence to Walrus before kickoff.
6. After full time, computes the result from the real scoreline and seals the grade as a second record.
7. Publishes both, plus the hashes, so anyone can re-read the blob and recompute.

Current ledger, replayed over real World Cup 2026 fixtures:

- 50 receipts, 99 seals (pick plus grade), 49 graded
- Agent overall: **22-26, 0.458**
- Agent played 38 at **21-17, 0.553**
- Agent passed 10 and went **1-9** on those, which is the point of a publishing floor
- The `comeback` market is **0-9**, which is exactly why the number it prints for that market collapses

A handicapper that hides its passed picks is a tipster with a delete key, so the pass record ships too.

## Architecture

```
                          +---------------------------+
                          |   browser (web/)          |
                          |   vanilla JS, no build    |
                          +------------+--------------+
                                       |
                        GET /api/board, /api/receipts
                        POST /api/board/pick, /api/verify
                                       |
+--------------------------------------v---------------------------------------+
|  Express server (server/index.ts, port 4310)                                 |
|                                                                              |
|  agent.ts        sealPick()   gradePick()   humanPick()   gradeFinished()    |
|     |                                                                        |
|  engine.ts       slateMarket() -> assess() -> recall() + shrinkage           |
|     |                                                                        |
|  ledger.ts       pickText() / gradeText() / parseRecord() / gradeAgainst()   |
|     |                                                                        |
|  mem.ts          seal()  recall()  health()  (fake double behind a flag)     |
|     |                                                                        |
|  football.ts     TheSportsDB live fixtures + openfootball WC2026 replay      |
+------+---------------------------------------------+-----------------------+
       |                                             |
       | rememberAndWait(text, idempotencyKey)       | recall(query, limit)
       v                                             v
+------------------------------+          +-----------------------------+
| Walrus Memory relayer        |          | data/ledger.json            |
| relayer.memory.walrus.xyz    |          | local mirror: blob id, hash |
| account 0xe46b...0c3b        |          | used by /api/verify to      |
| delegate key in .env         |          | recompute independently     |
+------------------------------+          +-----------------------------+
       |
       | 402 challenge / x402 settle (optional)
       v
+------------------------------+
| Sui mainnet (x402.ts)        |
| verify tx digest + balance   |
| change to payTo, replay-safe |
+------------------------------+
```

Two write paths, one read path:

- **Write.** `sealPick()` composes a single line of text, hashes it, calls `seal()` with idempotency key `pick:<id>`, stores the returned `blob_id`.
- **Grade write.** `gradePick()` composes a second line, key `grade:<id>`, stores that blob id too.
- **Read.** `assess()` calls `recall()` with a text query, parses each returned blob, and only counts records whose kind is `GRADE` and whose market and side match.

## Tech stack

- **Runtime:** Node 20+, TypeScript, ESM, run through `tsx`. No bundler on the server side.
- **HTTP:** Express 4, single process, three route groups (read, write, pay).
- **Memory:** [`@mysten-incubation/memwal`](https://www.npmjs.com/package/@mysten-incubation/memwal), the Walrus Memory SDK. `MemWal.create({ key, accountId, serverUrl, namespace })`, then `rememberAndWait` and `recall`.
- **Fixtures:** TheSportsDB free tier for upcoming fixtures, openfootball `2026/worldcup.json` for the replay corpus with real full time and half time scores.
- **Payments:** x402 over Sui mainnet, settled in SUI, verified by reading the transaction's balance changes through Sui JSON-RPC (Tatum gateway when a key is present, public fullnode otherwise).
- **Front end:** hand written HTML, CSS and vanilla JS. No framework, no build step. Editorial newsprint styling so hashes and timestamps read as evidence rather than as UI chrome.
- **Storage:** `data/ledger.json` as a local mirror of chain state, so verification can recompute instead of trusting the API.

## The receipt format

A record is one line of pipe delimited `key value` pairs. Text, not JSON, on purpose: it hashes predictably, it survives a copy paste, and a human can read it out loud on a video.

```ts
// server/ledger.ts
export function pickText(p: Omit<PickRecord, "recordText" | "contentHash" | "evidence" | "grade">): string {
  return [
    `PICK ${p.id}`,
    `comp ${clean(p.competition)}`,
    `home ${clean(p.home)}`,
    `away ${clean(p.away)}`,
    `kickoff ${p.kickoff}`,
    `market ${p.market}`,
    `side ${clean(p.side)}`,
    `base ${p.base.toFixed(3)}`,
    `confidence ${p.confidence.toFixed(3)}`,
    `verdict ${p.verdict}`,
    `reasoning ${clean(p.reasoning)}`,
    `sealed ${p.sealedAt}`,
    `owner ${clean(p.owner ?? "agent")}`,
    `kind ${p.kind ?? "agent"}`,
  ].join(" | ");
}
```

A real sealed pick from the ledger:

```
PICK pk-687ce77b90 | comp World Cup 2026 | home Mexico | away South Africa | kickoff 2026-06-11T12:00:00Z | market under_2_5 | side - | base 0.450 | confidence 0.450 | verdict play | reasoning Prior 45.0% on "Under 2.5 goals". My sealed record on this market: 0-0 across 0 graded receipts, shrunk to 45.0%. That moves the number +0.000 to 45.0%. Above the 45.0% floor, so I publish. | sealed 2026-11-08T15:15:30.887Z | owner agent | kind agent
```

Its grade, sealed later:

```
GRADE pk-687ce77b90 | comp World Cup 2026 | home Mexico | away South Africa | market under_2_5 | side - | final 2-0 | ht 1-0 | result won | graded 2026-11-08T15:15:30.928Z
```

Note what is absent from the pick: the result. It cannot be present, because the pick was sealed before the match existed as a result.

## The confidence engine

The agent does not get an opinion about its own reliability. The number is the market prior, pulled toward its own graded record:

```ts
// server/engine.ts
const PRIOR_WEIGHT = 3;
const FLOOR = 0.45;

const n = won + lost;
const shrunk = (won + PRIOR_WEIGHT * base) / (n + PRIOR_WEIGHT);
const delta = shrunk - base;
const confidence = Number(clamp(shrunk, 0.05, 0.95).toFixed(3));
const verdict = n >= 5 && shrunk < 0.35 ? "pass" : confidence >= FLOOR ? "play" : "pass";
```

`PRIOR_WEIGHT = 3` means three pseudo observations at the market prior. With one win in seven on a 0.70 market you get `(1 + 2.1) / 9 = 0.344`, so the pick publishes low or gets benched. With a clean 5-0 record you get `(5 + 2.1) / 8 = 0.888`, so the agent earns its conviction the same way a person would.

The reasoning string is assembled from the same numbers, not generated separately, so the sentence and the figure cannot disagree:

```
Prior 16.0% on "USA trails at half, wins". My sealed record on this market: 0-0 across 0 graded
receipts, shrunk to 16.0%. That moves the number +0.000 to 16.0%. Below my 45.0% publishing
floor, so I pass.
```

## Recall is the part that matters

This is the loop the project exists to show. Before sealing, the agent recalls its own graded history for the market and the team:

```ts
// server/engine.ts
const query = `GRADE ${label} ${side} graded result won lost`;
const hits = await recall(query, 30);

for (const h of hits) {
  const fields = parseRecord(h.text);
  const counted = kindOf(h.text) === "GRADE" && fields.market === market && fields.side === side;
  if (counted) fields.result === "won" ? won++ : lost++;
}
```

Semantic recall over its own record, then arithmetic over what came back. No model call is required for the number, which means a judge can reproduce it with a calculator. An optional LLM pass writes prose around the figure when `OPENAI_API_KEY` is set, and the server works without it.

## Verifiable, not trust-me

Every receipt carries three things: the `blob_id` Walrus returned, the sha256 of the exact text that was written, and the `createdAt` the relayer reports. Verification re-reads from memory rather than from the local mirror:

```ts
// scripts/verify.ts
const hits = await recall(p.recordText, 5);
const hit = hits.find((h) => parseRecord(h.text).PICK === p.id);
const match = hashOf(hit.text) === p.contentHash && hit.text === p.recordText;
```

`POST /api/verify/:id` runs the same check on demand for the pick and the grade separately, and returns `unmodified` or `mismatch`. If someone edited `data/ledger.json`, verification still passes, because it never trusted the mirror. If someone edited the blob, the hash stops matching and the receipt dies.

## Two sided board

Humans connect their own memory space with a delegate key and get graded by the same rules. `humanPick()` writes through the identical `pickText()` and the identical `seal()` call, with `owner` set to the person and `kind` set to `human`. The standings strip shows the agent and each human side by side, and separates the play record from the pass record:

```ts
// server/agent.ts
export async function humanPick(name, fixture, market, side, confidence) {
  const id = `hu-${hashOf(`${name}:${fixture.id}:${market}`).slice(0, 10)}`;
  const recordText = pickText({ ...base, owner: name, kind: "human" });
  const written = await seal(recordText, `pick:${id}`);
  ...
}
```

Agent picks are `pk-`, human picks are `hu-`. Same schema, same grading function, same audit trail. A human cannot retro-edit their pick either, which is the honest version of a leaderboard.

## Payments

`GET /api/receipt/:id/verified` returns the full receipt, evidence and tamper check for 0.10 SUI. Without a valid `X-PAYMENT` header it returns 402 with an `accepts` array:

```ts
// server/x402.ts
export function requirement(resource: string): Requirement {
  return {
    scheme: "exact",
    network: env.x402Network,              // sui:mainnet
    maxAmountRequired: env.x402PriceMist,  // 100000000 MIST
    resource,
    payTo: env.x402PayTo,
    asset: "0x2::sui::SUI",
    ...
  };
}
```

Verification is real when `X402_MOCK` is unset: it base64 decodes the header, rejects a `txDigest` it has already seen, reads `sui_getTransactionBlock` with `showBalanceChanges`, requires a successful status and a SUI balance change of at least the price to `payTo`. With `X402_MOCK=1` it returns `mode: "demo"` and the UI says so, because a mock settlement dressed up as a real one is the exact dishonesty this project is arguing against.

## API

- `GET /api/health` memory health, whether a delegate key is loaded, Tatum and x402 config
- `GET /api/board` upcoming fixtures, any pick already sealed on each, stats
- `GET /api/receipts` every pick, newest first, with grades and parsed evidence
- `GET /api/receipt/:id` one pick
- `POST /api/seal` `{ fixtureId }` seals an agent pick
- `POST /api/agent/tick` grades everything finished, then seals up to three upcoming fixtures
- `POST /api/verify/:id` re-reads the blobs and recomputes the hashes
- `GET /api/receipt/:id/verified` x402 gated, full receipt plus settlement
- `POST /api/board/pick` `{ name, fixtureId, market, side, confidence }` human pick
- `GET|POST /api/humans` connect a delegate public key to a display name
- `GET /api/memory/stats` how many blobs the namespace holds

## Run it locally

Requires Node 20 or newer. Nothing else.

```bash
git clone <your-fork-url> receipts
cd receipts
npm install
cp .env.example .env
```

Fill `.env`. `MEMWAL_ACCOUNT_ID` and `MEMWAL_AGENT_ID` are the memory account and the delegate public key. `MEMWAL_KEY` is the delegate private key and must never leave `.env`, which is git ignored.

To develop without a key, run everything against the local test double:

```bash
MEMWAL_FAKE=1 npm run seed          # replay 40 fixtures, writes to data/fake-memory.json
MEMWAL_FAKE=1 npm start             # http://localhost:4310
```

The boot log says which backend is live, so a console screenshot can never be mistaken for a mainnet run:

```
memory: TEST DOUBLE (data/fake-memory.json) - not a submission run
```

With a real key, the same commands without the flag write to mainnet:

```bash
npm run mem:check                   # connectivity, seal and recall smoke test
npm run seed                        # 50 receipts, about 99 writes, clears the 10 write floor
npm run seal:upcoming               # seal today's real fixtures before kickoff
npm run grade                       # after full time, grade everything finished
npm run verify                      # re-read every blob and recheck the hash
npm start
```

`npm run reset` clears the local ledger and the test double so a demo starts clean. Resetting the ledger does not delete anything from Walrus, which is the entire point.

Other knobs: `SEED_LIMIT`, `SEED_OFFSET`, `SEAL_LIMIT`, `PORT`, `X402_PRICE_MIST`, `X402_MOCK`, `TATUM_API_KEY`, `OPENAI_API_KEY`.

## Repo layout

```
server/
  env.ts            typed env loader, memwalReady()
  mem.ts            seal / recall / health, plus the disk backed test double
  ledger.ts         record schema, market priors, grading rules, hashing
  engine.ts         market rotation, recall, shrinkage, reasoning
  agent.ts          sealPick / gradePick / humanPick / gradeFinished
  football.ts       live fixtures and the World Cup 2026 replay corpus
  store.ts          data/ledger.json persistence
  x402.ts           requirement, payment verification, replay guard
  index.ts          Express routes, view projection, startup banner
scripts/
  mem-check.ts      connectivity and write smoke test
  seed.ts           chronological replay seeding
  seal-upcoming.ts  seal real upcoming fixtures
  grade.ts          grade finished picks
  verify.ts         independent hash verification
web/
  index.html        editorial layout, four bands
  style.css         newsprint palette, evidence blocks, mobile table scroll
  app.js            fetch, render, two stage pay button, human pick form
data/
  wc2026.json       fixture cache
  ledger.json       local mirror, git ignored
```

## Fork it and build something

Fork, branch, `npm install`, and keep `MEMWAL_FAKE=1` while you work. The test double is the reason contribution is cheap: you never need a funded memory account to change the engine.

Ground rules that keep the project honest:

1. A receipt is append only. If a change lets a record be rewritten in place, the change is wrong regardless of how convenient it is.
2. The published number must be recomputable from the record. No hidden state in the confidence.
3. The pass record ships with the play record. A UI that only shows wins is a regression.
4. `MEMWAL_FAKE` must never be able to pass as a live run. The boot banner and the UI label both have to say so.

Concrete things worth building, roughly in order of how much they would add:

### 1. Receipt explorer with a public verifier page
A page per blob id: the raw text, the sha256, the relayer timestamp, and a green check that re-reads from Walrus in the browser. Right now verification is an API call and a CLI. A permanent URL per receipt turns every pick into a citation someone else can paste.

### 2. Scheduled sealing with a cron driven agent tick
Run `POST /api/agent/tick` on a five minute interval so picks land at T minus two hours without a human present, and grades land minutes after the final whistle. The handler exists; it needs a scheduler and an offline queue so a relayer hiccup does not silently drop a pick.

### 3. Calibration curve, not just hit rate
Bucket every graded pick by the confidence it published and plot predicted against realised. A handicapper at 0.46 who wins 46% is better than one at 0.70 who wins 55%, and only the curve shows that. This is the single most convincing chart the project could ship.

### 4. Per-team memory namespaces
Right now everything sits in one namespace. Give each club its own memory space so recall is scoped and cheap, and so a judge can ask "what does this thing remember about Arsenal" and get a clean answer.

### 5. Multi-agent disagreement
Two agents with different priors, both sealing to the same account. Where they disagree, show both receipts. A market for opinions with an audit trail is more interesting than a single oracle.

### 6. Real settlement on the payments side
Wire an actual payer: a script that builds and signs a SUI transfer, posts the digest, and shows the 200 with a Suiscan link. The verification half already works; the paying half is what makes the lane real.

### 7. Shareable receipts as images
A `/receipt/:id.png` endpoint that renders the record and the hash as a card, so a pick can be posted to a group chat where a tweet cannot go, and the hash travels with it.

### 8. Any sport, any league
The fixture layer is already abstracted behind `upcomingFixtures()`. Cricket, NBA, or an election market with the same seal, grade, verify loop would show that content addressed memory is not football specific.

### 9. Delegate key rotation
Support rotating a human's delegate key without orphaning their history, and prove it with a verification run. That is the operational question anyone deploying this will ask on day two.

### 10. Versioned reasoning prompts
The optional LLM reasoning pass exists but the prompt is not versioned. Pin the prompt hash into the record so the prose can be audited the same way the number can.

## Known limits, stated plainly

- The replayed fixtures were seeded in one evening, so their write timestamps are all recent. The ordering claim rests on the content hash, not the clock: a pick sealed with no result in it cannot have been written after seeing the result. The live path exists exactly to make that argument literal.
- Semantic recall is approximate. The engine counters that by filtering recalled hits on exact parsed fields before counting anything, so a sloppy recall returns fewer receipts, never a wrong count.
- The replay corpus is World Cup 2026 only, and it is a fixed snapshot.
- x402 verification trusts the relayer and the RPC endpoint for finality. It does not implement its own light client.