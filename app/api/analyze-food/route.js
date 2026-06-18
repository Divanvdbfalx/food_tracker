export const runtime = "nodejs";

export async function POST(request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return Response.json({ error: "OPENROUTER_API_KEY not configured" }, { status: 500 });

  const { imageDataUrl, description } = await request.json();
  if (!imageDataUrl) return Response.json({ error: "No image provided" }, { status: 400 });

  const promptText = `${description ? description + ". " : ""}And estimate the macros. List only Short Description, Protein, Calories. Return ONLY compact JSON: {"description": "string", "protein_g": number, "calories": number}`;

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
  const raw = data.choices?.[0]?.message?.content ?? "";

  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Response.json({
      description: parsed.description ?? "",
      protein_g: Number(parsed.protein_g ?? 0),
      calories: Number(parsed.calories ?? 0),
    });
  } catch {
    const calMatch = raw.match(/calories[:\s]*(\d+)/i);
    const proMatch = raw.match(/protein[:\s]*(\d+)/i);
    return Response.json({
      description: raw.slice(0, 200),
      protein_g: proMatch ? Number(proMatch[1]) : 0,
      calories: calMatch ? Number(calMatch[1]) : 0,
    });
  }
}
