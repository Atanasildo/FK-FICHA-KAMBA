// Pede o código de reserva (create_bet_book_v2) para os boletins publicados que ainda não o têm.
// Corre no PC local: o Swarm das casas recusa os servidores da Vercel (HTTP 403).
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node tools/reserve-pending.js           (uma vez)
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node tools/reserve-pending.js --watch   (a cada 2 min)
//
// Cria só o código de reserva (Amount 0); não coloca apostas nem movimenta dinheiro.
import { createClient } from "@supabase/supabase-js";
import { createBooking } from "../api/bookmakers/reserve.js";

const siteOf = title => /elephant/i.test(title) ? "elephant" : /bantu/i.test(title) ? "bantu" : null;

// Devolve { ready, skipped } sem tocar na rede. Só reserva quando TODAS as selecções têm
// selection_id numérico e nenhum jogo já começou.
export function pickReservable(tickets, now = Date.now()) {
  const ready = [], skipped = [];
  for (const t of tickets || []) {
    const legs = t.ticket_legs || [];
    const site = siteOf(t.title || "");
    let reason = null;
    if (!site) reason = "casa não identificada no título";
    else if (!legs.length) reason = "sem selecções";
    else if (legs.some(l => !/^\d+$/.test(String(l.selection_id ?? "")))) reason = "faltam selection_id";
    else if (legs.some(l => !l.matches?.kickoff_at || Date.parse(l.matches.kickoff_at) <= now)) reason = "há jogos já iniciados";
    (reason ? skipped : ready).push(reason ? { id: t.id, title: t.title, reason } : { ticket: t, site });
  }
  return { ready, skipped };
}

export async function reservePending(db, { now = Date.now(), log = console.log } = {}) {
  const since = new Date(now - 36 * 3600 * 1000).toISOString();
  const { data, error } = await db.from("tickets")
    .select("id,title,total_odds,booking_reference,ticket_legs(selection_id,odd,matches(kickoff_at))")
    .eq("status", "published").is("booking_reference", null).gte("published_at", since);
  if (error) throw new Error("Não foi possível ler os boletins: " + error.message);

  const { ready, skipped } = pickReservable(data, now);
  for (const s of skipped) log(`SALTA  ${s.title} -> ${s.reason}`);
  const done = [];
  for (const { ticket, site } of ready) {
    const claim = JSON.stringify({ status: "creating", startedAt: new Date().toISOString() });
    const { data: claimed, error: claimError } = await db.from("tickets")
      .update({ booking_reference: claim }).eq("id", ticket.id).is("booking_reference", null).select("id").maybeSingle();
    if (claimError || !claimed) { log(`SALTA  ${ticket.title} -> já em processamento`); continue; }
    try {
      const result = await createBooking({
        site, totalOdd: ticket.total_odds,
        selections: ticket.ticket_legs.map(l => ({ selectionId: l.selection_id, odd: Number(l.odd), startTime: l.matches.kickoff_at }))
      });
      const reference = JSON.stringify({ id: result.bookingId, url: result.bookingLink, status: "booking_created", site, createdAt: new Date().toISOString() });
      const { error: saveError } = await db.from("tickets").update({ booking_reference: reference }).eq("id", ticket.id).eq("booking_reference", claim);
      if (saveError) throw new Error("código criado (" + result.bookingId + ") mas não gravado: " + saveError.message);
      log(`OK     ${ticket.title} -> ${result.bookingId}`);
      done.push({ id: ticket.id, bookingId: result.bookingId });
    } catch (e) {
      await db.from("tickets").update({ booking_reference: null }).eq("id", ticket.id).eq("booking_reference", claim);
      log(`ERRO   ${ticket.title} -> ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return { reserved: done.length, skipped: skipped.length, pending: ready.length - done.length };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) { console.error("Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const watch = process.argv.includes("--watch");
  do {
    try { const r = await reservePending(db); console.log(`[${new Date().toLocaleTimeString("pt-PT")}] reservados: ${r.reserved} | por reservar: ${r.pending} | saltados: ${r.skipped}`); }
    catch (e) { console.error("Falha:", e.message); }
    if (watch) await new Promise(r => setTimeout(r, 120000));
  } while (watch);
}
