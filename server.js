// server.js — FerBot API (offline + OpenAI + Panel unificado + Analizador ES)
// GLOBAL READY: panel /admin/panel, keep logs en data/* (Render: usar Disk para persistir)
// ---------------------------------------------------------------------------------------
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");

const app = express();
app.use(cors({ origin: "*"}));
app.use(express.json({ limit: "1mb" }));

// ----------------------------
// Paths y archivos
// ----------------------------
const ROOT_DIR    = __dirname;
const PUBLIC_DIR  = path.join(ROOT_DIR, "public");
const DATA_DIR    = path.join(ROOT_DIR, "data");
const MEMORY_PATH   = path.join(DATA_DIR, "memory.json");
const VARIANTS_PATH = path.join(DATA_DIR, "variants.json");
const STATS_PATH    = path.join(DATA_DIR, "stats.json");
const USAGE_PATH    = path.join(DATA_DIR, "usage.json");

for (const p of [DATA_DIR]) {
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true });
}
if (!fssync.existsSync(MEMORY_PATH))   fssync.writeFileSync(MEMORY_PATH,   JSON.stringify({ items: [] }, null, 2));
if (!fssync.existsSync(VARIANTS_PATH)) fssync.writeFileSync(VARIANTS_PATH, JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(STATS_PATH))    fssync.writeFileSync(STATS_PATH,    JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(USAGE_PATH))    fssync.writeFileSync(USAGE_PATH,    JSON.stringify({ events: [] }, null, 2));

app.use(express.static(PUBLIC_DIR)); // opcional: /public

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

// ----------------------------
// Variants
// ----------------------------
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
  if (/(pitch|presenta|qué hace platzi|que hace platzi)/.test(s)) return "pitch";
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
// Stats (rating por variante)
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
// USAGE (tráfico / usuarios)
// ----------------------------
function dayKey(d = new Date()){
  const z = new Date(d);
  z.setUTCHours(0,0,0,0);
  return z.toISOString().slice(0,10);
}
async function logUsage(evt = {}) {
  const u = await readJsonSafe(USAGE_PATH, { events: [] });
  if (!Array.isArray(u.events)) u.events = [];
  const now = new Date();
  u.events.push({
    ts: now.toISOString(),
    day: dayKey(now),
    user_id: String(evt.user_id || "anon"),
    channel: String(evt.channel || "unknown"),
    intent: String(evt.intent || "_default"),
    model: String(evt.model || "offline-variants"),
    ok: evt.ok !== false
  });
  if (u.events.length > 50000) u.events = u.events.slice(-50000);
  await writeJsonPretty(USAGE_PATH, u);
}
async function usageSummary({ days = 14 } = {}) {
  const u = await readJsonSafe(USAGE_PATH, { events: [] });
  const end = new Date(); end.setUTCHours(23,59,59,999);
  const start = new Date(end); start.setUTCDate(end.getUTCDate() - (days-1)); start.setUTCHours(0,0,0,0);
  const byDay = {}, usersToday = {}, usersAll = {};
  for (const e of u.events || []) {
    const d = e.day || dayKey(e.ts ? new Date(e.ts) : undefined);
    if (d >= start.toISOString().slice(0,10) && d <= end.toISOString().slice(0,10)) {
      byDay[d] = (byDay[d] || 0) + 1;
      usersAll[e.user_id] = (usersAll[e.user_id] || 0) + 1;
      if (d === dayKey(end)) usersToday[e.user_id] = (usersToday[e.user_id] || 0) + 1;
    }
  }
  const daysList = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0,10);
    daysList.push({ day: key, count: byDay[key] || 0 });
  }
  const topUsersToday = Object.entries(usersToday).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const topUsersAll   = Object.entries(usersAll).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const total7 = daysList.slice(-7).reduce((s,x)=>s+x.count,0);
  return {
    days: daysList, total14: daysList.reduce((s,x)=>s+x.count,0), total7,
    today: daysList.at(-1)?.count || 0, topUsersToday, topUsersAll
  };
}

