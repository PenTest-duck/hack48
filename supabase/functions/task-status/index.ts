// Edge Function: task-status
// Returns the current TwelveLabs indexing status for a given task_id.
// When the task is ready, also persists the video_id to submission metadata
// so search-videos can match clips back to submissions.
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
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const tlApiKey = Deno.env.get("TWELVELABS_API_KEY")!;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON body" }, 400);
  }

  const taskId = body.task_id ? String(body.task_id) : null;
  // submission_id is optional — if provided, we'll persist the video_id on ready
  const submissionId = body.submission_id ? String(body.submission_id) : null;

  if (!taskId) return json({ error: "task_id is required" }, 400);

  const res = await fetch(`https://api.twelvelabs.io/v1.3/tasks/${taskId}`, {
    headers: { "x-api-key": tlApiKey },
  });

  if (!res.ok) {
    const text = await res.text();
    return json({ error: `TwelveLabs error (${res.status}): ${text}` }, 500);
  }

  const data = await res.json();
  const status = data.status as string;
  const videoId: string | null = data.video_id ?? null;

  // When ready, persist video_id to submission metadata so search can map clips → submissions
  if (status === "ready" && videoId && submissionId) {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: existing } = await admin
      .from("submissions")
      .select("metadata")
      .eq("id", submissionId)
      .single();

    const meta = existing?.metadata as Record<string, unknown> | null;
    if (!meta?.twelvelabs_video_id) {
      await admin
        .from("submissions")
        .update({ metadata: { ...(meta ?? {}), twelvelabs_video_id: videoId } })
        .eq("id", submissionId);
    }
  }

  return json({ task_id: taskId, status, video_id: videoId, created_at: data.created_at ?? null }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
