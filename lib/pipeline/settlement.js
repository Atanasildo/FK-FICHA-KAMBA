import { evaluateLiveMarket } from "../tickets/live-market.js";

// Só se liquidam mercados de tempo regulamentar cujo resultado depende apenas do marcador final.
// Qualquer outro (partes, handicaps, combinados, cartões, etc.) fica pendente: nunca se adivinha.
const clean = value => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const SAFE_MARKET = /^(resultado do jogo|total de golos no jogo|dupla chance|ambas equipas marcarao)$/;
const SETTLED = new Set(["Ganha", "Perdida", "Linha devolvida"]);

export const isSettleableMarket = name => SAFE_MARKET.test(clean(name));

// Liquida as selecções pendentes de um jogo terminado em tempo regulamentar (FT).
// Devolve quantas selecções foram actualizadas. O estado do boletim deriva das selecções.
export async function settleFinishedLegs({ db, match, legs, fixture, log = () => {} }) {
  if (!fixture || !/^FT$/i.test(String(fixture.status))) return 0;
  const pending = (legs || []).filter(leg => leg.match_id === match.id && (!leg.result || leg.result === "pending"));
  if (!pending.length) return 0;

  const marketIds = [...new Set(pending.map(leg => leg.market_id).filter(Boolean))];
  const lines = new Map();
  if (marketIds.length) {
    const { data, error } = await db.from("markets").select("id,line").in("id", marketIds);
    if (error) throw new Error("Não foi possível ler as linhas dos mercados: " + error.message);
    for (const row of data || []) lines.set(row.id, row.line);
  }

  let updated = 0;
  for (const leg of pending) {
    if (!isSettleableMarket(leg.market_name)) continue;
    const evaluation = evaluateLiveMarket({
      market: leg.market_name, selection: leg.selection, line: lines.get(leg.market_id) ?? null,
      home: match.home_team, away: match.away_team,
      homeScore: fixture.home_score, awayScore: fixture.away_score, status: "FT"
    });
    if (!evaluation.supported || !SETTLED.has(evaluation.marketStatus)) continue;
    const { error } = await db.from("ticket_legs").update({ result: evaluation.marketStatus })
      .eq("id", leg.id).eq("result", "pending");
    if (error) throw new Error("Não foi possível gravar o resultado da selecção: " + error.message);
    updated++;
    log(`LIQUIDADA ${match.home_team} - ${match.away_team} · ${leg.market_name} ${leg.selection} → ${evaluation.marketStatus}`);
  }
  return updated;
}
