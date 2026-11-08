import { seal } from "./mem.js";
import {
  gradeAgainst,
  gradeText,
  hashOf,
  pickText,
  type Fixture,
  type MarketKey,
  type PickRecord,
} from "./ledger.js";
import { assess, slateMarket } from "./engine.js";
import { upsert } from "./store.js";
import { resultFor, worldCup2026 } from "./football.js";

export async function sealPick(fixture: Fixture): Promise<PickRecord> {
  const market = slateMarket(fixture);
  const a = await assess(fixture, market);
  const sealedAt = new Date().toISOString();
  const id = `pk-${hashOf(`${fixture.id}:${market}`).slice(0, 10)}`;

  const base = {
    id,
    fixtureId: fixture.id,
    competition: fixture.competition,
    home: fixture.home,
    away: fixture.away,
    kickoff: fixture.kickoff,
    source: fixture.source,
    market,
    side: a.side,
    base: a.base,
    confidence: a.confidence,
    verdict: a.verdict,
    reasoning: a.reasoning,
    sealedAt,
    owner: "agent",
    kind: "agent" as const,
  };

  const recordText = pickText(base);
  const written = await seal(recordText, `pick:${id}`);

  const pick: PickRecord = {
    ...base,
    sealedBlobId: written.blob_id,
    contentHash: hashOf(recordText),
    recordText,
    evidence: a.evidence,
  };
  await upsert(pick);
  return pick;
}

/** A human on the board seals their own pick. Same record shape, same grading rule. */
export async function humanPick(
  name: string,
  fixture: Fixture,
  market: MarketKey,
  side: string,
  confidence: number,
): Promise<PickRecord> {
  const sealedAt = new Date().toISOString();
  const id = `hu-${hashOf(`${name}:${fixture.id}:${market}`).slice(0, 10)}`;
  const base = {
    id,
    fixtureId: fixture.id,
    competition: fixture.competition,
    home: fixture.home,
    away: fixture.away,
    kickoff: fixture.kickoff,
    source: fixture.source,
    market,
    side,
    base: confidence,
    confidence,
    verdict: "play" as const,
    reasoning: `${name} sealed this pick before kickoff. The agent did not touch it.`,
    sealedAt,
    owner: name,
    kind: "human" as const,
  };
  const recordText = pickText(base);
  const written = await seal(recordText, `pick:${id}`);
  const pick: PickRecord = {
    ...base,
    sealedBlobId: written.blob_id,
    contentHash: hashOf(recordText),
    recordText,
    evidence: [],
  };
  await upsert(pick);
  return pick;
}

export async function gradePick(pick: PickRecord, scores: { ft: [number, number]; ht: [number, number] }): Promise<PickRecord> {
  if (pick.grade) return pick;
  const fixture = {
    id: pick.fixtureId,
    competition: pick.competition,
    home: pick.home,
    away: pick.away,
    kickoff: pick.kickoff,
    source: pick.source,
    ft: scores.ft,
    ht: scores.ht,
  } as Fixture;

  const result = gradeAgainst(fixture, pick.market, pick.side);
  const gradedAt = new Date().toISOString();
  const text = gradeText({
    pickId: pick.id,
    competition: pick.competition,
    home: pick.home,
    away: pick.away,
    market: pick.market,
    side: pick.side,
    ft: scores.ft,
    ht: scores.ht,
    result,
    gradedAt,
  });
  const written = await seal(text, `grade:${pick.id}`);

  const next: PickRecord = {
    ...pick,
    grade: {
      result,
      ft: `${scores.ft[0]}-${scores.ft[1]}`,
      ht: `${scores.ht[0]}-${scores.ht[1]}`,
      gradedAt,
      blobId: written.blob_id,
      contentHash: hashOf(text),
      recordText: text,
    },
  };
  await upsert(next);
  return next;
}

/** Grade every sealed live pick whose match has a final score. */
export async function gradeFinished(picks: PickRecord[]): Promise<{ graded: string[]; pending: number }> {
  const out: string[] = [];
  let pending = 0;
  for (const p of picks) {
    if (p.grade) continue;
    if (new Date(p.kickoff).getTime() > Date.now()) {
      pending++;
      continue;
    }
    /* replay fixtures carry their own score; live ones need the API */
    const replay = (await worldCup2026()).find((f) => f.id === p.fixtureId);
    const r = replay?.ft ? { ft: replay.ft, ht: replay.ht ?? ([0, 0] as [number, number]) } : await resultFor(p.fixtureId);
    if (!r) {
      pending++;
      continue;
    }
    await gradePick(p, r);
    out.push(p.id);
  }
  return { graded: out, pending };
}
