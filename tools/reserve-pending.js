// Pede o código de reserva (create_bet_book_v2) dos boletins publicados que ainda não o têm.
// Corre no PC local porque o Swarm das casas recusa os servidores da Vercel (HTTP 403).
// Fala com a API (GET/POST /api/bookmakers/reserve); não precisa de chaves do Supabase.
//
//   CRON_SECRET=... node tools/reserve-pending.js --once      (uma passagem)
//   CRON_SECRET=... node tools/reserve-pending.js --watch     (a cada 2 minutos)
//
// FK_RESERVE_URL (opcional) muda o endereço; por defeito usa a produção.
// Cria só o código de reserva (Amount 0); não coloca apostas nem movimenta dinheiro.
import { createBooking } from "../api/bookmakers/reserve.js";

const base = (process.env.FK_RESERVE_URL || "https://fk-ficha-kamba.vercel.app").replace(/\/$/, "");
const endpoint = base + "/api/bookmakers/reserve";

function headers() {
  const h = { "content-type": "application/json", authorization: "Bearer " + process.env.CRON_SECRET };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) h["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return h;
}
async function call(method, body) {
  const r = await fetch(endpoint, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status });
  return data;
}

export async function reservePass(log = console.log) {
  const { pending, skipped } = await call("GET");
  let reserved = 0;
  for (const t of pending) {
    try { await call("POST", { action: "claim", ticketId: t.id }); }
    catch (e) { log(`SALTA  ${t.title} -> ${e.message}`); continue; }
    try {
      const result = await createBooking({ site: t.site, totalOdd: t.totalOdds, selections: t.selections.map(s => ({ ...s })) });
      await call("POST", { action: "save", ticketId: t.id, bookingId: result.bookingId });
      log(`OK     ${t.title} -> ${result.bookingId}`);
      reserved++;
    } catch (e) {
      await call("POST", { action: "release", ticketId: t.id }).catch(() => {});
      log(`ERRO   ${t.title} -> ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return { reserved, pending: pending.length - reserved, skipped: skipped.length };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  if (!process.env.CRON_SECRET) { console.error("Falta CRON_SECRET no ambiente."); process.exit(1); }
  const watch = process.argv.includes("--watch");
  let failed = false;
  do {
    try {
      const r = await reservePass();
      console.log(`[${new Date().toLocaleTimeString("pt-PT")}] reservados: ${r.reserved} | por reservar: ${r.pending} | saltados: ${r.skipped}`);
      failed = false;
    } catch (e) { console.error("Falha:", e.message); failed = true; }
    if (watch) await new Promise(r => setTimeout(r, 120000));
  } while (watch);
  if (failed) process.exit(1);
}
