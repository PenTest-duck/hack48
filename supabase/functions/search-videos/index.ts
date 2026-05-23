// Edge Function: search-videos
// Calls TwelveLabs search API with a natural language query and returns matching submissions.
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

  // Search TwelveLabs — returns clips; we'll deduplicate to unique parent videos below
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
      threshold: "low",
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

  const admin = createClient(supabaseUrl, serviceKey);

  // Collect unique TwelveLabs video IDs across all clips
  const tlVideoIds = [...new Set(hits.map(h => h.video_id))];

  // Fetch all submissions (optionally filtered to a task)
  let submissionsQuery = admin
    .from("submissions")
    .select("id, collector_id, storage_path, status, metadata, created_at");
  if (taskId) {
    submissionsQuery = submissionsQuery.eq("task_id", taskId);
  }
  const { data: submissions, error: dbErr } = await submissionsQuery;
  if (dbErr) return json({ error: `DB error: ${dbErr.message}` }, 500);

  // Build lookup: stored TL video_id or task_id → submission
  const submissionByTlId = new Map<string, typeof submissions[0]>();
  for (const sub of submissions ?? []) {
    const meta = sub.metadata as Record<string, unknown> | null;
    const storedTaskId = meta?.twelvelabs_task_id as string | undefined;
    const storedVideoId = meta?.twelvelabs_video_id as string | undefined;
    if (storedTaskId) submissionByTlId.set(storedTaskId, sub);
    if (storedVideoId) submissionByTlId.set(storedVideoId, sub);
  }

  // Find TL video_ids that didn't match any submission via stored metadata
  const unmatchedVideoIds = tlVideoIds.filter(vid => !submissionByTlId.has(vid));

  // For unmatched video_ids: find submissions with a task_id but no video_id stored,
  // then call TwelveLabs to resolve task → video_id on the fly and persist for future calls.
  if (unmatchedVideoIds.length > 0) {
    const needsResolution = (submissions ?? []).filter(sub => {
      const meta = sub.metadata as Record<string, unknown> | null;
      return meta?.twelvelabs_task_id && !meta?.twelvelabs_video_id;
    });

    await Promise.all(
      needsResolution.map(async (sub) => {
        const meta = sub.metadata as Record<string, unknown>;
        const tlTaskId = meta.twelvelabs_task_id as string;
        try {
          const taskRes = await fetch(`https://api.twelvelabs.io/v1.3/tasks/${tlTaskId}`, {
            headers: { "x-api-key": tlApiKey },
          });
          if (!taskRes.ok) return;
          const taskData = await taskRes.json();
          const resolvedVideoId = taskData.video_id as string | null;
          if (!resolvedVideoId) return;

          // Register in our lookup
          submissionByTlId.set(resolvedVideoId, sub);

          // Persist so future searches don't need to re-resolve
          await admin
            .from("submissions")
            .update({ metadata: { ...meta, twelvelabs_video_id: resolvedVideoId } })
            .eq("id", sub.id);
        } catch {
          // Non-fatal — just skip this submission
        }
      })
    );
  }

  // Deduplicate clips → unique submissions, keeping best score per submission
  const bestBySubmission = new Map<string, { submission: typeof submissions[0]; score: number }>();
  for (const hit of hits) {
    const sub = submissionByTlId.get(hit.video_id);
    if (!sub) continue;
    const existing = bestBySubmission.get(sub.id);
    if (!existing || hit.score > existing.score) {
      bestBySubmission.set(sub.id, { submission: sub, score: hit.score });
    }
  }

  // Debug: always include raw TL hit info so we can diagnose mismatches
  const debug = {
    tlVideoIds,
    submissionMetadata: (submissions ?? []).map(s => ({
      id: s.id,
      twelvelabs_task_id: (s.metadata as Record<string,unknown>|null)?.twelvelabs_task_id ?? null,
      twelvelabs_video_id: (s.metadata as Record<string,unknown>|null)?.twelvelabs_video_id ?? null,
    })),
    matched: [...bestBySubmission.keys()],
  };

  if (!bestBySubmission.size) {
    return json({ results: [], debug }, 200);
  }

  // Generate signed URLs for matched submissions, sorted by best score
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
