// server.js — FerBot API + Telemetría y Panel Unificado
// ---------------------------------------------------------------------------------
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");
const crypto = require("crypto");

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
const STATS_PATH     = path.join(DATA_DIR, "stats.json");               // métricas de rating por texto
const TRAINER_TXT    = path.join(DATA_DIR, "trainer_identity.txt");     // identidad del trainer
const TRAINER_KNOW   = path.join(DATA_DIR, "trainer_knowledge");        // carpeta .txt/.md (opcional)
const USAGE_LOG_ND   = path.join(DATA_DIR, "usage.ndjson");             // telemetría de uso (eventos)
const USAGE_SUMMARY  = path.join(DATA_DIR, "metrics.json");             // resumen simple (opcional)

for (const p of [DATA_DIR, TRAINER_KNOW]) {
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true });
}
if (!fssync.existsSync(MEMORY_PATH))    fssync.writeFileSync(MEMORY_PATH,   JSON.stringify({ items: [] }, null, 2));
if (!fssync.existsSync(VARIANTS_PATH))  fssync.writeFileSync(VARIANTS_PATH, JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(STATS_PATH))     fssync.writeFileSync(STATS_PATH,    JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(USAGE_LOG_ND))   fssync.writeFileSync(USAGE_LOG_ND,  "");
if (!fssync.existsSync(USAGE_SUMMARY))  fssync.writeFileSync(USAGE_SUMMARY, JSON.stringify({ }, null, 2));
if (!fssync.existsSync(TRAINER_TXT))    fssync.writeFileSync(TRAINER_TXT, "");

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
function clampReplyToWhatsApp(text, maxChars=220) {
  let t = (text || "").trim();
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  t = parts.slice(0,2).join(" ");
  if (t.length > maxChars) t = t.slice(0, maxChars-1).trimEnd() + "…";
  return t;
}
function hashText(s=""){
  return crypto.createHash("sha1").update(String(s)).digest("hex").slice(0,16);
}
function getClientSig(req){
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "0.0.0.0";
  const ua = req.headers["user-agent"] || "unknown";
  return `${ip}__${ua}`;
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
// Tracking + Ratings (stats.json para ranking por texto)
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
// Telemetría de uso (NDJSON)
// ----------------------------
async function appendUsage(event){
  try {
    await fs.appendFile(USAGE_LOG_ND, JSON.stringify(event) + "\n", "utf8");
  } catch {}
}
function safeSnippet(s="", n=120){
  s = (s||"").replace(/\s+/g," ").trim();
  return s.length>n? (s.slice(0,n-1)+"…") : s;
}
function parseTime(ts){ const d = new Date(ts); return isNaN(+d) ? new Date() : d; }

// ----------------------------
// ASSIST offline (variants + KB)
// ----------------------------
app.post("/assist", async (req, res) => {
  const tStart = Date.now();
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
      time_ms: Date.now()-tStart
    });

    // Telemetría
    const ev = {
      type:"assist",
      mode:"offline",
      ts:new Date().toISOString(),
      intent, stage,
      ms: Date.now()-tStart,
      q: safeSnippet(question, 160),
      replyHash: hashText(reply),
      source: req.headers["x-ferbot-source"] || (req.headers.referer?.includes("/agent")?"panel":"unknown"),
      client: getClientSig(req)
    };
    appendUsage(ev).catch(()=>{});
  } catch (err) {
    console.error("assist error", err);
    res.status(500).json({ ok: false, error: "assist_failed" });
  }
});

// ----------------------------
// ASSIST OpenAI (general)
// ----------------------------
app.post("/assist_openai", async (req, res) => {
  const tStart = Date.now();
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
      },
      time_ms: Date.now()-tStart
    });

    appendUsage({
      type:"assist",
      mode:"openai",
      ts:new Date().toISOString(),
      intent, stage,
      ms: Date.now()-tStart,
      q: safeSnippet(question, 160),
      replyHash: hashText(reply),
      source: req.headers["x-ferbot-source"] || (req.headers.referer?.includes("/agent")?"panel":"unknown"),
      client: getClientSig(req)
    }).catch(()=>{});

  } catch (err) {
    console.error("assist_openai error", err);
    res.status(500).json({ ok:false, error:"assist_openai_failed" });
  }
});

