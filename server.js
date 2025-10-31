// server.js — FerBot API (OpenAI + Trainer + Dashboard de Usabilidad)
// ---------------------------------------------------------------------------------
require("dotenv").config();

const express  = require("express");
const cors     = require("cors");
const fs       = require("fs/promises");
const fssync   = require("fs");
const path     = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Rutas base
const ROOT_DIR   = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
app.use(express.static(PUBLIC_DIR));

// ----------------------------
// DATA PATHS
// ----------------------------
const DATA_DIR       = path.join(ROOT_DIR, "data");
const MEMORY_PATH    = path.join(DATA_DIR, "memory.json");              // KB (objeciones)
const VARIANTS_PATH  = path.join(DATA_DIR, "variants.json");            // variants por intent::stage
const STATS_PATH     = path.join(DATA_DIR, "stats.json");               // métricas (rating/wins)
const TRAINER_TXT    = path.join(DATA_DIR, "trainer_identity.txt");     // identidad del trainer
const TRAINER_KNOW   = path.join(DATA_DIR, "trainer_knowledge");        // carpeta .txt/.md (opcional)
const EVENTS_PATH    = path.join(DATA_DIR, "events.jsonl");             // NUEVO: event log (JSONL)

for (const p of [DATA_DIR]) {
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true });
}
if (!fssync.existsSync(MEMORY_PATH))    fssync.writeFileSync(MEMORY_PATH,   JSON.stringify({ items: [] }, null, 2));
if (!fssync.existsSync(VARIANTS_PATH))  fssync.writeFileSync(VARIANTS_PATH, JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(STATS_PATH))     fssync.writeFileSync(STATS_PATH,    JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(TRAINER_KNOW))   fssync.mkdirSync(TRAINER_KNOW, { recursive: true });
if (!fssync.existsSync(TRAINER_TXT))    fssync.writeFileSync(TRAINER_TXT, "");
if (!fssync.existsSync(EVENTS_PATH))    fssync.writeFileSync(EVENTS_PATH, "");

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
// EVENT LOG (server-side)
// ----------------------------
function clientIdFrom(req){
  return (req.headers["x-client-id"] || req.headers["x-forwarded-for"] || req.ip || "").toString();
}
async function appendEvent(ev){
  try{
    const line = JSON.stringify(ev) + "\n";
    await fs.appendFile(EVENTS_PATH, line, "utf8");
  }catch(_){}
}

// ----------------------------
// ASSIST offline (variants + KB)
// ----------------------------
app.post("/assist", async (req, res) => {
  const startedAt = Date.now();
  try {
    const { question = "", customerName = "Cliente", stage = "rebatir" } = req.body || {};
    const name = customerName || "Cliente";
    const intent = inferIntent(question);

    const reply = clampReplyToWhatsApp(pickVariant(intent, stage, name));
    const guidePoints = await buildGuideFromKB(intent);
    const guide = normalizeSpaces(`Hola ${name}, ${guidePoints}`);

    trackShown(intent, stage, reply).catch(()=>{});

    // Log event
    appendEvent({
      ts: new Date().toISOString(),
      route: "/assist",
      ok: true,
      intent, stage,
      reply_len: reply.length,
      ms: Date.now() - startedAt,
      ip: req.ip, ua: req.headers["user-agent"]||"",
      cid: clientIdFrom(req)
    }).catch(()=>{});

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
      time_ms: Date.now() - startedAt
    });
  } catch (err) {
    appendEvent({
      ts: new Date().toISOString(),
      route: "/assist",
      ok: false,
      error: "assist_failed",
      ms: Date.now() - startedAt,
      ip: req.ip, ua: req.headers["user-agent"]||"",
      cid: clientIdFrom(req)
    }).catch(()=>{});
    res.status(500).json({ ok: false, error: "assist_failed" });
  }
});

