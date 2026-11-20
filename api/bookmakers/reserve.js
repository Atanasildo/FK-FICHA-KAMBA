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

const siteOf = title => /elephant/i.test(title || "") ? "elephant" : /bantu/i.test(title || "") ? "bantu" : null;

// Decide, sem tocar na rede, que boletins podem ser reservados agora: todas as selecções com
// selection_id numérico e nenhum jogo já iniciado.
export function pickReservable(tickets, now = Date.now()) {
  const ready = [], skipped = [];
  for (const t of tickets || []) {
    const legs = t.ticket_legs || [];
    const site = siteOf(t.title);
    let reason = null;
    if (!site) reason = "casa não identificada no título";
    else if (!legs.length) reason = "sem selecções";
    else if (legs.some(l => !/^\d+$/.test(String(l.selection_id ?? "")))) reason = "faltam selection_id";
    else if (legs.some(l => !l.matches?.kickoff_at || Date.parse(l.matches.kickoff_at) <= now)) reason = "há jogos já iniciados";
    if (reason) skipped.push({ id: t.id, title: t.title, reason });
    else ready.push({ ticket: t, site });
  }
  return { ready, skipped };
}

function parseReference(reference) {
  if (!reference) return null;
  try { const parsed = JSON.parse(reference); return parsed && typeof parsed === "object" ? parsed : { id: String(reference) }; }
  catch { return { id: String(reference) }; }
}

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Configuração privada do Supabase em falta.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// O Swarm das casas recusa os servidores da Vercel (HTTP 403), por isso a reserva é pedida a partir
// do PC local (tools/reserve-pending.js). Este endpoint só lista o que falta reservar e grava o código.
//   GET  -> boletins por reservar
//   POST { action: "claim" | "save" | "release", ticketId, bookingId? }
export async function listPending(db, now = Date.now()) {
  const since = new Date(now - 36 * 3600 * 1000).toISOString();
  const { data, error } = await db.from("tickets")
    .select("id,title,total_odds,booking_reference,ticket_legs(selection_id,odd,matches(kickoff_at))")
    .eq("status", "published").is("booking_reference", null).gte("published_at", since);
  if (error) throw new Error("Não foi possível ler os boletins: " + error.message);
  const { ready, skipped } = pickReservable(data, now);
  return {
    pending: ready.map(({ ticket, site }) => ({
      id: ticket.id, title: ticket.title, site, totalOdds: Number(ticket.total_odds),
      selections: ticket.ticket_legs.map(l => ({ selectionId: String(l.selection_id), odd: Number(l.odd), startTime: l.matches.kickoff_at }))
    })),
    skipped
  };
}

export async function applyAction(db, { action, ticketId, bookingId }) {
  if (!ticketId) throw Object.assign(new Error("Falta ticketId."), { status: 400 });
  const { data: ticket, error } = await db.from("tickets").select("id,title,status,booking_reference").eq("id", ticketId).maybeSingle();
  if (error) throw new Error("Não foi possível ler a ficha: " + error.message);
  if (!ticket || ticket.status !== "published") throw Object.assign(new Error("A ficha não existe ou não está publicada."), { status: 404 });
  const current = ticket.booking_reference;
  const parsed = parseReference(current);

  if (action === "claim") {
    if (current) throw Object.assign(new Error("A ficha já tem uma referência ou está em processamento."), { status: 409 });
    const claim = JSON.stringify({ status: "creating", startedAt: new Date().toISOString() });
    const { data: claimed, error: e } = await db.from("tickets").update({ booking_reference: claim }).eq("id", ticketId).is("booking_reference", null).select("id").maybeSingle();
    if (e) throw new Error("Não foi possível reservar o processamento: " + e.message);
    if (!claimed) throw Object.assign(new Error("Outro pedido ficou com esta ficha."), { status: 409 });
    return { ok: true, status: "creating" };
  }
  if (parsed?.status !== "creating") throw Object.assign(new Error("A ficha não está em processamento."), { status: 409 });

  if (action === "release") {
    await db.from("tickets").update({ booking_reference: null }).eq("id", ticketId).eq("booking_reference", current);
    return { ok: true, status: "released" };
  }
  if (action === "save") {
    const site = siteOf(ticket.title);
    if (!site) throw Object.assign(new Error("Casa não identificada no título da ficha."), { status: 400 });
    if (!/^\d{3,12}$/.test(String(bookingId ?? ""))) throw Object.assign(new Error("bookingId inválido."), { status: 400 });
    const reference = JSON.stringify({
      id: String(bookingId), url: configs[site].bookingBase + bookingId,
      status: "booking_created", site, createdAt: new Date().toISOString()
    });
    const { error: e } = await db.from("tickets").update({ booking_reference: reference }).eq("id", ticketId).eq("booking_reference", current);
    if (e) throw new Error("Não foi possível gravar o código: " + e.message);
    return { ok: true, status: "booking_created", bookingId: String(bookingId) };
  }
  throw Object.assign(new Error("Acção desconhecida."), { status: 400 });
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Método não permitido." });
  }
  try {
    const db = adminClient();
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") return res.status(200).json({ ok: true, ...(await listPending(db)) });
    return res.status(200).json(await applyAction(db, req.body || {}));
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message });
  }
}
