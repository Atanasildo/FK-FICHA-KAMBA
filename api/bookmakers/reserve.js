import { createClient } from "@supabase/supabase-js";

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

export function kickoffMillis(value) {
  if (!value) return NaN;
  const iso = Date.parse(value);
  if (Number.isFinite(iso)) return iso;
  const match = String(value).match(/^(\d{2})[./](\d{2})[./](\d{4}),?\s+(\d{2}):(\d{2})$/);
  if (!match) return NaN;
  const [, day, month, year, hour, minute] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 1, Number(minute));
}

export function isKickoffEligible(value, now = Date.now()) {
  const kickoff = kickoffMillis(value);
  return Number.isFinite(kickoff) && kickoff > now;
}

function buildPayload(site, selections, suppliedTotal) {
  const cfg = configs[site];
  const events = selections.map(s => {
    const odd = Number(s.odd);
    if (!Number.isFinite(odd) || odd <= 1) throw new Error("Cada selecção deve ter uma odd decimal válida superior a 1.00.");
    return {
      finalPayoutFormatted: false, isLive: s.isLive ? 1 : 0, price: String(odd),
      stake: "0", taxOnStake: false, totalStake: "0", taxOnProfitOrReturn: false,
      showTotalStake: false, possibleWin: "0", finalPayout: false,
      ...(site === "elephant" ? { betBuilderEvent: true } : {}),
      childrenEvents: [], startTime: s.startTime || "", team1Name: s.home || "",
      team2Name: s.away || "", eventName: s.selectionName || "",
      competitionName: s.competition || "", regionName: s.region || "",
      base: s.base ?? null, sportAlias: "Soccer", marketName: s.marketName || "",
      incInSysCalc: false
    };
  });
  const calculated = events.reduce((acc, e) => acc * Number(e.price), 1);
  if (suppliedTotal != null && Math.abs(Number(suppliedTotal) - calculated) > Math.max(0.02, calculated * 0.002)) {
    throw new Error("A odd total indicada não corresponde ao produto das odds individuais.");
  }
  if (cfg.maxOdd != null && calculated > cfg.maxOdd) throw new Error("A odd total excede o limite configurado para esta casa.");
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
  if (!configs[site] || !Array.isArray(selections) || selections.length < 1) {
    throw new Error("Indica uma casa válida e pelo menos uma selecção.");
  }
  if (selections.some(s => !s || !s.home || !s.away || !s.selectionName || !s.marketName || !s.startTime)) {
    throw new Error("Cada selecção precisa de jogo, mercado, selecção e hora de início.");
  }
  if (selections.some(s => !isKickoffEligible(s.startTime))) {
    throw new Error("Todas as partidas devem ainda não ter começado.");
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
  if (!response.ok) throw new Error(`A casa recusou a criação da partilha (HTTP ${response.status}).`);
  const bookingId = extractBookingId(data);
  if (!bookingId) throw new Error("A casa não devolveu bookingId.");
  return {
    ok: true, site: configs[site].siteName, bookingId: String(bookingId),
    bookingLink: data.share?.bookingLink || configs[site].bookingBase + bookingId,
    shareTemplateLink: data.shareTemplateLink || null,
    totalOdd: Number(payload.betslip.totalOdds || selections[0].odd)
  };
}

function getExistingBooking(reference) {
  if (!reference) return null;
  try {
    const parsed = JSON.parse(reference);
    return parsed && typeof parsed === "object" ? parsed : { id: String(reference) };
  } catch {
    return { id: String(reference) };
  }
}

async function createBookingForTicket(ticketId, requestedSite) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Configuração privada do Supabase em falta.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: ticket, error: ticketError } = await db.from("tickets")
    .select("id,title,status,total_odds,booking_reference,ticket_legs(id,market_id,market_name,selection,odd,matches(home_team,away_team,competition,kickoff_at))")
    .eq("id", ticketId).maybeSingle();
  if (ticketError) throw new Error("Não foi possível ler a ficha: " + ticketError.message);
  if (!ticket || ticket.status !== "published") throw new Error("A ficha não existe ou não está publicada.");

  const existing = getExistingBooking(ticket.booking_reference);
  if (existing?.id && existing.status !== "creating") {
    return { ok: true, alreadyExists: true, bookingId: String(existing.id), bookingLink: existing.url || null, status: existing.status || "share_link_created" };
  }
  if (existing?.status === "creating") throw new Error("Já existe um pedido de partilha em processamento para esta ficha.");

  const siteFromTitle = /elephant/i.test(ticket.title) ? "elephant" : /bantu/i.test(ticket.title) ? "bantu" : null;
  const site = requestedSite || siteFromTitle;
  if (!site || site !== siteFromTitle) throw new Error("A casa indicada não corresponde à versão desta ficha.");
  if (!Array.isArray(ticket.ticket_legs) || !ticket.ticket_legs.length) throw new Error("A ficha não tem selecções.");

  const marketIds = [...new Set(ticket.ticket_legs.map(leg => leg.market_id).filter(Boolean))];
  if (marketIds.length !== ticket.ticket_legs.length) throw new Error("Há selecções sem mercado de origem; não é seguro criar a partilha.");
  const { data: markets, error: marketsError } = await db.from("markets")
    .select("id,line,period,selection,market_name,bookmaker_id").in("id", marketIds);
  if (marketsError) throw new Error("Não foi possível validar os mercados: " + marketsError.message);
  const marketById = new Map((markets || []).map(m => [m.id, m]));
  const bookmakerIds = [...new Set((markets || []).map(m => m.bookmaker_id).filter(Boolean))];
  const { data: bookmakers, error: bookmakersError } = await db.from("bookmakers")
    .select("id,code,name").in("id", bookmakerIds);
  if (bookmakersError) throw new Error("Não foi possível validar a casa de apostas: " + bookmakersError.message);
  const bookmakerById = new Map((bookmakers || []).map(b => [b.id, b]));
  const expectedCode = site === "elephant" ? "elephantbet" : "bantubet";

  const selections = ticket.ticket_legs.map(leg => {
    const market = marketById.get(leg.market_id);
    const bookmaker = market && bookmakerById.get(market.bookmaker_id);
    const match = leg.matches || {};
    if (!market || !bookmaker || String(bookmaker.code).toLowerCase() !== expectedCode) {
      throw new Error("Uma ou mais selecções não pertencem à casa indicada.");
    }
    if (!match.home_team || !match.away_team || !match.kickoff_at) throw new Error("Há um jogo sem equipas ou hora de início.");
    return {
      home: match.home_team, away: match.away_team, competition: match.competition || "",
      startTime: match.kickoff_at, marketName: leg.market_name, selectionName: leg.selection,
      odd: leg.odd, base: null, isLive: false
    };
  });

  const claim = JSON.stringify({ status: "creating", startedAt: new Date().toISOString() });
  const { data: claimed, error: claimError } = await db.from("tickets").update({ booking_reference: claim })
    .eq("id", ticketId).is("booking_reference", null).select("id").maybeSingle();
  if (claimError) throw new Error("Não foi possível reservar o processamento: " + claimError.message);
  if (!claimed) throw new Error("A ficha já tem uma referência ou outro pedido está em processamento.");

  try {
    const result = await createBooking({ site, selections, totalOdd: ticket.total_odds });
    const reference = JSON.stringify({
      id: result.bookingId, url: result.bookingLink, status: "share_link_created",
      site, createdAt: new Date().toISOString(), shareTemplateLink: result.shareTemplateLink
    });
    const { error: saveError } = await db.from("tickets").update({ booking_reference: reference })
      .eq("id", ticketId).eq("booking_reference", claim);
    if (saveError) throw new Error("O link foi criado, mas não foi possível guardá-lo: " + saveError.message);
    return { ...result, ticketId, status: "share_link_created", message: "Link de partilha criado; isto não confirma uma aposta colocada." };
  } catch (error) {
    await db.from("tickets").update({ booking_reference: null }).eq("id", ticketId).eq("booking_reference", claim);
    throw error;
  }
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
    const body = req.body || {};
    const result = body.ticketId
      ? await createBookingForTicket(String(body.ticketId), body.site)
      : await createBooking(body);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.name === "AbortError" ? 504 : 400).json({
      ok: false, error: error.name === "AbortError" ? "Tempo esgotado ao contactar a casa." : error.message
    });
  }
}
