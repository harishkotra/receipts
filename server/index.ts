import express from "express";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { env, memwalReady } from "./env.js";
import { all } from "./store.js";
import { upcomingFixtures, worldCup2026, resultFor } from "./football.js";
import { sealPick, gradeFinished, humanPick, gradePick } from "./agent.js";
import { byId } from "./store.js";
import { recall, mem, health } from "./mem.js";
import { MARKETS, hashOf, parseRecord, type MarketKey, type PickRecord } from "./ledger.js";
import { isConfigured, requirement, verifyPayment } from "./x402.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const base = `http://localhost:${env.port}`;

/* one shape for the UI: market label plus scores as pairs */
function view(p: PickRecord) {
  return {
    ...p,
    marketLabel: MARKETS[p.market].label(p.home),
    evidence: (p.evidence ?? []).map((e) => {
      const r = parseRecord(e.text);
      const mk = (r.market ?? "") as keyof typeof MARKETS;
      return {
        blobId: e.blobId,
        result: e.result,
        counted: e.counted,
        fixture: r.home && r.away ? `${r.home} v ${r.away}` : "",
        marketLabel: MARKETS[mk] ? MARKETS[mk].label(r.home ?? "team") : r.market ?? "",
        pickId: r.PICK ?? "",
        sealed: r.sealed ?? "",
      };
    }),
    grade: p.grade
      ? { ...p.grade, ft: p.grade.ft.split("-").map(Number), ht: p.grade.ht.split("-").map(Number) }
      : undefined,
  };
}

function stats(picks: PickRecord[]) {
  const graded = picks.filter((p) => p.grade);
  const won = graded.filter((p) => p.grade!.result === "won").length;
  const lost = graded.filter((p) => p.grade!.result === "lost").length;
  return {
    receipts: picks.length,
    seals: picks.length + graded.length,
    graded: graded.length,
    won,
    lost,
    accuracy: graded.length ? Number((won / graded.length).toFixed(3)) : null,
    openPicks: picks.filter((p) => !p.grade).length,
  };
}

app.get("/api/health", async (_req, res) => {
  const h = memwalReady() ? await health() : { ok: false, detail: "MEMWAL_KEY not set" };
  res.json({
    memwal: h,
    keyPresent: memwalReady(),
    accountId: env.memwalAccountId,
    server: env.memwalServerUrl,
    agentId: env.memwalAgentId,
    namespace: env.namespace,
    tatum: { configured: Boolean(env.tatumApiKey), rpc: env.tatumSuiRpc },
    x402: { configured: isConfigured(), mock: env.x402Mock, price: env.x402PriceMist, payTo: env.x402PayTo },
  });
});

app.get("/api/board", async (_req, res) => {
  const picks = await all();
  const byFixture = new Map(picks.map((p) => [p.fixtureId, p]));
  let fixtures: Awaited<ReturnType<typeof upcomingFixtures>> = [];
  let fixtureError = "";
  try {
    fixtures = await upcomingFixtures();
  } catch (e) {
    fixtureError = (e as Error).message;
  }
  const now = Date.now();
  const board = fixtures
    .filter((f) => new Date(f.kickoff).getTime() > now - 3 * 3600_000)
    .slice(0, 24)
    .map((f) => ({ fixture: f, pick: byFixture.has(f.id) ? view(byFixture.get(f.id)!) : null }));
  res.json({ board, stats: stats(picks), fixtureError });
});

app.get("/api/receipts", async (_req, res) => {
  const picks = await all();
  const sorted = [...picks].sort((a, b) => b.sealedAt.localeCompare(a.sealedAt));
  res.json({ stats: stats(picks), picks: sorted.map(view) });
});