// ----------------------------
// ASSIST OpenAI (general)
// ----------------------------
app.post("/assist_openai", async (req, res) => {
  const startedAt = Date.now();
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
      appendEvent({
        ts: new Date().toISOString(),
        route: "/assist_openai",
        ok: false,
        error: "openai_failed",
        detail: String(errText || ""),
        ms: Date.now() - startedAt,
        ip: req.ip, ua: req.headers["user-agent"]||"",
        cid: clientIdFrom(req)
      }).catch(()=>{});
      return res.status(500).json({ ok:false, error: "openai_failed", detail: errText });
    }
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || `Hola ${name}, ¿Te explico cómo lo hacemos fácil y rápido?`;
    const reply = clampReplyToWhatsApp(raw);

    trackShown(intent, stage, reply).catch(()=>{});

    appendEvent({
      ts: new Date().toISOString(),
      route: "/assist_openai",
      ok: true,
      intent, stage,
      reply_len: reply.length,
      ms: Date.now() - startedAt,
      ip: req.ip, ua: req.headers["user-agent"]||"",
      cid: clientIdFrom(req)
    }).catch(()=>{});

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
    appendEvent({
      ts: new Date().toISOString(),
      route: "/assist_openai",
      ok: false,
      error: "assist_openai_failed",
      ms: Date.now() - startedAt,
      ip: req.ip, ua: req.headers["user-agent"]||"",
      cid: clientIdFrom(req)
    }).catch(()=>{});
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
  const startedAt = Date.now();
  try {
    const { question = "", customerName = "", stage = "rebatir", intent:intentIn, context = "" } = req.body || {};
    const name = (customerName || "").trim();
    const safeName = name || "Cliente";
    const intent = intentIn || inferIntent(question);

    const rules = [
      "Hablas como Ferney (cálido, claro, directo). Español.",
      "WhatsApp-friendly: ≤220 caracteres y máximo 2 frases.",
      "Sin clases gratis ni beneficios no confirmados.",
      "Respeta el stage: sondeo, rebatir, pre_cierre, cierre, integracion.",
      "Si falta info, pide 1 dato clave y da micro-CTA.",
      "FORMATO ESTRICTO (3 líneas):",
      "REPLY: <mensaje para WhatsApp (puede empezar con el nombre si está disponible)>",
      "WHY: <por qué esta respuesta (≤100 caracteres)>",
      "NEXT: <siguiente paso para el asesor (≤100 caracteres)>"
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
      appendEvent({
        ts: new Date().toISOString(),
        route: "/assist_trainer",
        ok: false,
        error: "openai_failed",
        detail: String(errText || ""),
        ms: Date.now() - startedAt,
        ip: req.ip, ua: req.headers["user-agent"]||"",
        cid: clientIdFrom(req)
      }).catch(()=>{});
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

    appendEvent({
      ts: new Date().toISOString(),
      route: "/assist_trainer",
      ok: true,
      intent, stage,
      reply_len: reply.length,
      ms: Date.now() - startedAt,
      ip: req.ip, ua: req.headers["user-agent"]||"",
      cid: clientIdFrom(req)
    }).catch(()=>{});

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
    appendEvent({
      ts: new Date().toISOString(),
      route: "/assist_trainer",
      ok: false,
      error: "assist_trainer_failed",
      ms: Date.now() - startedAt,
      ip: req.ip, ua: req.headers["user-agent"]||"",
      cid: clientIdFrom(req)
    }).catch(()=>{});
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
    res.status(500).json({ ok: false, error: "import_failed" });
  }
});

// ----------------------------
// Dashboard (legacy simple) + NUEVO /admin/usability
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
    res.status(500).json({ ok: false, error: "stats_failed" });
  }
});

app.get("/admin/dashboard", async (_req, res) => {
  // redirige al panel moderno
  res.redirect("/dashboard.html");
});

// NUEVO: redirect amable para /admin/usability
app.get("/admin/usability", (_req,res)=> res.redirect("/dashboard.html"));

