// Edge Function: submit-recording
// The app streams the bundle files straight to Storage, then calls this with a
// small JSON body. We verify the JWT and write the recordings + submissions rows.
// (No file handling here — keeps the function fast and within memory limits.)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // 1) Identify the caller from their JWT.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Unauthorized" }, 401);

  // 2) Parse the metadata payload.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON body" }, 400);
  }

  const recordingId = String(body.recording_id ?? crypto.randomUUID());
  const taskId = body.task_id ? String(body.task_id) : null;
  if (!taskId) return json({ error: "task_id is required" }, 400); // submissions.task_id is NOT NULL

  const storagePath = body.storage_path ? String(body.storage_path) : `${recordingId}/`;
  const streams = Array.isArray(body.streams) ? body.streams : [];
  const numOrNull = (v: unknown) => (v === undefined || v === null ? null : Number(v));
  const strOrNull = (v: unknown) => (v === undefined || v === null ? null : String(v));

  // 3) Service-role client writes the rows (bypasses RLS).
  const admin = createClient(supabaseUrl, serviceKey);

  const { error: dbErr } = await admin.from("recordings").upsert({
    id: recordingId,
    bounty_id: taskId,
    collector_id: user.id,
    device_model: strOrNull(body.device_model),
    duration_ms: numOrNull(body.duration_ms),
    size_bytes: numOrNull(body.size_bytes),
    gps_lat: numOrNull(body.gps_lat),
    gps_lon: numOrNull(body.gps_lon),
    gps_accuracy_m: numOrNull(body.gps_accuracy_m),
    storage_path: storagePath,
    streams,
    status: "uploaded",
  });
  if (dbErr) return json({ error: `recordings: ${dbErr.message}` }, 500);

  const { data: subData, error: subErr } = await admin.from("submissions").insert({
    task_id: taskId,
    collector_id: user.id, // equals profiles.id
    storage_path: storagePath,
    status: "pending",
    metadata: {
      recording_id: recordingId,
      device_model: strOrNull(body.device_model),
      duration_ms: numOrNull(body.duration_ms),
      size_bytes: numOrNull(body.size_bytes),
      gps: (numOrNull(body.gps_lat) !== null && numOrNull(body.gps_lon) !== null)
        ? { lat: numOrNull(body.gps_lat), lon: numOrNull(body.gps_lon), accuracy_m: numOrNull(body.gps_accuracy_m) }
        : null,
      streams,
    },
  }).select("id").single();
  if (subErr) return json({ error: `submissions: ${subErr.message}` }, 500);

  // Fire-and-forget: kick off TwelveLabs indexing without blocking the response
  if (subData?.id) {
    const indexUrl = `${supabaseUrl}/functions/v1/index-video`;
    fetch(indexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ submission_id: subData.id, storage_path: storagePath }),
    }).catch(() => { /* intentionally ignored */ });
  }

  return json({ ok: true, recording_id: recordingId, streams }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
