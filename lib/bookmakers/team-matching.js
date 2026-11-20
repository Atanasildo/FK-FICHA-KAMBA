const STOP = new Set(["fc","cf","sc","ac","club","clube","de","da","do","the","and","football","futebol"]);
const TOKEN_ALIASES = new Map([
  ["utd","united"],
  ["munchen","munich"],
  ["muenchen","munich"],
  ["ath","athletic"],
  ["athletico","atletico"]
]);
const ALIASES = new Map([
  ["sportingcp","sporting lisbon"],
  ["intermilan","inter milan"],
  ["internazionale","inter milan"],
  ["psg","paris saint germain"],
  ["manutd","manchester united"],
  ["manunited","manchester united"],
  ["mancity","manchester city"],
  ["spurs","tottenham hotspur"],
  ["bayern","bayern munich"],
  ["bayernmunchen","bayern munich"],
  ["bayernmunich","bayern munich"],
  ["barca","barcelona"],
  ["mocambique","mozambique"],
  ["etiopia","ethiopia"],
  ["paraguai","paraguay"],
  ["ilhascomores","comoros"],
  ["wolves","wolverhampton wanderers"],
  ["forest","nottingham forest"],
  ["nottmforest","nottingham forest"],
  ["newcastle","newcastle united"],
  ["westham","west ham united"],
  ["brighton","brighton hove albion"],
  ["leicester","leicester city"],
  ["leeds","leeds united"],
  ["atlmadrid","atletico madrid"],
  ["atleticomadrid","atletico madrid"],
  ["bdortmund","borussia dortmund"],
  ["dortmund","borussia dortmund"],
  ["mgladbach","borussia monchengladbach"],
  ["gladbach","borussia monchengladbach"],
  ["leverkusen","bayer leverkusen"],
  ["bayer04","bayer leverkusen"],
  ["rbleipzig","rb leipzig"],
  ["leipzig","rb leipzig"],
  ["realbetis","real betis"],
  ["betis","real betis"],
  ["sociedad","real sociedad"],
  ["celta","celta vigo"],
  ["alemanha","germany"],
  ["espanha","spain"],
  ["franca","france"],
  ["inglaterra","england"],
  ["italia","italy"],
  ["holanda","netherlands"],
  ["paisesbaixos","netherlands"],
  ["belgica","belgium"],
  ["suica","switzerland"],
  ["croacia","croatia"],
  ["dinamarca","denmark"],
  ["suecia","sweden"],
  ["noruega","norway"],
  ["polonia","poland"],
  ["turquia","turkey"],
  ["marrocos","morocco"],
  ["egito","egypt"],
  ["argelia","algeria"],
  ["tunisia","tunisia"],
  ["camaroes","cameroon"],
  ["costadomarfim","ivory coast"],
  ["africadosul","south africa"],
  ["estadosunidos","united states"],
  ["eua","united states"],
  ["mexico","mexico"],
  ["japao","japan"],
  ["coreiadosul","south korea"],
  ["arabiasaudita","saudi arabia"]
]);

// Marcadores que distinguem equipas com o mesmo nome (femininas, sub-X, reservas).
const AGE_MARKER = /^u\d{2}$/;

function norm(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\bu (\d{2})\b/g, "u$1");
}

function tokens(value) {
  const raw = norm(value).split(/\s+/).filter(Boolean);
  const alias = ALIASES.get(raw.join(""));
  const expanded = alias ? alias.split(" ") : raw.map(token => TOKEN_ALIASES.get(token) || token);
  return expanded.filter(token => !STOP.has(token));
}

const WOMEN_MARKERS = new Set(["w","wom","women","woman","feminino","feminina","fem","ladies","mulh","mulher","mulheres"]);
const RESERVE_MARKERS = new Set(["res","reserves","reserve","reservas","reserva","ii"]);

function splitMarkers(list) {
  const markers = new Set();
  const words = [];
  list.forEach((token, index) => {
    if (AGE_MARKER.test(token)) markers.add(token);
    else if (WOMEN_MARKERS.has(token)) markers.add("w");
    else if (RESERVE_MARKERS.has(token)) markers.add("res");
    // "FC Hegelmann B": B final é equipa B; "B. Dortmund": B inicial é só a inicial.
    else if (token === "b" && index === list.length - 1 && list.length >= 2) markers.add("res");
    else words.push(token);
  });
  return { markers, words };
}

