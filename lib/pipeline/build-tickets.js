import { createClient } from "@supabase/supabase-js";
import { buildTicketBatch } from "../tickets/builder.js";
import { createBooking } from "../../api/bookmakers/reserve.js";

const json = (res, status, body) => res.status(status).json(body);

function safeBookingUrl(reservation, bookmaker) {
  if (!reservation?.bookingLink) return null;
  try {
    const url = new URL(reservation.bookingLink);
    const host = url.hostname.toLowerCase();
    const expected = String(bookmaker || "").toLowerCase().includes("elephant")
      ? host === "elephantbet.co.ao" || host.endsWith(".elephantbet.co.ao")
      : host === "bantubet.co.ao" || host.endsWith(".bantubet.co.ao");
    return url.protocol === "https:" && expected ? url.toString() : null;
  } catch {
    return null;
  }
}

async function publishBatch(batch, reservations) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) throw new Error("Configuração segura do Supabase incompleta; nenhuma ficha foi publicada.");

  const reservationByGroup = new Map();
  reservations.forEach((reservation, index) => {
    const slip = batch.slips[index];
    if (!slip) return;
    if (!reservationByGroup.has(slip.shared_ticket_id)) reservationByGroup.set(slip.shared_ticket_id, []);
    reservationByGroup.get(slip.shared_ticket_id).push({ slip, reservation });
  });

  // Só publicamos um grupo quando as duas casas devolveram bookingId.
  const completeGroups = [...reservationByGroup.values()].filter(items =>
    items.length === 2 &&
    new Set(items.map(item => item.slip.bookmaker)).size === 2 &&
    items.every(item => item.reservation?.ok && item.reservation?.bookingId)
  );
  if (!completeGroups.length) return [];

  const fixtureIds = [...new Set(completeGroups.flatMap(items =>
    items.flatMap(({ slip }) => slip.legs.map(leg => String(leg.event_id)))
  ))];
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: matches, error: matchError } = await admin
    .from("matches").select("id,external_id").eq("source", "SportAPI").in("external_id", fixtureIds);
  if (matchError) throw new Error("Não foi possível confirmar os jogos na base de dados: " + matchError.message);

  const matchMap = new Map((matches || []).map(match => [String(match.external_id), match.id]));
  const missing = fixtureIds.filter(id => !matchMap.has(id));
  if (missing.length) throw new Error("Não foram encontrados na tabela matches os jogos: " + missing.join(", "));

  const published = [];
  for (const items of completeGroups) {
    const groupPublished = [];
    try {
      for (const { slip, reservation } of items) {
        const publishedAt = new Date().toISOString();
        const { data: ticket, error: ticketError } = await admin.from("tickets").insert({
          shared_ticket_id: slip.shared_ticket_id,
          title: `FK · ${slip.tier.charAt(0).toUpperCase() + slip.tier.slice(1)} · ${slip.bookmaker} · ${new Date(publishedAt).toLocaleDateString("pt-AO")}`,
          status: "published",
          total_odds: slip.total_odd,
          booking_reference: JSON.stringify({
            id: String(reservation.bookingId),
            url: safeBookingUrl(reservation, slip.bookmaker)
          }),
          published_at: publishedAt,
          updated_at: publishedAt
        }).select("id,title,status,total_odds,booking_reference,published_at,shared_ticket_id").single();
        if (ticketError) throw new Error("Falha ao publicar a ficha " + slip.tier + " (" + slip.bookmaker + "): " + ticketError.message);

        const legs = slip.legs.map(leg => ({
          ticket_id: ticket.id,
          match_id: matchMap.get(String(leg.event_id)),
          market_name: leg.line == null ? leg.market : `${leg.market} (${leg.line})`,
          selection: leg.selection,
          odd: leg.odd
        }));
        const { error: legsError } = await admin.from("ticket_legs").insert(legs);
        if (legsError) {
          await admin.from("tickets").delete().eq("id", ticket.id);
          throw new Error("Falha ao guardar as selecções da ficha " + slip.tier + " (" + slip.bookmaker + "): " + legsError.message);
        }
        groupPublished.push({ ...ticket, legs: legs.length, reservation: reservation.bookingLink || null });
      }
      published.push(...groupPublished);
    } catch (error) {
      const createdIds = [...published, ...groupPublished].map(ticket => ticket.id);
      if (createdIds.length) await admin.from("tickets").delete().in("id", createdIds);
      throw error;
    }
  }
  return published;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Método não permitido." });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return json(res, 401, { error: "Não autorizado." });
  }
  const pool = req.body?.pool;
  if (!Array.isArray(pool) || pool.length < 1 || pool.length > 500) {
    return json(res, 400, { error: "Envia um pool entre 1 e 500 selecções validadas." });
  }

  let batch;
  try {
    batch = buildTicketBatch(pool, { publishedAt: req.body?.publishedAt || new Date().toISOString() });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
  if (!batch.validation.valid) {
    res.setHeader("Cache-Control", "no-store");
    return json(res, 200, {
      ...batch, reservations: [], publishedTickets: [],
      reservationStatus: "not_started",
      note: "O lote não cumpriu todos os mínimos; nenhuma reserva ou publicação foi solicitada."
    });
  }

  const reservations = new Array(batch.slips.length);
  let reservationCursor = 0;
  const reservationWorkers = Array.from(
    { length: Math.min(3, batch.slips.length) },
    async () => {
      while (true) {
        const index = reservationCursor++;
        if (index >= batch.slips.length) return;
        const slip = batch.slips[index];
        const site = String(slip.bookmaker || "").toLowerCase().includes("elephant") ? "elephant"
          : String(slip.bookmaker || "").toLowerCase().includes("bantu") ? "bantu" : null;
        if (!site) {
          reservations[index] = { tier: slip.tier, ok: false, error: "Casa de execução não identificada." };
          continue;
        }
        try {
          const booking = await createBooking({
            site,
            totalOdd: slip.total_odd,
            selections: slip.legs.map(leg => ({
              home: leg.home, away: leg.away, selectionName: leg.selection,
              marketName: leg.marketName, odd: leg.odd, startTime: leg.startTime,
              competition: leg.competition, base: leg.line == null ? "" : String(leg.line)
            }))
          });
          reservations[index] = { tier: slip.tier, shared_ticket_id: slip.shared_ticket_id, ...booking };
        } catch (error) {
          reservations[index] = { tier: slip.tier, shared_ticket_id: slip.shared_ticket_id, ok: false, site, error: error.message };
        }
      }
    }
  );
  await Promise.all(reservationWorkers);

  let publishedTickets;
  try {
    publishedTickets = await publishBatch(batch, reservations);
  } catch (error) {
    return json(res, 500, {
      ...batch, reservations, publishedTickets: [],
      reservationStatus: reservations.every(item => item?.ok) ? "complete" : "partial",
      publicationStatus: "failed", error: error.message,
      note: "As reservas podem ter sido criadas, mas a publicação do par não foi concluída. Nenhuma aposta foi submetida nem dinheiro movimentado."
    });
  }

  res.setHeader("Cache-Control", "no-store");
  const completeGroups = new Set(publishedTickets.map(ticket => ticket.shared_ticket_id)).size;
  return json(res, 200, {
    ...batch, reservations, publishedTickets,
    reservationStatus: reservations.every(item => item?.ok) ? "complete" : "partial",
    publicationStatus: publishedTickets.length ? "published" : "not_published",
    publishedSharedGroups: completeGroups,
    note: "Cada grupo publicado contém as mesmas selecções nas duas casas, com odds e bookingId próprios. Só é publicado quando ambas as reservas são confirmadas. Nenhuma aposta foi submetida e nenhum valor foi movimentado."
  });
}
