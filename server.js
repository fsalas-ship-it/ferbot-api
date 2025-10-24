// server.js — FerBot API (estable + OpenAI opcional + UI estática)
// ---------------------------------------------------------------
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Servir carpeta pública (UI del asesor: public/agent.html)
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
app.use(express.static(PUBLIC_DIR));

// ----------------------------
// Rutas de datos
// ----------------------------
const DATA_DIR      = path.join(ROOT_DIR, "data");
const MEMORY_PATH   = path.join(DATA_DIR, "memory.json");   // KB (objeciones)
const VARIANTS_PATH = path.join(DATA_DIR, "variants.json"); // variantes por intent::stage
const STATS_PATH    = path.join(DATA_DIR, "stats.json");    // métricas

for (const p of [DATA_DIR]) {
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true });
}
if (!fssync.existsSync(MEMORY_PATH))   fssync.writeFileSync(MEMORY_PATH,   JSON.stringify({ items: [] }, null, 2));
if (!fssync.existsSync(VARIANTS_PATH)) fssync.writeFileSync(VARIANTS_PATH, JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(STATS_PATH))    fssync.writeFileSync(STATS_PATH,    JSON.stringify({ byKey: {} }, null, 2));

// ----------------------------
// Helpers
// ----------------------------
async function readJsonSafe(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}
async function writeJsonPretty(file, obj) {
  await fs.writeFile(file, JSON.stringify(obj, null, 2), "utf8");
}
function normalizeSpaces(s = "") {
  return String(s).replace(/\s+/g, " ").replace(/ ,/g, ",").replace(/ \./g, ".").trim();
}
function normKey(s=""){ return String(s||"").toLowerCase().replace(/\s+/g," ").trim(); }

// ------- Variants / intents -------
let VAR_CACHE = { byKey: {} };
async function loadVariants() {
  const v = await readJsonSafe(VARIANTS_PATH, { byKey: {} });
  VAR_CACHE = v?.byKey ? v : { byKey: {} };
}

function pickVariant(intent, stage, name) {
  const key = `${intent}::${stage}`;
  const block = VAR_CACHE.byKey[key];
  if (!block || !Array.isArray(block.variants) || block.variants.length === 0) {
    const fb = VAR_CACHE.byKey[`_default::${stage}`] || VAR_CACHE.byKey[`_default::rebatir`];
    const v = fb?.variants?.[0]?.text || `Hola ${name}, ¿Te explico cómo lo hacemos fácil y rápido?`;
    return v.replace(/{name}/g, name);
  }
  let list = block.variants;
  let total = list.reduce((acc, v) => acc + (Number(v.weight || 1)), 0);
  let r = Math.random() * total;
  for (const v of list) {
    r -= Number(v.weight || 1);
    if (r <= 0) return (v.text || "").replace(/{name}/g, name);
  }
  return (list[0].text || "").replace(/{name}/g, name);
}

function inferIntent(q = "") {
  const s = (q || "").toLowerCase();
  if (/(precio|caro|costo|costoso|vale|promoci|oferta|descuento)/.test(s)) return "precio";
  if (/(tiempo|agenda|no tengo tiempo|horario|no alcanzo|ocupad)/.test(s)) return "tiempo";
  if (/(cert|certificado|certificacion|certificación)/.test(s)) return "cert";
  if (/(coursera|udemy|alura|competenc|otra plataforma)/.test(s)) return "competencia";
  if (/(pitch|qué es platzi|que es platzi|platzi)/.test(s)) return "pitch";
  return "_default";
}

// ---------- NUEVO: Guía limpia (contexto + siguiente paso) ----------
async function buildGuideFromKB(intent = "_default", stage = "rebatir") {
  // 1) Lee KB y filtra por intent (con fallback a _default)
  const mem = await readJsonSafe(MEMORY_PATH, { items: [] });
  const items = Array.isArray(mem.items) ? mem.items : [];
  let pool = items.filter(it => it.tipo === "objecion" && it.tema === intent);
  if (pool.length === 0) pool = items.filter(it => it.tipo === "objecion" && it.tema === "_default");

  // 2) Normaliza y elimina duplicados
  const seen = new Set();
  const unique = [];
  for (const it of pool) {
    const raw = normalizeSpaces(it.contenido || "");
    const key = raw.toLowerCase();
    if (raw && !seen.has(key)) {
      seen.add(key);
      unique.push(raw);
    }
  }

  // 3) Toma 1–2 puntos máximo y conviértelos a una sola frase
  const picked = unique.slice(0, 2);
  const contexto =
    picked.length === 0
      ? "Platzi transforma carreras con rutas, comunidad y certificaciones verificables."
      : picked.join(" ");

  // 4) CTA según stage (sin ofrecer clases gratis)
  const ctas = {
    sondeo:
      "Haz 2 preguntas clave (meta y tiempo disponible) y confirma si busca certificación.",
    rebatir:
      "Propón enviar su ruta personalizada y un plan de inicio para hoy (2 pasos).",
    pre_cierre:
      "Sugiere el plan adecuado (Expert/Duo/Family) y valida preferencia.",
    cierre:
      "Confirma el plan elegido y pide el OK para activarlo.",
    integracion:
      "Felicita la decisión y agenda un check-in en 7 días para revisar avances."
  };
  const siguientePaso = ctas[stage] || ctas["rebatir"];

  // 5) Devuelve un texto ya formateado para el asesor
  const suffix = "→ Siguiente paso:";
  return `Contexto: ${contexto} ${suffix} ${siguientePaso}`;
}

