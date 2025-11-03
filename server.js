// server.js — FerBot API (OpenAI/Trainer + panel + manual + dashboard)
// ---------------------------------------------------------------------------------
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");
const fetch = global.fetch || ((...args) => import("node-fetch").then(({default: f}) => f(...args)));

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Rutas base (estáticos)
const ROOT_DIR   = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
app.use(express.static(PUBLIC_DIR));

// ----------------------------
// DATA PATHS
// ----------------------------
const DATA_DIR       = path.join(ROOT_DIR, "data");
const MEMORY_PATH    = path.join(DATA_DIR, "memory.json");              // KB (objeciones)
const VARIANTS_PATH  = path.join(DATA_DIR, "variants.json");            // variants por intent::stage
const STATS_PATH     = path.join(DATA_DIR, "stats.json");               // métricas por respuesta
const USAGE_PATH     = path.join(DATA_DIR, "usage.ndjson");             // trazas de uso
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
if (!fssync.existsSync(USAGE_PATH))     fssync.writeFileSync(USAGE_PATH, "");

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
  // Máximo 2 frases
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  t = parts.slice(0,2).join(" ");
  if (t.length > maxChars) t = t.slice(0, maxChars-1).trimEnd() + "…";
  return t;
}
function nowIso(){ return new Date().toISOString(); }
function appendUsage(obj){
  try {
    const line = JSON.stringify({ ts: nowIso(), ...obj }) + "\n";
    fssync.appendFileSync(USAGE_PATH, line, "utf8");
  } catch {}
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
  appendUsage({ type:"shown", intent, stage, text: t });
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
  appendUsage({ type:"winlose", intent, stage, text: t, won: !!won });
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
  appendUsage({ type:"rate", intent, stage, text: t, rating });
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
    TRAINER_SNIPPETS = joined.slice(0, 12000); // límite seguro
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
      "Eres un asesor comercial breve y claro para WhatsApp (español Colombia).",
      "Tono cercano, dinámico, energía positiva. 1–2 frases, ≤220 caracteres.",
      "Responde por ETAPA (sondeo, rebatir, pre_cierre, cierre, integracion).",
      "No invites a llamadas ni ‘te envío material’. Suscripción anual.",
      `Guía de contexto: ${guidePoints}`
    ].join("\n");

    const user = `Cliente: ${name}\nStage: ${stage}\nPregunta: ${question}\nIntent: ${intent}\nEntrega solo el mensaje final (≤220c).`;

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
        persona: { brand: "Platzi" }
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
    sondeo:     "Validamos meta y contexto para personalizar.",
    rebatir:    "Convertimos la objeción en valor y beneficio de vida.",
    pre_cierre: "Subimos valor percibido y quitamos fricción.",
    cierre:     "Concretamos la decisión anual con claridad.",
    integracion:"Refuerza decisión y hábito inicial."
  };
  return map[stage] || `Guía por beneficio y CTA (${intent}/${stage}).`;
}
function fallbackNext(stage) {
  const map = {
    sondeo:     "Haz 1 pregunta clave y prepara la invitación anual.",
    rebatir:    "Reformula en beneficio y pide mini ‘OK’ para avanzar.",
    pre_cierre: "Recapitula valor y propone el anual directo.",
    cierre:     "Solicita confirmación del anual y activa.",
    integracion:"Deja hábito inicial y seguimiento corto."
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
      "Eres FerBot (Colombia): amable, dinámico, con energía. 1–2 frases, ≤220c.",
      "Vendes transformación con suscripción ANUAL. Nada de llamadas ni “te envío material”.",
      "Respeta ETAPA: sondeo, rebatir, pre_cierre, cierre, integracion.",
      "Si falta info, pide UNA cosa y deja micro-CTA.",
      "FORMATO ESTRICTO (3 líneas):",
      "REPLY: <mensaje listo para WhatsApp (máx 220c, 1–2 frases, tono Colombia)>",
      "WHY: <por qué esta respuesta (≤100c, explica cómo convierte objeción en valor)>",
      "NEXT: <siguiente paso para el asesor (≤100c, orientado al plan anual)>"
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
        persona: { brand: "Platzi" }
      }
    });
  } catch (err) {
    console.error("assist_trainer error", err);
    res.status(500).json({ ok:false, error:"assist_trainer_failed" });
  }
});

// ----------------------------
// Dashboard / Métricas
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

// Dashboard HTML compacto
app.get("/admin/dashboard", async (_req, res) => {
  try {
    const stats = await (await fetchLocalStats()).json();
    const rows = (stats.rows || []).map(r => `
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
  a.btn{display:inline-block;margin-right:8px;padding:8px 12px;border-radius:8px;background:#162036;color:#cbd5e1;text-decoration:none}
  a.btn:hover{background:#1a2742}
</style>
</head>
<body>
  <h1>FerBot · Dashboard</h1>
  <div class="sub">Ranking por winrate y exposición (wins compuestos: buena=1, regular=0.5, mala=0)</div>
  <div style="margin:12px 0">
    <a class="btn" href="/admin/usability" target="_blank">Panel de Usabilidad</a>
    <a class="btn" href="/stats" target="_blank">Ver JSON</a>
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
// Paneles estáticos / Documentación
// ----------------------------

// /agent → agent.html (panel de emergencia)
app.get("/agent", (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "agent.html")));

// /admin/usability → usability.html (panel unificado)
app.get("/admin/usability", (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "usability.html")));

// Manual HTML, README y PDF descargable
app.get("/manual", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "manual.html")));
app.get("/readme", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "README_INSTALACION.md")));
app.get("/FerBot_Manual_Instalacion_Uso_v1.3.pdf", (_req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, "FerBot_Manual_Instalacion_Uso_v1.3.pdf"))
);

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
