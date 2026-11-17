/**
 * FK Live Stats — BetConstruct Swarm (ElephantBet + BantuBet)
 *
 * Consulta curta por WebSocket para funções serverless. Não mantém subscrições
 * permanentes: Vercel Functions podem terminar a qualquer momento. O frontend
 * consulta a API de acompanhamento em intervalos e cada execução abre/fecha
 * as ligações, evitando sockets abandonados e timeouts longos.
 */
import WebSocket from "ws";
import { normalizeLiveStats } from "./normalize.js";

export const LIVE_BOOKMAKERS = {
  elephant: {
    name: "ElephantBet",
    siteId: 18756188,
    socketUrl: "wss://eu-swarm-newm.elephantbet.co.ao/",
    origin: "https://m.elephantbet.co.ao"
  },
  bantu: {
    name: "BantuBet",
    siteId: 1869146,
    socketUrl: "wss://eu-swarm-newm.bantubet.co.ao/",
    origin: "https://m.bantubet.co.ao"
  }
};

function unwrapGames(message) {
  const root = message?.data?.data || message?.data || {};
  const found = new Map();
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (node.game && typeof node.game === "object") {
      for (const [id, game] of Object.entries(node.game)) {
        if (game && typeof game === "object" && (game.team1_name || game.team2_name)) {
          const normalized = normalizeSwarmLiveGame(game, id);
          if (normalized) found.set(normalized.id, normalized);
        }
      }
    }
    // Algumas respostas de subscrição vêm agrupadas em sport/region/competition.
    for (const [key, value] of Object.entries(node)) {
      if (key !== "game" && value && typeof value === "object") visit(value, depth + 1);
    }
  };
  visit(root);
  return [...found.values()];
}

function numberFromScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseScore(info, game) {
  const home = numberFromScore(info.score1 ?? game.score1);
  const away = numberFromScore(info.score2 ?? game.score2);
  if (home !== null && away !== null) return { home, away };
  const raw = String(game.score || info.score || "");
  const match = raw.match(/(\d+)\s*[:–-]\s*(\d+)/);
  return match ? { home: Number(match[1]), away: Number(match[2]) } : { home: null, away: null };
}

function normalizeEvents(game) {
  const source = game.live_events ?? game.events ?? [];
  if (Array.isArray(source)) return source.map(event => ({
    ...event,
    event_type: event.event_type || event.type || event.name || null,
    player_name: event.player_name || event.player || event.player_name_1 || null,
    minute: event.minute ?? event.time ?? event.game_time ?? null,
    team_side: event.team_side || event.side || null
  }));
  return source && typeof source === "object" ? Object.values(source) : [];
}

export function normalizeSwarmLiveGame(game, fallbackId = null, bookmaker = null) {
  if (!game || typeof game !== "object") return null;
  const info = game.info || {};
  const score = parseScore(info, game);
  const startTs = Number(game.start_ts) || null;
  const liveFlag = game.is_live === true || Number(game.is_live) === 1 || Number(game.type) === 1;
  const clock = info.current_game_time ?? game.current_game_time ?? null;
  const period = info.current_game_state ?? game.current_game_state ?? null;
  const rawStats = game.stats || {};
  const stats = normalizeLiveStats(rawStats);
  const events = normalizeEvents(game);
  const id = game.id ?? fallbackId;
  if (id == null) return null;

  return {
    id: String(id),
    bookmaker,
    home_team: String(game.team1_name || "").trim(),
    away_team: String(game.team2_name || "").trim(),
    home: String(game.team1_name || "").trim(),
    away: String(game.team2_name || "").trim(),
    kickoff_at: startTs ? new Date(startTs * 1000).toISOString() : null,
    date: startTs ? new Date(startTs * 1000).toISOString() : null,
    start_ts: startTs,
    status: liveFlag ? "live" : String(period || "scheduled").toLowerCase(),
    is_live: liveFlag,
    home_score: score.home,
    away_score: score.away,
    minute: clock == null ? null : (String(clock).match(/\d+/)?.[0] || null),
    clock: clock == null ? null : String(clock),
    period: period == null ? null : String(period),
    statistics: stats,
    events,
    last_event: game.last_event || null,
    is_stat_available: Boolean(game.is_stat_available),
    updated_at: new Date().toISOString(),
    raw: game
  };
}

