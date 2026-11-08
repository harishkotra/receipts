import { recall } from "./mem.js";
import {
  MARKETS,
  MARKETS_OF_MATCH,
  kindOf,
  parseRecord,
  type Evidence,
  type Fixture,
  type MarketKey,
} from "./ledger.js";

export interface Assessment {
  market: MarketKey;
  side: string;
  label: string;
  base: number;
  won: number;
  lost: number;
  n: number;
  shrunk: number;
  delta: number;
  confidence: number;
  verdict: "play" | "pass";
  evidence: Evidence[];
  teamRecord: { won: number; lost: number };
  reasoning: string;
}

const PRIOR_WEIGHT = 3;
const FLOOR = 0.45;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** One market per fixture, by rotation. The agent does not get to pick its easiest market after the fact. */
export function slateMarket(fixture: Fixture): MarketKey {
  let h = 0;
  for (const c of fixture.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return MARKETS_OF_MATCH[h % MARKETS_OF_MATCH.length];
}

export function sideFor(market: MarketKey, fixture: Fixture): string {
  switch (market) {
    case "match_winner":
    case "ht_leader_wins":
    case "comeback":
      return fixture.home;
    case "over_2_5":
      return "over 2.5 goals";
    case "under_2_5":
      return "under 2.5 goals";
    case "btts":
      return "both teams to score";
    default:
      return "-";
  }
}

export async function assess(fixture: Fixture, market: MarketKey): Promise<Assessment> {
  const side = sideFor(market, fixture);
  const label = MARKETS[market].label(fixture.home);
  const base = MARKETS[market].prior;

  const query = `GRADE ${label} ${side} graded result won lost`;
  let hits: Awaited<ReturnType<typeof recall>> = [];
  let recallError = "";
  try {
    hits = await recall(query, 30);
  } catch (e) {
    recallError = (e as Error).message;
  }

  const evidence: Evidence[] = [];
  let won = 0;
  let lost = 0;
  const team = { won: 0, lost: 0 };

  for (const h of hits) {
    const fields = parseRecord(h.text);
    const kind = kindOf(h.text);
    const isGrade = kind === "GRADE";
    const sameMarket = fields.market === market;
    const sameTeam = fields.home === side || fields.away === side;
    const counted = isGrade && sameMarket && (fields.side === side || side === "-");
    if (counted) {
      if (fields.result === "won") won++;
      else if (fields.result === "lost") lost++;
    }
    if (isGrade && sameTeam) {
      if (fields.result === "won") team.won++;
      else if (fields.result === "lost") team.lost++;
    }
    if (evidence.length < 8 || counted) {
      evidence.push({
        blobId: h.blob_id,
        createdAt: h.created_at,
        distance: h.distance,
        text: h.text,
        pickId: isGrade ? fields.GRADE : fields.PICK,
        result: fields.result === "won" || fields.result === "lost" ? fields.result : undefined,
        counted,
      });
    }
  }

  const n = won + lost;
  /* shrink the market prior toward the agent's own graded record */
  const shrunk = (won + PRIOR_WEIGHT * base) / (n + PRIOR_WEIGHT);
  const delta = shrunk - base;
  const confidence = Number(clamp(shrunk, 0.05, 0.95).toFixed(3));
  const verdict: "play" | "pass" =
    n >= 5 && shrunk < 0.35 ? "pass" : confidence >= FLOOR ? "play" : "pass";

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const reasoning =
    `Prior ${pct(base)} on "${label}". My sealed record on this market: ${won}-${lost} across ${n} ` +
    `graded receipt${n === 1 ? "" : "s"}, shrunk to ${pct(shrunk)}. That moves the number ${delta >= 0 ? "+" : ""}${delta.toFixed(3)} ` +
    `to ${pct(confidence)}. ` +
    (recallError
      ? `Recall failed (${recallError}), so this is the prior alone.`
      : verdict === "pass"
        ? `Below my ${pct(FLOOR)} publishing floor, so I pass.`
        : `Above the ${pct(FLOOR)} floor, so I publish.`) +
    (team.won + team.lost > 0 ? ` Across all markets, ${side} is ${team.won}-${team.lost} in my ledger.` : "");

  evidence.sort((a, b) => Number(b.counted) - Number(a.counted) || a.distance - b.distance);

  return {
    market,
    side,
    label,
    base,
    won,
    lost,
    n,
    shrunk: Number(shrunk.toFixed(4)),
    delta: Number(delta.toFixed(4)),
    confidence,
    verdict,
    evidence: evidence.slice(0, 8),
    teamRecord: team,
    reasoning,
  };
}

export function pickFor(fixture: Fixture): Promise<Assessment> {
  return assess(fixture, slateMarket(fixture));
}
