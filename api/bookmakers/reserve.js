import { createClient } from "@supabase/supabase-js";
import { createSwarmBooking, SWARM_BOOKMAKERS } from "../../lib/bookmakers/swarm.js";

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

export function extractBookingId(data) {
  const direct = data?.share?.bookId;
  if (direct != null && String(direct).trim()) return String(direct);
  return data?.share?.bookingLink?.match(/bookingId=(\d+)/)?.[1] || null;
}

export async function createBooking({ site, selections, totalOdd }) {
  if (!configs[site] || !Array.isArray(selections) || selections.length < 1) {
    throw new Error("Indica uma casa válida e pelo menos uma selecção.");
  }
  if (selections.some(s => !s || !s.selectionId || !(Number(s.odd) > 1))) {
    throw new Error("Cada selecção precisa de selectionId da casa e de uma odd decimal superior a 1.00.");
  }
  if (selections.some(s => s.startTime && !isKickoffEligible(s.startTime))) {
    throw new Error("Todas as partidas devem ainda não ter começado.");
  }
  const calculated = selections.reduce((acc, s) => acc * Number(s.odd), 1);
  if (totalOdd != null && Math.abs(Number(totalOdd) - calculated) > Math.max(0.02, calculated * 0.002)) {
    throw new Error("A odd total indicada não corresponde ao produto das odds individuais.");
  }
  const cfg = configs[site];
  if (cfg.maxOdd != null && calculated > cfg.maxOdd) throw new Error("A odd total excede o limite configurado para esta casa.");

  const swarm = SWARM_BOOKMAKERS[site];
  const result = await createSwarmBooking({
    siteId: swarm.siteId, wsUrl: swarm.wsUrl,
    selections: selections.map(s => ({ selectionId: s.selectionId, price: s.odd }))
  });
  return {
    ok: true, site: cfg.siteName, bookingId: result.bookingId,
    bookingLink: cfg.bookingBase + result.bookingId,
    shareTemplateLink: null,
    totalOdd: Number(calculated.toFixed(3))
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
    .select("id,title,status,total_odds,booking_reference,ticket_legs(id,market_id,selection_id,market_name,selection,odd,matches(home_team,away_team,competition,kickoff_at))")
    .eq("id", ticketId).maybeSingle();
  if (ticketError) throw new Error("Não foi possível ler a ficha: " + ticketError.message);
  if (!ticket || ticket.status !== "published") throw new Error("A ficha não existe ou não está publicada.");

  const existing = getExistingBooking(ticket.booking_reference);
  if (existing?.id && existing.status !== "creating") {
    return { ok: true, alreadyExists: true, bookingId: String(existing.id), bookingLink: existing.url || null, status: existing.status || "booking_created" };
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
    if (!leg.selection_id) throw new Error("Há selecções sem selection_id da casa; não é possível reservar esta ficha.");
    return {
      home: match.home_team, away: match.away_team, competition: match.competition || "",
      startTime: match.kickoff_at, marketName: leg.market_name, selectionName: leg.selection,
      odd: leg.odd, selectionId: leg.selection_id
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
      id: result.bookingId, url: result.bookingLink, status: "booking_created",
      site, createdAt: new Date().toISOString(), shareTemplateLink: result.shareTemplateLink
    });
    const { error: saveError } = await db.from("tickets").update({ booking_reference: reference })
      .eq("id", ticketId).eq("booking_reference", claim);
    if (saveError) throw new Error("O link foi criado, mas não foi possível guardá-lo: " + saveError.message);
    return { ...result, ticketId, status: "booking_created", message: "Reserva criada; isto não confirma uma aposta colocada." };
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
