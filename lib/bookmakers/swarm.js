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

export function collectSwarm({ siteId, wsUrl, gameIds = [], timeoutMs = DEFAULT_TIMEOUT }) {
  if (!Number.isInteger(Number(siteId)) || !wsUrl) {
    return Promise.reject(new Error("siteId e wsUrl são obrigatórios."));
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let rid = 1;
    let settled = false;
    let timer;
    const results = new Map();
    const requested = [...new Set(gameIds.map(String))];
    const pending = new Set();

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

    timer = setTimeout(() => {
      const missing = requested.filter(id => !results.has(id));
      finish(null, {
        siteId: Number(siteId),
        requested: requested.length,
        received: results.size,
        missing,
        games: [...results.values()],
        timedOut: missing.length > 0
      });
    }, timeoutMs);

    ws.on("open", () => {
      send("request_session", { site_id: Number(siteId), language: "por" });
    });

    ws.on("message", raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.rid === "rid-1") {
        if (msg.code !== 0) return finish(new Error(`Sessão recusada pelo fornecedor (código ${msg.code}).`));
        try {
          if (!requested.length) {
            send("get", {
              source: "betting",
              what: { sport: ["id", "name", "alias"] },
              where: {},
              subscribe: false
            });
          } else {
            for (const id of requested) {
              const requestId = send("get", {
                source: "betting",
                what: {
                  game: ["id", "team1_name", "team2_name", "start_ts", "is_live"],
                  market: ["id", "type", "name", "base", "display_key"],
                  event: ["id", "price", "name", "base", "type_1"]
                },
                where: { game: { id: Number(id) } },
                subscribe: false
              });
              pending.add(requestId);
            }
          }
        } catch (error) { finish(error); }
        return;
      }

      const data = msg.data?.data;
      if (!requested.length && data?.sport) {
        finish(null, Object.values(data.sport));
        return;
      }

      if (data?.game) {
        for (const [gid, game] of Object.entries(data.game)) {
          const normalized = normalizeGame(gid, game);
          if (requested.includes(normalized.id)) results.set(normalized.id, normalized);
        }
        if (results.size >= requested.length) {
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
    });

    ws.on("error", error => finish(error));
    ws.on("close", () => {
      if (!settled && requested.length && results.size) {
        const missing = requested.filter(id => !results.has(id));
        finish(null, {
          siteId: Number(siteId), requested: requested.length, received: results.size,
          missing, games: [...results.values()], timedOut: missing.length > 0
        });
      }
    });
  });
}

export const SWARM_BOOKMAKERS = {
  elephant: { siteId: 18756188, wsUrl: "wss://eu-swarm-newm.elephantbet.co.ao/" },
  bantu: { siteId: 1869146, wsUrl: "wss://eu-swarm-newm.bantubet.co.ao/" }
};
