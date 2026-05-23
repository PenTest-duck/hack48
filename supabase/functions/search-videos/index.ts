// Edge Function: search-videos
// Calls TwelveLabs search API with a natural language query and returns matching results.
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
  const tlIndexId = Deno.env.get("TWELVELABS_INDEX_ID")!;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON body" }, 400);
  }

  const query = body.query ? String(body.query).trim() : null;
  if (!query) return json({ error: "query is required" }, 400);

  const taskId = body.task_id ? String(body.task_id) : null;

  // Search TwelveLabs
  const tlRes = await fetch("https://api.twelvelabs.io/v1.3/search", {
    method: "POST",
    headers: {
      "x-api-key": tlApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      index_id: tlIndexId,
      query_text: query,
      search_options: ["visual", "audio"],
      threshold: "medium",
    }),
  });

  if (!tlRes.ok) {
    const errText = await tlRes.text();
    return json({ error: `TwelveLabs search failed: ${errText}` }, 500);
  }

  const tlData = await tlRes.json();
  const hits: Array<{ video_id: string; score: number; start: number; end: number }> =
    tlData.data ?? [];

  if (!hits.length) {
    return json({ results: [] }, 200);
  }

  // Map TwelveLabs video IDs back to submission IDs via metadata.twelvelabs_task_id
  // TwelveLabs video_id corresponds to the completed video id, but we stored the task_id.
  // We match submissions whose metadata contains these twelvelabs_task_ids or video_ids.
  const admin = createClient(supabaseUrl, serviceKey);

  // Collect unique video IDs from hits
  const videoIds = [...new Set(hits.map(h => h.video_id))];

  // Fetch all submissions for this task (if task_id provided) or globally
  let submissionsQuery = admin
    .from("submissions")
    .select("id, collector_id, storage_path, status, metadata, created_at");

  if (taskId) {
    submissionsQuery = submissionsQuery.eq("task_id", taskId);
  }

  const { data: submissions, error: dbErr } = await submissionsQuery;
  if (dbErr) return json({ error: `DB error: ${dbErr.message}` }, 500);

  // Build a map from twelvelabs video/task id → submission
  const submissionByTlId = new Map<string, typeof submissions[0]>();
  for (const sub of submissions ?? []) {
    const meta = sub.metadata as Record<string, unknown> | null;
    const tlTaskId = meta?.twelvelabs_task_id as string | undefined;
    const tlVideoId = meta?.twelvelabs_video_id as string | undefined;
    if (tlTaskId) submissionByTlId.set(tlTaskId, sub);
    if (tlVideoId) submissionByTlId.set(tlVideoId, sub);
  }

  // Join hits with submissions; deduplicate by submission id, keeping best score
  const bestBySubmission = new Map<string, { submission: typeof submissions[0]; score: number }>();
  for (const hit of hits) {
    const sub = submissionByTlId.get(hit.video_id);
    if (!sub) continue;
    const existing = bestBySubmission.get(sub.id);
    if (!existing || hit.score > existing.score) {
      bestBySubmission.set(sub.id, { submission: sub, score: hit.score });
    }
  }

  // Generate signed URLs for matched submissions
  const results = await Promise.all(
    [...bestBySubmission.values()]
      .sort((a, b) => b.score - a.score)
      .map(async ({ submission, score }) => {
        const videoPath = submission.storage_path.replace(/\/$/, "") + "/video.mp4";
        const { data } = await admin.storage
          .from("recordings")
          .createSignedUrl(videoPath, 3600);
        return {
          ...submission,
          score,
          signedUrl: data?.signedUrl ?? null,
        };
      })
  );

  return json({ results }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
