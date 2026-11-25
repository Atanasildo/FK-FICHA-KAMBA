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

// Devolve { snippet, pct:[1,X,2]|null, tips:[...] } se as duas equipas aparecem juntas (≤ 220 caracteres).
export function findInText(textNorm, textRaw, home, away) {
  const h = keyTokens(home), a = keyTokens(away);
  if (!h.length || !a.length) return null;
  let from = 0;
  for (let guard = 0; guard < 40; guard++) {
    const i = textNorm.indexOf(h[0], from);
    if (i < 0) return null;
    from = i + h[0].length;
    const win = textNorm.slice(Math.max(0, i - 220), i + 260);
    if (!a.some(t => win.includes(t)) || (h[1] && !textNorm.slice(Math.max(0, i - 220), i + 260).includes(h[1]) && h.length > 1 && a.length < 1)) continue;
    const snippet = textRaw.slice(Math.max(0, i - 60), i + 340);
    const pcts = [...snippet.matchAll(/(\d{1,3})\s?%/g)].map(x => Number(x[1])).filter(n => n <= 100);
    const trio = pcts.length >= 3 && Math.abs(pcts[0] + pcts[1] + pcts[2] - 100) <= 3 ? pcts.slice(0, 3) : null;
    const tips = [...snippet.matchAll(/\b(over 2\.5|under 2\.5|btts|both teams to score|home win|away win|draw|1x|x2)\b/gi)].map(x => x[1].toLowerCase());
    return { snippet: snippet.slice(0, 300), pct: trio, tips: [...new Set(tips)].slice(0, 4) };
  }
  return null;
}
