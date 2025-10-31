// server.js — FerBot API estable con Trainer + Tracking + Dashboard Usabilidad
// ---------------------------------------------------------------------------------
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");

const app = express();

// --- Middlewares base ---
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// --- Static /public ---
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
app.use(express.static(PUBLIC_DIR));

// ----------------------------
// DATA PATHS
// ----------------------------
const DATA_DIR       = path.join(ROOT_DIR, "data");
const MEMORY_PATH    = path.join(DATA_DIR, "memory.json");           // KB (objeciones)
const VARIANTS_PATH  = path.join(DATA_DIR, "variants.json");         // variants por intent::stage
const STATS_PATH     = path.join(DATA_DIR, "stats.json");            // métricas (shown, wins, ratings)
const TRAINER_TXT    = path.join(DATA_DIR, "trainer_identity.txt");  // identidad del trainer
const TRAINER_KNOW   = path.join(DATA_DIR, "trainer_knowledge");     // carpeta .txt/.md (opcional)

for (const p of [DATA_DIR, TRAINER_KNOW]) {
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true });
}
if (!fssync.existsSync(MEMORY_PATH))    fssync.writeFileSync(MEMORY_PATH,   JSON.stringify({ items: [] }, null, 2));
if (!fssync.existsSync(VARIANTS_PATH))  fssync.writeFileSync(VARIANTS_PATH, JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(STATS_PATH))     fssync.writeFileSync(STATS_PATH,    JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(TRAINER_TXT))    fssync.writeFileSync(TRAINER_TXT, "");

// ----------------------------
// Helpers
// ----------------------------
async function readJsonSafe(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}
async function writeJsonPretty(file, obj) {
  // Escritura inmediata, sin debounce, para reflejar en dashboard enseguida
  await fs.writeFile(file, JSON.stringify(obj, null, 2), "utf8");
}
function normalizeSpaces(s = "") {
  return String(s).replace(/\s+/g, " ").replace(/ ,/g, ",").replace(/ \./g, ".").trim();
}
function normKey(s=""){ return String(s||"").toLowerCase().replace(/\s+/g," ").trim(); }
function clampReplyToWhatsApp(text, maxChars=220) {
  let t = (text || "").trim();
  // Máximo 2 frases
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  t = parts.slice(0,2).join(" ");
  if (t.length > maxChars) t = t.slice(0, maxChars-1).trimEnd() + "…";
  return t;
}

// ----------------------------
// Trainer (identidad + conocimiento)
// ----------------------------
let TRAINER_IDENTITY = "";
let TRAINER_SNIPPETS = ""; // texto concatenado de .txt/.md (capado 10k)

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
    model_env: process.env.OPENAI_MODEL || "gpt-5"
  });
});

