const FLOOR = 0.45;
const $ = (id) => document.getElementById(id);
const pos = (v) => Math.max(0, Math.min(100, ((v - FLOOR) / (1 - FLOOR)) * 100));
const pct = (v) => `${pos(v).toFixed(2)}%`;
const short = (s, n = 14) => (s ? `${String(s).slice(0, n)}…` : "—");
const ago = (iso) => {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};
const when = (iso) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

let picks = [];
let featured = null;

function renderMeta(health, stats) {
  $("m-account").textContent = health.accountId ? short(health.accountId, 10) : "—";
  $("m-account").title = health.accountId || "";
  const ok = health.keyPresent;
  $("m-delegate").textContent = ok ? `${short(health.agentId, 10)} · live` : "no key in .env";
  $("m-delegate").style.color = ok ? "var(--accent)" : "var(--refuse)";
  $("m-ns").textContent = health.namespace || "—";
  $("m-seals").textContent = stats.seals ?? 0;
  const terms = health.x402 || {};
  $("pay-terms").textContent = `${Number(terms.price || 0) / 1e9} SUI per verified pick · ${terms.network || "sui:mainnet"} · pay to ${short(terms.payTo, 12)}`;
}

function pickFeatured() {
  /* lead with the receipt where recall pulled the agent off a bet */
  const graded = picks.filter((p) => p.grade);
  const pulledBack = graded
    .filter((p) => p.confidence < p.base)
    .sort((a, b) => a.confidence - a.base - (b.confidence - b.base))[0];
  return pulledBack || graded[graded.length - 1] || picks[0] || null;
}

function renderAxis(p) {
  const base = $("mark-base");
  const fin = $("mark-final");
  const axis = $("axis");
  document.querySelectorAll(".delta, .delta-label").forEach((n) => n.remove());
  const wrap = document.querySelector(".axis-wrap");
  if (!p) {
    base.hidden = true;
    fin.hidden = true;
    if (wrap) wrap.hidden = true;
    return;
  }
  if (wrap) wrap.hidden = false;
  base.hidden = false;
  fin.hidden = false;
  base.style.left = pct(p.base);
  fin.style.left = pct(p.confidence);
  base.querySelector("i").textContent = `base ${p.base.toFixed(2)}`;
  fin.querySelector("i").textContent = `sealed ${p.confidence.toFixed(2)}`;

  if (Math.abs(pos(p.confidence) - pos(p.base)) > 2) {
    const left = Math.min(pos(p.base), pos(p.confidence));
    const width = Math.abs(pos(p.confidence) - pos(p.base));
    const bar = document.createElement("div");
    bar.className = "delta";
    bar.style.left = `${left}%`;
    bar.style.width = `${width}%`;
    axis.append(bar);
  }
}