// ----------------------------
// Analizador de Sentimiento (ES, simple y rápido)
// ----------------------------
function analyzeSpanishSentiment(text="") {
  const s = (text || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"");
  const negations = ["no","nunca","jamas","ni","sin"];
  const positives = ["bien","excelente","genial","perfecto","me gusta","buen","bueno","claro","sirve","util","facil","rapido","gracias","interesado","quiero","me encanta","funciona","ayuda","me sirve","vale la pena","confio"];
  const negatives = ["caro","carisimo","malo","mal","dificil","complicado","no puedo","no tengo tiempo","tarde","lento","no me sirve","no funciona","no confio","engano","estafa","odio","frustrado","aburrido","duda","dudas"];
  const boostersUp   = ["muy","super","re","bastante"];
  const boostersDown = ["poco","algo","apenas"];
  let score = 0;
  const words = s.split(/\s+/);
  for (let i=0;i<words.length;i++){
    const w = words[i];
    const prev = words.slice(Math.max(0,i-3), i);
    const hasNeg = prev.some(x => negations.includes(x));
    const boostUp = prev.some(x => boostersUp.includes(x)) ? 1.5 : 1.0;
    const boostDn = prev.some(x => boostersDown.includes(x)) ? 0.6 : 1.0;
    const boost = boostUp * boostDn;
    const posHit = positives.some(p => w.includes(p) || s.includes(p+" "));
    const negHit = negatives.some(n => w.includes(n) || s.includes(n+" "));
    if (posHit) score += hasNeg ? (-0.7*boost) : (1.0*boost);
    if (negHit) score += hasNeg ? (0.6*boost) : (-1.0*boost);
  }
  if (score > 3) score = 3; if (score < -3) score = -3;
  const norm = +(score/3).toFixed(3);
  let label = "neutral";
  if (norm >= 0.25) label = "positivo"; else if (norm <= -0.25) label = "negativo";
  const tips = [];
  if (label === "negativo") tips.push("Empatiza primero y propone un paso pequeño.");
  if (label === "neutral")  tips.push("Aclara objetivo 30–60 días y sugiere ruta inicial.");
  if (label === "positivo") tips.push("Cierra con CTA directo (ruta + primera clase hoy).");
  return { label, score: norm, tips };
}

app.post("/analyze", (req, res) => {
  try { const { text = "" } = req.body || {}; res.json({ ok:true, ...analyzeSpanishSentiment(text) }); }
  catch { res.status(500).json({ ok:false, error:"analyze_failed" }); }
});

// ----------------------------
// Health
// ----------------------------
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ferbot-api", time: new Date().toISOString(), openai: !!process.env.OPENAI_API_KEY, model_env: process.env.OPENAI_MODEL || null });
});

// ----------------------------
// ASSIST (offline)
// ----------------------------
app.post("/assist", async (req, res) => {
  try {
    const { question = "", customerName = "Cliente", stage = "rebatir", user_id = "anon", metadata = {} } = req.body || {};
    const name = customerName || "Cliente";
    const intent = inferIntent(question);
    const reply = pickVariant(intent, stage, name);
    const guidePoints = await buildGuideFromKB(intent);
    const guide = normalizeSpaces(`Hola ${name}, ${guidePoints}`);
    await trackShown(intent, stage, reply).catch(()=>{});
    await logUsage({ user_id, channel: metadata.channel || "ui/offline", intent, model: "offline-variants", ok: true }).catch(()=>{});
    res.json({
      ok: true,
      text: reply, whatsapp: reply, message: reply, answer: reply,
      result: { guide, reply, sections: { [stage]: reply }, model: "offline-variants", confidence: 0.9, intent, stage },
      time_ms: 3
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "assist_failed" });
  }
});