// ----------------------------
// Intent helper
// ----------------------------
function inferIntent(q = "") {
  const s = (q || "").toLowerCase();
  if (/(precio|caro|costo|vale|promoci|oferta|descuento)/.test(s)) return "precio";
  if (/(tiempo|agenda|no tengo tiempo|horario|no alcanzo|ocupad)/.test(s)) return "tiempo";
  if (/(cert|certificado|certificacion|certificación)/.test(s)) return "cert";
  if (/(coursera|udemy|alura|competenc|otra plataforma)/.test(s)) return "competencia";
  if (/(pitch|qué es platzi|que es platzi|platzi)/.test(s)) return "pitch";
  return "_default";
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
// ASSIST_TRAINER — usa Trainer (system) + optional knowledge
// Devuelve: REPLY (≤220 chars, ≤2 frases) + WHY + NEXT
// ----------------------------
app.post("/assist_trainer", async (req, res) => {
  try {
    const { question = "", customerName = "", stage = "rebatir", intent:intentIn, context = "" } = req.body || {};
    const name = (customerName || "").trim();
    const safeName = name || "Cliente";
    const intent = intentIn || inferIntent(question);

    const rules = [
      "Eres FerBot, asesor comercial de Platzi para Colombia. Tono: español de Colombia, amable, dinámico, con energía positiva.",
      "No vendes cursos sueltos; vendes transformación con suscripción ANUAL.",
      "Respeta la ETAPA (sondeo, rebatir, pre_cierre, cierre, integracion).",
      "WhatsApp-friendly: ≤220 caracteres y máximo 2 frases.",
      "No llames, no pidas correos, no prometas beneficios no confirmados.",
      "Si falta contexto, pide UNA cosa y da CTA.",
      "FORMATO ESTRICTO (3 líneas):",
      "REPLY: <mensaje listo para WhatsApp (máx 220c, 1–2 frases)>",
      "WHY: <razón pedagógica concreta, qué validaste y cómo lo conviertes en valor (≤100c)>",
      "NEXT: <siguiente paso para el asesor (≤100c), orientado al plan ANUAL>"
    ].join("\n");

    const system = [
      TRAINER_IDENTITY || "",
      rules,
      TRAINER_SNIPPETS ? `Conocimiento adicional:\n${TRAINER_SNIPPETS}` : ""
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

    // Llamada OpenAI (sin max_tokens; algunos modelos requieren max_completion_tokens)
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
      // Mensajes comunes de error para el cliente
      if (r.status === 429) {
        return res.status(500).json({ ok:false, error:"openai_rate_limited", detail:"OpenAI 429: límite/cuota. Intenta más tarde." });
      }
      if (r.status === 400 && /Unsupported parameter/i.test(errText)) {
        return res.status(500).json({ ok:false, error:"openai_bad_param", detail:"Parámetro no soportado por el modelo." });
      }
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
    if (!why)  why  = "Valida lo que dice y lo convierte en valor.";
    if (!next) next = "Propón el paso inmediato hacia el plan anual.";

    // Tracking exposición
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
        guide: `POR QUÉ: ${why} · SIGUIENTE PASO: ${next}`,
        sections: { [stage]: reply },
        model,
        confidence: 0.9,
        intent,
        stage,
        persona: { name: "FerBot", brand: "Platzi" }
      }
    });
  } catch (err) {
    console.error("assist_trainer error", err);
    res.status(500).json({ ok:false, error:"assist_trainer_failed" });
  }
});

// ----------------------------
// Tracking endpoints
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

