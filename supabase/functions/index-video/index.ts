// Edge Function: index-video
// Gets a signed URL for a submission's video and submits it to TwelveLabs for indexing.
// Stores the returned task_id in the submission's metadata field.
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

  const submissionId = body.submission_id ? String(body.submission_id) : null;
  const storagePath = body.storage_path ? String(body.storage_path) : null;
  if (!submissionId || !storagePath) {
    return json({ error: "submission_id and storage_path are required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // Generate a signed URL for the video (1-hour expiry — enough for TwelveLabs to fetch it)
  const videoPath = storagePath.replace(/\/$/, "") + "/video.mp4";
  const { data: signedUrlData, error: signedUrlErr } = await admin.storage
    .from("recordings")
    .createSignedUrl(videoPath, 3600);

  if (signedUrlErr || !signedUrlData?.signedUrl) {
    return json({ error: `Failed to create signed URL: ${signedUrlErr?.message}` }, 500);
  }

  const signedUrl = signedUrlData.signedUrl;

  // Submit to TwelveLabs for indexing (v1.3 requires multipart/form-data with video_url)
  const form = new FormData();
  form.append("index_id", tlIndexId);
  form.append("video_url", signedUrl);

  const tlRes = await fetch("https://api.twelvelabs.io/v1.3/tasks", {
    method: "POST",
    headers: { "x-api-key": tlApiKey },
    body: form,
  });

  if (!tlRes.ok) {
    const errText = await tlRes.text();
    return json({ error: `TwelveLabs indexing failed: ${errText}` }, 500);
  }

  const tlData = await tlRes.json();
  const tlTaskId = tlData._id ?? tlData.id ?? tlData.task_id;

  // Store the TwelveLabs task ID in the submission's metadata
  const { data: existing, error: fetchErr } = await admin
    .from("submissions")
    .select("metadata")
    .eq("id", submissionId)
    .single();

  if (fetchErr) {
    return json({ error: `Failed to fetch submission: ${fetchErr.message}` }, 500);
  }

  const updatedMetadata = {
    ...(existing?.metadata ?? {}),
    twelvelabs_task_id: tlTaskId,
  };

  const { error: updateErr } = await admin
    .from("submissions")
    .update({ metadata: updatedMetadata })
    .eq("id", submissionId);

  if (updateErr) {
    return json({ error: `Failed to update submission metadata: ${updateErr.message}` }, 500);
  }

  return json({ ok: true, twelvelabs_task_id: tlTaskId }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
