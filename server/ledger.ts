import { sha256 } from "./mem.js";

export type MarketKey =
  | "match_winner"
  | "over_2_5"
  | "under_2_5"
  | "btts"
  | "ht_leader_wins"
  | "comeback";

export type Source = "replay" | "live";

export interface Fixture {
  id: string;
  competition: string;
  home: string;
  away: string;
  kickoff: string;
  source: Source;
  ft?: [number, number];
  ht?: [number, number];
  round?: string;
}

export interface Evidence {
  blobId: string;
  createdAt?: string;
  distance: number;
  text: string;
  pickId?: string;
  result?: "won" | "lost";
  counted: boolean;
}

export interface PickRecord {
  id: string;
  fixtureId: string;
  competition: string;
  home: string;
  away: string;
  kickoff: string;
  source: Source;
  market: MarketKey;
  side: string;
  base: number;
  confidence: number;
  verdict: "play" | "pass";
  reasoning: string;
  sealedAt: string;
  /* who signed it: the agent, or a human on the board using their own delegate key */
  owner?: string;
  kind?: "agent" | "human";
  sealedBlobId: string;
  contentHash: string;
  recordText: string;
  evidence: Evidence[];
  grade?: {
    result: "won" | "lost";
    ft: string;
    ht: string;
    gradedAt: string;
    blobId: string;
    contentHash: string;
    recordText: string;
  };
}

export const MARKETS: Record<MarketKey, { label: (home: string) => string; prior: number }> = {
  match_winner: { label: () => "Home win", prior: 0.46 },
  over_2_5: { label: () => "Over 2.5 goals", prior: 0.55 },
  under_2_5: { label: () => "Under 2.5 goals", prior: 0.45 },
  btts: { label: () => "Both teams to score", prior: 0.52 },
  ht_leader_wins: { label: (h) => `${h} leads at half, wins`, prior: 0.7 },
  comeback: { label: (h) => `${h} trails at half, wins`, prior: 0.16 },
};

export const MARKETS_OF_MATCH: MarketKey[] = Object.keys(MARKETS) as MarketKey[];

const clean = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

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

export function gradeText(g: {
  pickId: string;
  competition: string;
  home: string;
  away: string;
  market: MarketKey;
  side: string;
  ft: [number, number];
  ht: [number, number];
  result: "won" | "lost";
  gradedAt: string;
}): string {
  return [
    `GRADE ${g.pickId}`,
    `comp ${clean(g.competition)}`,
    `home ${clean(g.home)}`,
    `away ${clean(g.away)}`,
    `market ${g.market}`,
    `side ${clean(g.side)}`,
    `final ${g.ft[0]}-${g.ft[1]}`,
    `ht ${g.ht[0]}-${g.ht[1]}`,
    `result ${g.result}`,
    `graded ${g.gradedAt}`,
  ].join(" | ");
}

export function parseRecord(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split("|")) {
    const t = part.trim();
    const sp = t.indexOf(" ");
    if (sp === -1) continue;
    out[t.slice(0, sp)] = t.slice(sp + 1).trim();
  }
  return out;
}

export const kindOf = (text: string): "PICK" | "GRADE" | "OTHER" => {
  if (text.startsWith("PICK ")) return "PICK";
  if (text.startsWith("GRADE ")) return "GRADE";
  return "OTHER";
};

export const hashOf = (text: string) => sha256(text);

export function gradeAgainst(f: Fixture, market: MarketKey, side: string): "won" | "lost" {
  if (!f.ft || !f.ht) throw new Error("fixture has no final score");
  const [fh, fa] = f.ft;
  const [hh, ha] = f.ht;
  const homeSide = side === f.home;
  const goals = fh + fa;
  switch (market) {
    case "match_winner":
      return homeSide ? (fh > fa ? "won" : "lost") : fa > fh ? "won" : "lost";
    case "over_2_5":
      return goals > 2.5 ? "won" : "lost";
    case "under_2_5":
      return goals < 2.5 ? "won" : "lost";
    case "btts":
      return fh > 0 && fa > 0 ? "won" : "lost";
    case "ht_leader_wins":
      return homeSide
        ? hh > ha && fh > fa
          ? "won"
          : "lost"
        : ha > hh && fa > fh
          ? "won"
          : "lost";
    case "comeback":
      return homeSide
        ? hh < ha && fh > fa
          ? "won"
          : "lost"
        : ha < hh && fa > fh
          ? "won"
          : "lost";
  }
}

export const fmtScore = (s?: [number, number]) => (s ? `${s[0]}-${s[1]}` : "-");