// ----------------------------
// ASSIST OpenAI
// ----------------------------
app.post("/assist_openai", async (req, res) => {
  try {
    const { question = "", customerName = "Cliente", stage = "rebatir", user_id = "anon", metadata = {} } = req.body || {};
    const name = customerName || "Cliente";
    const intent = inferIntent(question);
    const guidePoints = await buildGuideFromKB(intent);
    const system = [
      "Eres un asesor comercial breve y claro para WhatsApp.",
      "Tono cercano, hispano neutro.",
      "Respeta el 'stage' (sondeo, rebatir, pre_cierre, cierre, integracion).",
      "Responde en 1-2 líneas, accionable y sin adornos extra.",
      `Guía para el asesor: ${guidePoints}`
    ].join("\n");
    const user = `Cliente: ${name}\nStage: ${stage}\nPregunta: ${question}\nIntent detectado: ${intent}\nResponde solo el mensaje final para WhatsApp.`;

    const apiKey = process.env.OPENAI_API_KEY;
    const model  = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!apiKey) return res.status(400).json({ ok: false, error: "missing_openai_api_key" });

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":`Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 1, messages: [ { role:"system", content: system }, { role:"user", content: user } ] })
    });
    if (!r.ok) {
      const errText = await r.text().catch(()=> "");
      return res.status(500).json({ ok:false, error: "openai_failed", detail: errText });
    }
    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || `Hola ${name}, ¿Te explico cómo lo hacemos fácil y rápido?`;

    await trackShown(intent, stage, reply).catch(()=>{});
    await logUsage({ user_id, channel: metadata.channel || "ui/openai", intent, model, ok: true }).catch(()=>{});

    res.json({
      ok: true,
      text: reply, whatsapp: reply, message: reply, answer: reply,
      result: { guide: `Hola ${name}, ${guidePoints}`, reply, sections: { [stage]: reply }, model, confidence: 0.85, intent, stage, persona: { name: "Ferney Salas", brand: "Platzi" } }
    });
  } catch (err) {
    res.status(500).json({ ok:false, error:"assist_openai_failed" });
  }
});

// ----------------------------
// Importador (merge) de data/ferney_variants.json
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

        const existingSet = new Set((currentVariants.byKey[key].variants || []).map(v => normKey(v.text)));
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

    res.json({ ok: true, mode: "merge", variants_added, variants_skipped, kb_added, kb_skipped });
  } catch (err) {
    res.status(500).json({ ok: false, error: "import_failed" });
  }
});

// ----------------------------
// Endpoints rating & stats
// ----------------------------
app.post("/trackShow", async (req, res) => {
  try {
    const { intent = "_default", stage = "rebatir", text = "" } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: "missing_text" });
    await trackShown(intent, stage, text);
    res.json({ ok: true });
  } catch { res.status(500).json({ ok: false, error: "track_show_failed" }); }
});
app.post("/trackWin", async (req, res) => {
  try {
    const { intent = "_default", stage = "rebatir", text = "", won = false } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: "missing_text" });
    await trackWinLose(intent, stage, text, !!won);
    res.json({ ok: true });
  } catch { res.status(500).json({ ok: false, error: "track_win_failed" }); }
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
  } catch { res.status(500).json({ ok: false, error: "track_rate_failed" }); }
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
        out.push({ intent, stage, text, shown, wins, winrate,
          good: Number(row.good || 0), regular: Number(row.regular || 0), bad: Number(row.bad || 0) });
      }
    }
    out.sort((a,b)=> (b.winrate - a.winrate) || (b.shown - a.shown));
    res.json({ ok: true, rows: out });
  } catch { res.status(500).json({ ok: false, error: "stats_failed" }); }
});

// ----------------------------
// Usage summary (JSON)
// ----------------------------
app.get("/usage/summary", async (_req, res) => {
  try { res.json({ ok:true, ...(await usageSummary({ days: 14 })) }); }
  catch { res.status(500).json({ ok:false, error:"usage_summary_failed" }); }
});

