// server.js — FerBot API (offline, OpenAI, Trainer con WHY/NEXT, respuestas cortas)
// ---------------------------------------------------------------------------------
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");

// Node >=18 tiene fetch global
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Rutas estáticas (panel, agent, etc.)
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
if (!fssync.existsSync(PUBLIC_DIR)) fssync.mkdirSync(PUBLIC_DIR, { recursive: true });
app.use(express.static(PUBLIC_DIR));

// ----------------------------
// DATA PATHS
// ----------------------------
const DATA_DIR       = path.join(ROOT_DIR, "data");
const MEMORY_PATH    = path.join(DATA_DIR, "memory.json");              // KB (objeciones)
const VARIANTS_PATH  = path.join(DATA_DIR, "variants.json");            // variants por intent::stage
const STATS_PATH     = path.join(DATA_DIR, "stats.json");               // métricas
const TRAINER_TXT    = path.join(DATA_DIR, "trainer_identity.txt");     // identidad del trainer
const TRAINER_KNOW   = path.join(DATA_DIR, "trainer_knowledge");        // carpeta .txt/.md (opcional)

for (const p of [DATA_DIR]) {
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true });
}
if (!fssync.existsSync(MEMORY_PATH))    fssync.writeFileSync(MEMORY_PATH,   JSON.stringify({ items: [] }, null, 2));
if (!fssync.existsSync(VARIANTS_PATH))  fssync.writeFileSync(VARIANTS_PATH, JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(STATS_PATH))     fssync.writeFileSync(STATS_PATH,    JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(TRAINER_KNOW))   fssync.mkdirSync(TRAINER_KNOW, { recursive: true });
if (!fssync.existsSync(TRAINER_TXT))    fssync.writeFileSync(TRAINER_TXT, "");

// ----------------------------
// Helpers básicos
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

// ----------------------------
// Variants cache (modo offline)
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
    const v = fb?.variants?.[0]?.text || `Hola ${name}, ¿te explico cómo lo hacemos fácil y rápido?`;
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

// =====================================================
//  OPENAI CLIENT (Chat → fallback Responses automáticamente)
// =====================================================
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_MODEL    = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_KEY      = process.env.OPENAI_API_KEY;

// Utilidad: ¿el error sugiere usar max_completion/max_output tokens?
function suggestsResponsesSwitch(errText=""){
  const t = (errText || "").toLowerCase();
  return t.includes("unsupported parameter") && (t.includes("max_completion_tokens") || t.includes("max output tokens") || t.includes("max_output_tokens"));
}

// Llama a Chat Completions; si falla por el parámetro de tokens, reintenta con Responses API.
async function openaiChatCompat(messages, { system="", maxTokens=220 } = {}){
  if (!OPENAI_KEY) throw new Error("missing_openai_api_key");

  // 1) Chat Completions
  const chatPayload = {
    model: OPENAI_MODEL,
    messages: [
      ...(system ? [{ role:"system", content: system }] : []),
      ...messages
    ],
    // sin max_tokens para mejor compatibilidad; si quieres forzar, descomenta:
    // max_tokens: maxTokens,
  };

  let resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type":"application/json", "Authorization":`Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(chatPayload)
  });

  if (resp.ok) {
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return { ok: true, text, raw: data, api: "chat" };
  }

  const errText = await resp.text().catch(()=> "");
  // Si el backend pide max_completion_tokens / responses, reintentamos con Responses API
  if (resp.status >= 400 && suggestsResponsesSwitch(errText)) {
    // 2) Responses API
    const prompt = [
      ...(system ? [{ role:"system", content: system }] : []),
      ...messages
    ];

    // Algunas cuentas piden 'max_output_tokens', otras toleran 'max_completion_tokens'
    const responsesPayloadA = {
      model: OPENAI_MODEL,
      input: prompt,
      max_output_tokens: maxTokens
    };
    let resp2 = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":`Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(responsesPayloadA)
    });

    if (!resp2.ok) {
      // intento B con max_completion_tokens (por si la cuenta lo exige)
      const responsesPayloadB = {
        model: OPENAI_MODEL,
        input: prompt,
        max_completion_tokens: maxTokens
      };
      resp2 = await fetch(`${OPENAI_BASE_URL}/responses`, {
        method: "POST",
        headers: { "Content-Type":"application/json", "Authorization":`Bearer ${OPENAI_KEY}` },
        body: JSON.stringify(responsesPayloadB)
      });
    }

    if (resp2.ok) {
      const data2 = await resp2.json();
      // Responses API puede responder en data.output[0].content[0].text
      let text = "";
      try {
        text = data2?.output?.[0]?.content?.[0]?.text ?? "";
      } catch {}
      if (!text && data2?.choices?.[0]?.message?.content) {
        text = data2.choices[0].message.content;
      }
      return { ok: true, text: text || "", raw: data2, api: "responses" };
    }

    const err2 = await resp2.text().catch(()=> "");
    return { ok: false, error: `OpenAI responses failed: ${err2 || "(no body)"}`, status: resp2.status };
  }

  return { ok: false, error: `OpenAI chat failed: ${errText || "(no body)"}`, status: resp.status };
}

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
    const { question = "", customerName = "Cliente", stage = "rebatir", context = "" } = req.body || {};
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

    const user = `Cliente: ${name}\nStage: ${stage}\nIntent: ${intent}\n${context ? "Contexto: " + context + "\n" : ""}Pregunta: ${question}\nEntrega solo el mensaje final para WhatsApp.`;

    if (!OPENAI_KEY) return res.status(400).json({ ok: false, error: "missing_openai_api_key" });

    const r = await openaiChatCompat(
      [{ role: "user", content: user }],
      { system, maxTokens: 220 }
    );

    if (!r.ok) {
      return res.status(500).json({ ok:false, error: "openai_failed", detail: r.error || `status ${r.status}` });
    }

    const raw = (r.text || "").trim() || `Hola ${name}, ¿te explico cómo lo hacemos fácil y rápido?`;
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
        model: OPENAI_MODEL,
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

    if (!OPENAI_KEY) return res.status(400).json({ ok: false, error: "missing_openai_api_key" });

    const r = await openaiChatCompat(
      [{ role: "user", content: user }],
      { system, maxTokens: 300 } // un poco más para incluir WHY/NEXT, igual filtramos abajo
    );

    if (!r.ok) {
      return res.status(500).json({ ok:false, error: "openai_failed", detail: r.error || `status ${r.status}` });
    }

    const content = (r.text || "").trim();

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
        model: OPENAI_MODEL,
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
// Dashboard + stats
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

// /agent → agent.html
app.get("/agent", (_req,res)=> res.redirect("/agent.html"));

// ----------------------------
// Inicio servidor
// ----------------------------
(async () => {
  await loadVariants();
  await loadTrainerIdentity();
  console.log("➡️  OpenAI habilitado:", !!OPENAI_KEY, "· modelo:", OPENAI_MODEL);
  const PORT = Number(process.env.PORT || 3005);
  app.listen(PORT, () => {
    console.log(`🔥 FerBot API escuchando en http://localhost:${PORT}`);
  });
})();
