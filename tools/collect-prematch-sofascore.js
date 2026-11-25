// Recolhe o pré-jogo (palpite do público, forma, confrontos) de hoje e amanhã. Corre no PC:
//   node tools/collect-prematch-sofascore.js [--max=150]
import { createClient } from "@supabase/supabase-js";
import { getSofascoreJson } from "./collect-live-sofascore.js";
import { collectPrematch } from "../lib/pipeline/prematch.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.error("Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const max = Number(process.argv.find(a => a.startsWith("--max="))?.split("=")[1] || 150);
const watch = process.argv.includes("--watch");
do {
  let wait = 3 * 3600 * 1000;
  try { await collectPrematch({ db, getJson: getSofascoreJson, max, log: m => console.log(`[${new Date().toLocaleTimeString("pt-PT")}] ${m}`) }); }
  catch (e) { console.error(`[${new Date().toLocaleTimeString("pt-PT")}] Parou: ${e.message}`); if (!watch) process.exit(1); wait = 30 * 60 * 1000; }
  if (watch) await new Promise(r => setTimeout(r, wait));
} while (watch);
