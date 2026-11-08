# Run Receipts

Two ways to run it: a local demo with no keys, and a real mainnet run.

## 0. Prerequisites

- Node 20 or newer (`node -v`)
- Nothing else. No Docker, no database.

## 1. Unpack and install

```bash
unzip receipts.zip -d receipts
cd receipts
npm install
```

## 2. Configure

```bash
cp .env.example .env
```

Open `.env` and fill in:

- `MEMWAL_KEY` : the delegate private key (hex). This is the only secret. It stays in `.env`, which is git ignored.
- `MEMWAL_ACCOUNT_ID` and `MEMWAL_AGENT_ID` : already filled in `.env.example`.
- `TATUM_API_KEY` : optional for the Sui RPC leg, required by the submission form. Free key at dashboard.tatum.io.
- `X402_PAY_TO` : the address that receives the 0.10 SUI. Set this to your own wallet, not the memory account.
- `X402_MOCK` : leave it out for real settlement, set `X402_MOCK=1` for the demo flow.

## 3. Local demo run, no keys needed

```bash
MEMWAL_FAKE=1 npm run seed
MEMWAL_FAKE=1 npm start
```

Open http://localhost:4310

What you should see:

- A lead receipt with its pick, reasoning, confidence and delta bar
- The receipt table with grades and blob ids
- The standings strip (agent plus any humans)
- The paywall band: first press returns the 402 requirement, second press settles

`npm run seed` replays 40 World Cup 2026 fixtures chronologically, sealing a pick and a grade for each, so the board is populated in about ten seconds. Use `SEED_LIMIT=48` for the full ledger used in the README numbers.

The boot log prints `memory: TEST DOUBLE (data/fake-memory.json) - not a submission run`. That is deliberate. A demo run must never look like a live run.

## 4. Real mainnet run

```bash
npm run mem:check        # connectivity, one seal, one recall
npm run reset            # clear local state only, nothing on Walrus is deleted
npm run seed             # 50 receipts, about 99 writes to Walrus Memory
npm run verify           # re-read every blob and recompute the sha256
npm run seal:upcoming    # seal today's real fixtures before kickoff
npm start                # http://localhost:4310
```

After the matches finish:

```bash
npm run grade            # grades every pick whose match is over, seals the grade
npm run verify           # re-check the whole record
```

Useful overrides:

```bash
SEAL_LIMIT=3 npm run seal:upcoming
SEED_LIMIT=20 SEED_OFFSET=0 npm run seed
PORT=4311 npm start
```

## 5. The demo beat, in order

1. On the board, pick a receipt that has a `PICK` blob id and no grade yet. Note the hash.
2. Wait for full time, or use a replay fixture that already has a score.
3. `npm run grade`.
4. Reload. The grade is a second blob. The pick's hash is identical.
5. `npm run verify` prints `unmodified` for each record, re-read from Walrus rather than from the local file.

That is the whole pitch: same hash at T minus two hours and after full time.

## 6. Troubleshooting

- `MEMWAL_KEY is empty` : the key is missing from `.env`. Either paste it, or use `MEMWAL_FAKE=1` for the demo.
- `EADDRINUSE :4310` : `lsof -ti tcp:4310 | xargs kill` then start again.
- Empty board after `npm start` : run `npm run seed` first. A reset deletes the local ledger.
- `402` on the receipt endpoint : that is the paywall working. Press the button a second time to settle, or set `X402_MOCK=1` for the demo path.

Built By Harish Kotra: https://harishkotra.me
Checkout my other builds: https://dailybuild.xyz
