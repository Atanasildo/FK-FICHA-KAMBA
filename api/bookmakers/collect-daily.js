import { createClient } from "@supabase/supabase-js";
import { discoverSwarmGames, collectSwarm, SWARM_BOOKMAKERS } from "../../lib/bookmakers/swarm.js";
import { compareFixtures } from "../../lib/bookmakers/comparison.js";
import { selectCommonSwarmGames } from "../../lib/bookmakers/daily-swarm.js";

async function runForProvider(label, task) {
  try {
    return await task;
  } catch (error) {
    throw new Error(`${label}: ${error?.message || String(error)}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    return res.status(503).json({ error: "Configura SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor." });
  }

  try {
    const [bantuList, elephantList] = await Promise.all([
      runForProvider("BantuBet — descoberta de jogos", discoverSwarmGames({ ...SWARM_BOOKMAKERS.bantu, sportId: 1, timeoutMs: 20000 })),
      runForProvider("ElephantBet — descoberta de jogos", discoverSwarmGames({ ...SWARM_BOOKMAKERS.elephant, sportId: 1, timeoutMs: 20000 }))
    ]);

    const gameIds = selectCommonSwarmGames(bantuList.games, elephantList.games, { maxGames: 5 });
    if (!gameIds.length) {
      return res.status(200).json({
        ok: true,
        collectedAt: new Date().toISOString(),
        discovered: { bantu: bantuList.gamesFound, elephant: elephantList.gamesFound },
        commonGames: 0,
        savedGames: 0,
        savedComparisons: 0,
        message: "Não foram encontrados jogos comuns dentro da janela de recolha."
      });
    }

    const [bantu, elephant] = await Promise.all([
      runForProvider("BantuBet — recolha de odds", collectSwarm({ ...SWARM_BOOKMAKERS.bantu, gameIds, timeoutMs: 30000 })),
      runForProvider("ElephantBet — recolha de odds", collectSwarm({ ...SWARM_BOOKMAKERS.elephant, gameIds, timeoutMs: 30000 }))
    ]);

    const bantuById = new Map(bantu.games.map(game => [String(game.id), game]));
    const elephantById = new Map(elephant.games.map(game => [String(game.id), game]));
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    let savedGames = 0;
    let savedComparisons = 0;
    let savedSelections = 0;
    const missing = [];

    for (const gameId of gameIds) {
      const a = bantuById.get(gameId);
      const b = elephantById.get(gameId);
      if (!a || !b || !a.home || !a.away || !b.home || !b.away) {
        missing.push(gameId);
        continue;
      }

      const kickoff = a.start_ts ? new Date(Number(a.start_ts) * 1000).toISOString() : null;
      const { data: match, error: matchError } = await admin.from("matches").upsert({
        source: "swarm",
        external_id: gameId,
        home_team: a.home,
        away_team: a.away,
        competition: a.competition || null,
        kickoff_at: kickoff,
        status: a.is_live || b.is_live ? "live" : "scheduled",
        updated_at: new Date().toISOString()
      }, { onConflict: "source,external_id" }).select("id").single();
      if (matchError) throw new Error("Erro ao guardar jogo " + gameId + ": " + matchError.message);
      savedGames++;

      const comparison = compareFixtures([
        {
          id: gameId, home: a.home, away: a.away, competition: a.competition || null,
          kickoff, bookmaker: "BantuBet",
          markets: (a.markets || []).flatMap(m => (m.selections || []).map(s => ({
            market: m.name || m.type, marketType: m.type, marketBase: m.base,
            selection: s.name, odds: s.odd, collectedAt: s.receivedAt || m.receivedAt || a.receivedAt
          })))
        },
        {
          id: gameId, home: b.home, away: b.away, competition: b.competition || null,
          kickoff, bookmaker: "ElephantBet",
          markets: (b.markets || []).flatMap(m => (m.selections || []).map(s => ({
            market: m.name || m.type, marketType: m.type, marketBase: m.base,
            selection: s.name, odds: s.odd, collectedAt: s.receivedAt || m.receivedAt || b.receivedAt
          })))
        }
      ]);

      if (!comparison.events.length) continue;
      const group = comparison.events[0];
      const collectedAt = new Date().toISOString();
      const storedComparison = {
        ...comparison,
        source: "Swarm",
        collectedAt,
        providers: {
          bantu: { collectionStartedAt: bantu.collectionStartedAt, collectedAt: bantu.collectedAt },
          elephant: { collectionStartedAt: elephant.collectionStartedAt, collectedAt: elephant.collectedAt }
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

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      collectedAt: new Date().toISOString(),
      discovered: { bantu: bantuList.gamesFound, elephant: elephantList.gamesFound },
      requestedGames: gameIds.length,
      receivedGames: { bantu: bantu.received, elephant: elephant.received },
      savedGames,
      savedComparisons,
      savedSelections,
      missing
    });
  } catch (error) {
    console.error("[collect-daily]", error);
    return res.status(500).json({
      error: "Falha na recolha automática de odds.",
      detail: error.message
    });
  }
}
