const ODDS_RE = /^\d+(?:[.,]\d+)?$/;
const LINE_RE = /^(?:[+-]\d+(?:[.,]\d+)?|0(?:[.,]0+)?)$/;
const THRESHOLD_RE = /^\d+(?:[.,]\d+)?\+$/;

function cleanLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^NOVO$/i.test(line));
}

function toNumber(value) {
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function isOdd(value) {
  if (!ODDS_RE.test(value)) return false;
  const n = toNumber(value);
  return n !== null && n > 1 && n <= 10000;
}

function isLine(value) {
  return LINE_RE.test(value) || THRESHOLD_RE.test(value) ||
    /^\d+(?:[.,]\d+)?$/.test(value);
}

function makeSelection(selection, odd, extra = {}) {
  const numericOdd = toNumber(odd);
  if (!selection || numericOdd === null || numericOdd <= 1 || numericOdd > 10000) return null;
  return {
    selection: String(selection).trim(),
    odd: numericOdd,
    oddText: String(odd),
    ...extra
  };
}

function parseOverUnder(lines) {
  if (!/^mais de$/i.test(lines[0] || "") || !/^menos(?: de)?$/i.test(lines[1] || "")) return null;

  const selections = [];
  for (let i = 2; i + 2 < lines.length; i += 3) {
    const line = lines[i];
    const over = lines[i + 1];
    const under = lines[i + 2];
    if (!isLine(line) || !isOdd(over) || !isOdd(under)) return null;

    const normalizedLine = line.replace(",", ".");
    selections.push(makeSelection(`Mais de ${normalizedLine}`, over, { side: "over", line: normalizedLine }));
    selections.push(makeSelection(`Menos de ${normalizedLine}`, under, { side: "under", line: normalizedLine }));
  }
  return selections.length ? selections.filter(Boolean) : null;
}

function parseHandicap(lines) {
  const firstLineIndex = lines.findIndex((line, i) => i > 1 && LINE_RE.test(line));
  if (firstLineIndex < 0) return null;

  const teams = lines.slice(0, firstLineIndex).filter(line => !isOdd(line));
  const home = teams[0] || "Equipa 1";
  const away = teams[1] || "Equipa 2";
  const selections = [];
  let zeroIndex = 0;

  for (let i = firstLineIndex; i + 1 < lines.length; i += 2) {
    const line = lines[i];
    const odd = lines[i + 1];
    if (!LINE_RE.test(line) || !isOdd(odd)) return null;

    const normalizedLine = line.replace(",", ".");
    let team;
    if (normalizedLine.startsWith("-")) team = home;
    else if (normalizedLine.startsWith("+")) team = away;
    else {
      team = zeroIndex % 2 === 0 ? home : away;
      zeroIndex += 1;
    }
    selections.push(makeSelection(`${team} (${normalizedLine})`, odd, {
      team,
      line: normalizedLine
    }));
  }
  return selections.length ? selections.filter(Boolean) : null;
}

function parseLabelOddPairs(lines) {
  const selections = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const label = lines[i];
    const odd = lines[i + 1];
    if (!isOdd(odd)) return null;
    selections.push(makeSelection(label, odd));
  }
  return selections.length ? selections.filter(Boolean) : null;
}

function parseStructuredSelections(market) {
  const rows = market?.selecoes || market?.selections;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const parsed = rows.map(row => makeSelection(
    row?.selecao || row?.selection || row?.nome || row?.label,
    row?.odd ?? row?.odds,
    {
      ...((row?.line ?? row?.linha) != null ? { line: String(row.line ?? row.linha).replace(",", ".") } : {}),
      ...(row?.side != null ? { side: row.side } : {}),
      ...(row?.team != null ? { team: row.team } : {})
    }
  ));
  if (parsed.some(item => !item)) return null;
  return parsed;
}

function parseMarket(market) {
  const rawContent = market?.conteudo || market?.content || "";
  const lines = cleanLines(rawContent);
  const title = String(market?.mercado || market?.market || lines[0] || "Mercado sem nome").trim();
  // A flag de recolha incompleta tem prioridade sobre qualquer parsing:
  // nunca promover dados parcialmente associados a selecções válidas.
  if (market?.associacaoCompleta === false) {
    return {
      market: title,
      selections: [],
      status: "review",
      warning: "A recolha encontrou odds sem conseguir associar todas às respectivas selecções.",
      rawContent
    };
  }
  const structured = parseStructuredSelections(market);
  if (structured) return { market: title, selections: structured, status: "ok", rawContent };
  if (lines.length && lines[0].toLocaleLowerCase() === title.toLocaleLowerCase()) lines.shift();
  if (lines.length === 0) {
    return { market: title, selections: [], status: "empty", rawContent };
  }

  const overUnder = parseOverUnder(lines);
  if (overUnder) return { market: title, selections: overUnder, status: "ok", rawContent };

  const handicap = parseHandicap(lines);
  if (handicap) return { market: title, selections: handicap, status: "ok", rawContent };

  const firstOdd = lines.findIndex(isOdd);
  if (firstOdd >= 0) {
    const labels = lines.slice(0, firstOdd);
    const odds = lines.slice(firstOdd).filter(isOdd);

    if (labels.length && labels.length === odds.length) {
      const selections = labels.map((label, i) => makeSelection(label, odds[i])).filter(Boolean);
      if (selections.length === labels.length) {
        return { market: title, selections, status: "ok", rawContent };
      }
    }

    const pairs = parseLabelOddPairs(lines);
    if (pairs) return { market: title, selections: pairs, status: "ok", rawContent };
  }

  return {
    market: title,
    selections: [],
    status: "review",
    warning: "Não foi possível associar todas as selecções às odds sem ambiguidade.",
    rawContent
  };
}

function stableKey(market) {
  return [
    String(market.market || "").toLocaleLowerCase(),
    ...(market.selections || []).map(s =>
      `${String(s.selection).toLocaleLowerCase()}|${s.line || ""}|${s.odd}`
    )
  ].join("::");
}

/**
 * Normaliza os mercados recolhidos na interface pública da casa.
 * A categoria "Tudo" é ignorada porque agrega os mercados das categorias específicas
 * e pode introduzir duplicações. Apenas as categorias específicas são processadas.
 */
export function normalizeBookmakerMarkets(categories = [], options = {}) {
  const bookmaker = options.bookmaker || "BantuBet";
  const event = options.event || null;
  const byKey = new Map();

  for (const category of categories) {
    const categoryName = String(category?.categoria || category?.name || "Sem categoria").trim();
    if (categoryName.toLocaleLowerCase() === "tudo") continue;
    if (!Array.isArray(category?.mercados || category?.markets)) continue;

    for (const rawMarket of category.mercados || category.markets) {
      const parsed = parseMarket(rawMarket);
      const key = stableKey(parsed);
      if (!byKey.has(key)) {
        byKey.set(key, {
          id: `${bookmaker.toLowerCase()}-${byKey.size + 1}`,
          bookmaker,
          event,
          category: categoryName,
          categories: [categoryName],
          market: parsed.market,
          selections: parsed.selections,
          status: parsed.status,
          warning: parsed.warning || null,
          rawContent: parsed.rawContent
        });
      } else {
        const existing = byKey.get(key);
        if (!existing.categories.includes(categoryName)) existing.categories.push(categoryName);
        if (existing.category === "Tudo" && categoryName !== "Tudo") existing.category = categoryName;
      }
    }
  }

  return [...byKey.values()];
}

export { parseMarket };