// ----------------------------
// MÉTRICAS AVANZADAS (para dashboard.html)
// ----------------------------
app.get("/metrics", async (_req, res) => {
  try {
    // base: stats (ratings) + events (tiempos y actividad)
    const stats = await readJsonSafe(STATS_PATH, { byKey: {} });

    // a) rows (como /stats)
    const rows = [];
    let totalShown=0, totalWins=0, totalGood=0, totalRegular=0, totalBad=0;
    for (const key of Object.keys(stats.byKey || {})) {
      const [intent, stage] = key.split("::");
      const map = stats.byKey[key];
      for (const text of Object.keys(map)) {
        const row = map[text];
        const shown = Number(row.shown || 0);
        const wins = Number(row.wins || 0);
        const good = Number(row.good || 0);
        const regular = Number(row.regular || 0);
        const bad = Number(row.bad || 0);
        const winrate = shown > 0 ? +(wins / shown).toFixed(3) : 0;
        rows.push({ intent, stage, text, shown, wins, winrate, good, regular, bad });
        totalShown += shown; totalWins += wins;
        totalGood += good; totalRegular += regular; totalBad += bad;
      }
    }
    rows.sort((a,b)=> (b.winrate - a.winrate) || (b.shown - a.shown));

    // b) events.jsonl → tiempos, actividad, por-hora
    let lines = [];
    try {
      const content = await fs.readFile(EVENTS_PATH, "utf8");
      lines = content.trim() ? content.trim().split("\n").map(l => JSON.parse(l)) : [];
    } catch { lines = []; }

    const now = Date.now();
    const ms5m = 5*60*1000;
    const start0h = new Date(); start0h.setHours(0,0,0,0);
    const start24h = now - 24*60*60*1000;

    const uniq5m = new Set();
    const uniqToday = new Set();
    const timesLast24 = [];

    const byHour = new Map(); // hourLabel -> count
    for (let i=0;i<24;i++){
      const d = new Date(now - (23-i)*60*60*1000);
      const label = d.toTimeString().slice(0,5); // HH:MM aprox
      byHour.set(label, 0);
    }

    for (const ev of lines) {
      const t = new Date(ev.ts).getTime();
      if (ev.ok) {
        if (t>=start24h) timesLast24.push(Number(ev.ms||0));
        if (t>=now-ms5m) uniq5m.add(ev.cid || ev.ip || "na");
        if (t>=start0h.getTime()) uniqToday.add(ev.cid || ev.ip || "na");

        // por hora
        const hour = new Date(t);
        const label = new Date(hour.getFullYear(), hour.getMonth(), hour.getDate(), hour.getHours(), 0, 0)
          .toTimeString().slice(0,5);
        if (byHour.has(label)) byHour.set(label, byHour.get(label)+1);
      }
    }

    // tiempos respuesta
    const avgMs = timesLast24.length ? Math.round(timesLast24.reduce((a,b)=>a+b,0)/timesLast24.length) : 0;
    const p95Ms = (() => {
      if (!timesLast24.length) return 0;
      const arr = [...timesLast24].sort((a,b)=>a-b);
      const idx = Math.floor(0.95*(arr.length-1));
      return arr[idx];
    })();

    // sesiones aprox por IP/cid (ventana 24h, gap >30min = nueva sesión)
    const sessions = new Map(); // cid -> [timestamps...]
    lines.forEach(ev=>{
      if (!ev.ok) return;
      const t = new Date(ev.ts).getTime();
      if (t<start24h) return;
      const cid = ev.cid || ev.ip || "na";
      if (!sessions.has(cid)) sessions.set(cid, []);
      sessions.get(cid).push(t);
    });
    let totalDur=0, totalSess=0;
    for (const [,ts] of sessions) {
      ts.sort((a,b)=>a-b);
      let sStart=ts[0], prev=ts[0];
      for (let i=1;i<ts.length;i++){
        if (ts[i]-prev > 30*60*1000) { // corta sesión
          totalDur += (prev - sStart);
          totalSess += 1;
          sStart = ts[i];
        }
        prev = ts[i];
      }
      totalDur += (prev - sStart);
      totalSess += 1;
    }
    const avgSessMin = totalSess ? +(totalDur/totalSess/60000).toFixed(1) : 0;

    res.json({
      ok:true,
      summary:{
        shown: totalShown,
        winrate: totalShown ? +(totalWins/totalShown*100).toFixed(1) : 0,
        good: totalGood,
        regular: totalRegular,
        bad: totalBad,
        active_5m: uniq5m.size,
        active_today: uniqToday.size,
        avg_response_ms: avgMs,
        p95_response_ms: p95Ms,
        avg_session_min: avgSessMin
      },
      per_hour: Array.from(byHour.entries()).map(([label,count])=>({label,count})),
      rows
    });
  } catch (e) {
    res.status(500).json({ ok:false, error:"metrics_failed" });
  }
});

// /agent → agent.html (panel emergencia ya existente si lo tienes)
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
