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

const analysisKinds = [
  "gemini_eval",
  "mediapipe_hands",
  "yolo_objects",
  "sam_segments",
  "temporal_actions",
] as const;

const analysisFilenames: Record<typeof analysisKinds[number], string> = {
  gemini_eval: "gemini-eval.json",
  mediapipe_hands: "mediapipe-hands.json",
  yolo_objects: "yolo-detections.json",
  sam_segments: "sam-segments.json",
  temporal_actions: "temporal-actions.json",
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
    status: "analyzing",
    is_scoring: true,
  });
  if (dbErr) return json({ error: `recordings: ${dbErr.message}` }, 500);

  const { data: subData, error: subErr } = await admin
    .from("submissions")
    .insert({
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
    })
    .select("id")
    .single();
  if (subErr) return json({ error: `submissions: ${subErr.message}` }, 500);

  const storagePathWithoutTrailingSlash = storagePath.replace(/\/+$/, "") || recordingId;
  const jobRows = analysisKinds.map((kind) => ({
    recording_id: recordingId,
    kind,
    status: "pending",
    artifact_path: `${storagePathWithoutTrailingSlash}/analysis/${analysisFilenames[kind]}`,
    error: null,
    started_at: null,
    finished_at: null,
  }));
  const { error: jobsErr } = await admin
    .from("recording_analysis_jobs")
    .upsert(jobRows, { onConflict: "recording_id,kind" });
  if (jobsErr) return json({ error: `recording_analysis_jobs: ${jobsErr.message}` }, 500);

  const modalResult = await startModalAnalysis({
    recording_id: recordingId,
    task_id: taskId,
    submission_id: subData?.id ?? null,
    storage_path: storagePath,
  });

  return json({
    ok: true,
    recording_id: recordingId,
    submission_id: subData?.id ?? null,
    streams,
    analysis_started: modalResult.ok,
    analysis_error: modalResult.ok ? null : modalResult.error,
  }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function startModalAnalysis(payload: {
  recording_id: string;
  task_id: string;
  submission_id: string | null;
  storage_path: string;
}) {
  const modalUrl = Deno.env.get("MODAL_ANALYSIS_URL");
  const modalSecret = Deno.env.get("MODAL_ANALYSIS_SECRET");
  if (!modalUrl || !modalSecret) {
    return { ok: false, error: "Modal analysis env is not configured" };
  }

  try {
    const res = await fetch(modalUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hack48-Modal-Secret": modalSecret,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `Modal kickoff failed (${res.status}): ${text}` };
    }
    return { ok: true, body: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Modal kickoff failed: ${message}` };
  }
}
