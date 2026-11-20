const HOUSES = new Set(["bantu", "elephant"]);

// O ID do jogo no Swarm é o número no fim do external_id ("vascodagama-internacional-1994586").
export function swarmGameId(externalId) {
  const match = String(externalId || "").match(/(\d+)$/);
  return match ? match[1] : null;
}

export function ticketHouse(ticket) {
  try {
    const parsed = JSON.parse(ticket.booking_reference || "null");
    if (parsed && HOUSES.has(parsed.site)) return parsed.site;
  } catch { /* texto simples */ }
  if (/elephant/i.test(ticket.title || "")) return "elephant";
  if (/bantu/i.test(ticket.title || "")) return "bantu";
  return null;
}

const round2 = value => Math.round(value * 100) / 100;

// Cruza as pernas de uma ficha com os jogos recolhidos da casa e devolve as actualizações a gravar.
// Jogo recebido sem a selecção = suspensa; jogo não recebido = não mexe (sem informação nova).
export function computeOddUpdates({ ticket, game, checkedAt }) {
  const prices = new Map();
  for (const market of game?.markets || []) for (const sel of market.selections) prices.set(String(sel.id), sel.odd);
  const legs = [];
  for (const leg of ticket.ticket_legs || []) {
    if (!game || !leg.selection_id) continue;
    const price = prices.get(String(leg.selection_id));
    legs.push(price != null
      ? { id: leg.id, current_odd: round2(price), odd_state: "open", current_odd_at: checkedAt }
      : { id: leg.id, current_odd: null, odd_state: "suspended", current_odd_at: checkedAt });
  }
  return legs;
}

export function totalFromLegs(ticketLegs, updatesById) {
  let total = 1;
  for (const leg of ticketLegs) {
    const update = updatesById.get(leg.id);
    const odd = update ? update.current_odd : leg.current_odd;
    if (!odd) return null;
    total *= Number(odd);
  }
  return ticketLegs.length ? round2(total) : null;
}

const CHUNK = 25;

// Um ciclo: lê as fichas publicadas, pede à casa as odds actuais dos jogos que ainda não começaram
// e grava a odd actual em cada perna e o total actual em cada ficha.
export async function refreshLegOdds({ db, collect, now = Date.now(), log = () => {} }) {
  const { SWARM_BOOKMAKERS, collectSwarm } = await import("../bookmakers/swarm.js");
  collect = collect || collectSwarm;
  const { data: tickets, error } = await db.from("tickets")
    .select("id,title,booking_reference,ticket_legs(id,selection_id,current_odd,matches(external_id,kickoff_at))")
    .eq("status", "published");
  if (error) throw new Error("Não foi possível ler as fichas: " + error.message);

  const byHouse = new Map();
  for (const ticket of tickets || []) {
    const house = ticketHouse(ticket);
    if (!house) continue;
    const upcoming = (ticket.ticket_legs || []).some(leg => leg.matches && Date.parse(leg.matches.kickoff_at) > now);
    if (!upcoming) continue;
    if (!byHouse.has(house)) byHouse.set(house, []);
    byHouse.get(house).push(ticket);
  }

  const summary = { houses: 0, legs: 0, tickets: 0, suspended: 0 };
  for (const [house, list] of byHouse) {
    const ids = new Set();
    for (const ticket of list) for (const leg of ticket.ticket_legs || []) {
      const id = swarmGameId(leg.matches?.external_id);
      if (id && Date.parse(leg.matches.kickoff_at) > now) ids.add(id);
    }
    const games = new Map();
    const idList = [...ids];
    for (let i = 0; i < idList.length; i += CHUNK) {
      try {
        const result = await collect({ ...SWARM_BOOKMAKERS[house], gameIds: idList.slice(i, i + CHUNK), timeoutMs: 20000 });
        for (const game of result.games) games.set(String(game.id), game);
      } catch (e) { log(`Odds ${house}: falha num lote (${e.message}).`); }
    }
    if (!games.size) continue;
    summary.houses++;
    const checkedAt = new Date(now).toISOString();
    for (const ticket of list) {
      const updates = [];
      for (const leg of ticket.ticket_legs || []) {
        const started = Date.parse(leg.matches?.kickoff_at) <= now;
        const game = started ? null : games.get(swarmGameId(leg.matches?.external_id));
        updates.push(...computeOddUpdates({ ticket: { ticket_legs: [leg] }, game, checkedAt }));
      }
      if (!updates.length) continue;
      for (const update of updates) {
        const { id, ...fields } = update;
        const { error: writeError } = await db.from("ticket_legs").update(fields).eq("id", id);
        if (writeError) throw new Error("Não foi possível gravar a odd actual: " + writeError.message);
      }
      summary.legs += updates.length;
      summary.suspended += updates.filter(u => u.odd_state === "suspended").length;
      const byId = new Map(updates.map(u => [u.id, u]));
      const total = totalFromLegs(ticket.ticket_legs || [], byId);
      const { error: totalError } = await db.from("tickets")
        .update({ current_total_odds: total, current_odds_at: checkedAt }).eq("id", ticket.id);
      if (totalError) throw new Error("Não foi possível gravar o total actual: " + totalError.message);
      summary.tickets++;
    }
  }
  return summary;
}
