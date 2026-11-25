// Lê páginas de previsões de sites públicos e liga-as aos jogos da base (match_statistics, source "site:<nome>").
//   node tools\collect-prediction-sites.js --dry     (só mostra o que encontrou, não grava)
//   node tools\collect-prediction-sites.js           (grava)   |  --watch repete de 3 em 3 horas
import { execFile } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { SITES, htmlToText, findInText, norm } from "../lib/pipeline/prediction-sites.js";

const clean = v => String(v || "").trim().replace(/^["']+|["']+$/g, "");
const url = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY);
if (!url || !key) { console.error("Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const dry = process.argv.includes("--dry"), watch = process.argv.includes("--watch");
const SKIP = /(\bsrl\b|women|feminin|femenin|\(w\)|\bwom\b|u-?1\d|u-?2\d|juvenil|youth|reserves|amateur|virtual)/i;
const stamp = () => `[${new Date().toLocaleTimeString("pt-PT")}]`;

const get = target => new Promise(resolve => execFile(process.platform === "win32" ? "curl.exe" : "curl",
  ["-sL", "--max-time", "25", "-w", "\n%{http_code}", target], { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (e, out) => {
    const t = String(out || ""), i = t.lastIndexOf("\n");
    resolve({ status: Number(t.slice(i + 1).trim()) || 0, body: t.slice(0, i) });
  }));

async function runOnce() {
  const now = Date.now();
  const { data: matches, error } = await db.from("matches").select("id,home_team,away_team,kickoff_at")
    .gte("kickoff_at", new Date(now + 20 * 60000).toISOString()).lte("kickoff_at", new Date(now + 36 * 3600000).toISOString()).limit(1500);
  if (error) throw new Error(error.message);
  const todo = (matches || []).filter(m => !SKIP.test(`${m.home_team} ${m.away_team}`));
  console.log(`${stamp()} ${todo.length} jogos a procurar.`);
  let total = 0;
  for (const site of SITES) {
    let raw = "";
    for (const u of site.urls) {
      const r = await get(u);
      if (r.status !== 200 || /just a moment/i.test(r.body.slice(0, 3000))) { console.log(`${stamp()} ${site.id}: HTTP ${r.status} — saltado`); continue; }
      raw += " " + htmlToText(r.body);
      await new Promise(res => setTimeout(res, 1500));
    }
    if (!raw.trim()) continue;
    const textNorm = norm(raw);
    let found = 0;
    for (const m of todo) {
      const hit = findInText(textNorm, raw, m.home_team, m.away_team);
      if (!hit) continue;
      found++;
      if (dry && found <= 3) console.log(`   ${m.home_team} - ${m.away_team} | pct=${JSON.stringify(hit.pct)} tips=${hit.tips.join(",")}\n   «${hit.snippet.slice(0, 160)}»`);
      if (dry) continue;
      const payload = { site: site.id, ...hit, recolhidoEm: new Date().toISOString() };
      const source = `site:${site.id}`;
      const { data: ex } = await db.from("match_statistics").select("id").eq("match_id", m.id).eq("source", source).limit(1).maybeSingle();
      const w = ex ? await db.from("match_statistics").update({ payload, collected_at: payload.recolhidoEm }).eq("id", ex.id)
                   : await db.from("match_statistics").insert({ match_id: m.id, source, payload, collected_at: payload.recolhidoEm });
      if (w.error) console.log(`${stamp()} ${site.id}: ${w.error.message}`);
    }
    total += found;
    console.log(`${stamp()} ${site.id}: ${found} jogos encontrados${dry ? " (simulação)" : " e gravados"}`);
  }
  console.log(`${stamp()} total de ligações: ${total}`);
}

do {
  try { await runOnce(); } catch (e) { console.error(`${stamp()} Parou: ${e.message}`); if (!watch) process.exit(1); }
  if (watch) await new Promise(r => setTimeout(r, 3 * 3600 * 1000));
} while (watch);
