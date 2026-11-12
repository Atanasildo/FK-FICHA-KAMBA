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

function marketScope(name) {
  const normalized = clean(name);
  const minuteRange = normalized.match(/(?:minuto?s?\s*)?(\d{1,3})\s*(?:-|a|ate)\s*(\d{1,3})\s*(?:minuto?s?)?/);
  if (minuteRange && /minuto|\d\s*(?:-|a|ate)\s*\d/.test(normalized)) {
    return `minutes:${Number(minuteRange[1])}-${Number(minuteRange[2])}`;
  }
  const advantage = normalized.match(/(\d+)\s*golo?s?\s*de\s*avanco/);
  if (advantage) return `goal-advantage:${Number(advantage[1])}`;
  return "match";
}

function describeMarket(name, marketType = null) {
  const normalized = clean(name);
  const type = clean(marketType);
  const period = periodOf(name);
  const scope = marketScope(name);
  const teamMatch = normalized.match(/total de golos? (?:do|da|de) (.+)$/);
  let kind = "market";
  let entity = null;
  let fallback = null;

  if (/penalti|penalty/.test(normalized)) kind = "penalty";
  else if (/cartoes?.*pontos|pontos.*cartoes?/.test(normalized)) {
    const teamCardMatch = normalized.match(/total de pontos de cartoes? (?:do|da|de) (.+)$/);
    kind = /handicap/.test(normalized) ? "card-points-handicap" : teamCardMatch ? "card-points-team-total" : /total/.test(normalized) ? "card-points-total" : "card-points";
    if (teamCardMatch) entity = teamCardMatch[1];
  } else if (/cantos?/.test(normalized) || (/corner|canto/.test(type) && /total/.test(type))) {
    kind = /handicap/.test(normalized) || /handicap/.test(type) ? "corner-handicap" : /total/.test(normalized) || /total/.test(type) ? "corner-total" : "corner";
  } else if (teamMatch) {
    kind = "team-goals";
    entity = teamMatch[1];
  } else if (/resultado/.test(normalized) && /jogo|partida|match/.test(normalized) && /golo?s? de avanco/.test(normalized)) kind = "match-result-advantage";
  else if (/total.*golos?|golos?.*total/.test(normalized) || (/goal|golo/.test(type) && /total/.test(type))) {
    kind = /team/.test(type) ? "team-goals" : "goals-total";
  }
  else if (/handicap asiatico|asian handicap/.test(normalized)) kind = "asian-handicap";
  else if (/handicap/.test(normalized)) kind = "handicap";
  else if (/dupla chance|double chance/.test(normalized)) kind = "double-chance";
  else if (/empate anula|draw no bet/.test(normalized)) kind = "draw-no-bet";
  else if (/ambas.*marcam|both teams.*score/.test(normalized)) kind = "both-teams-score";
  else if (/resultado/.test(normalized) && /jogo|partida|match/.test(normalized)) kind = "match-result";
  else if (/resultado/.test(normalized)) kind = "result";
  else fallback = normalized;

  return { period, scope, kind, entity: entity ? clean(entity) : null, fallback };
}

function describeSelection(market, row) {
  const label = String(row.selection ?? row.selecao ?? "").trim();
  const normalized = clean(label);
  const descriptor = describeMarket(market, row.marketType);
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
  const label = String(row.selection || "");
  const total = label.match(/(?:mais de|mais|over|menos de|menos|under)\s+([+-]?\d+(?:[.,]\d+)?)/i);
  if (total) return canonicalLine(total[1]);
  const suppliedLine = canonicalLine(row.line ?? row.marketBase ?? row.base);
  if (suppliedLine) return suppliedLine;
  const marketLine = String(row.market || row.mercado || "").match(/(?:linha|line|mais de|menos de|over|under)\s*[:(]?\s*([+-]?\d+(?:[.,]\d+)?)/i);
  if (marketLine) return canonicalLine(marketLine[1]);
  const handicap = label.match(/\(([+-]?\d+(?:[.,]\d+)?)\)$/);
  return handicap ? canonicalLine(handicap[1]) : null;
}

function isTotalMarket(name, marketType) {
  const normalized = clean(name);
  const type = clean(marketType);
  return /\btotal\b/.test(normalized) || /total/.test(type) ||
    /golos?\s+(?:do|da|no|de)|cartoes?\s+(?:do|da|no|de)|cantos?\s+(?:do|da|no|de)/.test(normalized);
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

        const market = describeMarket(marketName, row.marketType);
        const selectionKey = describeSelection(marketName, { ...row, selection });
        const isOverUnder = /^(mais de|mais|over|menos de|menos|under)\b/i.test(selection);
        if (isOverUnder && isTotalMarket(marketName, row.marketType) &&
            !lineFromSelection({ ...row, selection })) continue;
        const lineIdentity = lineFromSelection({ ...row, selection });
        // O tipo e o base nativos podem variar entre casas; a identidade usa a classificação semântica e a linha normalizada.
        const marketKey = [market.period, market.scope, market.kind, market.entity || "", market.fallback || "", lineIdentity || ""].join("|");
        const key = `${marketKey}::${selectionKey}`;
        if (!quotesByKey.has(key)) {
          quotesByKey.set(key, {
            market: marketName, selection, period: market.period,
            marketType: row.marketType || null,
            marketBase: row.marketBase == null ? null : String(row.marketBase),
            category: row.category || null,
            categoryId: row.categoryId == null ? null : String(row.categoryId),
            categoryOrder: row.categoryOrder == null ? null : Number(row.categoryOrder),
            line: lineFromSelection({ ...row, selection }),
            quotes: new Map()
          });
        }

        const quote = {
          bookmaker,
          odds,
          market: marketName,
          selection,
          marketType: row.marketType || null,
          marketBase: row.marketBase == null ? null : String(row.marketBase),
          marketCode: row.marketCode || null,
          marketDisplayKey: row.marketDisplayKey || null,
          marketId: row.marketId == null ? null : String(row.marketId),
          category: row.category || null,
          categoryId: row.categoryId == null ? null : String(row.categoryId),
          categoryOrder: row.categoryOrder == null ? null : Number(row.categoryOrder),
          marketOrder: row.marketOrder == null ? null : Number(row.marketOrder),
          selectionId: row.selectionId == null ? null : String(row.selectionId),
          selectionType: row.selectionType || null,
          selectionOrder: row.selectionOrder == null ? null : Number(row.selectionOrder),
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
        marketType: item.marketType,
        marketBase: item.marketBase,
        category: quotes.find(q => q.category)?.category || item.category || null,
        categoryId: quotes.find(q => q.categoryId)?.categoryId || item.categoryId || null,
        categoryOrder: quotes.find(q => q.categoryOrder != null)?.categoryOrder ?? item.categoryOrder ?? null,
        categories: [...new Set(quotes.map(q => q.category).filter(Boolean))],
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
