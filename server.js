// server.js — FerBot API (offline, OpenAI, Trainer con WHY/NEXT, respuestas cortas) + USAGE DASHBOARD
// ---------------------------------------------------------------------------------
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Rutas base
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
app.use(express.static(PUBLIC_DIR));

// ----------------------------
// DATA PATHS
// ----------------------------
const DATA_DIR       = path.join(ROOT_DIR, "data");
const MEMORY_PATH    = path.join(DATA_DIR, "memory.json");              // KB (objeciones)
const VARIANTS_PATH  = path.join(DATA_DIR, "variants.json");            // variants por intent::stage
const STATS_PATH     = path.join(DATA_DIR, "stats.json");               // métricas agregadas
const TRAINER_TXT    = path.join(DATA_DIR, "trainer_identity.txt");     // identidad del trainer
const TRAINER_KNOW   = path.join(DATA_DIR, "trainer_knowledge");        // carpeta .txt/.md (opcional)
const USAGE_LOG_PATH = path.join(DATA_DIR, "usage.ndjson");             // eventos atómicos (shown/rating/etc)

for (const p of [DATA_DIR]) {
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true });
}
if (!fssync.existsSync(MEMORY_PATH))    fssync.writeFileSync(MEMORY_PATH,   JSON.stringify({ items: [] }, null, 2));
if (!fssync.existsSync(VARIANTS_PATH))  fssync.writeFileSync(VARIANTS_PATH, JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(STATS_PATH))     fssync.writeFileSync(STATS_PATH,    JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(TRAINER_KNOW))   fssync.mkdirSync(TRAINER_KNOW, { recursive: true });
if (!fssync.existsSync(TRAINER_TXT))    fssync.writeFileSync(TRAINER_TXT, "");
if (!fssync.existsSync(USAGE_LOG_PATH)) fssync.writeFileSync(USAGE_LOG_PATH, "");

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
function appendUsage(event) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    fssync.appendFileSync(USAGE_LOG_PATH, line);
  } catch {}
}
function normalizeSpaces(s = "") {
  return String(s).replace(/\s+/g, " ").replace(/ ,/g, ",").replace(/ \./g, ".").trim();
}
function normKey(s=""){ return String(s||"").toLowerCase().replace(/\s+/g," ").trim(); }
function clampReplyToWhatsApp(text, maxChars=220) {
  let t = (text || "").trim();
  // Deja máximo 2 frases
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  t = parts.slice(0,2).join(" ");
  // Recorta por caracteres (suave)
  if (t.length > maxChars) t = t.slice(0, maxChars-1).trimEnd() + "…";
  return t;
}

// Variants cache (modo offline)
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
  if (/(precio|caro|costo|vale|promoci|oferta|descuento)/.test(s)) return "precio";
  if (/(tiempo|agenda|no tengo tiempo|horario|no alcanzo|ocupad)/.test(s)) return "tiempo";
  if (/(cert|certificado|certificacion|certificación)/.test(s)) return "cert";
  if (/(coursera|udemy|alura|competenc|otra plataforma)/.test(s)) return "competencia";
  if (/(pitch|qué es platzi|que es platzi|platzi)/.test(s)) return "pitch";
  return "_default";
}

async function buildGuideFromKB(intent = "_default") {
  const mem = await readJsonSafe(MEMORY_PATH, { items: [] });
  const items = Array.isArray(mem.items) ? mem.items : [];
  let pool = items.filter(it => it.tipo === "objecion" && it.tema === intent);
  if (pool.length === 0) pool = items.filter(it => it.tipo === "objecion" && it.tema === "_default");
  const bullets = pool.slice(0, 3).map(it => `• ${normalizeSpaces(it.contenido)}`);
  const suffix = "→ Cierra con un siguiente paso simple y accionable.";
  return normalizeSpaces(`${bullets.join(" ")} ${suffix}`);
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
  appendUsage({ type: "shown", intent, stage, text: replyText });
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
  appendUsage({ type: "winlose", won: !!won, intent, stage, text: replyText });
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
  appendUsage({ type: "rating", rating, intent, stage, text: replyText });
}

