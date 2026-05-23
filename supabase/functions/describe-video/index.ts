// Edge Function: describe-video
// Uses TwelveLabs Pegasus 1.5 (index-independent) to describe video content.
// Accepts storage_path, generates a signed URL, and passes it directly to /analyze.
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

  const storagePath = body.storage_path ? String(body.storage_path) : null;
  if (!storagePath) return json({ error: "storage_path is required" }, 400);

  // Generate a signed URL for the video
  const admin = createClient(supabaseUrl, serviceKey);
  const videoPath = storagePath.replace(/\/$/, "") + "/video.mp4";
  const { data: signedUrlData, error: signedUrlErr } = await admin.storage
    .from("recordings")
    .createSignedUrl(videoPath, 3600);

  if (signedUrlErr || !signedUrlData?.signedUrl) {
    return json({ error: `Failed to create signed URL: ${signedUrlErr?.message}` }, 500);
  }

  // Pegasus 1.5: stream video from Supabase, upload to TwelveLabs as base64 file
  const videoFetch = await fetch(signedUrlData.signedUrl);
  if (!videoFetch.ok) {
    return json({ error: `Failed to fetch video from storage (${videoFetch.status})` }, 500);
  }
  const videoBytes = new Uint8Array(await videoFetch.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < videoBytes.length; i += chunkSize) {
    binary += String.fromCharCode(...videoBytes.subarray(i, i + chunkSize));
  }
  const videoB64 = btoa(binary);

  const res = await fetch("https://api.twelvelabs.io/v1.3/analyze", {
    method: "POST",
    headers: {
      "x-api-key": tlApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      video: { type: "base64_string", base64_string: videoB64 },
      prompt: "Describe the key visual content and any sounds or speech in this video in 2-3 sentences. Be specific about objects, actions, settings, and people visible.",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return json({ error: `TwelveLabs analyze failed (${res.status}): ${text}` }, 500);
  }

  const data = await res.json();
  const description = data.data ?? data.summary ?? data.text ?? data.result ?? null;
  return json({ description }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
