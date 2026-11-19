// A tabela "markets" é só um arquivo bruto: a análise lê o JSON de odds_comparisons.
// Guardamos apenas as famílias de mercados principais; props de jogadores, cantos,
// cartões e variantes por equipa ocupavam ~80% do espaço (e 314 MB só em índices).
const USEFUL_MARKET = /^(Resultado do Jogo|Dupla Chance|Ambas equipas marcar|Total de golos no jogo$|Empate anula|Handicap|Resultado correto|Dupla Chance e|Resultado e|Total de golos no jogo \(|1º Parte|2º Parte)/i;

export function isUsefulMarketName(name) {
  return USEFUL_MARKET.test(String(name ?? "").trim());
}
