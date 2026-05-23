// Edge Function: task-status
// Returns the current TwelveLabs indexing status for a given task_id.
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

  const taskId = body.task_id ? String(body.task_id) : null;
  if (!taskId) return json({ error: "task_id is required" }, 400);

  const res = await fetch(`https://api.twelvelabs.io/v1.3/tasks/${taskId}`, {
    headers: { "x-api-key": tlApiKey },
  });

  if (!res.ok) {
    const text = await res.text();
    return json({ error: `TwelveLabs error (${res.status}): ${text}` }, 500);
  }

  const data = await res.json();
  // Normalize: status is typically "pending", "indexing", "ready", or "failed"
  return json({
    task_id: taskId,
    status: data.status,
    video_id: data.video_id ?? null,
    created_at: data.created_at ?? null,
  }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
