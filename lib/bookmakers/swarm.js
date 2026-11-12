import WebSocket from "ws";

const DEFAULT_TIMEOUT = 25000;

function normalizeGame(gid, game) {
  const markets = Object.values(game.market || {}).map(m => ({
    id: String(m.id ?? ""),
    name: m.name || "",
    type: m.type || m.display_key || "",
    base: m.base ?? null,
    selections: Object.values(m.event || {}).map(e => ({
      id: String(e.id ?? ""),
      name: String(e.name || "").trim(),
      odd: Number(e.price),
      type: e.type_1 ?? null,
      base: e.base ?? m.base ?? null
    })).filter(e => e.name && Number.isFinite(e.odd) && e.odd > 1)
  })).filter(m => m.selections.length);

  return {
    id: String(game.id ?? gid),
    home: game.team1_name || "",
    away: game.team2_name || "",
    start_ts: Number(game.start_ts) || null,
    is_live: Boolean(game.is_live),
    markets
  };
}

function runSwarmRequest({ siteId, wsUrl, timeoutMs = DEFAULT_TIMEOUT }, onReady, onData) {
  if (!Number.isInteger(Number(siteId)) || !wsUrl) {
    return Promise.reject(new Error("siteId e wsUrl são obrigatórios."));
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let rid = 2;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      error ? reject(error) : resolve(value);
    };

    const send = (command, params = {}) => {
      if (ws.readyState !== WebSocket.OPEN) throw new Error("Ligação WebSocket indisponível.");
      const requestId = `rid-${rid++}`;
      ws.send(JSON.stringify({ command, params, rid: requestId }));
      return requestId;
    };

    const timer = setTimeout(
      () => finish(new Error("Tempo limite excedido na consulta WebSocket.")),
      timeoutMs
    );

    ws.on("open", () => {
      try {
        ws.send(JSON.stringify({
          command: "request_session",
          params: { site_id: Number(siteId), language: "por" },
          rid: "rid-1"
        }));
      } catch (error) { finish(error); }
    });

    ws.on("message", raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.rid === "rid-1") {
        if (msg.code !== 0) {
          finish(new Error(`Sessão recusada pelo fornecedor (código ${msg.code}).`));
          return;
        }
        try { onReady(send, finish); } catch (error) { finish(error); }
        return;
      }

      try { onData(msg, finish); } catch (error) { finish(error); }
    });

    ws.on("error", error => finish(error));
    ws.on("close", () => {
      if (!settled) finish(new Error("Ligação WebSocket fechada antes de concluir a consulta."));
    });
  });
}

export function discoverSwarmGames({
  siteId,
  wsUrl,
  sportId = 1,
  timeoutMs = DEFAULT_TIMEOUT
}) {
  return runSwarmRequest(
    { siteId, wsUrl, timeoutMs },
    send => {
      send("get", {
        source: "betting",
        what: {
          sport: ["id", "name"],
          game: ["id", "team1_name", "team2_name", "start_ts", "is_live"]
        },
        where: { sport: { id: Number(sportId) } },
        subscribe: false
      });
    },
    (msg, finish) => {
      const recordsById = msg.data?.data?.sport?.[String(sportId)]?.game;
      if (!recordsById) return;
      const records = Object.values(recordsById);
      const games = records
        .filter(game => game.team1_name && game.team2_name)
        .map(game => ({
          id: String(game.id),
          home: String(game.team1_name).trim(),
          away: String(game.team2_name).trim(),
          start_ts: Number(game.start_ts) || null,
          is_live: Boolean(game.is_live)
        }));
      finish(null, {
        siteId: Number(siteId),
        sportId: Number(sportId),
        totalRecords: records.length,
        gamesFound: games.length,
        excludedRecords: records.length - games.length,
        games
      });
    }
  );
}

export function collectSwarm({ siteId, wsUrl, gameIds = [], timeoutMs = DEFAULT_TIMEOUT }) {
  const requested = [...new Set(gameIds.map(String))];
  if (!requested.length) {
    return Promise.reject(new Error("Indica pelo menos um ID de jogo para recolher odds."));
  }
  const results = new Map();

  return runSwarmRequest(
    { siteId, wsUrl, timeoutMs },
    send => {
      for (const id of requested) {
        send("get", {
          source: "betting",
          what: {
            game: ["id", "team1_name", "team2_name", "start_ts", "is_live"],
            market: ["id", "type", "name", "base", "display_key"],
            event: ["id", "price", "name", "base", "type_1"]
          },
          where: { game: { id: Number(id) } },
          subscribe: false
        });
      }
    },
    (msg, finish) => {
      const data = msg.data?.data;
      if (!data?.game) return;
      for (const [gid, game] of Object.entries(data.game)) {
        const normalized = normalizeGame(gid, game);
        if (requested.includes(normalized.id)) results.set(normalized.id, normalized);
      }
      if (results.size === requested.length) {
        finish(null, {
          siteId: Number(siteId),
          requested: requested.length,
          received: results.size,
          missing: [],
          games: [...results.values()],
          timedOut: false
        });
      }
    }
  );
}

export const SWARM_BOOKMAKERS = {
  elephant: { siteId: 18756188, wsUrl: "wss://eu-swarm-newm.elephantbet.co.ao/" },
  bantu: { siteId: 1869146, wsUrl: "wss://eu-swarm-newm.bantubet.co.ao/" }
};
