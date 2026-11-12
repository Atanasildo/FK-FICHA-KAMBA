import { buildTicketBatch } from "../tickets/builder.js";
import { createBooking } from "../../api/bookmakers/reserve.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }
  const pool = req.body?.pool;
  if (!Array.isArray(pool) || pool.length < 1 || pool.length > 500) {
    return res.status(400).json({ error: "Envia um pool entre 1 e 500 selecções validadas." });
  }

  let batch;
  try {
    batch = buildTicketBatch(pool, { publishedAt: req.body?.publishedAt || new Date().toISOString() });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (!batch.validation.valid) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ...batch,
      reservations: [],
      reservationStatus: "not_started",
      note: "O lote não cumpriu todos os mínimos; nenhuma reserva foi solicitada."
    });
  }

  const reservations = [];
  for (const slip of batch.slips) {
    const site = String(slip.bookmaker || "").toLowerCase().includes("elephant") ? "elephant"
      : String(slip.bookmaker || "").toLowerCase().includes("bantu") ? "bantu" : null;
    if (!site) {
      reservations.push({ tier: slip.tier, ok: false, error: "Casa de execução não identificada." });
      continue;
    }
    try {
      const booking = await createBooking({
        site,
        totalOdd: slip.total_odd,
        selections: slip.legs.map(leg => ({
          home: leg.home, away: leg.away, selectionName: leg.selectionName,
          marketName: leg.marketName, odd: leg.odd, startTime: leg.startTime,
          competition: leg.competition, base: leg.line == null ? "" : String(leg.line)
        }))
      });
      reservations.push({ tier: slip.tier, ...booking });
    } catch (error) {
      reservations.push({ tier: slip.tier, ok: false, site, error: error.message });
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ...batch,
    reservations,
    reservationStatus: reservations.every(item => item.ok) ? "complete" : "partial",
    note: "As reservas criam apenas links/IDs de partilha. Nenhuma aposta foi submetida e nenhum valor foi movimentado."
  });
}
