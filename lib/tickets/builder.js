const TIERS = {
  extrema: { minOdd: 400, maxOdd: 900, minLegs: 9, maxLegs: 11, minGames: 4, maxGames: 6, count: 1 },
  longa: { minOdd: 60, maxOdd: 150, minLegs: 5, maxLegs: 8, minGames: 4, maxGames: 8, count: 3 },
  media: { minOdd: 25, maxOdd: 60, minLegs: 3, maxLegs: 6, minGames: 3, maxGames: 6, count: 2 },
  curta: { minOdd: 15, maxOdd: 25, minLegs: 3, maxLegs: 5, minGames: 3, maxGames: 5, count: 2 }
};
const MIN_ODD = 1.4;
const MIN_SELECTION_EV = 0.03;
const MIN_SLIP_EV = 0.10;
const MIN_HOURS = 6;

const clean = value => String(value || "").trim().toLocaleLowerCase("pt");
const teamKey = value => clean(value).normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
const kickoffTime = value => {
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : NaN;
};

function normalizeCandidate(item, now) {
  const odd = Number(item.bestOdds ?? item.odd);
  const fairProb = Number(item.fairProbability ?? item.fair_prob);
  const kickoff = kickoffTime(item.kickoff ?? item.startTime);
  const ev = fairProb * odd - 1;
  if (!item.fixtureId || !item.home || !item.away || !item.competition ||
      !item.market || !item.selection || !item.rationale ||
      String(item.rationale).trim().length < 12 ||
      !Number.isFinite(odd) || odd < MIN_ODD ||
      !Number.isFinite(fairProb) || fairProb <= 0 || fairProb >= 1 ||
      ev < MIN_SELECTION_EV || !Number.isFinite(kickoff) ||
      kickoff < now + MIN_HOURS * 3600000) return null;
  return {
    ...item,
    selectionId: String(item.selectionId || item.id || `${item.fixtureId}:${item.market}:${item.selection}`),
    fixtureId: String(item.fixtureId),
    home: String(item.home), away: String(item.away),
    competition: String(item.competition),
    leagueKey: clean(item.competition),
    odd, fairProb, ev,
    kickoff: new Date(kickoff).toISOString(),
    bookmaker: item.bestBookmaker || item.bookmaker || null
  };
}