// ----------------------------
// Tracking + Ratings
// ----------------------------
function ensureStatEntry(stats, intent, stage, text) {
  const key = `${intent}::${stage}`;
  if (!stats.byKey[key]) stats.byKey[key] = {};
  const t = (text || "").trim();
  if (!stats.byKey[key][t]) stats.byKey[key][t] = { shown: 0, wins: 0, good: 0, regular: 0, bad: 0 };
  return { key, t };
}
async function trackShown(intent, stage, replyText) {
  const stats = await readJsonSafe(STATS_PATH, { byKey: {} });
  const { key, t } = ensureStatEntry(stats, intent, stage, replyText);
  stats.byKey[key][t].shown += 1;
  await writeJsonPretty(STATS_PATH, stats);
}
async function trackWinLose(intent, stage, replyText, won) {
  const stats = await readJsonSafe(STATS_PATH, { byKey: {} });
  const { key, t } = ensureStatEntry(stats, intent, stage, replyText);
  stats.byKey[key][t].shown = Math.max(stats.byKey[key][t].shown, 1);
  if (won) {
    stats.byKey[key][t].wins += 1;
    stats.byKey[key][t].good += 1;
  } else {
    stats.byKey[key][t].bad += 1;
  }
  await writeJsonPretty(STATS_PATH, stats);
}
async function trackRating(intent, stage, replyText, rating) {
  const stats = await readJsonSafe(STATS_PATH, { byKey: {} });
  const { key, t } = ensureStatEntry(stats, intent, stage, replyText);
  stats.byKey[key][t].shown = Math.max(stats.byKey[key][t].shown, 1);
  if (rating === "good") {
    stats.byKey[key][t].good += 1;
    stats.byKey[key][t].wins += 1;
  } else if (rating === "regular") {
    stats.byKey[key][t].regular += 1;
    stats.byKey[key][t].wins += 0.5;
  } else if (rating === "bad") {
    stats.byKey[key][t].bad += 1;
  }
  await writeJsonPretty(STATS_PATH, stats);
}

// ----------------------------
// Básico: health
// ----------------------------
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ferbot-api",
    time: new Date().toISOString(),
    openai: !!process.env.OPENAI_API_KEY,
    model_env: process.env.OPENAI_MODEL || "(unset)"
  });
});

// ----------------------------
// ASSIST (offline con variants + KB)
// ----------------------------
app.post("/assist", async (req, res) => {
  try {
    const { question = "", customerName = "Cliente", stage = "rebatir" } = req.body || {};
    const name = customerName || "Cliente";
    const intent = inferIntent(question);

    const reply = pickVariant(intent, stage, name);
    const guidePoints = await buildGuideFromKB(intent, stage); // <— usa stage
    const guide = normalizeSpaces(`Hola ${name}, ${guidePoints}`);

    trackShown(intent, stage, reply).catch(()=>{});

    const result = {
      guide,
      reply,
      sections: { [stage]: reply },
      model: "offline-variants",
      confidence: 0.9,
      intent,
      stage
    };

    res.json({
      ok: true,
      text: reply,
      whatsapp: reply,
      message: reply,
      answer: reply,
      result,
      time_ms: 3
    });
  } catch (err) {
    console.error("assist error", err);
    res.status(500).json({ ok: false, error: "assist_failed" });
  }
});