function requestSwarm({ bookmaker = "elephant", gameId = null, liveOnly = false, timeoutMs = 9000 } = {}) {
  const config = LIVE_BOOKMAKERS[bookmaker];
  if (!config) return Promise.reject(new Error("Casa de apostas desconhecida."));
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(config.socketUrl, {
      headers: { Origin: config.origin, "User-Agent": "Mozilla/5.0" }
    });
    let settled = false;
    let requestId = null;
    let quietTimer = null;
    let overallTimer = null;
    const games = new Map();

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      clearTimeout(quietTimer);
      try { ws.close(); } catch {}
      if (error) reject(error);
      else resolve(result);
    };

    overallTimer = setTimeout(
      () => finish(new Error(`Timeout Swarm (${config.name}) após ${timeoutMs} ms.`)),
      timeoutMs
    );

    ws.on("open", () => {
      ws.send(JSON.stringify({
        command: "request_session",
        params: { language: "por", site_id: config.siteId },
        rid: "fk-session"
      }));
    });

    ws.on("message", raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }

      if (message.rid === "fk-session") {
        if (message.code !== 0) {
          finish(new Error(`Sessão Swarm recusada em ${config.name} (código ${message.code}).`));
          return;
        }
        const params = {
          source: "betting",
          what: { game: [] },
          where: { game: gameId != null ? { id: Number(gameId) } : liveOnly ? { type: 1 } : {} },
          subscribe: false
        };
        requestId = "fk-live";
        ws.send(JSON.stringify({ command: "get", params, rid: requestId }));
        return;
      }

      if (message.rid !== requestId || message.code !== 0) return;
      for (const game of unwrapGames(message)) {
        game.bookmaker = config.name;
        if (gameId == null || String(game.id) === String(gameId)) games.set(String(game.id), game);
      }

      // A resposta Swarm pode vir repartida em frames. Fecha após um pequeno
      // período sem novos frames, sem manter o socket aberto indefinidamente.
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(null, [...games.values()]), 450);
    });

    ws.on("error", error => finish(error));
    ws.on("close", () => {
      if (!settled) finish(new Error(`Ligação Swarm fechada em ${config.name} antes da resposta.`));
    });
  });
}

export async function getLiveGames(bookmaker = "elephant", options = {}) {
  const games = await requestSwarm({ bookmaker, liveOnly: true, timeoutMs: options.timeoutMs || 9000 });
  return {
    bookmaker: LIVE_BOOKMAKERS[bookmaker].name,
    total: games.length,
    fetchedAt: new Date().toISOString(),
    games
  };
}

export async function getGameById(bookmaker, gameId, options = {}) {
  if (!/^\d+$/.test(String(gameId))) throw new Error("ID de jogo Swarm inválido.");
  const games = await requestSwarm({ bookmaker, gameId, timeoutMs: options.timeoutMs || 9000 });
  const game = games.find(item => String(item.id) === String(gameId));
  if (!game) throw new Error(`Jogo ${gameId} não encontrado em ${LIVE_BOOKMAKERS[bookmaker]?.name || bookmaker}.`);
  return game;
}

export async function getAllLiveGames(options = {}) {
  const [elephant, bantu] = await Promise.allSettled([
    getLiveGames("elephant", options),
    getLiveGames("bantu", options)
  ]);
  return {
    elephant: elephant.status === "fulfilled" ? elephant.value : { error: String(elephant.reason), games: [] },
    bantu: bantu.status === "fulfilled" ? bantu.value : { error: String(bantu.reason), games: [] }
  };
}

// A subscrição persistente do exemplo original não é usada em Vercel Functions:
// para o site usamos consultas curtas e repetidas, compatíveis com serverless.