function findSlip(pool, tier, usedGames, usedTeams, now, maxNodes = 180000) {
  const cfg = TIERS[tier];
  const ordered = [...pool].sort((a, b) => (b.ev + b.fairProb) - (a.ev + a.fairProb));
  let nodes = 0;
  let answer = null;
  const chosen = [];
  const leagueCounts = new Map();
  const gameCounts = new Map();
  const localTeams = new Set();

  function visit(start, odd, probability) {
    if (++nodes > maxNodes || answer) return;
    if (chosen.length >= cfg.minLegs) {
      const games = [...new Set(chosen.map(x => x.fixtureId))];
      const minGamesOk = games.length >= cfg.minGames && games.length <= cfg.maxGames;
      const oddOk = odd >= cfg.minOdd && odd <= cfg.maxOdd;
      const p = probability;
      const ev = p * odd - 1;
      if (minGamesOk && oddOk && ev >= MIN_SLIP_EV) {
        answer = { legs: [...chosen], totalOdd: odd, jointProb: p, ev, games };
        return;
      }
    }
    if (chosen.length >= cfg.maxLegs || odd > cfg.maxOdd) return;
    for (let i = start; i < ordered.length; i++) {
      const item = ordered[i];
      if (usedGames.has(item.fixtureId)) continue;
      const home = teamKey(item.home), away = teamKey(item.away);
      if (usedTeams.has(home) || usedTeams.has(away) || localTeams.has(home) || localTeams.has(away)) continue;
      const sameGameCount = gameCounts.get(item.fixtureId) || 0;
      if (sameGameCount && (tier !== "extrema" || sameGameCount >= 2)) continue;
      const leagueCount = leagueCounts.get(item.leagueKey) || 0;
      if (leagueCount >= 2) continue;
      const nextOdd = odd * item.odd;
      if (nextOdd > cfg.maxOdd) continue;
      chosen.push(item);
      localTeams.add(home); localTeams.add(away);
      leagueCounts.set(item.leagueKey, leagueCount + 1);
      gameCounts.set(item.fixtureId, sameGameCount + 1);
      // Only an explicit, provider/model-supplied correlation estimate can qualify
      // a second selection from the same event in the extreme slip.
      let nextProbability = probability * item.fairProb;
      if (sameGameCount === 1) {
        const pair = chosen.filter(x => x.fixtureId === item.fixtureId);
        const ratio = Number(item.correlationRatio ?? pair[0].correlationRatio);
        if (!Number.isFinite(ratio) || ratio < 1.2) {
          chosen.pop(); localTeams.delete(home); localTeams.delete(away);
          leagueCounts.set(item.leagueKey, leagueCount);
          gameCounts.set(item.fixtureId, sameGameCount);
          continue;
        }
        nextProbability *= ratio;
      }
      visit(i + 1, nextOdd, Math.min(0.999999, nextProbability));
      chosen.pop();
      localTeams.delete(home); localTeams.delete(away);
      leagueCounts.set(item.leagueKey, leagueCount);
      gameCounts.set(item.fixtureId, sameGameCount);
      if (answer || nodes > maxNodes) return;
    }
  }
  visit(0, 1, 1);
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
  const slips = [];

  const order = ["extrema", "longa", "media", "curta"];
  for (const tier of order) {
    const cfg = TIERS[tier];
    const desired = tier === "longa" ? 3 : cfg.count;
    for (let n = 0; n < desired; n++) {
      const found = findSlip(pool, tier, usedGames, usedTeams, now, maxNodes);
      if (!found) break;
      for (const leg of found.legs) {
        usedTeams.add(teamKey(leg.home));
        usedTeams.add(teamKey(leg.away));
        usedGames.add(leg.fixtureId);
      }
      slips.push({
        tier, total_odd: Number(found.totalOdd.toFixed(3)),
        joint_prob: Number(found.jointProb.toFixed(6)),
        ev: Number(found.ev.toFixed(4)),
        games_used: found.games,
        legs: found.legs.map(leg => ({
          selection_id: leg.selectionId, event_id: leg.fixtureId,
          market: leg.market, line: leg.line ?? null, odd: leg.odd,
          fair_prob: leg.fairProb, ev: Number(leg.ev.toFixed(4)),
          justification: leg.rationale, bookmaker: leg.bookmaker,
          home: leg.home, away: leg.away, competition: leg.competition,
          start_time: leg.kickoff
        }))
      });
    }
  }

  const sumJointProb = slips.reduce((sum, slip) => sum + slip.joint_prob, 0);
  const probabilityAtLeastOne = slips.reduce((miss, slip) => miss * (1 - slip.joint_prob), 1);
  const atLeastOne = 1 - probabilityAtLeastOne;
  return {
    level: "A",
    pool_size: rawPool.length,
    slips,
    validation: {
      minimumOdds: MIN_ODD,
      minimumSelectionEV: MIN_SELECTION_EV,
      minimumSlipEV: MIN_SLIP_EV,
      sum_joint_prob: Number(sumJointProb.toFixed(6)),
      probability_at_least_one: Number(atLeastOne.toFixed(6)),
      sixSlipsMinimum: slips.length >= 6,
      probabilitySumMinimum: sumJointProb >= 0.17,
      probabilityAtLeastOneMinimum: atLeastOne >= 0.22,
      valid: slips.length >= 6 && sumJointProb >= 0.17 && atLeastOne >= 0.22
    },
    published_at: new Date(now).toISOString(),
    note: "Probabilidades conjuntas calculadas por produto sob hipótese de independência entre jogos; não usar como garantia de acerto."
  };
}