// ----------------------------
// Panel unificado (/admin/panel)
// ----------------------------
app.get("/admin/panel", async (_req, res) => {
  try {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"/><title>FerBot · Panel</title><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
:root{--bg:#0b0f19;--card:#0f1524;--text:#e2e8f0;--sub:#94a3b8;--line:rgba(255,255,255,.08);--muted:rgba(255,255,255,.05);--accent:#97C93E;--good:#19c37d;--warn:#fbbf24;--bad:#ef4444}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial}
header{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line)}
h1{margin:0;font-size:18px}.wrap{padding:20px;display:grid;gap:16px;grid-template-columns:repeat(12,1fr)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.col-4{grid-column:span 4}.col-6{grid-column:span 6}.col-8{grid-column:span 8}.col-12{grid-column:span 12}
.sub{color:var(--sub);font-size:12px}.kpi{display:flex;gap:18px}
.kpi .item{flex:1;background:var(--muted);border-radius:12px;padding:12px;border:1px solid var(--line)}
.kpi .num{font-size:22px;font-weight:800}table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line)}th{color:var(--sub);text-align:left}
.bar{height:28px;background:var(--muted);border-radius:8px;overflow:hidden;border:1px solid var(--line)}
.bar>div{height:100%;background:linear-gradient(90deg,var(--accent),#6dd16e)}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.pill{display:inline-block;padding:3px 8px;border-radius:999px;font-weight:700;font-size:11px;background:var(--muted);border:1px solid var(--line);color:var(--sub)}
.hint{color:var(--sub);font-size:12px;margin-top:6px}@media (max-width:980px){.col-4,.col-6,.col-8,.col-12{grid-column:span 12}}
.analyzer{display:grid;gap:8px;grid-template-columns:1fr 220px}.badge{padding:4px 8px;border-radius:999px;font-weight:800;font-size:12px;display:inline-block}
.b-pos{background:#073d2b;color:#a7f3d0;border:1px solid #115e42}.b-neu{background:#1e293b;color:#cbd5e1;border:1px solid #334155}
.b-neg{background:#3f1d22;color:#fecaca;border:1px solid #7f1d1d}textarea{width:100%;min-height:110px;background:#0f1524;color:#dbeafe;border:1px solid var(--line);border-radius:10px;padding:10px;resize:vertical}
button{border:0;border-radius:10px;padding:10px 12px;background:var(--accent);color:#0b0f19;font-weight:800;cursor:pointer}
</style></head>
<body>
<header><h1>FerBot · Panel de uso y efectividad</h1><div class="pill" id="serverInfo">Cargando…</div></header>
<div class="wrap">
  <div class="card col-8">
    <h3 style="margin:0 0 8px">Tráfico últimos 14 días</h3>
    <div id="chart" class="mono" style="display:grid;grid-template-columns:1fr;gap:8px"></div>
    <div class="hint">Cada barra muestra el número de respuestas generadas por día.</div>
  </div>
  <div class="card col-4">
    <h3 style="margin:0 0 8px">KPIs</h3>
    <div class="kpi">
      <div class="item"><div class="num" id="kpiToday">–</div><div class="sub">Hoy</div></div>
      <div class="item"><div class="num" id="kpi7">–</div><div class="sub">Últimos 7 días</div></div>
      <div class="item"><div class="num" id="kpi14">–</div><div class="sub">Últimos 14 días</div></div>
    </div>
    <div class="hint">Se contabilizan llamadas exitosas a <span class="mono">/assist</span> y <span class="mono">/assist_openai</span>.</div>
  </div>
  <div class="card col-6">
    <h3 style="margin:0 0 8px">Top usuarios (hoy)</h3>
    <table id="tblTopToday"><thead><tr><th>Usuario</th><th>Respuestas</th></tr></thead><tbody><tr><td colspan="2">Cargando…</td></tr></tbody></table>
  </div>
  <div class="card col-6">
    <h3 style="margin:0 0 8px">Top usuarios (acumulado)</h3>
    <table id="tblTopAll"><thead><tr><th>Usuario</th><th>Respuestas</th></tr></thead><tbody><tr><td colspan="2">Cargando…</td></tr></tbody></table>
  </div>
  <div class="card col-12">
    <h3 style="margin:0 10px 10px 0;display:flex;align-items:center;gap:10px">Efectividad (variantes) <span class="sub">· ranking por winrate</span></h3>
    <table id="tblStats">
      <thead><tr><th>Intent</th><th>Etapa</th><th>Texto</th><th style="text-align:right">Shown</th><th style="text-align:right">Wins</th><th style="text-align:right">Winrate</th></tr></thead>
      <tbody><tr><td colspan="6">Cargando…</td></tr></tbody>
    </table>
    <div class="hint">Win = buena (1), regular (0.5), mala (0). Marca desde la extensión.</div>
  </div>
  <div class="card col-12">
    <h3 style="margin:0 0 8px">Analizador de texto (sentimiento del cliente)</h3>
    <div class="analyzer">
      <textarea id="txtAnalyze" placeholder="Pega aquí el último mensaje del cliente…"></textarea>
      <div><button id="btnAnalyze">Analizar</button><div id="outAnalyze" style="margin-top:10px" class="sub">Sin análisis</div></div>
    </div>
  </div>
</div>
<script>
function esc(s=""){ return String(s).replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;", '"':"&quot;" }[m])); }
async function loadAll(){
  try{ const h = await (await fetch("/health")).json(); document.getElementById("serverInfo").textContent = h.ok ? ("Modelo: " + (h.model_env || (h.openai? "openai" : "offline"))) : "Servidor"; }
  catch{ document.getElementById("serverInfo").textContent = "Sin /health"; }

  const u = await (await fetch("/usage/summary")).json();
  document.getElementById("kpiToday").textContent = u.today ?? "0";
  document.getElementById("kpi7").textContent    = u.total7 ?? "0";
  document.getElementById("kpi14").textContent   = u.total14 ?? "0";

  const max = Math.max(1, ...(u.days||[]).map(d=>d.count));
  const chart = document.getElementById("chart");
  chart.innerHTML = (u.days||[]).map(d=>{
    const w = Math.round((d.count/max)*100);
    return \`<div style="display:flex;align-items:center;gap:10px">
      <div class="bar" title="\${d.day} = \${d.count}" style="flex:1"><div style="width:\${w}%"></div></div>
      <div class="mono" style="min-width:110px">\${d.day}</div>
      <div class="mono">\${d.count}</div>
    </div>\`;
  }).join("") || '<div class="sub">Sin datos</div>';

  const t1 = document.querySelector("#tblTopToday tbody");
  t1.innerHTML = (u.topUsersToday||[]).map(([id,c])=> \`<tr><td>\${esc(id)}</td><td>\${c}</td></tr>\`).join("") || '<tr><td colspan="2" class="sub">Sin datos</td></tr>';
  const t2 = document.querySelector("#tblTopAll tbody");
  t2.innerHTML = (u.topUsersAll||[]).map(([id,c])=> \`<tr><td>\${esc(id)}</td><td>\${c}</td></tr>\`).join("") || '<tr><td colspan="2" class="sub">Sin datos</td></tr>';

  const s = await (await fetch("/stats")).json();
  const tb = document.querySelector("#tblStats tbody");
  const rows = (s.rows||[]).slice(0,50).map(r=>\`<tr>
    <td>\${esc(r.intent)}</td><td>\${esc(r.stage)}</td><td>\${esc(r.text)}</td>
    <td style="text-align:right">\${r.shown||0}</td>
    <td style="text-align:right">\${r.wins||0}</td>
    <td style="text-align:right">\${((r.winrate||0)*100).toFixed(1)}%</td>
  </tr>\`).join("");
  tb.innerHTML = rows || '<tr><td colspan="6" class="sub">Aún no hay estadísticas</td></tr>';
}
loadAll();

document.getElementById("btnAnalyze").addEventListener("click", async ()=>{
  const t = document.getElementById("txtAnalyze").value.trim();
  if(!t){ document.getElementById("outAnalyze").textContent="Pega un texto primero."; return; }
  const r = await (await fetch("/analyze", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ text: t }) })).json();
  const wrap = document.getElementById("outAnalyze");
  const badgeClass = r.label === "positivo" ? "b-pos" : r.label === "negativo" ? "b-neg" : "b-neu";
  wrap.innerHTML = \`<div>Sentimiento: <span class="badge \${badgeClass}">\${r.label.toUpperCase()}</span> · score: <span class="mono">\${r.score}</span></div>
  <ul style="margin:6px 0 0 18px">\${(r.tips||[]).map(x=>\`<li>\${x}</li>\`).join("")}</ul>\`;
});
</script>
</body></html>`);
  } catch (err) {
    res.status(500).send("Error");
  }
});

// Acceso directo: /agent (si usas public/agent.html)
app.get("/agent", (_req,res)=> res.redirect("/agent.html"));

// ----------------------------
// Inicio
// ----------------------------
(async () => {
  await loadVariants();
  console.log("➡️  OpenAI habilitado.", !!process.env.OPENAI_API_KEY);
  const PORT = Number(process.env.PORT || 3005);
  app.listen(PORT, () => console.log(`🔥 FerBot API escuchando en http://localhost:${PORT}`));
})();