// ----------------------------
// TRAINER (identidad + conocimiento)
// ----------------------------
let TRAINER_IDENTITY = "";
let TRAINER_SNIPPETS = ""; // texto concatenado de .txt/.md (capado)

async function loadTrainerIdentity() {
  try {
    TRAINER_IDENTITY = (await fs.readFile(TRAINER_TXT, "utf8")).trim();
  } catch { TRAINER_IDENTITY = ""; }

  try {
    const files = await fs.readdir(TRAINER_KNOW);
    const texts = [];
    for (const f of files) {
      if (!/\.(txt|md)$/i.test(f)) continue;
      const p = path.join(TRAINER_KNOW, f);
      const t = (await fs.readFile(p, "utf8")).trim();
      if (t) texts.push(`# ${f}\n${t}`);
    }
    const joined = texts.join("\n\n---\n\n");
    TRAINER_SNIPPETS = joined.slice(0, 10000);
  } catch { TRAINER_SNIPPETS = ""; }
}

app.post("/admin/reloadTrainer", async (_req, res) => {
  await loadTrainerIdentity();
  res.json({ ok: true, identity_len: TRAINER_IDENTITY.length, knowledge_len: TRAINER_SNIPPETS.length });
});

// ----------------------------
// Health
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
// ASSIST offline (variants + KB)
// ----------------------------
app.post("/assist", async (req, res) => {
  try {
    const { question = "", customerName = "Cliente", stage = "rebatir" } = req.body || {};
    const name = customerName || "Cliente";
    const intent = inferIntent(question);

    const reply = clampReplyToWhatsApp(pickVariant(intent, stage, name));
    const guidePoints = await buildGuideFromKB(intent);
    const guide = normalizeSpaces(`Hola ${name}, ${guidePoints}`);

    trackShown(intent, stage, reply).catch(()=>{});

    res.json({
      ok: true,
      text: reply,
      whatsapp: reply,
      message: reply,
      answer: reply,
      result: {
        guide,
        reply,
        sections: { [stage]: reply },
        model: "offline-variants",
        confidence: 0.9,
        intent,
        stage
      },
      time_ms: 3
    });
  } catch (err) {
    console.error("assist error", err);
    res.status(500).json({ ok: false, error: "assist_failed" });
  }
});

