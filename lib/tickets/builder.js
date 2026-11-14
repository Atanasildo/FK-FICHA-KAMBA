import { randomUUID } from "node:crypto";

const TIERS = {
  extrema: { minOdd: 400, maxOdd: 900, minLegs: 9, maxLegs: 11, minGames: 4, maxGames: 6, count: 1 },
  longa: { minOdd: 60, maxOdd: 150, minLegs: 5, maxLegs: 8, minGames: 4, maxGames: 8, count: 3 },
  media: { minOdd: 25, maxOdd: 60, minLegs: 3, maxLegs: 6, minGames: 3, maxGames: 6, count: 2 },
  curta: { minOdd: 15, maxOdd: 25, minLegs: 3, maxLegs: 5, minGames: 3, maxGames: 5, count: 2 }
};
const BOOKMAKERS = ["BantuBet", "ElephantBet"];
const MIN_ODD = 1.4;
const MIN_SELECTION_EV = 0.03;
const MIN_SLIP_EV = 0.10;
const MIN_HOURS = 1;
const TIME_ZONE = "Africa/Luanda";
const luandaDay = value => new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date(value));

const clean = value => String(value || "").trim().toLocaleLowerCase("pt");
export const teamKey = value => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const kickoffTime = value => {
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : NaN;
};

export function normalizeCandidate(item, now) {
  const fairProb = Number(item.fairProbability ?? item.fair_prob);
  const kickoff = kickoffTime(item.kickoff ?? item.startTime);
  if (!item.fixtureId || !item.home || !item.away || !item.competition ||
      !item.market || !item.selection || !item.rationale ||
      String(item.rationale).trim().length < 12 ||
      !Number.isFinite(fairProb) || fairProb <= 0 || fairProb >= 1 ||
      !Number.isFinite(kickoff) || kickoff < now + MIN_HOURS * 3600000 ||
      luandaDay(kickoff) !== luandaDay(now) ||
      !Array.isArray(item.quotes)) return null;

  const oddsByBookmaker = {};
  for (const bookmaker of BOOKMAKERS) {
    const quotes = item.quotes
      .filter(q => q?.bookmaker === bookmaker && Number.isFinite(Number(q.odds)) &&
        Number(q.odds) >= MIN_ODD && Number(q.odds) <= 10000)
      .sort((a, b) => (Date.parse(b.collectedAt || "") || 0) - (Date.parse(a.collectedAt || "") || 0));
    if (!quotes.length) return null;
    oddsByBookmaker[bookmaker] = Number(quotes[0].odds);
    if (fairProb * oddsByBookmaker[bookmaker] - 1 < MIN_SELECTION_EV) return null;
  }

  return {
    ...item,
    selectionId: String(item.selectionId || item.id || `${item.fixtureId}:${item.market}:${item.selection}`),
    fixtureId: String(item.fixtureId),
    home: String(item.home), away: String(item.away),
    competition: String(item.competition),
    leagueKey: clean(item.competition),
    fairProb,
    kickoff: new Date(kickoff).toISOString(),
    oddsByBookmaker
  };
}

function findSlip(pool, tier, usedGames, usedTeams, now, maxNodes = 180000) {
  const cfg = TIERS[tier];
  const ordered = [...pool].sort((a, b) => {
    const aWorstEv = Math.min(...BOOKMAKERS.map(name => a.fairProb * a.oddsByBookmaker[name] - 1));
    const bWorstEv = Math.min(...BOOKMAKERS.map(name => b.fairProb * b.oddsByBookmaker[name] - 1));
    return (bWorstEv + b.fairProb) - (aWorstEv + a.fairProb);
  });
  let nodes = 0;
  let answer = null;
  const chosen = [];
  const leagueCounts = new Map();
  const gameCounts = new Map();
  const localTeams = new Set();

  function visit(start, totals, probability) {
    if (++nodes > maxNodes || answer) return;
    if (chosen.length >= cfg.minLegs) {
      const games = [...new Set(chosen.map(x => x.fixtureId))];
      const minGamesOk = games.length >= cfg.minGames && games.length <= cfg.maxGames;
      const oddsOk = BOOKMAKERS.every(name => totals[name] >= cfg.minOdd && totals[name] <= cfg.maxOdd);
      const evOk = BOOKMAKERS.every(name => probability * totals[name] - 1 >= MIN_SLIP_EV);
      if (minGamesOk && oddsOk && evOk) {
        answer = { legs: [...chosen], totals: { ...totals }, jointProb: probability, games };
        return;
      }
    }
    if (chosen.length >= cfg.maxLegs || BOOKMAKERS.some(name => totals[name] > cfg.maxOdd)) return;
    for (let i = start; i < ordered.length; i++) {
      const item = ordered[i];
      if (usedGames.has(item.fixtureId)) continue;
      const home = teamKey(item.home), away = teamKey(item.away);
      const sameGameCount = gameCounts.get(item.fixtureId) || 0;
      if (usedTeams.has(home) || usedTeams.has(away) ||
          (sameGameCount === 0 && (localTeams.has(home) || localTeams.has(away)))) continue;
      if (sameGameCount && (tier !== "extrema" || sameGameCount >= 2)) continue;
      const leagueCount = leagueCounts.get(item.leagueKey) || 0;
      if (leagueCount >= 2) continue;
      const nextTotals = Object.fromEntries(BOOKMAKERS.map(name => [
        name, totals[name] * item.oddsByBookmaker[name]
      ]));
      if (BOOKMAKERS.some(name => nextTotals[name] > cfg.maxOdd)) continue;

      chosen.push(item);
      localTeams.add(home); localTeams.add(away);
      leagueCounts.set(item.leagueKey, leagueCount + 1);
      gameCounts.set(item.fixtureId, sameGameCount + 1);
      let nextProbability = probability * item.fairProb;
      if (sameGameCount === 1) {
        const pair = chosen.filter(x => x.fixtureId === item.fixtureId);
        const ratio = Number(item.correlationRatio ?? pair[0].correlationRatio);
        if (!Number.isFinite(ratio) || ratio < 1.2) {
          chosen.pop();
          if (sameGameCount === 0) { localTeams.delete(home); localTeams.delete(away); }
          leagueCounts.set(item.leagueKey, leagueCount);
          gameCounts.set(item.fixtureId, sameGameCount);
          continue;
        }
        nextProbability *= ratio;
      }
      visit(i + 1, nextTotals, Math.min(0.999999, nextProbability));
      chosen.pop();
      if (sameGameCount === 0) { localTeams.delete(home); localTeams.delete(away); }
      leagueCounts.set(item.leagueKey, leagueCount);
      gameCounts.set(item.fixtureId, sameGameCount);
      if (answer || nodes > maxNodes) return;
    }
  }
  visit(0, { BantuBet: 1, ElephantBet: 1 }, 1);
  return answer;
}

