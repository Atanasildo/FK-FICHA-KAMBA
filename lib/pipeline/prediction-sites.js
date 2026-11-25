// Previsões de sites públicos, lidas pelo PC (curl normal). Uma página de lista por site: procura cada
// jogo da base pelo nome das duas equipas e guarda o trecho + as percentagens 1/X/2 que encontrar.
// Não contorna bloqueios: 403/Cloudflare -> o site é saltado.
export const SITES = [
  { id: "mybets", urls: ["https://www.mybets.today/soccer-predictions/"] },
  { id: "footystats", urls: ["https://www.footystats.org/predictions"] },
  { id: "forza", urls: ["https://forzafootball.com/gb/play/betting-tips"] },
  { id: "statarea", urls: ["https://www.statarea.com/predictions"] },
  { id: "soccervista", urls: ["https://www.soccervista.com/"] },
  { id: "vitibet", urls: ["https://www.vitibet.com/index.php?clanek=quicktips&sekce=fotbal&lang=en"] },
  { id: "betstudy", urls: ["https://www.betstudy.com/predictions/"] }
];

const STOP = new Set(["fc", "cf", "sc", "ac", "as", "fk", "sk", "if", "bk", "united", "city", "club", "real", "sporting", "athletic", "the", "de", "del", "la", "cd", "ud", "sv", "vfb", "vfl", "tsv", "afc"]);
export const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function htmlToText(html) {
  return String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

function keyTokens(name) {
  const tokens = norm(name).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(t => t.length >= 4 && !STOP.has(t));
  return tokens.sort((a, b) => b.length - a.length).slice(0, 2);
}

// Devolve { snippet, pct:[1,X,2]|null, tip, tips } se a equipa da casa e a de fora aparecem juntas (casa primeiro).
// Só olha para o que vem DEPOIS do nome da equipa de fora e até à hora seguinte da lista, para não apanhar
// as percentagens do jogo vizinho.
export function findInText(textNorm, textRaw, home, away) {
  const h = keyTokens(home), a = keyTokens(away);
  if (!h.length || !a.length) return null;
  let from = 0;
  for (let guard = 0; guard < 60; guard++) {
    const i = textNorm.indexOf(h[0], from);
    if (i < 0) return null;
    from = i + h[0].length;
    const ahead = textNorm.slice(from, from + 160);
    let j = -1, tokenLen = 0;
    for (const t of a) { const k = ahead.indexOf(t); if (k >= 0 && (j < 0 || k < j)) { j = k; tokenLen = t.length; } }
    if (j < 0) continue;
    const start = from + j + tokenLen;
    let after = textRaw.slice(start, start + 170);
    const next = after.search(/\b\d{1,2}:\d{2}\b|\b\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}/);
    if (next > 12) after = after.slice(0, next);
    const labelled = after.match(/\b1\s*(\d{1,3})\s?%\s*X\s*(\d{1,3})\s?%\s*2\s*(\d{1,3})\s?%/);
    const plain = after.match(/(\d{1,3})\s?%\s+(\d{1,3})\s?%\s+(\d{1,3})\s?%/);
    const m = labelled || plain;
    const pct = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    const okPct = pct && Math.abs(pct[0] + pct[1] + pct[2] - 100) <= 3 ? pct : null;
    const tipMatch = after.match(/\bTIP\s+(1X|X2|12|1|X|2)\b(?!\s*-)/i) || after.match(/\bTip\s+\d-\d\s+(1X|X2|12|1|X|2)\b/i)
      || after.match(/^\W{0,3}(1X|X2|12|1|X|2)\b(?!\s*\d{1,3}\s?%)/);
    const tips = [...after.matchAll(/\b(over 2\.5|under 2\.5|btts|both teams to score)\b/gi)].map(x => x[1].toLowerCase());
    return { snippet: textRaw.slice(Math.max(0, i - 20), start + Math.min(after.length, 120)).slice(0, 260), pct: okPct,
      tip: tipMatch ? tipMatch[1].toUpperCase() : null, tips: [...new Set(tips)].slice(0, 3) };
  }
  return null;
}
