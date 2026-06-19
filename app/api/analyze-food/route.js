export const runtime = "nodejs";

export async function POST(request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return Response.json({ error: "OPENROUTER_API_KEY not configured" }, { status: 500 });

  const { imageDataUrl, description } = await request.json();
  if (!imageDataUrl) return Response.json({ error: "No image provided" }, { status: 400 });

  const promptText = `${description ? description + ". " : ""}Analyze this food image. Reply with ONLY these three lines, nothing else:
Calories: <number>
Protein: <number>
Description: <max 20 characters>`;

  const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openrouter/free",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl } },
            { type: "text", text: promptText },
          ],
        },
      ],
    }),
  });

  if (!orRes.ok) {
    const err = await orRes.text();
    return Response.json({ error: `OpenRouter error: ${err}` }, { status: orRes.status });
  }

  const data = await orRes.json();
  const raw = (data.choices?.[0]?.message?.content ?? "").trim();

  const calMatch = raw.match(/^Calories:\s*(\d+)/im);
  const proMatch = raw.match(/^Protein:\s*(\d+)/im);
  const descMatch = raw.match(/^Description:\s*(.+)/im);

  return Response.json({
    calories: calMatch ? Number(calMatch[1]) : 0,
    protein_g: proMatch ? Number(proMatch[1]) : 0,
    description: descMatch ? descMatch[1].trim().slice(0, 20) : "",
    raw: raw.trim(),
  });
}
