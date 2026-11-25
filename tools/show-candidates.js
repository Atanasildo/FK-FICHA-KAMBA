// Lê a base (odds das duas casas + previsões gravadas) e mostra os candidatos por consenso. Não grava nada.
//   node tools\show-candidates.js [--horas=36]
import { createClient } from "@supabase/supabase-js";
import { extract1x2, collectSignals, buildCandidates } from "../lib/pipeline/consensus.js";
const clean = v => String(v || "").trim().replace(/^["']+|["']+$/g, "");
const url = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY);
if (!url || !key) { console.error("Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const horas = Number(process.argv.find(a => a.startsWith("--horas="))?.split("=")[1] || 36);
const now = Date.now();
const { data: matches, error } = await db.from("matches").select("id,external_id,home_team,away_team,kickoff_at")
  .gte("kickoff_at", new Date(now + 30 * 60000).toISOString()).lte("kickoff_at", new Date(now + horas * 3600000).toISOString()).order("kickoff_at").limit(1500);
if (error) { console.error(error.message); process.exit(1); }
const ids = matches.map(m => m.id);
const [{ data: stats }, { data: comps }] = await Promise.all([
  db.from("match_statistics").select("match_id,source,payload").in("match_id", ids).or("source.like.site:%,source.eq.sofascore-prematch"),
  db.from("odds_comparisons").select("match_id,comparison").in("match_id", ids)
]);
const by = (rows) => { const m = new Map(); for (const r of rows || []) { (m.get(r.match_id) || m.set(r.match_id, []).get(r.match_id)).push(r); } return m; };
const statsBy = by(stats), compBy = by(comps);
const out = [];
for (const m of matches) {
  const comp = compBy.get(m.id)?.[0]?.comparison; if (!comp) continue;
  const signals = collectSignals(statsBy.get(m.id));
  for (const c of buildCandidates({ odds: extract1x2(comp), signals })) out.push({ m, c });
}
out.sort((a, b) => b.c.agree - a.c.agree || b.c.fairProbability - a.c.fairProbability);
console.log(`${matches.length} jogos, ${out.length} candidatos com fontes a concordar.\n`);
for (const { m, c } of out.slice(0, 40)) {
  const hh = Object.entries(c.houses).map(([h, v]) => `${h[0]}${v.odd}`).join(" ");
  console.log(`${new Date(m.kickoff_at).toLocaleTimeString("pt-PT", { timeZone: "Africa/Luanda", hour: "2-digit", minute: "2-digit" })} ${m.home_team} - ${m.away_team} | ${c.selection} | odds ${hh} | prob ${(c.fairProbability * 100).toFixed(0)}% | fontes ${c.agree}/${c.agree + c.disagree} | ${c.fontes.join("; ")}`);
}
