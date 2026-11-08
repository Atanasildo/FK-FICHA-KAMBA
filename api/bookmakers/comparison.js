const clean = value => String(value ?? "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLocaleLowerCase()
  .replace(/[^a-z0-9+.-]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

function canonicalLine(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim().replace(",", ".");
  const match = raw.match(/^([+-]?)(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isFinite(number)) return null;
  const numberText = Number.isInteger(number) ? String(number) : String(Number(number.toFixed(4)));
  return match[1] === "+" ? `+${numberText}` : match[1] === "-" ? `-${numberText}` : numberText;
}

function periodOf(marketName) {
  const name = clean(marketName);
  if (/\b(1|primeira)\s*(a|ª|o|º)?\s*parte\b|\bfirst half\b|\b1h\b/.test(name)) return "1H";
  if (/\b(2|segunda)\s*(a|ª|o|º)?\s*parte\b|\bsecond half\b|\b2h\b/.test(name)) return "2H";
  return "FT";
}

function describeMarket(name) {
  const normalized = clean(name);
  const period = periodOf(name);
  const teamMatch = normalized.match(/total de golos? (?:do|da|de) (.+)$/);
  let kind = "market";
  let entity = null;
  let fallback = null;

  if (/penalti|penalty/.test(normalized)) kind = "penalty";
  else if (/cartoes?.*pontos|pontos.*cartoes?/.test(normalized)) {
    const teamCardMatch = normalized.match(/total de pontos de cartoes? (?:do|da|de) (.+)$/);
    kind = /handicap/.test(normalized) ? "card-points-handicap" : teamCardMatch ? "card-points-team-total" : /total/.test(normalized) ? "card-points-total" : "card-points";
    if (teamCardMatch) entity = teamCardMatch[1];
  } else if (/cantos?/.test(normalized)) {
    kind = /handicap/.test(normalized) ? "corner-handicap" : /total/.test(normalized) ? "corner-total" : "corner";
  } else if (teamMatch) {
    kind = "team-goals";
    entity = teamMatch[1];
  } else if (/total.*golos?|golos?.*total/.test(normalized)) kind = "goals-total";
  else if (/handicap asiatico|asian handicap/.test(normalized)) kind = "asian-handicap";
  else if (/handicap/.test(normalized)) kind = "handicap";
  else if (/dupla chance|double chance/.test(normalized)) kind = "double-chance";
  else if (/empate anula|draw no bet/.test(normalized)) kind = "draw-no-bet";
  else if (/ambas.*marcam|both teams.*score/.test(normalized)) kind = "both-teams-score";
  else if (/resultado/.test(normalized) && /jogo|partida|match/.test(normalized)) kind = "match-result";
  else if (/resultado/.test(normalized)) kind = "result";
  else fallback = normalized;

  return { period, kind, entity: entity ? clean(entity) : null, fallback };
}

function describeSelection(market, row) {
  const label = String(row.selection ?? row.selecao ?? "").trim();
  const normalized = clean(label);
  const descriptor = describeMarket(market);
  let side = row.side || null;
  let line = canonicalLine(row.line);
  let team = row.team ? clean(row.team) : null;

  if (!side) {
    if (/^(mais de|mais|over)\s+/.test(normalized)) side = "over";
    else if (/^(menos de|menos|under)\s+/.test(normalized)) side = "under";
  }
  if (!line && side) {
    const match = normalized.match(/(?:mais de|mais|over|menos de|menos|under)\s+([+-]?\d+(?:[.,]\d+)?)/);
    if (match) line = canonicalLine(match[1]);
  }
  if (!team) {
    const handicap = label.match(/^(.+?)\s*\(([+-]?\d+(?:[.,]\d+)?)\)$/);
    if (handicap) {
      team = clean(handicap[1]);
      line = line || canonicalLine(handicap[2]);
    }
  }

  if (side && line && ["goals-total", "team-goals", "corner-total", "card-points-total"].includes(descriptor.kind)) {
    return `${side}|${line}`;
  }
  if (team && line && ["handicap", "asian-handicap", "corner-handicap", "card-points-handicap"].includes(descriptor.kind)) {
    return `${team}|${line}`;
  }
  return clean(label);
}

function lineFromSelection(row) {
  const explicit = canonicalLine(row.line);
  if (explicit) return explicit;
  const label = String(row.selection || "");
  const total = label.match(/(?:mais de|mais|over|menos de|menos|under)\\s+([+-]?\\d+(?:[.,]\\d+)?)/i);
  if (total) return canonicalLine(total[1]);
  const handicap = label.match(/\\(([+-]?\\d+(?:[.,]\\d+)?)\\)$/);
  return handicap ? canonicalLine(handicap[1]) : null;
}

function eventKey(fixture) {
  const home = clean(fixture.home);
  const away = clean(fixture.away);
  const competition = clean(fixture.competition || "");
  return home && away ? `${home}::${away}::${competition}` : null;
}

function kickoffCompatible(a, b) {
  if (!a || !b) return true;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true;
  return Math.abs(ta - tb) <= 3 * 60 * 60 * 1000;
}

/**
 * Compara apenas a mesma partida, mercado, período, linha e selecção.
 * Não calcula arbitragem nem valor esperado; apenas identifica a melhor odd observada.
 */
export function compareFixtures(fixtures = []) {
  const events = new Map();

  for (const fixture of fixtures) {
    if (!fixture || typeof fixture.home !== "string" || typeof fixture.away !== "string" || !Array.isArray(fixture.markets)) continue;
    const key = eventKey(fixture);
    if (!key) continue;
    if (!events.has(key)) {
      events.set(key, {
        event: {
          home: fixture.home,
          away: fixture.away,
          competition: fixture.competition || null,
          kickoff: fixture.kickoff || null
        },
        fixtures: []
      });
    }
    events.get(key).fixtures.push(fixture);
  }

  const results = [];
  for (const group of events.values()) {
    const quotesByKey = new Map();
    const referenceKickoff = group.event.kickoff;

    for (const fixture of group.fixtures) {
      if (!kickoffCompatible(referenceKickoff, fixture.kickoff)) continue;
      const bookmaker = String(fixture.bookmaker || fixture.provider || "").trim();
      if (!bookmaker) continue;

      for (const row of fixture.markets) {
        const marketName = String(row.market || row.mercado || "").trim();
        const selection = String(row.selection || row.selecao || "").trim();
        const odds = Number(row.odds ?? row.odd);
        if (!marketName || !selection || !Number.isFinite(odds) || odds <= 1 || odds > 10000) continue;

        const market = describeMarket(marketName);
        const selectionKey = describeSelection(marketName, { ...row, selection });
        const marketKey = [market.period, market.kind, market.entity || "", market.fallback || ""].join("|");
        const key = `${marketKey}::${selectionKey}`;
        if (!quotesByKey.has(key)) {
          quotesByKey.set(key, { market: marketName, selection, period: market.period, line: lineFromSelection({ ...row, selection }), quotes: new Map() });
        }

        const quote = {
          bookmaker,
          odds,
          market: marketName,
          selection,
          line: lineFromSelection({ ...row, selection }),
          side: row.side || null,
          team: row.team || null,
          sourceUrl: row.sourceUrl || fixture.sourceUrl || null,
          collectedAt: row.collectedAt || fixture.collectedAt || null,
          fixtureId: fixture.id || null
        };
        const existing = quotesByKey.get(key).quotes.get(bookmaker);
        const quoteTime = Date.parse(quote.collectedAt || "") || 0;
        const existingTime = Date.parse(existing?.collectedAt || "") || 0;
        if (!existing || quoteTime >= existingTime) quotesByKey.get(key).quotes.set(bookmaker, quote);
      }
    }

    const comparisons = [];
    for (const item of quotesByKey.values()) {
      const quotes = [...item.quotes.values()].sort((a, b) => b.odds - a.odds);
      if (quotes.length < 2) continue;
      comparisons.push({
        market: item.market,
        selection: item.selection,
        period: item.period,
        line: item.line,
        bestOdds: quotes[0].odds,
        bestBookmaker: quotes[0].bookmaker,
        quotes
      });
    }

    if (comparisons.length) {
      comparisons.sort((a, b) => b.bestOdds - a.bestOdds);
      results.push({ event: group.event, bookmakerCount: new Set(comparisons.flatMap(c => c.quotes.map(q => q.bookmaker))).size, comparisons });
    }
  }

  return {
    status: results.length ? "comparison_ready" : "insufficient_comparable_data",
    eventCount: results.length,
    comparisonCount: results.reduce((sum, item) => sum + item.comparisons.length, 0),
    events: results,
    note: "A comparação mostra odds observadas para selecções equivalentes. Não constitui recomendação, arbitragem garantida nem confirmação de disponibilidade."
  };
}

export { canonicalLine, describeMarket, describeSelection };
