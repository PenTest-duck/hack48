// Edge Function: describe-video
// Uses TwelveLabs generate API to produce a plain-language description of
// what a video contains, so users know what terms to search for.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const tlApiKey = Deno.env.get("TWELVELABS_API_KEY")!;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON body" }, 400);
  }

  const videoId = body.video_id ? String(body.video_id) : null;
  if (!videoId) return json({ error: "video_id is required" }, 400);

  const res = await fetch("https://api.twelvelabs.io/v1.3/generate", {
    method: "POST",
    headers: {
      "x-api-key": tlApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      video_id: videoId,
      prompt: "Describe the key visual content and any sounds or speech in this video in 2-3 sentences. Be specific about objects, actions, settings, and people visible.",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return json({ error: `TwelveLabs generate failed (${res.status}): ${text}` }, 500);
  }

  const data = await res.json();
  return json({ description: data.data ?? data.text ?? data.result ?? null }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
