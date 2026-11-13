import { createClient } from "@supabase/supabase-js";
import { compareFixtures } from "./comparison.js";



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
      marketType: m.marketType || m.type || "",
      marketCode: m.type || "",
      marketDisplayKey: m.displayKey || "",
      marketId: m.id || null,
      marketBase: m.base ?? null,
      category: m.groupName || "",
      categoryId: m.groupId ?? null,
      categoryOrder: m.groupOrder ?? null,
      marketOrder: m.order ?? null,
      selection: s.name,
      selectionId: s.id || null,
      selectionType: s.type || null,
      selectionOrder: s.order ?? null,
      line: s.base ?? m.base ?? null,
      odds: Number(s.odd),
      collectedAt: s.receivedAt || m.receivedAt || game.receivedAt || new Date().toISOString()
    })))
  };
}

export async function handleSwarmIngest(req, res) {
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

  const { batchId, bantu, elephant } = req.body || {};
  if (typeof batchId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
    return json(res, 400, { error: "batchId UUID é obrigatório para garantir uma gravação idempotente." });
  }
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
  let savedRawMarkets = 0;
  const missing = [];
  const bookmakerIds = new Map();

  async function saveRawMarkets(game, bookmakerName) {
    if (!bookmakerIds.has(bookmakerName)) {
      const code = bookmakerName.toLowerCase();
      const { data: bookmaker, error } = await admin.from("bookmakers").upsert({
        code, name: bookmakerName, active: true
      }, { onConflict: "code" }).select("id").single();
      if (error) throw new Error("Erro ao registar " + bookmakerName + ": " + error.message);
      bookmakerIds.set(bookmakerName, bookmaker.id);
    }
    const flat = flattenGame(game, bookmakerName);
    const rows = flat.markets
      .filter(m => Number.isFinite(m.odds) && m.odds > 1 && m.odds <= 10000 && m.selection)
      .map(m => ({
        match_id: null,
        bookmaker_id: bookmakerIds.get(bookmakerName),
        market_name: String(m.market || "Mercado").slice(0, 250),
        market_key: [m.marketCode, m.marketType, m.marketBase, m.market, m.line].map(v => String(v ?? "").trim().toLowerCase()).join(":").slice(0, 220),
        period: "full_time",
        line: m.line == null ? null : String(m.line).slice(0, 80),
        selection: String(m.selection).slice(0, 250),
        odd: m.odds,
        source_url: null,
        collected_at: m.collectedAt || new Date().toISOString(),
        ingest_batch_id: batchId
      }));
    return rows;
  }

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

      for (const [game, bookmakerName] of [[a, "BantuBet"], [b, "ElephantBet"]]) {
        const rows = await saveRawMarkets(game, bookmakerName);
        // Deduplicate identical selections inside the same payload before upsert.
        // The database unique index makes a replay of this batch safe.
        const uniqueRows = new Map();
        for (const row of rows) {
          const completeRow = { ...row, match_id: match.id };
          const key = JSON.stringify([
            completeRow.ingest_batch_id,
            completeRow.match_id,
            completeRow.bookmaker_id,
            completeRow.market_key,
            completeRow.period,
            completeRow.line,
            completeRow.selection
          ]);
          uniqueRows.set(key, completeRow);
        }
        const deduplicatedRows = [...uniqueRows.values()];
        for (let offset = 0; offset < deduplicatedRows.length; offset += 500) {
          const chunk = deduplicatedRows.slice(offset, offset + 500);
          const { error } = await admin.from("markets").upsert(chunk, {
            onConflict: "ingest_batch_id,match_id,bookmaker_id,market_key,period,line,selection"
          });
          if (error) throw new Error("Erro ao guardar mercados brutos de " + bookmakerName + " no jogo " + gameId + ": " + error.message);
          savedRawMarkets += chunk.length;
        }
      }

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
      const { error } = await admin.rpc("save_swarm_comparison", {
        p_batch_id: batchId,
        p_match_id: match.id,
        p_comparison: storedComparison,
        p_best_prices: group.comparisons.map(item => ({
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
      savedRawMarkets,
      missing
    });
  } catch (error) {
    console.error("[ingest-swarm]", error);
    return json(res, 500, { error: "Falha ao guardar a recolha na Supabase.", detail: error.message });
  }
}
