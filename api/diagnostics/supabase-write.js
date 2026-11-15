import { createClient } from "@supabase/supabase-js";

const json = (res, status, body) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
};

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST only" });
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== "Bearer " + secret) {
    return json(res, 401, { ok: false, error: "Unauthorized" });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return json(res, 503, { ok: false, hasUrl: !!url, hasSecretKey: !!key });

  const customFetch = (input, init = {}) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((v, k) => headers.set(k, v));
    headers.set("apikey", key);
    if (headers.get("authorization") === "Bearer " + key) headers.delete("authorization");
    return fetch(input, { ...init, headers });
  };

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: customFetch }
  });

  const marker = "fk-diagnostic-" + Date.now();
  let rowId = null;
  try {
    const { data, error } = await db.from("matches").insert({
      external_id: marker,
      home_team: "Ficha Kamba Diagnostic",
      away_team: "Temporary API key test",
      competition: "Temporary diagnostic",
      status: "scheduled",
      source: "diagnostic"
    }).select("id").single();

    if (error) return json(res, 502, {
      ok: false, stage: "insert", message: error.message, code: error.code || null
    });

    rowId = data.id;
    const { error: deleteError } = await db.from("matches").delete().eq("id", rowId);
    if (deleteError) return json(res, 500, {
      ok: false, stage: "cleanup", inserted: true, cleanupSucceeded: false,
      diagnosticRowId: rowId, message: deleteError.message
    });

    return json(res, 200, {
      ok: true, stage: "complete", apiKeyAccepted: true,
      insertSucceeded: true, cleanupSucceeded: true, persistedDiagnosticRows: 0
    });
  } catch (error) {
    return json(res, 500, {
      ok: false, stage: rowId ? "cleanup" : "request",
      message: String(error.message || error), diagnosticRowId: rowId
    });
  }
}
