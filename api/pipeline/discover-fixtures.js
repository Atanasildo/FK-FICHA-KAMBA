import { createClient } from "@supabase/supabase-js";

const API_BASE = "https://sportapi.ai/api";
const TZ = "Africa/Luanda";

function localDate(offset = 0) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
  const date = new Date(parts + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function isUpcoming(status) {
  return !/live|in.?play|half|finished|ended|full.?time|cancel|postpon|abandon|awarded/i.test(String(status || ""));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const apiKey = process.env.SPORTAPI_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!apiKey) return res.status(503).json({ error: "SPORTAPI_KEY não configurada." });
  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({ error: "Credenciais de servidor do Supabase não configuradas." });
  }

  const days = Math.min(7, Math.max(1, Number(req.body?.days) || 2));
  const dates = Array.from({ length: days }, (_, i) => localDate(i));
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const results = await Promise.all(dates.map(async date => {
      const response = await fetch(`${API_BASE}/fixtures/date/${date}`, {
        headers: { "X-Api-Key": apiKey, Accept: "application/json" }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false || !Array.isArray(payload.data)) {
        throw new Error(`SportAPI ${date}: ${payload.error || payload.message || `HTTP ${response.status}`}`);
      }
      return { date, fixtures: payload.data };
    }));

    const rows = results.flatMap(({ fixtures }) => fixtures
      .filter(f => f?.id != null && f.home_team && f.away_team && isUpcoming(f.status))
      .map(f => ({
        source: "sportapi",
        external_id: String(f.id),
        home_team: String(f.home_team).slice(0, 180),
        away_team: String(f.away_team).slice(0, 180),
        competition: String(f.league_name || f.competition_name || "").slice(0, 180) || null,
        kickoff_at: f.kickoff_utc || null,
        status: "scheduled",
        updated_at: new Date().toISOString()
      })));

    let saved = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await admin.from("matches").upsert(batch, {
        onConflict: "source,external_id",
        ignoreDuplicates: false
      });
      if (error) throw new Error(`Supabase: ${error.message}`);
      saved += batch.length;
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      source: "SportAPI",
      timezone: TZ,
      dates,
      fixturesDiscovered: rows.length,
      fixturesSaved: saved,
      note: "Jogos futuros foram descobertos e guardados. Este passo não recolhe odds, não executa a Groq e não publica fichas."
    });
  } catch (error) {
    return res.status(502).json({
      error: "Falha na descoberta automática de jogos.",
      detail: error.message
    });
  }
}
