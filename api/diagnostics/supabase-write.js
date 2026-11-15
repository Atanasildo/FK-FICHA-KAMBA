const json = (res, status, body) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
};

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST only" });
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== "Bearer " + cronSecret) {
    return json(res, 401, { ok: false, error: "Unauthorized" });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) {
    return json(res, 503, { ok: false, stage: "configuration", hasUrl: !!url, hasKey: !!key });
  }

  let projectRef = null;
  try { projectRef = new URL(url).hostname.split(".")[0]; } catch {}
  const keyType = key.startsWith("sb_secret_") ? "sb_secret"
    : key.startsWith("sb_publishable_") ? "sb_publishable"
    : key.startsWith("eyJ") ? "legacy_jwt" : "unknown";

  const headers = { apikey: key, "Content-Type": "application/json" };
  const marker = "fk-diagnostic-" + Date.now();
  let rowId = null;

  try {
    // Test the REST API directly, independently of supabase-js.
    const probe = await fetch(url + "/rest/v1/bookmakers?select=id&limit=1", {
      method: "GET",
      headers: { apikey: key }
    });
    if (!probe.ok) {
      return json(res, 502, {
        ok: false, stage: "apikey_probe", httpStatus: probe.status,
        keyType, keyLength: key.length, projectRef,
        response: (await probe.text()).slice(0, 500)
      });
    }

    const insert = await fetch(url + "/rest/v1/matches?select=id", {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        external_id: marker,
        home_team: "Ficha Kamba Diagnostic",
        away_team: "Temporary API key test",
        competition: "Temporary diagnostic",
        status: "scheduled",
        source: "diagnostic"
      })
    });
    const insertBody = await insert.text();
    if (!insert.ok) {
      return json(res, 502, {
        ok: false, stage: "insert", httpStatus: insert.status,
        keyType, keyLength: key.length, projectRef,
        response: insertBody.slice(0, 700)
      });
    }

    const inserted = JSON.parse(insertBody);
    rowId = inserted?.[0]?.id || null;
    if (!rowId) {
      return json(res, 500, { ok: false, stage: "insert_response", keyType, projectRef });
    }

    const cleanup = await fetch(url + "/rest/v1/matches?id=eq." + encodeURIComponent(rowId), {
      method: "DELETE",
      headers: { apikey: key, Prefer: "return=minimal" }
    });
    if (!cleanup.ok) {
      return json(res, 500, {
        ok: false, stage: "cleanup", httpStatus: cleanup.status,
        diagnosticRowId: rowId, response: (await cleanup.text()).slice(0, 500),
        keyType, projectRef
      });
    }

    return json(res, 200, {
      ok: true, stage: "complete", apiKeyAccepted: true,
      insertSucceeded: true, cleanupSucceeded: true,
      persistedDiagnosticRows: 0, keyType, keyLength: key.length, projectRef
    });
  } catch (error) {
    return json(res, 500, {
      ok: false, stage: rowId ? "cleanup" : "request",
      message: String(error.message || error), diagnosticRowId: rowId,
      keyType, keyLength: key.length, projectRef
    });
  }
}