// ----------------------------
// ASSIST_TRAINER — usa Trainer (REPLY + WHY + NEXT)
// ----------------------------
function fallbackWhy(stage, intent) {
  const map = {
    sondeo:     "Reconoce la meta y avanza con pregunta única.",
    rebatir:    "Conviertes objeción en valor y beneficio de vida.",
    pre_cierre: "Refuerzas valor y quitas fricción hacia anual.",
    cierre:     "Concretas con decisión clara.",
    integracion:"Alineas meta y primer paso sin fricción."
  };
  return map[stage] || `Guía al valor y CTA (${intent}/${stage}).`;
}
function fallbackNext(stage) {
  const map = {
    sondeo:     "Haz 1 pregunta clave y prepara CTA anual.",
    rebatir:    "Valida y propone paso concreto hoy.",
    pre_cierre: "Confirma interés y despeja última duda.",
    cierre:     "Pide decisión (plan anual) de forma amable.",
    integracion:"Define primer paso y ritmo semanal."
  };
  return map[stage] || "Cierra con un CTA simple y accionable.";
}

app.post("/assist_trainer", async (req, res) => {
  const tStart = Date.now();
  try {
    const { question = "", customerName = "", stage = "rebatir", intent:intentIn, context = "" } = req.body || {};
    const name = (customerName || "").trim();
    const safeName = name || "Cliente";
    const intent = intentIn || inferIntent(question);

    const rules = [
      "Eres FerBot (español Colombia), amable, dinámico y con energía positiva.",
      "WhatsApp-friendly: ≤220 caracteres y máximo 2 frases.",
      "Suscripción ANUAL; evita llamadas o 'enviar material'.",
      "Respeta el stage (sondeo, rebatir, pre_cierre, cierre, integracion).",
      "Si falta contexto, pide UNA cosa y da micro-CTA.",
      "FORMATO (3 líneas):",
      "REPLY: <mensaje WhatsApp>",
      "WHY: <por qué, ≤100c, enseña el criterio>",
      "NEXT: <siguiente paso para el asesor, ≤100c>"
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

    const mReply = content.match(/REPLY:\s*([\s\S]*?)(?:\n+WHY:|\n+NEXT:|$)/i);
    const mWhy   = content.match(/WHY:\s*(.*?)(?:\n+NEXT:|$)/i);
    const mNext  = content.match(/NEXT:\s*(.*)$/i);

    let reply = (mReply && mReply[1] || content).trim();
    let why   = (mWhy && mWhy[1]   || "").trim();
    let next  = (mNext && mNext[1] || "").trim();

    reply = clampReplyToWhatsApp(reply, 220);
    if (!why)  why  = fallbackWhy(stage, intent);
    if (!next) next = fallbackNext(stage);

    trackShown(intent, stage, reply).catch(()=>{});

    const resp = {
      ok: true,
      text: reply,
      whatsapp: reply,
      message: reply,
      answer: reply,
      result: {
        reply, why, next,
        guide: `Por qué: ${why} · Siguiente paso: ${next}`,
        sections: { [stage]: reply },
        model,
        confidence: 0.9,
        intent,
        stage
      },
      time_ms: Date.now()-tStart
    };
    res.json(resp);

    appendUsage({
      type:"assist",
      mode:"trainer",
      ts:new Date().toISOString(),
      intent, stage,
      ms: Date.now()-tStart,
      q: safeSnippet(question, 160),
      replyHash: hashText(reply),
      source: req.headers["x-ferbot-source"] || (req.headers.referer?.includes("/agent")?"panel":"unknown"),
      client: getClientSig(req)
    }).catch(()=>{});

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
    console.error("importFerney error", err);
    res.status(500).json({ ok: false, error: "import_failed" });
  }
});

// ----------------------------
// Dashboard clásico (se mantiene)
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

    // Telemetría rating
    appendUsage({
      type:"rate",
      ts:new Date().toISOString(),
      intent, stage,
      rating,
      replyHash: hashText(text),
      source: req.headers["x-ferbot-source"] || (req.headers.referer?.includes("/agent")?"panel":"unknown"),
      client: getClientSig(req)
    }).catch(()=>{});

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
<title>FerBot · Dashboard (clásico)</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial;background:#0b0f19;color:#e2e8f0;margin:0;padding:24px}
  h1{margin:0 0 12px;font-size:20px}
  table{width:100%;border-collapse:collapse;background:#0f1524;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden}
  th,td{padding:10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}
  th{background:rgba(255,255,255,.04);text-align:left}
  tr:hover{background:rgba(255,255,255,.03)}
  .sub{opacity:.7;font-size:12px;margin-bottom:16px}
  a{color:#97C93E}
</style>
</head>
<body>
  <h1>FerBot · Dashboard (clásico)</h1>
  <div class="sub">Para el panel nuevo y tecnológico ve a <a href="/panel.html">/panel.html</a></div>
  <div style="margin:12px 0">
    <form method="GET" action="/stats" target="_blank"><button>Ver JSON /stats</button></form>
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
// Panel público (emergencia/consulta)
// ----------------------------
app.get("/agent", (_req,res)=> res.redirect("/panel.html"));

// ----------------------------
// Telemetría agregada (JSON para panel nuevo)
// ----------------------------
app.get("/admin/usage", async (req, res) => {
  try {
    let lines = [];
    try {
      lines = (await fs.readFile(USAGE_LOG_ND, "utf8")).trim().split("\n").filter(Boolean);
    } catch { lines = []; }

    const events = [];
    for (const ln of lines) {
      try { events.push(JSON.parse(ln)); } catch {}
    }

    const now = new Date();
    const t24 = now.getTime() - 24*3600*1000;
    const t7d = now.getTime() - 7*24*3600*1000;
    const t5m = now.getTime() - 5*60*1000;
    const t1h = now.getTime() - 60*60*1000;

    const inRange = (t0) => (parseTime(t0).getTime() >= t24);
    const ev24 = events.filter(e => inRange(e.ts));
    const ev7d = events.filter(e => parseTime(e.ts).getTime() >= t7d);

    const active5m = new Set(ev24.filter(e=>parseTime(e.ts).getTime()>=t5m).map(e=>e.client)).size;
    const active1h = new Set(ev24.filter(e=>parseTime(e.ts).getTime()>=t1h).map(e=>e.client)).size;
    const active24 = new Set(ev24.map(e=>e.client)).size;

    const assists24 = ev24.filter(e=>e.type==="assist");
    const ratings24 = ev24.filter(e=>e.type==="rate");

    const avgLatency24 = assists24.length ? Math.round(assists24.reduce((a,b)=>a+(+b.ms||0),0)/assists24.length) : 0;

    const byHourMap = new Map();
    for (const e of assists24) {
      const d = new Date(e.ts);
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).toISOString();
      byHourMap.set(key, (byHourMap.get(key)||0)+1);
    }
    const byHour24 = Array.from(byHourMap.entries())
      .sort((a,b)=> new Date(a[0]) - new Date(b[0]))
      .map(([hourISO,count])=>({ hourISO, count }));

    const sumMap = (arr, key) => {
      const m = {};
      for (const e of arr) {
        const k = e[key] || "_";
        m[k] = (m[k]||0)+1;
      }
      return m;
    };
    const byIntent24 = sumMap(assists24, "intent");
    const byStage24  = sumMap(assists24, "stage");

    const rateCount = { good:0, regular:0, bad:0 };
    for (const r of ratings24) {
      if (r.rating==="good") rateCount.good++;
      else if (r.rating==="regular") rateCount.regular++;
      else if (r.rating==="bad") rateCount.bad++;
    }
    const shown24 = Math.max(1, (rateCount.good + rateCount.regular + rateCount.bad));
    const winrate = (rateCount.good*1 + rateCount.regular*0.5) / shown24;

    // Últimos 20 eventos (assist y rate)
    const recent = events.slice(-100).reverse().filter(e=>e.type==="assist").slice(0,20).map(e=>({
      ts: e.ts, intent: e.intent, stage: e.stage, ms: e.ms || 0,
      q: e.q || "", replyHash: e.replyHash || ""
    }));

    res.json({
      ok: true,
      now: now.toISOString(),
      totals: {
        last_24h: assists24.length,
        last_7d: ev7d.filter(e=>e.type==="assist").length,
        all_time: events.filter(e=>e.type==="assist").length
      },
      kpis: {
        avgLatencyMs24h: avgLatency24,
        activeUsers5m: active5m,
        activeUsers1h: active1h,
        activeUsers24h: active24
      },
      byHour24,
      byIntent24,
      byStage24,
      ratings24: { ...rateCount, winrate: +winrate.toFixed(3) },
      recent
    });
  } catch (err) {
    console.error("usage error", err);
    res.status(500).json({ ok:false, error:"usage_failed" });
  }
});

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
