export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const MODEL = "accounts/fireworks/models/qwen3-8b";

  // 1. Handle GET /api/health
  if (url.pathname.endsWith("/health")) {
    const hasKey = Boolean(env.FIREWORKS_API_KEY);
    return Response.json({
      connected: hasKey,
      model: hasKey ? "Qwen3 8B (Fireworks)" : null,
      detail: hasKey ? "Connected to Fireworks AI" : "Missing FIREWORKS_API_KEY in Cloudflare"
    });
  }

  // 2. Handle POST /api/chat
  if (url.pathname.endsWith("/chat") && request.method === "POST") {
    if (!env.FIREWORKS_API_KEY) {
      return Response.json({ error: "FIREWORKS_API_KEY is not set in Cloudflare." }, { status: 500 });
    }

    try {
      const { messages } = await request.json();

      const fwResponse = await fetch("https://fireworks.ai", {

        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.FIREWORKS_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: messages,
          temperature: 0.7
        })
      });

      const data = await fwResponse.json();

      if (!fwResponse.ok) {
        const errMsg = data?.error?.message || "Fireworks API error.";
        return Response.json({ error: errMsg }, { status: fwResponse.status });
      }

      const reply = data.choices?.[0]?.message?.content || "";
      return Response.json({ reply });
    } catch (err) {
      return Response.json({ error: err.message || "Failed to reach Fireworks AI." }, { status: 500 });
    }
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
