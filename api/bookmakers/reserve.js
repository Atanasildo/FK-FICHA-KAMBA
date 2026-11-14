const MIN_ODDS = 1.4;
const configs = {
  elephant: {
    url: "https://winners.elephantbet.co.ao/image-creator/share-booking/",
    siteId: 18756188, siteName: "Elephantbet",
    logoUrl: "https://www.elephantbet.co.ao/logo.png",
    hero: "rgb(247, 37, 133)", brand2: "rgb(255, 255, 255)", skin: "rgb(13, 15, 32)",
    maxOdd: null, bookingBase: "https://www.elephantbet.co.ao?bookingId="
  },
  bantu: {
    url: "https://winners.bantubet.co.ao/image-creator/share-booking/",
    siteId: 1869146, siteName: "Bantubet",
    logoUrl: "https://m.bantubet.co.ao/logo.png",
    hero: "rgb(236, 99, 56)", brand2: "rgb(234, 203, 11)", skin: "rgb(27, 33, 56)",
    maxOdd: 300000, bookingBase: "https://m.bantubet.co.ao?bookingId="
  }
};

function kickoffMillis(value) {
  if (!value) return NaN;
  const iso = Date.parse(value);
  if (Number.isFinite(iso)) return iso;
  const match = String(value).match(/^(\d{2})[./](\d{2})[./](\d{4}),?\s+(\d{2}):(\d{2})$/);
  if (!match) return NaN;
  const [, day, month, year, hour, minute] = match;
  // Africa/Luanda = UTC+1.
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 1, Number(minute));
}

function buildPayload(site, selections, suppliedTotal) {
  const cfg = configs[site];
  const events = selections.map(s => {
    const odd = Number(s.odd);
    if (!Number.isFinite(odd) || odd < MIN_ODDS) throw new Error("Cada selecção deve ter odd igual ou superior a 1.40.");
    return {
      finalPayoutFormatted: false, isLive: s.isLive ? 1 : 0, price: String(odd),
      stake: "0", taxOnStake: false, totalStake: "0", taxOnProfitOrReturn: false,
      showTotalStake: false, possibleWin: "0", finalPayout: false,
      ...(site === "elephant" ? { betBuilderEvent: true } : {}),
      childrenEvents: [], startTime: s.startTime || "", team1Name: s.home || "",
      team2Name: s.away || "", eventName: s.selectionName || "",
      competitionName: s.competition || "", regionName: s.region || "",
      base: s.base || "", sportAlias: "Soccer", marketName: s.marketName || "",
      incInSysCalc: false
    };
  });
  const calculated = events.reduce((acc, e) => acc * Number(e.price), 1);
  if (suppliedTotal != null && Math.abs(Number(suppliedTotal) - calculated) > Math.max(0.02, calculated * 0.002)) {
    throw new Error("A odd total indicada não corresponde ao produto das odds individuais.");
  }
  return {
    translations: {
      "Booking ID": "Reserva ID", "Date/Time": "Data", "Bet Type": "Tipo de aposta",
      "ODD Type": "Tipo de Odd", Single: "Simples", Express: "Múltipla", System: "Sistema",
      Bonus: "Bónus", Chain: "Cadeia", Odds: site === "elephant" ? "Cotações" : "Odds",
      Selections: "Selecções", Stake: "Aposta...", Tax: site === "elephant" ? "Imposto" : "Imposto prémios fonte 15%",
      "Winning Bonus": "Bónus vencedor", "Enjoy the game": "Boa sorte",
      "Final payout": site === "elephant" ? "Prémio potencial" : "Prémio líquido",
      "Possible win": site === "elephant" ? "Prémio potencial" : "Prémio potencial",
      "Accumulator bonus": "Bónus acumulador", "Total stake": "Aposta total",
      "Net stake": "Aposta líquida", "Tax on stake": "Imposto na aposta",
      "Look at my bet at {1}!": `Consulta o meu boletim em ${cfg.siteName}!`
    },
    share: { bookingLink: "", bookId: 0, date: new Date().toLocaleString("pt-PT") },
    configs: {
      key1: Date.now(), key2: Math.random().toString(36).slice(2, 14),
      colors: { hero_color: cfg.hero, brand_color_2: cfg.brand2, skin_color: cfg.skin },
      lang: "por", siteName: cfg.siteName, siteId: cfg.siteId, currencyName: "Kz",
      oddFormat: "Decimal", rtl: false, ageRestriction: "18", logoUrl: cfg.logoUrl,
      maxOdd: cfg.maxOdd, taxType: 2
    },
    betslip: {
      events, betType: selections.length > 1 ? 2 : 1, sysVal: 2,
      totalOdds: selections.length > 1 ? String(Number(calculated.toFixed(3))) : false,
      stake: "0", taxOnStake: false, totalStake: "0", taxOnProfitOrReturn: false,
      showTotalStake: false, possibleWin: "0", finalPayout: false,
      expressBonusPercent: false, expressBonus: false
    }
  };
}

export function extractBookingId(data) {
  const direct = data?.share?.bookId;
  if (direct != null && String(direct).trim()) return String(direct);
  return data?.share?.bookingLink?.match(/bookingId=(\d+)/)?.[1] || null;
}

export async function createBooking({ site, selections, totalOdd }) {
  if (!configs[site] || !Array.isArray(selections) || selections.length < 1 || selections.length > 11) {
    throw new Error("Indica casa válida e entre 1 e 11 selecções.");
  }
  if (selections.some(s => !s || !s.home || !s.away || !s.selectionName || !s.marketName || !s.startTime)) {
    throw new Error("Cada selecção precisa de jogo, mercado, selecção e hora de início.");
  }
  const earliestKickoff = Date.now() + 6 * 60 * 60 * 1000;
  if (selections.some(s => !Number.isFinite(kickoffMillis(s.startTime)) || kickoffMillis(s.startTime) < earliestKickoff)) {
    throw new Error("Todas as partidas devem começar pelo menos 6 horas após a reserva.");
  }
  const payload = buildPayload(site, selections, totalOdd);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(configs[site].url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload), signal: controller.signal
    });
  } finally { clearTimeout(timeout); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`A casa recusou a criação da reserva (HTTP ${response.status}).`);
  const bookingId = extractBookingId(data);
  if (!bookingId) throw new Error("A casa não devolveu bookingId.");
  return {
    ok: true, site: configs[site].siteName, bookingId: String(bookingId),
    bookingLink: data.share?.bookingLink || configs[site].bookingBase + bookingId,
    shareTemplateLink: data.shareTemplateLink || null,
    totalOdd: Number(payload.betslip.totalOdds || selections[0].odd)
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }
  try {
    const result = await createBooking(req.body || {});
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.name === "AbortError" ? 504 : 400).json({
      ok: false, error: error.name === "AbortError" ? "Tempo esgotado ao contactar a casa." : error.message
    });
  }
}