function tokenScore(a, b) {
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // "man" ~ "manchester", "atl" ~ "atletico": prefixo com pelo menos 3 letras.
  if (short.length >= 3 && long.startsWith(short)) return 0.9;
  // Inicial isolada ("B Dortmund" ~ "Borussia Dortmund").
  if (short.length === 1 && long.startsWith(short)) return 0.7;
  return 0;
}

function sameMarkers(x, y) {
  if (x.size !== y.size) return false;
  for (const m of x) if (!y.has(m)) return false;
  return true;
}

function compare(a, b) {
  const ta = splitMarkers(tokens(a));
  const tb = splitMarkers(tokens(b));
  if (!ta.words.length || !tb.words.length) return { score: 0, containment: 0 };
  // Feminino/sub-21/reservas nunca podem ser confundidos com a equipa principal.
  if (!sameMarkers(ta.markers, tb.markers)) return { score: 0, containment: 0 };

  const used = new Set();
  let matched = 0;
  let distinctive = false;
  for (const token of ta.words) {
    let best = -1;
    let bestScore = 0;
    tb.words.forEach((candidate, i) => {
      if (used.has(i)) return;
      const sc = tokenScore(token, candidate);
      if (sc > bestScore) { best = i; bestScore = sc; }
    });
    if (best >= 0) {
      used.add(best);
      matched += bestScore;
      if (bestScore === 1 && token.length >= 5) distinctive = true;
    }
  }
  const longest = Math.max(ta.words.length, tb.words.length);
  const shortest = Math.min(ta.words.length, tb.words.length);
  return { score: matched / longest, containment: matched / shortest, distinctive };
}

export function teamNameSimilarity(a, b) {
  return compare(a, b).score;
}

export function teamsSameFixture(a, b, { threshold = 0.8 } = {}) {
  return teamNameSimilarity(a, b) >= threshold;
}

/**
 * Decide se dois jogos de casas diferentes são o mesmo.
 * Regra normal: casa e fora com semelhança >= 0.8.
 * Regra de recurso (só com horas muito próximas): uma equipa quase idêntica e a outra
 * contida no nome da outra casa (ex.: "Leverkusen" / "Bayer Leverkusen").
 */
export function sameFixturePair(a, b, { deltaSeconds = Infinity, strictThreshold = 0.8, looseDeltaSeconds = 10 * 60 } = {}) {
  const home = compare(a.home, b.home);
  const away = compare(a.away, b.away);
  if (home.score >= strictThreshold && away.score >= strictThreshold) return true;
  if (!(deltaSeconds <= looseDeltaSeconds)) return false;
  const strong = x => x.score >= 0.9;
  const contained = x => x.containment >= 0.99 && x.distinctive && x.score >= 0.5;
  return (strong(home) && contained(away)) || (strong(away) && contained(home));
}

export function selectUniqueTeamFixture(home, away, kickoff, fixtures, {
  claimedIds = new Set(),
  maxDeltaMs = 90 * 60 * 1000,
  threshold = 0.8
} = {}) {
  const time = Date.parse(kickoff || "");
  if (!Number.isFinite(time)) return null;

  const ranked = (fixtures || [])
    .filter(fixture => !claimedIds.has(String(fixture.id)))
    .map(fixture => {
      const homeScore = teamNameSimilarity(home, fixture.home_team || fixture.home);
      const awayScore = teamNameSimilarity(away, fixture.away_team || fixture.away);
      const score = (homeScore + awayScore) / 2;
      const delta = Math.abs(Date.parse(fixture.kickoff_at || fixture.kickoff || "") - time);
      return { fixture, score, delta, homeScore, awayScore };
    })
    .filter(item =>
      Number.isFinite(item.delta) &&
      item.delta <= maxDeltaMs &&
      item.score >= threshold &&
      item.homeScore >= threshold &&
      item.awayScore >= threshold
    )
    .sort((a, b) => b.score - a.score || a.delta - b.delta);

  if (!ranked.length) return null;
  if (ranked.length > 1 &&
      Math.abs(ranked[0].score - ranked[1].score) < 0.04 &&
      Math.abs(ranked[0].delta - ranked[1].delta) < 15 * 60 * 1000) {
    return null;
  }
  return ranked[0].fixture;
}
