import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Fixture } from "./ledger.js";

const SPORTSDB = "https://www.thesportsdb.com/api/v1/json/123";
const LEAGUES = [
  { id: "4328", name: "English Premier League" },
  { id: "4335", name: "Spanish La Liga" },
  { id: "4332", name: "Italian Serie A" },
  { id: "4331", name: "German Bundesliga" },
  { id: "4334", name: "French Ligue 1" },
  { id: "4480", name: "UEFA Champions League" },
];

type Row = Record<string, string | null>;

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { "user-agent": "receipts/0.1" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

function toFixture(e: Row, competition: string): Fixture | null {
  const hs = e.intHomeScore;
  const as = e.intAwayScore;
  const played = hs !== null && as !== null && hs !== "" && as !== "";
  return {
    id: `sdb-${e.idEvent}`,
    competition,
    home: String(e.strHomeTeam),
    away: String(e.strAwayTeam),
    kickoff: `${e.strTimestamp}Z`.replace(" ", "T"),
    source: "live",
    ...(played
      ? {
          ft: [Number(hs), Number(as)] as [number, number],
          ...(e.intHomeScore && e.strHTScore ? {} : {}),
        }
      : {}),
  };
}

let cache: { at: number; fixtures: Fixture[] } | null = null;

export async function upcomingFixtures(): Promise<Fixture[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.fixtures;
  const all: Fixture[] = [];
  await Promise.all(
    LEAGUES.map(async (l) => {
      try {
        const d = await getJson(`${SPORTSDB}/eventsnextleague.php?id=${l.id}`);
        const events: Row[] = d?.events ?? [];
        for (const e of events) {
          const f = toFixture(e, l.name);
          if (f && f.kickoff) all.push(f);
        }
      } catch {
        /* one dead league must not empty the board */
      }
    }),
  );
  all.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const seen = new Set<string>();
  const fixtures = all.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
  cache = { at: Date.now(), fixtures };
  return fixtures;
}

export async function resultFor(fixtureId: string): Promise<{ ft: [number, number]; ht: [number, number] } | null> {
  if (!fixtureId.startsWith("sdb-")) return null;
  const id = fixtureId.slice(4);
  const d = await getJson(`${SPORTSDB}/lookupevent.php?id=${id}`);
  const e: Row | undefined = d?.events?.[0];
  if (!e || e.intHomeScore === null || e.intAwayScore === null) return null;
  const ft: [number, number] = [Number(e.intHomeScore), Number(e.intAwayScore)];
  // TheSportsDB exposes the half-time score as "1:0" in strHTScore when available.
  const htRaw = String(e.strHTScore ?? "");
  const m = htRaw.match(/(\d+)\D+(\d+)/);
  return { ft, ht: m ? [Number(m[1]), Number(m[2])] : ([0, 0] as [number, number]) };
}

/** Real World Cup 2026 results (openfootball/openfootball, CC0), used as the agent's preseason ledger. */
export async function worldCup2026(): Promise<Fixture[]> {
  const p = path.join(process.cwd(), "data", "wc2026.json");
  const j = JSON.parse(await readFile(p, "utf8"));
  const out: Fixture[] = [];
  for (const m of j.matches) {
    if (!m.score?.ft) continue;
    out.push({
      id: `wc26-${m.date}-${m.team1}-${m.team2}`.replace(/\s+/g, "_"),
      competition: "World Cup 2026",
      home: m.team1,
      away: m.team2,
      kickoff: `${m.date}T12:00:00Z`,
      source: "replay",
      ft: [m.score.ft[0], m.score.ft[1]],
      ht: m.score.ht ? [m.score.ht[0], m.score.ht[1]] : [0, 0],
      round: m.round,
    });
  }
  return out;
}
