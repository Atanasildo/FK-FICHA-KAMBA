/**
 * Ligação Swarm no navegador do utilizador.
 * O browser envia o Origin real da aplicação; não tenta falsificá-lo.
 * O endpoint de produção deve ser confirmado/permitido pelo operador BetConstruct.
 */
const SWARM_URL = "wss://eu-swarm-newm.betconstruct.com/";
export const SWARM_BOOKMAKERS = {
  elephant: { name: "ElephantBet", siteId: 18756188 },
  bantu: { name: "BantuBet", siteId: 1869146 }
};

function normalizeTeam(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|cf|sc|ac|afc|club|football|futebol)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

function unwrapGames(message) {
  const root = message?.data?.data || message?.data || {};
  const found = new Map();
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (node.game && typeof node.game === "object") {
      for (const [id, game] of Object.entries(node.game)) {
        if (!game || typeof game !== "object" || (!game.team1_name && !game.team2_name)) continue;
        const startTs = Number(game.start_ts) || null;
        const info = game.info || {};
        const scoreHome = Number(info.score1 ?? game.score1);
        const scoreAway = Number(info.score2 ?? game.score2);
        const scoreText = String(game.score || info.score || "");
        const scoreMatch = scoreText.match(/(\d+)\s*[:–-]\s*(\d+)/);
        const eventsRaw = game.live_events ?? game.events ?? [];
        const events = Array.isArray(eventsRaw) ? eventsRaw : Object.values(eventsRaw || {});
        const statsRaw = game.stats || {};
        found.set(String(game.id ?? id), {
          id: String(game.id ?? id),
          home: String(game.team1_name || "").trim(),
          away: String(game.team2_name || "").trim(),
          kickoff: startTs ? startTs * 1000 : null,
          live: game.is_live === true || Number(game.is_live) === 1 || Number(game.type) === 1,
          homeScore: Number.isFinite(scoreHome) ? scoreHome : scoreMatch ? Number(scoreMatch[1]) : null,
          awayScore: Number.isFinite(scoreAway) ? scoreAway : scoreMatch ? Number(scoreMatch[2]) : null,
          clock: info.current_game_time ?? game.current_game_time ?? null,
          period: info.current_game_state ?? game.current_game_state ?? null,
          statsRaw,
          events,
          lastEvent: game.last_event || events.at?.(-1) || null
        });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== "game" && value && typeof value === "object") visit(value, depth + 1);
    }
  };
  visit(root);
  return [...found.values()];
}

function requestLiveGames(bookmaker, timeoutMs = 8000) {
  const config = SWARM_BOOKMAKERS[bookmaker];
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SWARM_URL);
    let settled = false;
    let requestSent = false;
    let quietTimer = null;
    const games = new Map();
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      clearTimeout(quietTimer);
      try { ws.close(); } catch {}
      if (error) reject(error);
      else resolve([...games.values()]);
    };
    const overallTimer = window.setTimeout(() => finish(new Error("Tempo limite de ligação Swarm.")), timeoutMs);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        command: "request_session",
        params: { language: "por", site_id: config.siteId },
        rid: "fk-session"
      }));
    });
    ws.addEventListener("message", event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.rid === "fk-session") {
        if (message.code !== 0) {
          finish(new Error(`Sessão recusada pela ${config.name} (código ${message.code}).`));
          return;
        }
        if (requestSent) return;
        requestSent = true;
        ws.send(JSON.stringify({
          command: "get",
          params: {
            source: "betting",
            what: { game: [] },
            where: { game: { type: 1 } },
            subscribe: false
          },
          rid: "fk-live"
        }));
        return;
      }
      if (message.rid !== "fk-live") return;
      if (message.code !== 0) {
        finish(new Error(`Resposta Swarm inválida na ${config.name} (código ${message.code}).`));
        return;
      }
      for (const game of unwrapGames(message)) games.set(game.id, { ...game, bookmaker: config.name });
      clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => finish(null), 700);
    });
    ws.addEventListener("error", () => finish(new Error(`WebSocket bloqueado ou indisponível na ${config.name}; verificar Origin/domínio autorizado.`)));
    ws.addEventListener("close", () => {
      if (!settled) finish(new Error(`A ligação Swarm da ${config.name} foi fechada antes da resposta.`));
    });
  });
}

export async function fetchBookmakerLiveFeeds() {
  const results = await Promise.all(Object.keys(SWARM_BOOKMAKERS).map(async bookmaker => {
    try {
      return { bookmaker, name: SWARM_BOOKMAKERS[bookmaker].name, games: await requestLiveGames(bookmaker) };
    } catch (error) {
      return { bookmaker, name: SWARM_BOOKMAKERS[bookmaker].name, games: [], error: error?.message || String(error) };
    }
  }));
  return results;
}

export function buildSwarmLegUpdates(tickets, feeds) {
  const games = (feeds || []).flatMap(feed => feed.games || []);
  const updates = {};
  let matched = 0;
  for (const ticket of tickets || []) {
    for (const leg of ticket.legs || []) {
      const kickoff = Date.parse(leg.date || "");
      const home = normalizeTeam(leg.home);
      const away = normalizeTeam(leg.away);
      if (!home || !away) continue;
      const candidates = games.filter(game =>
        normalizeTeam(game.home) === home &&
        normalizeTeam(game.away) === away &&
        (!Number.isFinite(kickoff) || !game.kickoff || Math.abs(game.kickoff - kickoff) <= 4 * 60 * 60 * 1000)
      );
      if (candidates.length !== 1) continue;
      const game = candidates[0];
      if (!game.live) continue;
      const clock = game.clock == null ? null : String(game.clock);
      const minute = clock?.match(/\d+/)?.[0] || null;
      const stats = game.statsRaw || {};
      const event = game.lastEvent;
      updates[leg.id] = {
        matchStatus: "LIVE",
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        minute,
        lastEvent: event ? [event.event_type || event.type || event.name, event.player_name || event.player, event.minute || event.time].filter(Boolean).join(" · ") : null,
        liveStats: { raw: stats },
        liveSource: game.bookmaker
      };
      matched += 1;
    }
  }
  return { updates, matched, totalGames: games.length };
}