function renderPick(p) {
  if (!p) {
    $("p-fixture").textContent = "No pick sealed yet";
    $("p-market").textContent = "Seal one from the board below, or run `npm run seed` to replay the tournament.";
    $("p-reason").textContent = "The reasoning appears here once the agent writes it to memory.";
    $("p-blob").textContent = "—";
    $("p-hash").textContent = "—";
    $("p-sealed").textContent = "—";
    $("p-verdict").textContent = "—";
    $("p-call-num").textContent = "—";
    $("p-call-word").textContent = "no pick";
    $("p-call-word").className = "";
    $("p-call-delta").textContent = "";
    $("pick-when").textContent = "nothing sealed";
    renderAxis(null);
    return;
  }
  $("p-fixture").textContent = `${p.home} v ${p.away}`;
  $("p-market").innerHTML = `${p.marketLabel} · <span class="${p.verdict === "play" ? "verdict-play" : "verdict-pass"}">${p.verdict}</span>`;
  $("p-reason").textContent = p.reasoning;
  $("p-blob").textContent = p.sealedBlobId;
  $("p-hash").textContent = p.contentHash;
  $("p-sealed").textContent = `${when(p.sealedAt)} · ${ago(p.sealedAt)}`;
  $("p-verdict").textContent = p.grade ? "2 · pick + grade" : "1 · pick";
  $("p-call-num").textContent = p.confidence.toFixed(2);
  $("p-call-word").textContent = p.verdict === "play" ? "play" : "pass";
  $("p-call-word").className = p.verdict === "play" ? "is-play" : "is-pass";
  const diff = p.confidence - p.base;
  $("p-call-delta").textContent = `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(2)} after recall`;
  $("pick-when").textContent = `${p.fixtureId} · sealed ${ago(p.sealedAt)}`;
  renderAxis(p);

  const list = $("evidence-list");
  list.innerHTML = "";
  const ev = (p.evidence || []).slice(0, 7);
  if (!ev.length) {
    list.innerHTML = `<li class="empty">No prior graded receipts for this team and market. First look, so the prior stands.</li>`;
    return;
  }
  for (const e of ev) {
    const li = document.createElement("li");
    const won = e.result === "won";
    const day = e.sealed ? new Date(e.sealed).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "";
    li.innerHTML = `<div class="ev-row">
        <span class="ev-fixture">${e.fixture || "prior pick"}</span>
        <span class="${e.result === "won" ? "won" : e.result === "lost" ? "lost" : "neutral"}">${e.result || "open"}</span>
      </div>
      <div class="ev-sub">${day} · ${e.marketLabel || ""} · <span class="mono">${short(e.blobId, 10)}</span></div>`;
    list.append(li);
  }
}

function renderGrade(p) {
  if (!p || !p.grade) {
    $("g-score").textContent = p ? "awaiting full time" : "no result yet";
    $("g-score").className = "scoreline pending";
    $("g-word").textContent = "Not graded";
    $("g-note").textContent = p
      ? "Sealed and waiting for full time. The grade is a separate write, not an edit of the pick."
      : "A pick is graded only once the fixture has a final score.";
    $("h-before").textContent = p ? p.contentHash : "—";
    $("h-after").textContent = "—";
    $("h-grade").textContent = "—";
    $("h-verdict").textContent = "—";
    $("verify-btn").disabled = !p;
    $("grade-when").textContent = p ? "awaiting full time" : "nothing to grade";
    return;
  }
  const g = p.grade;
  $("g-score").textContent = `${g.ft[0]} – ${g.ft[1]}`;
  $("g-score").className = "scoreline";
  $("g-word").textContent = g.result === "won" ? "Won" : "Lost";
  $("g-word").className = `result-word ${g.result === "won" ? "won" : "lost"}`;
  $("g-note").textContent = `Half time ${g.ht[0]}–${g.ht[1]} · ${p.marketLabel} graded against the final score, ${ago(g.gradedAt)}.`;
  $("h-before").textContent = p.contentHash;
  $("h-after").textContent = p.contentHash;
  $("h-grade").textContent = g.blobId;
  $("h-verdict").textContent = "awaiting re-read";
  $("verify-btn").disabled = false;
  $("grade-when").textContent = `graded ${ago(g.gradedAt)}`;
}

function renderStandings(list) {
  const el = $("standings");
  if (!el) return;
  const rows = new Map();
  for (const p of list) {
    if (!p.grade) continue;
    const who = p.kind === "human" ? p.owner : "the agent";
    const r = rows.get(who) || { won: 0, lost: 0, pw: 0, pl: 0 };
    if (p.verdict === "pass") {
      if (p.grade.result === "won") r.pw++;
      else if (p.grade.result === "lost") r.pl++;
    } else if (p.grade.result === "won") r.won++;
    else if (p.grade.result === "lost") r.lost++;
    rows.set(who, r);
  }
  const sorted = [...rows.entries()].sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost));
  el.innerHTML = sorted
    .map(([who, r]) => {
      const n = r.won + r.lost;
      const pctv = n ? (r.won / n) : 0;
      const benched = r.pw + r.pl;
      return `<div class="standing"><b>${who}</b><span class="mono">${r.won}-${r.lost}</span><span class="mini">${n ? pctv.toFixed(3) : "—"} on picks it played${benched ? ` · benched ${r.pw}-${r.pl}` : ""}</span></div>`;
    })
    .join("");
}