// ----------------------------
// ASSIST con OpenAI (GPT-5/gpt-4o-mini, si pones tu API Key)
// ----------------------------
app.post("/assist_openai", async (req, res) => {
  try {
    const { question = "", customerName = "Cliente", stage = "rebatir" } = req.body || {};
    const name = customerName || "Cliente";
    const intent = inferIntent(question);

    const guidePoints = await buildGuideFromKB(intent, stage); // <— usa stage
    const system = [
      "Eres un asesor comercial breve y claro para WhatsApp.",
      "Tono cercano, hispano neutro.",
      "Respeta el 'stage' (sondeo, rebatir, pre_cierre, cierre, integracion).",
      "Responde en 1-2 líneas, accionable y sin adornos extra.",
      "No ofrezcas clases gratis.",
      `Guía para el asesor: ${guidePoints}`
    ].join("\n");

    const user = `Cliente: ${name}\nStage: ${stage}\nIntent detectado: ${intent}\nPregunta: ${question}\nResponde solo el mensaje final para WhatsApp.`;

    const apiKey = process.env.OPENAI_API_KEY;
    const model  = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!apiKey) return res.status(400).json({ ok: false, error: "missing_openai_api_key" });

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":`Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        // No enviamos temperature para evitar "unsupported_value" en algunos modelos
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(()=> "");
      return res.status(500).json({ ok:false, error: "openai_failed", detail: errText });
    }
    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || `Hola ${name}, ¿Te explico cómo lo hacemos fácil y rápido?`;

    trackShown(intent, stage, reply).catch(()=>{});

    res.json({
      ok: true,
      text: reply,
      whatsapp: reply,
      message: reply,
      answer: reply,
      result: {
        guide: `Hola ${name}, ${guidePoints}`,
        reply,
        sections: { [stage]: reply },
        model,
        confidence: 0.85,
        intent,
        stage
      }
    });
  } catch (err) {
    console.error("assist_openai error", err);
    res.status(500).json({ ok:false, error:"assist_openai_failed" });
  }
});

// ----------------------------
// IMPORTADOR (merge) de data/ferney_variants.json
// ----------------------------
app.post("/admin/importFerney", async (_req, res) => {
  try {
    const FERNEY_FILE = path.join(DATA_DIR, "ferney_variants.json");
    const raw = await fs.readFile(FERNEY_FILE, "utf8");
    const data = JSON.parse(raw);

    const currentVariants = await readJsonSafe(VARIANTS_PATH, { byKey: {} });
    if (!currentVariants.byKey) currentVariants.byKey = {};
    let variants_added = 0, variants_skipped = 0;

    if (Array.isArray(data.variants)) {
      for (const block of data.variants) {
        const intent = String(block.intent || "_default");
        const stage = String(block.stage || "rebatir");
        const key = `${intent}::${stage}`;
        if (!currentVariants.byKey[key]) currentVariants.byKey[key] = { intent, stage, variants: [] };

        const existingSet = new Set(
          (currentVariants.byKey[key].variants || [])
            .map(v => normKey(v.text))
        );

        const incoming = Array.isArray(block.variants) ? block.variants : [];
        for (const v of incoming) {
          const text = (v.text || "").trim();
          if (!text) continue;
          const nkey = normKey(text);
          if (existingSet.has(nkey)) { variants_skipped++; continue; }
          currentVariants.byKey[key].variants.push({ text, weight: Number(v.weight || 1) });
          existingSet.add(nkey);
          variants_added++;
        }
      }
    }

    await writeJsonPretty(VARIANTS_PATH, currentVariants);
    await loadVariants();

    // KB (objeciones) merge
    const memory = await readJsonSafe(MEMORY_PATH, { items: [] });
    const items = Array.isArray(memory.items) ? memory.items : [];
    const memSet = new Set(items.map(it => `${normKey(it.tema)}::${normKey(it.contenido)}`));
    let kb_added = 0, kb_skipped = 0;

    if (Array.isArray(data.kb)) {
      for (const k of data.kb) {
        const tema = String(k.tema || "_default");
        const contenido = (k.contenido || "").trim();
        if (!contenido) continue;
        const sig = `${normKey(tema)}::${normKey(contenido)}`;
        if (memSet.has(sig)) { kb_skipped++; continue; }
        items.push({ tipo: "objecion", tema, contenido, ts: new Date().toISOString(), source: "ferney_variants.json" });
        memSet.add(sig);
        kb_added++;
      }
    }
    await writeJsonPretty(MEMORY_PATH, { items });

    res.json({
      ok: true,
      mode: "merge",
      variants_added,
      variants_skipped,
      kb_added,
      kb_skipped
    });
  } catch (err) {
    console.error("importFerney error", err);
    res.status(500).json({ ok: false, error: "import_failed" });
  }
});