// ----------------------------
// ASSIST OpenAI (general)
// ----------------------------
app.post("/assist_openai", async (req, res) => {
  try {
    const { question = "", customerName = "Cliente", stage = "rebatir" } = req.body || {};
    const name = customerName || "Cliente";
    const intent = inferIntent(question);

    const guidePoints = await buildGuideFromKB(intent);
    const system = [
      "Eres un asesor comercial breve y claro para WhatsApp (español).",
      "Tono cercano, hispano neutro.",
      "Respeta el 'stage' (sondeo, rebatir, pre_cierre, cierre, integracion).",
      "Responde en ≤220 caracteres y máximo 2 frases.",
      "Prohibido ofrecer clases gratis o beneficios no confirmados.",
      `Guía de contexto: ${guidePoints}`
    ].join("\n");

    const user = `Cliente: ${name}\nStage: ${stage}\nPregunta: ${question}\nIntent: ${intent}\nEntrega solo el mensaje final para WhatsApp.`;

    const apiKey = process.env.OPENAI_API_KEY;
    const model  = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!apiKey) return res.status(400).json({ ok: false, error: "missing_openai_api_key" });

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":"application/json",
        "Authorization":`Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
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
    const raw = data?.choices?.[0]?.message?.content?.trim() || `Hola ${name}, ¿Te explico cómo lo hacemos fácil y rápido?`;
    const reply = clampReplyToWhatsApp(raw);

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
        stage,
        persona: { name: "Ferney Salas", brand: "Platzi" }
      }
    });
  } catch (err) {
    console.error("assist_openai error", err);
    res.status(500).json({ ok:false, error:"assist_openai_failed" });
  }
});

// ----------------------------
// ASSIST_TRAINER — usa Trainer (system) + optional knowledge
// Devuelve: REPLY (≤220 chars, ≤2 frases) + WHY + NEXT
// ----------------------------
function fallbackWhy(stage, intent) {
  const map = {
    sondeo:     "Primero entendemos meta y contexto para personalizar la ruta.",
    rebatir:    "Anclamos beneficio real y reducimos fricción con micro-acción.",
    pre_cierre: "Validamos interés y facilitamos el primer paso guiado.",
    cierre:     "Ofrecemos el plan más simple para avanzar hoy.",
    integracion:"Refuerza la decisión y agenda hábito corto diario."
  };
  return map[stage] || `Guiamos por beneficio y CTA (${intent}/${stage}).`;
}
function fallbackNext(stage) {
  const map = {
    sondeo:     "Pregunta meta 30–60 días y tiempo diario.",
    rebatir:    "Propón 2 clases iniciales y pide OK.",
    pre_cierre: "Envía ruta y solicita confirmación para hoy.",
    cierre:     "Ofrece plan (Expert/Duo/Family) y pide elección.",
    integracion:"Deja mini agenda 5–10 min y seguimiento."
  };
  return map[stage] || "Cierra con un CTA simple y accionable.";
}

app.post("/assist_trainer", async (req, res) => {
  try {
    const { question = "", customerName = "", stage = "rebatir", intent:intentIn, context = "" } = req.body || {};
    const name = (customerName || "").trim();
    const safeName = name || "Cliente";
    const intent = intentIn || inferIntent(question);

    const rules = [
      "Hablas como asesor comercial de Platzi (español Colombia), claro y enérgico.",
      "WhatsApp-friendly: ≤220 caracteres y máximo 2 frases.",
      "Sin clases gratis ni beneficios no confirmados. No digas 'soy <nombre>'.",
      "Respeta el stage: sondeo, rebatir, pre_cierre, cierre, integracion.",
      "Si falta info, pide 1 dato clave y da micro-CTA.",
      "FORMATO ESTRICTO (3 líneas):",
      "REPLY: <mensaje para WhatsApp (máx 220c)>",
      "WHY: <por qué esta respuesta (≤100c, pedagógica)>",
      "NEXT: <siguiente paso para el asesor (≤100c)>"
    ].join("\n");

    const system = [
      TRAINER_IDENTITY || "",
      rules,
      TRAINER_SNIPPETS ? `Conocimiento adicional (resumen):\n${TRAINER_SNIPPETS}` : ""
    ].filter(Boolean).join("\n\n");

    const user = [
      name ? `Nombre del cliente: ${name}` : "Nombre del cliente: (no provisto)",
      `Stage: ${stage}`,
      `Intent: ${intent}`,
      context ? `Contexto: ${context}` : "",
      `Mensaje del cliente: ${question}`,
      "Recuerda el FORMATO estricto REPLY/WHY/NEXT."
    ].filter(Boolean).join("\n");

    const apiKey = process.env.OPENAI_API_KEY;
    const model  = process.env.OPENAI_MODEL || "gpt-5";
    if (!apiKey) return res.status(400).json({ ok: false, error: "missing_openai_api_key" });

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":"application/json",
        "Authorization":`Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
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
    const content = data?.choices?.[0]?.message?.content || "";

    // Parse REPLY / WHY / NEXT
    const mReply = content.match(/REPLY:\s*([\s\S]*?)(?:\n+WHY:|\n+NEXT:|$)/i);
    const mWhy   = content.match(/WHY:\s*(.*?)(?:\n+NEXT:|$)/i);
    const mNext  = content.match(/NEXT:\s*(.*)$/i);

    let reply = (mReply && mReply[1] || content).trim();
    let why   = (mWhy && mWhy[1]   || "").trim();
    let next  = (mNext && mNext[1] || "").trim();

    // Enforce WhatsApp length
    reply = clampReplyToWhatsApp(reply, 220);
    if (!why)  why  = fallbackWhy(stage, intent);
    if (!next) next = fallbackNext(stage);

    trackShown(intent, stage, reply).catch(()=>{});

    res.json({
      ok: true,
      text: reply,
      whatsapp: reply,
      message: reply,
      answer: reply,
      result: {
        reply,
        why,
        next,
        guide: `Por qué: ${why} · Siguiente paso: ${next}`,
        sections: { [stage]: reply },
        model,
        confidence: 0.9,
        intent,
        stage,
        persona: { name: "Ferney Salas", brand: "Platzi" }
      }
    });
  } catch (err) {
    console.error("assist_trainer error", err);
    res.status(500).json({ ok:false, error:"assist_trainer_failed" });
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

    // KB merge
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
// Stats JSON plano (existente)
// ----------------------------
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

// ----------------------------
// Dashboard sencillo (existente)
// ----------------------------
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
  <div style="margin:12px 0">
    <form method="GET" action="/stats" target="_blank"><button>Ver JSON</button></form>
    <form method="POST" action="/admin/reloadTrainer" style="display:inline"><button>Recargar Trainer</button></form>
  </div>
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

// ----------------------------
// NUEVO: JSON agregado para panel de usabilidad
// ----------------------------
app.get("/stats_full", async (_req, res) => {
  try {
    const raw = await readJsonSafe(STATS_PATH, { byKey: {} });
    const rows = [];
    const perIntent = {};
    const perStage  = {};
    let totals = { shown:0, wins:0, good:0, regular:0, bad:0 };

    for (const key of Object.keys(raw.byKey || {})) {
      const [intent, stage] = key.split("::");
      const map = raw.byKey[key];

      for (const text of Object.keys(map)) {
        const r = map[text];
        const shown = Number(r.shown || 0);
        const wins = Number(r.wins || 0);
        const good = Number(r.good || 0);
        const regular = Number(r.regular || 0);
        const bad = Number(r.bad || 0);
        const winrate = shown>0 ? +(wins/shown).toFixed(3) : 0;

        rows.push({ intent, stage, text, shown, wins, good, regular, bad, winrate });

        // Totales
        totals.shown += shown; totals.wins += wins; totals.good += good; totals.regular += regular; totals.bad += bad;

        // Intent
        if (!perIntent[intent]) perIntent[intent] = { shown:0, wins:0, good:0, regular:0, bad:0 };
        perIntent[intent].shown += shown; perIntent[intent].wins += wins;
        perIntent[intent].good  += good;  perIntent[intent].regular += regular; perIntent[intent].bad  += bad;

        // Stage
        if (!perStage[stage]) perStage[stage] = { shown:0, wins:0, good:0, regular:0, bad:0 };
        perStage[stage].shown += shown; perStage[stage].wins += wins;
        perStage[stage].good  += good;  perStage[stage].regular += regular; perStage[stage].bad  += bad;
      }
    }

    // Top respuestas por winrate ponderado
    const top = [...rows].sort((a,b)=> (b.winrate - a.winrate) || (b.shown - a.shown)).slice(0,20);

    res.json({
      ok:true,
      totals: {
        ...totals,
        winrate: totals.shown>0 ? +(totals.wins/totals.shown).toFixed(3) : 0
      },
      perIntent: Object.fromEntries(Object.entries(perIntent).map(([k,v])=>[
        k, { ...v, winrate: v.shown>0? +(v.wins/v.shown).toFixed(3):0 }
      ])),
      perStage: Object.fromEntries(Object.entries(perStage).map(([k,v])=>[
        k, { ...v, winrate: v.shown>0? +(v.wins/v.shown).toFixed(3):0 }
      ])),
      top
    });
  } catch (e) {
    console.error("stats_full error", e);
    res.status(500).json({ ok:false, error:"stats_full_failed" });
  }
});

// ----------------------------
// NUEVO: Panel de usabilidad (gráficos y live refresh)
// ----------------------------
app.get("/admin/usage", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>FerBot · Usabilidad</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net"/>
<style>
  :root{ --bg:#0b0f19; --card:#0f1524; --muted:#94a3b8; --fg:#e2e8f0; --accent:#97C93E; }
  *{ box-sizing:border-box }
  body{ margin:0; background:var(--bg); color:var(--fg); font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial }
  header{ display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.03) }
  h1{ font-size:18px; margin:0; display:flex; gap:8px; align-items:center; }
  .pill{ font-size:12px; color:var(--muted); display:inline-flex; align-items:center; gap:8px; background:#101827; border:1px solid rgba(255,255,255,.08); padding:6px 10px; border-radius:999px }
  main{ padding:18px; display:grid; grid-template-columns: 1.2fr 1fr; gap:16px }
  .grid-2{ display:grid; grid-template-columns: 1fr 1fr; gap:16px }
  .card{ background:var(--card); border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:14px; box-shadow:0 10px 30px rgba(0,0,0,.25) }
  .card h2{ font-size:14px; margin:0 0 8px; color:#cbd5e1 }
  .kpis{ display:grid; grid-template-columns: repeat(4,1fr); gap:12px }
  .kpi{ background:#101827; border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:12px }
  .kpi .v{ font-size:20px; font-weight:800 }
  .kpi .l{ font-size:11px; color:var(--muted) }
  table{ width:100%; border-collapse:collapse }
  th,td{ font-size:12px; padding:8px; border-bottom:1px solid rgba(255,255,255,.06) }
  th{ text-align:left; color:#cbd5e1; background:rgba(255,255,255,.03) }
  tr:hover{ background:rgba(255,255,255,.02) }
  footer{ padding:14px 18px; color:var(--muted) }
  .accent{ color:var(--accent) }
</style>
</head>
<body>
  <header>
    <h1>FerBot · Usabilidad <span class="accent">⚡</span></h1>
    <div class="pill"><span id="ts">—</span> · auto-refresh 5s</div>
  </header>

  <main>
    <section class="card">
      <div class="kpis">
        <div class="kpi"><div class="v" id="k_shown">0</div><div class="l">Respuestas mostradas</div></div>
        <div class="kpi"><div class="v" id="k_winrate">0%</div><div class="l">Winrate compuesto</div></div>
        <div class="kpi"><div class="v" id="k_good">0</div><div class="l">👍 Buenas</div></div>
        <div class="kpi"><div class="v" id="k_bad">0</div><div class="l">👎 Malas</div></div>
      </div>
      <div style="margin-top:12px" class="grid-2">
        <div class="card"><h2>Por etapa</h2><canvas id="c_stage" height="160"></canvas></div>
        <div class="card"><h2>Por intento</h2><canvas id="c_intent" height="160"></canvas></div>
      </div>
    </section>

    <section class="card">
      <h2>Top respuestas (efectivas)</h2>
      <table id="tbl_top">
        <thead><tr><th>Intent</th><th>Stage</th><th>Texto</th><th>Shown</th><th>Wins</th><th>Winrate</th></tr></thead>
        <tbody></tbody>
      </table>
    </section>

    <section class="card" style="grid-column:1 / span 2">
      <h2>Distribución de calificaciones</h2>
      <canvas id="c_ratings" height="120"></canvas>
    </section>
  </main>

  <footer>Hecho con ❤️ y <span class="accent">Platzi</span>.</footer>

  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    let chStage, chIntent, chRatings;
    async function fetchStats(){
      const r = await fetch('/stats_full');
      if(!r.ok) throw new Error('stats_full fail');
      return r.json();
    }
    function fmtPct(x){ return (x*100).toFixed(1)+'%'; }

    function upKPIs(tot){
      document.getElementById('k_shown').textContent   = tot.shown||0;
      document.getElementById('k_winrate').textContent = fmtPct(tot.winrate||0);
      document.getElementById('k_good').textContent    = tot.good||0;
      document.getElementById('k_bad').textContent     = tot.bad||0;
    }

    function upTableTop(top){
      const tb = document.querySelector('#tbl_top tbody');
      tb.innerHTML = top.map(r=> \`
        <tr>
          <td>\${r.intent}</td>
          <td>\${r.stage}</td>
          <td>\${r.text.replace(/[<>]/g, s=>({ '<':'&lt;','>':'&gt;' }[s]))}</td>
          <td style="text-align:right">\${r.shown}</td>
          <td style="text-align:right">\${r.wins}</td>
          <td style="text-align:right">\${(r.winrate*100).toFixed(1)}%</td>
        </tr>\`
      ).join('') || '<tr><td colspan="6" style="color:#94a3b8">Sin datos</td></tr>';
    }

    function dataToPie(obj){
      const labels = Object.keys(obj);
      const data   = labels.map(k=> obj[k].shown||0);
      return { labels, data };
    }
    function dataToRatings(tot, perIntent){
      const labels = Object.keys(perIntent);
      const good = labels.map(k=> perIntent[k].good||0);
      const regular = labels.map(k=> perIntent[k].regular||0);
      const bad = labels.map(k=> perIntent[k].bad||0);
      return { labels, good, regular, bad };
    }

    function ensureCharts(){
      const ctxS = document.getElementById('c_stage').getContext('2d');
      const ctxI = document.getElementById('c_intent').getContext('2d');
      const ctxR = document.getElementById('c_ratings').getContext('2d');
      if(!chStage){
        chStage = new Chart(ctxS, { type:'doughnut', data:{labels:[], datasets:[{data:[]}]}, options:{ plugins:{legend:{labels:{color:'#e2e8f0'}}}}});
      }
      if(!chIntent){
        chIntent = new Chart(ctxI, { type:'doughnut', data:{labels:[], datasets:[{data:[]}]}, options:{ plugins:{legend:{labels:{color:'#e2e8f0'}}}}});
      }
      if(!chRatings){
        chRatings = new Chart(ctxR, { type:'bar', data:{labels:[], datasets:[
          {label:'👍 Buenas', data:[]},
          {label:'😐 Regulares', data:[]},
          {label:'👎 Malas', data:[]}
        ]}, options:{ responsive:true, plugins:{legend:{labels:{color:'#e2e8f0'}}}, scales:{
          x:{ticks:{color:'#e2e8f0'}}, y:{ticks:{color:'#e2e8f0'}}
        }}});
      }
    }

    async function refresh(){
      try{
        const js = await fetchStats();
        const { totals, perStage, perIntent, top } = js;
        upKPIs(totals);
        upTableTop(top);

        ensureCharts();

        const s = dataToPie(perStage);
        chStage.data.labels = s.labels; chStage.data.datasets[0].data = s.data; chStage.update();

        const i = dataToPie(perIntent);
        chIntent.data.labels = i.labels; chIntent.data.datasets[0].data = i.data; chIntent.update();

        const r = dataToRatings(totals, perIntent);
        chRatings.data.labels = r.labels;
        chRatings.data.datasets[0].data = r.good;
        chRatings.data.datasets[1].data = r.regular;
        chRatings.data.datasets[2].data = r.bad;
        chRatings.update();

        document.getElementById('ts').textContent = new Date().toLocaleTimeString();
      }catch(e){
        document.getElementById('ts').textContent = 'Error';
      }
    }
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`);
});

// /agent → agent.html
app.get("/agent", (_req,res)=> res.redirect("/agent.html"));

// ----------------------------
// Inicio servidor
// ----------------------------
(async () => {
  await loadVariants();
  await loadTrainerIdentity();
  console.log("➡️  OpenAI habilitado.", !!process.env.OPENAI_API_KEY);
  const PORT = Number(process.env.PORT || 3005);
  app.listen(PORT, () => {
    console.log(`🔥 FerBot API escuchando en http://localhost:${PORT}`);
  });
})();