function renderBoard(board) {
  const body = $("board-body");
  const sel = $("hp-fixture");
  if (sel) {
    const keep = sel.value;
    sel.innerHTML = board
      .map(({ fixture }) => `<option value="${fixture.id}">${fixture.home} v ${fixture.away} · ${fixture.source === "replay" ? "played" : "upcoming"}</option>`)
      .join("");
    if (keep) sel.value = keep;
  }
  body.innerHTML = "";
  if (!board.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">No fixtures on the board right now. Replay data is available through the seed script.</td></tr>`;
    return;
  }
  for (const { fixture, pick } of board) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="kick">${when(fixture.kickoff)}</td>
      <td>${fixture.home} v ${fixture.away}<div class="mini">${fixture.competition || ""}</div></td>
      <td>${pick ? pick.marketLabel : "not sealed"}</td>
      <td class="num">${pick ? pick.confidence.toFixed(2) : "—"}</td>
      <td class="${pick && pick.verdict === "play" ? "verdict-play" : "verdict-pass"}">${pick ? pick.verdict : "—"}</td>
      <td>${pick ? `<span class="mini">${short(pick.sealedBlobId, 12)}</span>` : `<button class="btn seal-btn" data-id="${fixture.id}" style="margin:0;padding:5px 10px;font-size:12px">Seal</button>`}</td>`;
    body.append(tr);
  }
  body.querySelectorAll(".seal-btn").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      b.textContent = "sealing…";
      try {
        const r = await fetch("/api/seal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fixtureId: b.dataset.id }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "seal failed");
        await load();
      } catch (e) {
        b.disabled = false;
        b.textContent = e.message.slice(0, 40);
      }
    }),
  );
}

function renderLedger(list) {
  const body = $("ledger-body");
  body.innerHTML = "";
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">No receipts yet. Nothing has been written to memory.</td></tr>`;
    $("ledger-note").textContent = "0 receipts";
    return;
  }
  for (const p of list) {
    const tr = document.createElement("tr");
    const res = p.grade ? (p.grade.result === "won" ? `<span class="won">won</span>` : `<span class="lost">lost</span>`) : `<span class="mini">open</span>`;
    tr.innerHTML = `
      <td class="kick">${when(p.sealedAt)}</td>
      <td>${p.home} v ${p.away}</td>
      <td>${p.marketLabel}</td>
      <td class="num">${p.confidence.toFixed(2)}</td>
      <td>${res}</td>
      <td class="mono" title="${p.sealedBlobId}">${short(p.sealedBlobId, 12)}</td>`;
    tr.addEventListener("click", () => {
      featured = p;
      renderPick(p);
      renderGrade(p);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    tr.style.cursor = "pointer";
    body.append(tr);
  }
  const won = list.filter((p) => p.grade && p.grade.result === "won").length;
  const done = list.filter((p) => p.grade).length;
  $("ledger-note").textContent = `${list.length} receipts · ${done} graded · ${won}-${done - won}`;
}

function renderRoster(people) {
  const el = $("roster");
  el.innerHTML = "";
  if (!people.length) {
    el.innerHTML = `<li><span>no one else on the board yet</span></li>`;
    return;
  }
  for (const p of people) {
    const li = document.createElement("li");
    li.innerHTML = `${p.name} <span>${short(p.agentId, 10)}</span>`;
    el.append(li);
  }
}

async function load() {
  const [health, receipts, board, humans] = await Promise.all([
    fetch("/api/health").then((r) => r.json()).catch(() => ({})),
    fetch("/api/receipts").then((r) => r.json()).catch(() => ({ picks: [], stats: {} })),
    fetch("/api/board").then((r) => r.json()).catch(() => ({ board: [] })),
    fetch("/api/humans").then((r) => r.json()).catch(() => ({ humans: [] })),
  ]);

  picks = receipts.picks || [];
  renderMeta(health, receipts.stats || {});
  featured = featured && picks.find((p) => p.id === featured.id) ? picks.find((p) => p.id === featured.id) : pickFeatured();
  renderPick(featured);
  renderGrade(featured);
  renderBoard(board.board || []);
  renderStandings(receipts.picks || []);
  renderLedger(picks);
  renderRoster(humans.humans || []);
  $("pay-btn").disabled = !featured;
}

$("verify-btn").addEventListener("click", async () => {
  if (!featured) return;
  const btn = $("verify-btn");
  btn.disabled = true;
  btn.textContent = "re-reading from Walrus…";
  try {
    const r = await fetch(`/api/verify/${featured.id}`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "verify failed");
    $("h-after").textContent = j.pick.hash || "not found";
    $("h-grade").textContent = j.grade?.blobId || "—";
    const good = j.verdict === "unmodified";
    $("h-verdict").textContent = good ? "unmodified — hashes match" : "mismatch — do not trust this record";
    $("h-verdict").style.color = good ? "var(--accent)" : "var(--refuse)";
    $("verify-hint").textContent = `read ${when(j.pick.createdAt)} from ${short(j.pick.blobId, 16)}`;
  } catch (e) {
    $("h-verdict").textContent = e.message.slice(0, 90);
    $("h-verdict").style.color = "var(--refuse)";
  }
  btn.disabled = false;
  btn.textContent = "Re-read both records from Walrus";
});

$("pay-btn").addEventListener("click", async () => {
  if (!featured) return;
  const btn = $("pay-btn");
  const out = $("pay-out");
  out.hidden = false;

  /* second press settles: hand the server a payment payload, as an x402 client would */
  if (btn.dataset.stage === "settle") {
    out.textContent = "settling…";
    const digest = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    const header = btoa(JSON.stringify({ txDigest: digest.slice(0, 44), payer: "demo-wallet" }));
    const r = await fetch(`/api/receipt/${featured.id}/verified`, { headers: { "x-payment": header } });
    const j = await r.json();
    out.textContent = `${r.status} ${r.statusText}\n\n${JSON.stringify(j.settlement ?? j, null, 2)}\n\nreceipt ${j.receipt?.id ?? "—"} · blob ${(j.receipt?.sealedBlobId ?? "").slice(0, 16)}…`;
    btn.dataset.stage = "challenge";
    btn.textContent = "Request a paid receipt";
    return;
  }

  out.textContent = "requesting…";
  const r = await fetch(`/api/receipt/${featured.id}/verified`);
  const j = await r.json();
  out.textContent = `${r.status} ${r.statusText}\n\n${JSON.stringify(j, null, 2)}`;
  if (r.status === 402) {
    btn.dataset.stage = "settle";
    btn.textContent = "Pay 0.1 SUI and settle";
  }
});

$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("join-name").value.trim();
  const agentId = $("join-agent").value.trim();
  const msg = $("join-msg");
  try {
    const r = await fetch("/api/humans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, agentId }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "could not add");
    msg.textContent = `${name} is on the board. Seal a pick and it is graded by the same rule.`;
    msg.style.color = "var(--accent)";
    $("join-form").reset();
    await load();
  } catch (err) {
    msg.textContent = err.message;
    msg.style.color = "var(--refuse)";
  }
});

$("pick-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("hp-msg");
  const payload = {
    name: $("hp-name").value.trim(),
    fixtureId: $("hp-fixture").value,
    market: $("hp-market").value,
    confidence: Number($("hp-conf").value),
  };
  try {
    const r = await fetch("/api/board/pick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "could not seal");
    const p = j.pick;
    msg.textContent = `sealed ${p.sealedBlobId.slice(0, 14)}… ${p.grade ? `· graded ${p.grade.result}` : "· waiting on full time"}`;
    msg.style.color = "var(--accent)";
    await load();
  } catch (err) {
    msg.textContent = err.message;
    msg.style.color = "var(--refuse)";
  }
});

load();
setInterval(load, 20000);