// ----------------------------
// Endpoints de tracking y stats
// ----------------------------
app.post("/trackShow", async (req, res) => {
  try {
    const { intent = "_default", stage = "rebatir", text = "" } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: "missing_text" });
    await trackShown(intent, stage, text);
    res.json({ ok: true });
  } catch (err) {
    console.error("trackShow error", err);
    res.status(500).json({ ok: false, error: "track_show_failed" });
  }
});
app.post("/trackWin", async (req, res) => {
  try {
    const { intent = "_default", stage = "rebatir", text = "", won = false } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: "missing_text" });
    await trackWinLose(intent, stage, text, !!won);
    res.json({ ok: true });
  } catch (err) {
    console.error("trackWin error", err);
    res.status(500).json({ ok: false, error: "track_win_failed" });
  }
});
app.post("/trackRate", async (req, res) => {
  try {
    const { intent = "_default", stage = "rebatir", text = "", rating = "regular" } = req.body || {};
    if (!text)   return res.status(400).json({ ok: false, error: "missing_text" });
    if (!["good","regular","bad"].includes(rating)) {
      return res.status(400).json({ ok: false, error: "invalid_rating" });
    }
    await trackRating(intent, stage, text, rating);
    res.json({ ok: true });
  } catch (err) {
    console.error("trackRate error", err);
    res.status(500).json({ ok: false, error: "track_rate_failed" });
  }
});

app.get("/stats", async (_req, res) => {
  try {
    const stats = await readJsonSafe(STATS_PATH, { byKey: {} });
    const out = [];
    for (const key of Object.keys(stats.byKey || {})) {
      const [intent, stage] = key.split("::");
      const map = stats.byKey[key];
      for (const text of Object.keys(map)) {
        const row = map[text];
        const shown = Number(row.shown || 0);
        const wins = Number(row.wins || 0);
        const winrate = shown > 0 ? +(wins / shown).toFixed(3) : 0;
        out.push({
          intent, stage, text, shown, wins, winrate,
          good: Number(row.good || 0),
          regular: Number(row.regular || 0),
          bad: Number(row.bad || 0),
        });
      }
    }
    out.sort((a,b)=> (b.winrate - a.winrate) || (b.shown - a.shown));
    res.json({ ok: true, rows: out });
  } catch (err) {
    console.error("stats error", err);
    res.status(500).json({ ok: false, error: "stats_failed" });
  }
});

app.get("/admin/dashboard", async (_req, res) => {
  try {
    const resp = await (await fetchLocalStats()).json();
    const rows = (resp.rows || []).map(r => `
      <tr>
        <td>${r.intent}</td>
        <td>${r.stage}</td>
        <td>${escapeHtml(r.text)}</td>
        <td style="text-align:right">${r.shown}</td>
        <td style="text-align:right">${r.wins}</td>
        <td style="text-align:right">${(r.winrate*100).toFixed(1)}%</td>
      </tr>
    `).join("");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"/>
<title>FerBot · Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial;background:#0b0f19;color:#e2e8f0;margin:0;padding:24px}
  h1{margin:0 0 12px;font-size:20px}
  table{width:100%;border-collapse:collapse;background:#0f1524;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden}
  th,td{padding:10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}
  th{background:rgba(255,255,255,.04);text-align:left}
  tr:hover{background:rgba(255,255,255,.03)}
  .sub{opacity:.7;font-size:12px;margin-bottom:16px}
</style>
</head>
<body>
  <h1>FerBot · Dashboard</h1>
  <div class="sub">Ranking por winrate y exposición (wins compuestos: buena=1, regular=0.5, mala=0)</div>
  <table>
    <thead><tr><th>Intent</th><th>Stage</th><th>Texto</th><th>Shown</th><th>Wins</th><th>Winrate</th></tr></thead>
    <tbody>${rows || ""}</tbody>
  </table>
</body></html>`);
  } catch (err) {
    res.status(500).send("Error");
  }
});

function escapeHtml(s=""){return s.replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]))}
async function fetchLocalStats(){
  const stats = await readJsonSafe(STATS_PATH, { byKey: {} });
  const out = [];
  for (const key of Object.keys(stats.byKey || {})) {
    const [intent, stage] = key.split("::");
    const map = stats.byKey[key];
    for (const text of Object.keys(map)) {
      const row = map[text];
      const shown = Number(row.shown || 0);
      const wins = Number(row.wins || 0);
      const winrate = shown > 0 ? +(wins / shown).toFixed(3) : 0;
      out.push({
        intent, stage, text, shown, wins, winrate,
        good: Number(row.good || 0),
        regular: Number(row.regular || 0),
        bad: Number(row.bad || 0),
      });
    }
  }
  out.sort((a,b)=> (b.winrate - a.winrate) || (b.shown - a.shown));
  return { json: async () => ({ ok:true, rows: out }) };
}

// Acceso directo: /agent redirige a agent.html
app.get("/agent", (_req,res)=> res.redirect("/agent.html"));

// ----------------------------
// Inicio servidor
// ----------------------------
(async () => {
  await loadVariants();
  console.log("➡️  OpenAI habilitado.", !!process.env.OPENAI_API_KEY);
  const PORT = Number(process.env.PORT || 3005);
  app.listen(PORT, () => {
    console.log(`🔥 FerBot API escuchando en http://localhost:${PORT}`);
  });
})();