app.get("/api/receipt/:id", async (req, res) => {
  const p = await byId(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  res.json(view(p));
});

app.post("/api/seal", async (req, res) => {
  const fixtureId = String(req.body?.fixtureId ?? "");
  if (!fixtureId) return res.status(400).json({ error: "fixtureId required" });
  try {
    const fx = (await upcomingFixtures()).find((f) => f.id === fixtureId);
    if (!fx) return res.status(404).json({ error: "fixture not on the board" });
    const pick = await sealPick(fx);
    res.json({ ok: true, pick });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post("/api/agent/tick", async (_req, res) => {
  try {
    const picks = await all();
    const grading = await gradeFinished(picks);
    const sealed: string[] = [];
    const unsealed = (await upcomingFixtures())
      .filter((f) => new Date(f.kickoff).getTime() > Date.now())
      .filter((f) => !picks.some((p) => p.fixtureId === f.id))
      .slice(0, 3);
    for (const f of unsealed) {
      const p = await sealPick(f);
      sealed.push(p.id);
    }
    res.json({ ok: true, graded: grading.graded, pending: grading.pending, sealed });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post("/api/verify/:id", async (req, res) => {
  const p = await byId(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  try {
    const check = async (text: string, expected: string, id: string, kind: "PICK" | "GRADE") => {
      const hits = await recall(text, 8);
      const hit = hits.find((h) => parseRecord(h.text)[kind] === id);
      if (!hit) return { found: false as const, expected, actual: null as string | null };
      const actual = hashOf(hit.text);
      return {
        found: true as const,
        blobId: hit.blob_id,
        createdAt: hit.created_at,
        identical: hit.text === text,
        hash: actual,
        expected,
        match: actual === expected,
      };
    };
    const pickCheck = await check(p.recordText, p.contentHash, p.id, "PICK");
    const gradeCheck = p.grade ? await check(p.grade.recordText, p.grade.contentHash, p.id, "GRADE") : null;
    res.json({
      id: p.id,
      pick: pickCheck,
      grade: gradeCheck,
      verdict: pickCheck.match && (!gradeCheck || gradeCheck.match) ? "unmodified" : "mismatch",
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/receipt/:id/verified", async (req, res) => {
  const p = await byId(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  const payment = await verifyPayment(req.header("x-payment"));
  if (!payment.ok) {
    res.status(402).json({
      x402Version: 1,
      error: payment.error,
      accepts: [requirement(`${base}/api/receipt/${p.id}/verified`)],
    });
    return;
  }
  res.json({ receipt: p, settlement: payment });
});

app.get("/api/memory/stats", async (_req, res) => {
  try {
    const list = await mem().listMemories({ limit: 200 });
    const items = (list as any).memories ?? (list as any).results ?? [];
    res.json({
      count: (list as any).total ?? items.length,
      newest: items.slice(0, 5).map((m: any) => ({ blob_id: m.blob_id, created_at: m.created_at })),
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

const webDir = path.join(process.cwd(), "web");
if (existsSync(path.join(webDir, "index.html"))) {
  app.use(express.static(webDir, { extensions: ["html"] }));
}

/* the two-sided board: anyone can connect their own memory space */
const humansPath = path.join(process.cwd(), "data", "humans.json");
const readHumans = () => {
  try {
    return JSON.parse(readFileSync(humansPath, "utf8"));
  } catch {
    return [];
  }
};

app.get("/api/humans", (_req, res) => res.json({ humans: readHumans() }));

app.post("/api/humans", (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 40);
  const agentId = String(req.body?.agentId ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  if (!/^[0-9a-f]{64}$/i.test(agentId)) return res.status(400).json({ error: "delegate key must be 64 hex characters" });
  const list = readHumans();
  if (!list.some((h: any) => h.agentId === agentId)) list.push({ name, agentId, joinedAt: new Date().toISOString() });
  mkdirSync(path.dirname(humansPath), { recursive: true });
  writeFileSync(humansPath, JSON.stringify(list, null, 2));
  res.json({ ok: true, humans: list });
});

/* a human seals a pick; it is graded by the same rule as the agent's */
app.post("/api/board/pick", async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim().slice(0, 40);
    const fixtureId = String(req.body?.fixtureId ?? "").trim();
    const market = String(req.body?.market ?? "") as MarketKey;
    const side = String(req.body?.side ?? "").trim();
    const confidence = Number(req.body?.confidence ?? 0.6);

    if (!name) return res.status(400).json({ error: "name required" });
    if (!MARKETS[market]) return res.status(400).json({ error: "unknown market" });
    if (!(confidence >= 0.05 && confidence <= 0.95)) return res.status(400).json({ error: "confidence must be 0.05-0.95" });

    const fixtures = [...(await worldCup2026()), ...(await upcomingFixtures())];
    const fixture = fixtures.find((f) => f.id === fixtureId);
    if (!fixture) return res.status(404).json({ error: "fixture not found" });

    let pick = await humanPick(name, fixture, market, side || MARKETS[market].label(fixture.home), confidence);
    const r = fixture.ft ? { ft: fixture.ft, ht: fixture.ht ?? ([0, 0] as [number, number]) } : await resultFor(fixture.id);
    if (r) pick = await gradePick(pick, r);
    res.json({ ok: true, pick: view(pick) });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.get("/favicon.ico", (_req, res) => res.status(204).end());

app.listen(env.port, () => {
  console.log(`receipts on http://localhost:${env.port}`);
  console.log(`memory ${env.memwalServerUrl} account ${env.memwalAccountId}`);
  console.log(
    env.memwalFake
      ? "memory: TEST DOUBLE (data/fake-memory.json) — not a submission run"
      : memwalReady()
        ? "memory: delegate key loaded, writing to Walrus"
        : "delegate key: MISSING (paste MEMWAL_KEY in .env)",
  );
});
