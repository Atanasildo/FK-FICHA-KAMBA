const clean = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function numericLine(market, selection, explicitLine) {
  const direct = Number(String(explicitLine ?? "").replace(",", "."));
  if (Number.isFinite(direct) && String(explicitLine ?? "").trim() !== "") return direct;
  const text = String(selection || "") + " " + String(market || "");
  const match = text.match(/(?:mais\s+de|menos\s+de|over|under|acima\s+de|abaixo\s+de)[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i)
    || text.match(/\(([0-9]+(?:[.,][0-9]+)?)\)/);
  return match ? Number(match[1].replace(",", ".")) : NaN;
}

function overUnder(selection) {
  const value = clean(selection);
  if (/^(mais\s+de|mais|over|acima\s+de)\b/.test(value)) return "over";
  if (/^(menos\s+de|menos|under|abaixo\s+de)\b/.test(value)) return "under";
  return null;
}

function thresholdState(value, line, side, finished) {
  if (!Number.isFinite(value) || !Number.isFinite(line) || !side) return null;
  const exact = Math.abs(value - line) < 0.0001;
  if (finished && exact) return "push";
  const reached = side === "over" ? value > line : value < line;
  if (finished) return reached ? "won" : "lost";
  if (exact) return "level";
  return reached ? "ahead" : "behind";
}

function resultSelection(selection) {
  const value = clean(selection).replace(/\s+/g, " ");
  if (/^(1|w1|home|vit[oó]ria da equipa da casa|vit[oó]ria da casa)$/.test(value)) return ["home"];
  if (/^(x|draw|empate)$/.test(value)) return ["draw"];
  if (/^(2|w2|away|vit[oó]ria da equipa visitante|vit[oó]ria visitante)$/.test(value)) return ["away"];
  if (/^(1x|casa ou empate)$/.test(value)) return ["home", "draw"];
  if (/^(x2|empate ou visitante)$/.test(value)) return ["draw", "away"];
  if (/^(12|sem empate)$/.test(value)) return ["home", "away"];
  return null;
}

function statusText(state) {
  return ({
    ahead: "A favor neste momento",
    behind: "Em risco neste momento",
    level: "Na linha neste momento",
    won: "Ganha",
    lost: "Perdida",
    push: "Linha devolvida",
  })[state] || "Aguardando confirmação";
}

export function evaluateLiveMarket({
  market = "", selection = "", line = null,
  home = "", away = "", homeScore = null, awayScore = null,
  status = "", stats = null
}) {
  const marketName = clean(market);
  const pick = clean(selection);
  const homeGoals = Number(homeScore);
  const awayGoals = Number(awayScore);
  const scoreAvailable = Number.isFinite(homeGoals) && Number.isFinite(awayGoals);
  const finished = /^(ft|finished|full_time|aet|pens|after_extra_time|penalty_shootout)$/i.test(String(status));
  const live = /^(live|in_play|1h|2h|ht|first_half|second_half)$/i.test(String(status));
  const totalGoals = scoreAvailable ? homeGoals + awayGoals : NaN;

  if (/(total.?goals|golos|goals)/i.test(market) && !/cart|corner|canto/i.test(market)) {
    const side = overUnder(selection);
    const threshold = numericLine(market, selection, line);
    const teamTotal = /team.?total|total.*(equipa|team)|(equipa|team).*total/i.test(market);
    let measuredGoals = totalGoals;
    let metricLabel = "Golos no jogo";
    if (teamTotal) {
      if (/equipa da casa|\bhome\b/i.test(marketName) || (home && marketName.includes(clean(home)))) {
        measuredGoals = homeGoals; metricLabel = "Golos da equipa da casa";
      } else if (/equipa visitante|\baway\b/i.test(marketName) || (away && marketName.includes(clean(away)))) {
        measuredGoals = awayGoals; metricLabel = "Golos da equipa visitante";
      } else {
        measuredGoals = NaN;
      }
    }
    if (side && Number.isFinite(threshold) && Number.isFinite(measuredGoals)) {
      const state = thresholdState(measuredGoals, threshold, side, finished);
      return {
        marketStatus: statusText(state),
        marketUpdate: `${metricLabel}: ${measuredGoals} · ${side === "over" ? "Mais" : "Menos"} de ${threshold}`,
        liveMetric: measuredGoals,
        supported: true
      };
    }
  }

  if (/resultado|match.?winner|1x2|dupla|double.?chance/i.test(market)) {
    const wanted = resultSelection(selection);
    if (wanted && scoreAvailable) {
      const actual = homeGoals > awayGoals ? "home" : homeGoals < awayGoals ? "away" : "draw";
      const matchesPick = wanted.includes(actual);
      const state = finished ? (matchesPick ? "won" : "lost") : (matchesPick ? "ahead" : "behind");
      return {
        marketStatus: statusText(state),
        marketUpdate: `Marcador: ${homeGoals} : ${awayGoals} · ${home || "Casa"} vs ${away || "Visitante"}`,
        liveMetric: `${homeGoals}:${awayGoals}`,
        supported: true
      };
    }
  }

  if (/cart[oõ]es?\s+amarelos?|yellow.?cards?/i.test(market)) {
    const side = overUnder(selection);
    const threshold = numericLine(market, selection, line);
    const homeCards = Number(stats?.home?.yellow_cards);
    const awayCards = Number(stats?.away?.yellow_cards);
    const teamTotal = /team.?total|total.*(equipa|team)|(equipa|team).*total/i.test(market);
    let measuredCards = homeCards + awayCards;
    let cardLabel = "Cartões amarelos";
    if (teamTotal) {
      if (/equipa da casa|\bhome\b/i.test(marketName) || (home && marketName.includes(clean(home)))) {
        measuredCards = homeCards; cardLabel = "Cartões amarelos da equipa da casa";
      } else if (/equipa visitante|\baway\b/i.test(marketName) || (away && marketName.includes(clean(away)))) {
        measuredCards = awayCards; cardLabel = "Cartões amarelos da equipa visitante";
      } else {
        measuredCards = NaN;
      }
    }
    if (side && Number.isFinite(threshold) && Number.isFinite(measuredCards)) {
      const state = thresholdState(measuredCards, threshold, side, finished);
      return {
        marketStatus: statusText(state),
        marketUpdate: `${cardLabel}: ${measuredCards} · linha ${threshold}`,
        liveMetric: measuredCards,
        supported: true
      };
    }
  }

  const statDefinitions = [
    { pattern: /remates?\s+(a|na)\s+baliza|shots.?on.?target/i, key: "shots_on_target", label: "Remates à baliza" },
    { pattern: /remates?\s+fora|shots.?off.?target/i, key: "shots_off_target", label: "Remates fora" },
    { pattern: /remates?|shots|finalizacoes/i, key: "shots", label: "Remates" },
    { pattern: /faltas|fouls/i, key: "fouls", label: "Faltas" },
    { pattern: /desarmes|tackles/i, key: "tackles", label: "Desarmes" },
    { pattern: /defesas|saves/i, key: "saves", label: "Defesas" }
  ];
  const statDefinition = statDefinitions.find(definition => definition.pattern.test(marketName));
  if (statDefinition) {
    const side = overUnder(selection);
    const threshold = numericLine(market, selection, line);
    const homeValue = Number(stats?.home?.[statDefinition.key]);
    const awayValue = Number(stats?.away?.[statDefinition.key]);
    const teamTotal = /team.?total|total.*(equipa|team)|(equipa|team).*total/i.test(marketName);
    let measured = homeValue + awayValue;
    let label = statDefinition.label;
    if (teamTotal) {
      if (/equipa da casa|\bhome\b/i.test(marketName) || (home && marketName.includes(clean(home)))) {
        measured = homeValue; label += " da equipa da casa";
      } else if (/equipa visitante|\baway\b/i.test(marketName) || (away && marketName.includes(clean(away)))) {
        measured = awayValue; label += " da equipa visitante";
      } else {
        measured = NaN;
      }
    }
    if (side && Number.isFinite(threshold) && Number.isFinite(homeValue) && Number.isFinite(awayValue) && Number.isFinite(measured)) {
      const state = thresholdState(measured, threshold, side, finished);
      return {
        marketStatus: statusText(state),
        marketUpdate: `${label}: ${measured} · linha ${threshold}`,
        liveMetric: measured,
        supported: true
      };
    }
  }

  if (/cart[oõ]es?\s+vermelhos?|red.?cards?/i.test(marketName)) {
    const side = overUnder(selection);
    const threshold = numericLine(market, selection, line);
    const events = Array.isArray(stats?.events) ? stats.events : [];
    if (!stats?.eventsAvailable) {
      return {
        marketStatus: "Aguardando eventos",
        marketUpdate: "A fonte ainda não confirmou os eventos deste jogo; não é possível contar cartões vermelhos.",
        liveMetric: null,
        supported: false
      };
    }
    const redCards = events.filter(event => /red_card|second_yellow/i.test(String(event.event_type || "")));
    const teamTotal = /team.?total|total.*(equipa|team)|(equipa|team).*total/i.test(marketName);
    let measured = redCards.length;
    let label = "Cartões vermelhos";
    if (teamTotal) {
      if (/equipa da casa|\bhome\b/i.test(marketName) || (home && marketName.includes(clean(home)))) {
        measured = redCards.filter(event => event.team_side === "home").length;
        label += " da equipa da casa";
      } else if (/equipa visitante|\baway\b/i.test(marketName) || (away && marketName.includes(clean(away)))) {
        measured = redCards.filter(event => event.team_side === "away").length;
        label += " da equipa visitante";
      } else measured = NaN;
    }
    if (side && Number.isFinite(threshold)) {
      const state = thresholdState(measured, threshold, side, finished);
      return {
        marketStatus: statusText(state),
        marketUpdate: `${label}: ${measured} · linha ${threshold}`,
        liveMetric: measured,
        supported: true
      };
    }
  }

  if (/canto|corner/i.test(market)) {
    return {
      marketStatus: "Estatística específica indisponível",
      marketUpdate: "A fonte desportiva actual não fornece contagem de cantos para este jogo.",
      liveMetric: null,
      supported: false
    };
  }

  return {
    marketStatus: finished ? "Resultado por confirmar" : live ? "A acompanhar" : "Aguardando dados",
    marketUpdate: "O marcador e o minuto podem ser acompanhados, mas a fonte ainda não disponibiliza a estatística necessária para avaliar este mercado.",
    liveMetric: null,
    supported: false
  };
}
