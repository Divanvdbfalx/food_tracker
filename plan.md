# Plan: Camera-based macro estimation in the Calorie Entry tab

## Goal
In the **Calorie Entry** tab, add a camera/photo option. The user takes (or picks) a
photo of food and adds a short description. The app sends the **image + description +
a premade prompt** to OpenRouter (mirroring `openrouter_test.py`), gets back a macro
estimate, and **auto-fills** the calorie-entry fields (description/notes, protein,
calories). The user can review and tap **Add Calorie Entry** as usual.

The premade prompt:
> `<user description>. And estimate the macros. List only Short Description, Protein, Calories`

---

## Why a server-side API route
`OPENROUTER_API_KEY` in `.env` is **not** `NEXT_PUBLIC_*`, so it is only available
server-side — and it must stay that way (never ship the key to the browser).
So the browser cannot call OpenRouter directly. We add a Next.js API route that the
client calls; the route holds the key and talks to OpenRouter.

This mirrors `openrouter_test.py` exactly (same base URL, same message shape with an
`image_url` data-URI + `text` part), just running in the Node route instead of Python.

---

## Steps

### 1. New API route — `app/api/analyze-food/route.js`
- `export const runtime = "nodejs";`
- `POST` handler accepts JSON `{ imageDataUrl, description }`.
  - `imageDataUrl` is a full `data:image/...;base64,...` string (built on the client).
- Call OpenRouter with `fetch` (no new npm dep needed) to
  `https://openrouter.ai/api/v1/chat/completions`:
  - Header `Authorization: Bearer ${process.env.OPENROUTER_API_KEY}`.
  - Body mirrors the Python example:
    ```
    model: "openrouter/free"
    messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: imageDataUrl } },
      { type: "text", text: `${description}. And estimate the macros. List only Short Description, Protein, Calories.
                             Return ONLY compact JSON: {"description": string, "protein_g": number, "calories": number}` }
    ]}]
    ```
  - We keep the user's exact wording and append a JSON-format instruction so the
    response is reliably parseable (instead of regex-scraping free text).
- Parse `choices[0].message.content`:
  - Strip any ```` ```json ```` fences, `JSON.parse`, pull `description`,
    `protein_g`, `calories`.
  - Fallback: if JSON parse fails, regex out `Protein` / `Calories` numbers and use
    the raw text as the description.
- Return `{ description, protein_g, calories }` (or `{ error }` with a 4xx/5xx on failure).
- Guard: if `OPENROUTER_API_KEY` is missing, return a clear 500 message.

### 2. Calorie Entry UI — `app/page.js` (the `tab === "calorie"` panel)
Add a small "Estimate from photo" block above the existing fields, inside the form.
New state in `Page()`:
- `photoPreview` (data URL for thumbnail), `analyzing` (bool), `analyzeMsg` (string).
- A hidden `<input type="file" accept="image/*" capture="environment">` + a visible
  "Take / choose photo" button that triggers it. `capture="environment"` opens the
  rear camera on mobile; on desktop it falls back to a file picker.
- An optional short-description text input (defaults empty; feeds the prompt).

Flow:
1. On file select → read file as data URL (`FileReader`), set `photoPreview`.
2. "Analyze" button (or auto on select) → set `analyzing`, `POST` to
   `/api/analyze-food` with `{ imageDataUrl, description }`.
3. On success → `setCalForm` with:
   - `calories` ← returned calories
   - `protein_g` ← returned protein
   - `notes` ← returned short description (so it lands in the existing Notes field
     that is already saved to `calorie_log.notes`)
   - leave `date` / `time` / `meal_tag` as the existing auto logic.
4. Show `analyzeMsg` (e.g. "Estimated from photo — review and Add").
5. User edits if needed and clicks the existing **Add Calorie Entry** button →
   `addCalories()` runs unchanged.

### 3. Styling — `app/globals.css`
- Small styles for the photo button, thumbnail preview, and a disabled/spinner state
  on the Analyze button. Reuse existing `.field-label`, `.muted`, `.secondary-btn`.

---

## Data flow summary
```
[Camera/file] -> FileReader -> data URL
   -> POST /api/analyze-food { imageDataUrl, description }
   -> OpenRouter (server, key hidden) -> JSON { description, protein_g, calories }
   -> setCalForm(...) -> user reviews -> "Add Calorie Entry" -> supabase insert
```

## Files touched
- `app/api/analyze-food/route.js` — **new** (server route to OpenRouter)
- `app/page.js` — camera input, description field, analyze handler, fill calForm
- `app/globals.css` — minor styles

## Notes / decisions
- No new npm dependency: use `fetch` instead of the `openai` SDK (the route body is a
  1:1 translation of `openrouter_test.py`).
- Model kept as `"openrouter/free"` to match the example; easy to swap later.
- Nothing in the DB schema changes — estimates flow into existing
  `calories`, `protein_g`, `notes` columns.
- Image is sent as a base64 data URI per request and not persisted.
```
