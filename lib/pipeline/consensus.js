// Consenso por jogo: junta as odds das duas casas (sem margem) com as percentagens/palpites que os sites e o
// SofaScore gravaram em match_statistics. Só propõe selecções em que as fontes concordam. Não grava nada.
export const HOUSES = ["BantuBet", "ElephantBet"];

// Odds do 1X2 final por casa: { W1: { BantuBet: {odd,id}, ElephantBet: {...} }, Empate: ..., W2: ... }
export function extract1x2(comparison) {
  const out = { W1: {}, Empate: {}, W2: {} };
  for (const ev of comparison?.events || []) for (const c of ev.comparisons || []) {
    if (c.market !== "Resultado do Jogo" || c.period !== "FT") continue;
    for (const q of c.quotes || []) {
      if (!out[q.selection] || !HOUSES.includes(q.bookmaker) || !(Number(q.odds) > 1)) continue;
      out[q.selection][q.bookmaker] = { odd: Number(q.odds), id: String(q.selectionId) };
    }
  }
  return out;
}

const SIDE = { W1: 0, Empate: 1, W2: 2 };
const NAMES = ["W1", "Empate", "W2"];

export function marketProbs(odds) {
  const avg = sel => {
    const v = HOUSES.map(h => odds[sel]?.[h]?.odd).filter(Boolean);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const o = NAMES.map(avg);
  if (o.some(x => !x)) return null;
  const inv = o.map(x => 1 / x), sum = inv.reduce((a, b) => a + b, 0);
  return inv.map(x => x / sum);
}

// stats: linhas de match_statistics do jogo -> { pcts:[[1,X,2],...], tips:[...] , fontes:[...] }
export function collectSignals(stats) {
  const pcts = [], tips = [], fontes = [];
  for (const row of stats || []) {
    const p = row.payload || {};
    if (String(row.source).startsWith("site:")) {
      if (Array.isArray(p.pct)) { pcts.push(p.pct.map(Number)); fontes.push(`${p.site} ${p.pct.join("/")}`); }
      if (p.tip) { tips.push(String(p.tip)); fontes.push(`${p.site} palpite ${p.tip}`); }
    } else if (row.source === "sofascore-prematch" && p.publico) {
      pcts.push([p.publico.casa, p.publico.empate, p.publico.fora].map(Number)); fontes.push(`público SofaScore ${p.publico.casa}/${p.publico.empate}/${p.publico.fora}`);
    }
  }
  return { pcts, tips, fontes };
}

const tipSides = tip => ({ "1": [0], X: [1], "2": [2], "1X": [0, 1], X2: [1, 2], "12": [0, 2] }[String(tip).toUpperCase()] || []);

// Devolve a lista de candidatos (1X2 e dupla chance) com probabilidade justa e provas.
export function buildCandidates({ odds, signals, minOdd = 1.4, maxOdd = 3.2, minValue = -0.02 }) {
  const market = marketProbs(odds);
  if (!market) return [];
  const srcP = signals.pcts.map(p => { const s = p[0] + p[1] + p[2]; return p.map(x => x / s); });
  const n = srcP.length;
  const fair = market.map((m, i) => n ? 0.5 * m + 0.5 * (srcP.reduce((a, p) => a + p[i], 0) / n) : m);
  const total = fair.reduce((a, b) => a + b, 0);
  const f = fair.map(x => x / total);
  const out = [];
  for (let side = 0; side < 3; side++) {
    const sel = NAMES[side];
    const houses = HOUSES.filter(h => odds[sel]?.[h]);
    if (houses.length < 2) continue;
    const minHouseOdd = Math.min(...houses.map(h => odds[sel][h].odd));
    if (minHouseOdd < minOdd || minHouseOdd > maxOdd) continue;
    const ev = f[side] * minHouseOdd - 1;          // retorno esperado (a margem das casas pesa sempre contra)
    const value = f[side] / market[side] - 1;      // quanto as fontes ficam acima do mercado
    const pctAgree = srcP.filter(p => p.indexOf(Math.max(...p)) === side).length;
    const tipAgree = signals.tips.filter(t => tipSides(t).length === 1 && tipSides(t)[0] === side).length;
    const agree = pctAgree + tipAgree;
    const disagree = srcP.length - pctAgree + signals.tips.filter(t => tipSides(t).length === 1 && tipSides(t)[0] !== side).length;
    if (value < minValue || agree < 2 || disagree > agree - 1) continue;
    out.push({ selection: sel, fairProbability: Math.round(f[side] * 1000) / 1000, ev: Math.round(ev * 1000) / 1000, valueVsMarket: Math.round(value * 1000) / 1000,
      agree, disagree, houses: Object.fromEntries(houses.map(h => [h, odds[sel][h]])), fontes: signals.fontes });
  }
  return out;
}
