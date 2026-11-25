import { createClient } from "@supabase/supabase-js";
import { buildTicketBatch } from "../tickets/builder.js";

const json = (res, status, body) => res.status(status).json(body);

async function publishBatch(batch) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) throw new Error("Configuração segura do Supabase incompleta; nenhuma ficha foi publicada.");

  // A reserva (create_bet_book_v2) é pedida a partir do PC local (tools/reserve-pending.js),
  // porque o Swarm recusa os servidores da Vercel (HTTP 403). Aqui só publicamos pares completos.
  const byGroup = new Map();
  for (const slip of batch.slips) {
    if (!byGroup.has(slip.shared_ticket_id)) byGroup.set(slip.shared_ticket_id, []);
    byGroup.get(slip.shared_ticket_id).push({ slip });
  }
  const completeGroups = [...byGroup.values()].filter(items =>
    items.length === 2 && new Set(items.map(item => item.slip.bookmaker)).size === 2 &&
    items.every(item => item.slip.legs.every(leg => /^\d+$/.test(String(leg.selection_id))))
  );
  if (!completeGroups.length) return [];

  const fixtureIds = [...new Set(completeGroups.flatMap(items =>
    items.flatMap(({ slip }) => slip.legs.map(leg => String(leg.event_id)))
  ))];
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: matches, error: matchError } = await admin
    .from("matches").select("id,external_id").eq("source", "swarm").in("external_id", fixtureIds);
  if (matchError) throw new Error("Não foi possível confirmar os jogos na base de dados: " + matchError.message);

  const matchMap = new Map((matches || []).map(match => [String(match.external_id), match.id]));
  const missing = fixtureIds.filter(id => !matchMap.has(id));
  if (missing.length) throw new Error("Não foram encontrados na tabela matches os jogos: " + missing.join(", "));

  // O campeonato vem da análise de cada selecção; grava-o no jogo para o site o mostrar em cada perna.
  const competitionByFixture = new Map();
  for (const items of completeGroups) for (const { slip } of items) for (const leg of slip.legs) {
    if (leg.competition && !competitionByFixture.has(String(leg.event_id))) competitionByFixture.set(String(leg.event_id), String(leg.competition).trim());
  }
  for (const [fixtureId, competition] of competitionByFixture) {
    const { error: competitionError } = await admin.from("matches")
      .update({ competition }).eq("id", matchMap.get(fixtureId)).is("competition", null);
    if (competitionError) console.warn("Não foi possível gravar o campeonato do jogo " + fixtureId + ": " + competitionError.message);
  }

  const published = [];
  for (const items of completeGroups) {
    const groupPublished = [];
    try {
      for (const { slip } of items) {
        const publishedAt = new Date().toISOString();
        const { data: ticket, error: ticketError } = await admin.from("tickets").insert({
          shared_ticket_id: slip.shared_ticket_id,
          title: `FK · ${{ alta: "100x–10.000x", mega: "1000x+", mediaAlta: "30x–70x", media: "25x–50x" }[slip.tier] || slip.tier} · ${slip.bookmaker} · ${new Date(publishedAt).toLocaleDateString("pt-AO")}`,
          status: "published",
          total_odds: slip.total_odd,
          booking_reference: null,
          published_at: publishedAt,
          updated_at: publishedAt
        }).select("id,title,status,total_odds,booking_reference,published_at,shared_ticket_id").single();
        if (ticketError) throw new Error("Falha ao publicar a ficha " + slip.tier + " (" + slip.bookmaker + "): " + ticketError.message);

        const legs = slip.legs.map(leg => ({
          ticket_id: ticket.id,
          match_id: matchMap.get(String(leg.event_id)),
          market_name: leg.line == null ? leg.market : `${leg.market} (${leg.line})`,
          selection: leg.selection,
          odd: leg.odd,
          selection_id: leg.selection_id == null ? null : String(leg.selection_id)
        }));
        const { error: legsError } = await admin.from("ticket_legs").insert(legs);
        if (legsError) {
          await admin.from("tickets").delete().eq("id", ticket.id);
          throw new Error("Falha ao guardar as selecções da ficha " + slip.tier + " (" + slip.bookmaker + "): " + legsError.message);
        }
        groupPublished.push({ ...ticket, legs: legs.length, reservation: null });
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
      ...batch, publishedTickets: [],
      reservationStatus: "not_started",
      note: "O lote não cumpriu todos os mínimos; nenhuma reserva ou publicação foi solicitada."
    });
  }

  let publishedTickets;
  try {
    publishedTickets = await publishBatch(batch);
  } catch (error) {
    return json(res, 500, {
      ...batch, publishedTickets: [],
      publicationStatus: "failed", error: error.message,
      note: "A publicação do par não foi concluída. Nenhuma aposta foi submetida nem dinheiro movimentado."
    });
  }

  res.setHeader("Cache-Control", "no-store");
  const completeGroups = new Set(publishedTickets.map(ticket => ticket.shared_ticket_id)).size;
  return json(res, 200, {
    ...batch, publishedTickets,
    reservationStatus: "pending_local",
    publicationStatus: publishedTickets.length ? "published" : "not_published",
    publishedSharedGroups: completeGroups,
    note: "Cada grupo publicado contém as mesmas selecções nas duas casas, com as odds de cada casa. O código de reserva é pedido logo a seguir, a partir do PC local (npm run reserve:pending). Nenhuma aposta foi submetida e nenhum valor foi movimentado."
  });
}