// ----------------------------
// Dashboard de Usabilidad (gráficos)
// ----------------------------
app.get("/admin/usability", async (_req, res) => {
  try {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"/>
<title>FerBot · Usabilidad</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="preconnect" href="https://cdn.jsdelivr.net"/>
<style>
  :root{--ink:#e2e8f0;--bg:#0b0f19;--card:#0f1524;--muted:#a4b0c0;--green:#97C93E}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial}
  .wrap{max-width:1200px;margin:16px auto;padding:0 16px}
  .header{display:flex;align-items:center;justify-content:space-between;margin:6px 0 16px}
  .pill{border:1px solid rgba(255,255,255,.1);padding:6px 10px;border-radius:999px;font-size:12px;color:#cbd5e1;background:#101727}
  .grid{display:grid;grid-template-columns: 1fr 1fr; gap:16px}
  .card{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px}
  .kpi{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px}
  .kpi h3{margin:0 0 8px;font-size:12px;color:#aeb7c5;font-weight:600}
  .kpi .num{font-size:22px;font-weight:800}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:8px;border-bottom:1px solid rgba(255,255,255,.06)}
  th{color:#aeb7c5;text-align:left}
  .footer{opacity:.7;font-size:12px;margin-top:12px}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h2 style="margin:0">FerBot · Usabilidad ⚡</h2>
    <div>
      <span class="pill" id="clock">--:--</span>
      <span class="pill">auto-refresh 5s</span>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><h3>Respuestas mostradas</h3><div class="num" id="k_shown">0</div></div>
    <div class="kpi"><h3>Winrate compuesto</h3><div class="num" id="k_wr">0%</div></div>
    <div class="kpi"><h3>👍 Buenas</h3><div class="num" id="k_good">0</div></div>
    <div class="kpi"><h3>👎 Malas</h3><div class="num" id="k_bad">0</div></div>
  </div>

  <div class="grid">
    <div class="card">
      <h3 style="margin:0 0 8px;color:#aeb7c5">Por etapa</h3>
      <canvas id="byStage" height="220"></canvas>
    </div>
    <div class="card">
      <h3 style="margin:0 0 8px;color:#aeb7c5">Por intento</h3>
      <canvas id="byIntent" height="220"></canvas>
    </div>
  </div>

  <div class="card" style="margin-top:12px">
    <h3 style="margin:0 0 8px;color:#aeb7c5">Top respuestas (efectivas)</h3>
    <table id="tbl"><thead><tr>
      <th>Intent</th><th>Stage</th><th>Texto</th><th>Shown</th><th>Wins</th><th>Winrate</th>
    </tr></thead><tbody></tbody></table>
    <div class="footer">Se actualiza con calificaciones en vivo.</div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
let ci1=null, ci2=null;
function donut(id, labels, data){
  const ctx = document.getElementById(id).getContext('2d');
  const existing = id==='byStage'?ci1:ci2;
  if (existing) existing.destroy();
  const c = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, borderColor:'#fff', borderWidth:1 }]},
    options: { plugins:{legend:{labels:{color:'#cbd5e1'}}}, cutout:'60%', responsive:true }
  });
  if (id==='byStage') ci1=c; else ci2=c;
}
async function load(){
  document.getElementById('clock').textContent = new Date().toLocaleTimeString();
  const r = await fetch('/stats'); const j = await r.json();
  const rows = (j.rows||[]);
  const tbody = document.querySelector('#tbl tbody');
  tbody.innerHTML = rows.map(r=>\`<tr>
    <td>\${r.intent}</td><td>\${r.stage}</td>
    <td>\${r.text.replace(/[&<>]/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[s]))}</td>
    <td>\${r.shown}</td><td>\${r.wins}</td><td>\${(r.winrate*100).toFixed(1)}%</td>
  </tr>\`).join('');

  // KPIs
  const shown = rows.reduce((a,b)=>a+b.shown,0);
  const wins  = rows.reduce((a,b)=>a+b.wins,0);
  const good  = rows.reduce((a,b)=>a+b.good,0);
  const bad   = rows.reduce((a,b)=>a+b.bad,0);
  const wr    = shown>0 ? (wins/shown*100) : 0;
  document.getElementById('k_shown').textContent = shown;
  document.getElementById('k_wr').textContent    = wr.toFixed(1)+'%';
  document.getElementById('k_good').textContent  = good;
  document.getElementById('k_bad').textContent   = bad;

  // Donuts
  const byStage = {}; const byIntent = {};
  rows.forEach(r=>{ byStage[r.stage]=(byStage[r.stage]||0)+r.shown; byIntent[r.intent]=(byIntent[r.intent]||0)+r.shown; });
  const sLabels = Object.keys(byStage); const sData = sLabels.map(k=>byStage[k]);
  const iLabels = Object.keys(byIntent); const iData = iLabels.map(k=>byIntent[k]);
  donut('byStage', sLabels.length?sLabels:['(sin datos)'], sData.length?sData:[1]);
  donut('byIntent', iLabels.length?iLabels:['(sin datos)'], iData.length?iData:[1]);
}
load(); setInterval(load, 5000);
</script>
</body></html>`);
  } catch (err) {
    res.status(500).send("Error");
  }
});

// /agent → panel.html (emergencia)
app.get("/agent", (_req,res)=> res.redirect("/panel.html"));

// ----------------------------
// Inicio servidor
// ----------------------------
(async () => {
  await loadTrainerIdentity();
  const PORT = Number(process.env.PORT || 3005);
  app.listen(PORT, () => {
    console.log(`🔥 FerBot API escuchando en http://localhost:${PORT}`);
  });
})();