export function buildTicketBatch(rawPool, { publishedAt = new Date().toISOString(), maxNodes = 180000 } = {}) {
  const now = Date.parse(publishedAt);
  if (!Array.isArray(rawPool) || !Number.isFinite(now)) {
    throw new TypeError("Pool e publishedAt válidos são obrigatórios.");
  }
  const pool = rawPool.map(item => normalizeCandidate(item, now)).filter(Boolean);
  const usedGames = new Set();
  const usedTeams = new Set();
  const groups = [];

  for (const tier of ["extrema", "longa", "media", "curta"]) {
    const cfg = TIERS[tier];
    for (let n = 0; n < cfg.count; n++) {
      const found = findSlip(pool, tier, usedGames, usedTeams, now, maxNodes);
      if (!found) break;
      for (const leg of found.legs) {
        usedTeams.add(teamKey(leg.home));
        usedTeams.add(teamKey(leg.away));
        usedGames.add(leg.fixtureId);
      }
      const sharedTicketId = randomUUID();
      groups.push({
        sharedTicketId, tier,
        joint_prob: Number(found.jointProb.toFixed(6)),
        games_used: found.games,
        legs: found.legs
      });
    }
  }

  const slips = groups.flatMap(group => BOOKMAKERS.map(bookmaker => ({
    shared_ticket_id: group.sharedTicketId,
    tier: group.tier,
    bookmaker,
    total_odd: Number(group.legs.reduce((total, leg) => total * leg.oddsByBookmaker[bookmaker], 1).toFixed(3)),
    joint_prob: group.joint_prob,
    ev: Number((group.joint_prob * group.legs.reduce((total, leg) => total * leg.oddsByBookmaker[bookmaker], 1) - 1).toFixed(4)),
    games_used: group.games_used,
    legs: group.legs.map(leg => ({
      selection_id: leg.selectionId, event_id: leg.fixtureId,
      market: leg.market, marketName: leg.market,
      selection: leg.selection, selectionName: leg.selection,
      line: leg.line ?? null, odd: leg.oddsByBookmaker[bookmaker],
      fair_prob: leg.fairProb,
      ev: Number((leg.fairProb * leg.oddsByBookmaker[bookmaker] - 1).toFixed(4)),
      justification: leg.rationale, bookmaker,
      home: leg.home, away: leg.away, competition: leg.competition,
      start_time: leg.kickoff, startTime: leg.kickoff
    }))
  })));

  const sumJointProb = groups.reduce((sum, group) => sum + group.joint_prob, 0);
  const probabilityAtLeastOne = groups.reduce((miss, group) => miss * (1 - group.joint_prob), 1);
  const atLeastOne = 1 - probabilityAtLeastOne;
  return {
    level: "A",
    pool_size: rawPool.length,
    sharedTicketGroups: groups.length,
    slips,
    validation: {
      minimumOdds: MIN_ODD,
      minimumSelectionEV: MIN_SELECTION_EV,
      minimumSlipEV: MIN_SLIP_EV,
      sum_joint_prob: Number(sumJointProb.toFixed(6)),
      probability_at_least_one: Number(atLeastOne.toFixed(6)),
      sixSlipsMinimum: groups.length >= 6,
      probabilitySumMinimum: sumJointProb >= 0.17,
      probabilityAtLeastOneMinimum: atLeastOne >= 0.22,
      valid: groups.length >= 6 && sumJointProb >= 0.17 && atLeastOne >= 0.22
    },
    published_at: new Date(now).toISOString(),
    note: "Cada grupo tem as mesmas selecções nas duas casas; odds e IDs de reserva são independentes por casa. Probabilidades conjuntas sob hipótese de independência entre jogos; não são garantia de acerto."
  };
}
