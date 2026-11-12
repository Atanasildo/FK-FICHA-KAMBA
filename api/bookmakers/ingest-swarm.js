import { createClient } from "@supabase/supabase-js";
import { compareFixtures } from "../../lib/bookmakers/comparison.js";

const json = (res, status, body) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
};

function flattenGame(game, bookmaker) {
  return {
    id: String(game.id),
    home: String(game.home || "").trim(),
    away: String(game.away || "").trim(),
    competition: game.competition || null,
    kickoff: game.start_ts ? new Date(Number(game.start_ts) * 1000).toISOString() : null,
    bookmaker,
    markets: (game.markets || []).flatMap(m => (m.selections || []).map(s => ({
      market: m.name || m.type || "Mercado",
      marketType: m.type || "",
      marketBase: m.base ?? null,
      selection: s.name,
      odds: Number(s.odd),
      collectedAt: s.receivedAt || m.receivedAt || game.receivedAt || new Date().toISOString()
    })))
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Método não permitido." });
  }

  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.authorization || "";
  if (!secret || authorization !== `Bearer ${secret}`) {
    return json(res, 401, { error: "Não autorizado." });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    return json(res, 503, { error: "A ligação à Supabase não está configurada no servidor." });
  }

  const { bantu, elephant } = req.body || {};
  if (!Array.isArray(bantu?.games) || !Array.isArray(elephant?.games) ||
      bantu.games.length > 10 || elephant.games.length > 10 ||
      !bantu.games.length || !elephant.games.length) {
    return json(res, 400, { error: "Envie as recolhas das duas casas, com no máximo 10 jogos por casa." });
  }

  const bantuMap = new Map(bantu.games.map(g => [String(g.id), g]));
  const elephantMap = new Map(elephant.games.map(g => [String(g.id), g]));
  const commonIds = [...bantuMap.keys()].filter(id => elephantMap.has(id));
  if (!commonIds.length) return json(res, 400, { error: "Não foram enviados jogos comuns às duas casas." });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let savedGames = 0;
  let savedComparisons = 0;
  let savedSelections = 0;
  const missing = [];

  try {
    for (const gameId of commonIds) {
      const a = bantuMap.get(gameId);
      const b = elephantMap.get(gameId);
      if (!a?.home || !a?.away || !b?.home || !b?.away ||
          !Array.isArray(a.markets) || !Array.isArray(b.markets)) {
        missing.push(gameId);
        continue;
      }

      const kickoff = a.start_ts ? new Date(Number(a.start_ts) * 1000).toISOString() : null;
      const { data: match, error: matchError } = await admin.from("matches").upsert({
        source: "swarm",
        external_id: gameId,
        home_team: a.home,
        away_team: a.away,
        competition: a.competition || b.competition || null,
        kickoff_at: kickoff,
        status: a.is_live || b.is_live ? "live" : "scheduled",
        updated_at: new Date().toISOString()
      }, { onConflict: "source,external_id" }).select("id").single();
      if (matchError) throw new Error("Erro ao guardar jogo " + gameId + ": " + matchError.message);
      savedGames++;

      const comparison = compareFixtures([
        flattenGame(a, "BantuBet"),
        flattenGame(b, "ElephantBet")
      ]);
      if (!comparison.events.length) continue;

      const group = comparison.events[0];
      const collectedAt = new Date().toISOString();
      const storedComparison = {
        ...comparison,
        source: "Swarm",
        collectedAt,
        providers: {
          bantu: { collectedAt: bantu.collectedAt || collectedAt },
          elephant: { collectedAt: elephant.collectedAt || collectedAt }
        }
      };
      const { error } = await admin.from("odds_comparisons").insert({
        match_id: match.id,
        comparison: storedComparison,
        best_prices: group.comparisons.map(item => ({
          market: item.market,
          selection: item.selection,
          bestBookmaker: item.bestBookmaker,
          bestOdds: item.bestOdds
        }))
      });
      if (error) throw new Error("Erro ao guardar comparação do jogo " + gameId + ": " + error.message);
      savedComparisons++;
      savedSelections += comparison.comparisonCount;
    }

    return json(res, 200, {
      ok: true,
      receivedGames: { bantu: bantu.games.length, elephant: elephant.games.length },
      commonGames: commonIds.length,
      savedGames,
      savedComparisons,
      savedSelections,
      missing
    });
  } catch (error) {
    console.error("[ingest-swarm]", error);
    return json(res, 500, { error: "Falha ao guardar a recolha na Supabase.", detail: error.message });
  }
}
