// server.js — FerBot API estable (Render) con Trainer + Panel/Agent
// ---------------------------------------------------------------------------------
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");

// Usa fetch nativo de Node 18+ (no node-fetch).
const fetch = globalThis.fetch;

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Paths
const ROOT_DIR   = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR   = path.join(ROOT_DIR, "data");

const MEMORY_PATH   = path.join(DATA_DIR, "memory.json");
const VARIANTS_PATH = path.join(DATA_DIR, "variants.json");
const STATS_PATH    = path.join(DATA_DIR, "stats.json");
const TRAINER_TXT   = path.join(DATA_DIR, "trainer_identity.txt");
const TRAINER_KNOW  = path.join(DATA_DIR, "trainer_knowledge");

// Ensure dirs/files
for (const p of [DATA_DIR, PUBLIC_DIR, TRAINER_KNOW]) {
  if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true });
}
if (!fssync.existsSync(MEMORY_PATH))   fssync.writeFileSync(MEMORY_PATH, JSON.stringify({ items: [] }, null, 2));
if (!fssync.existsSync(VARIANTS_PATH)) fssync.writeFileSync(VARIANTS_PATH, JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(STATS_PATH))    fssync.writeFileSync(STATS_PATH, JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(TRAINER_TXT))   fssync.writeFileSync(TRAINER_TXT, "");

// Serve estáticos
app.use(express.static(PUBLIC_DIR));

// Utils
async function readJsonSafe(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}
async function writeJsonPretty(file, obj) {
  await fs.writeFile(file, JSON.stringify(obj, null, 2), "utf8");
}
function clampReplyToWhatsApp(text, maxChars = 220) {
  let t = (text || "").trim();
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  t = parts.slice(0, 2).join(" ");
  if (t.length > maxChars) t = t.slice(0, maxChars - 1).trimEnd() + "…";
  return t;
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
function escapeHtml(s=""){return s.replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]))}

// Stats
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
  if (rating === "good") { stats.byKey[key][t].good += 1; stats.byKey[key][t].wins += 1; }
  else if (rating === "regular") { stats.byKey[key][t].regular += 1; stats.byKey[key][t].wins += 0.5; }
  else if (rating === "bad") { stats.byKey[key][t].bad += 1; }
  await writeJsonPretty(STATS_PATH, stats);
}

// Trainer cache
let TRAINER_IDENTITY = "";
let TRAINER_SNIPPETS = "";

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
    TRAINER_SNIPPETS = texts.join("\n\n---\n\n").slice(0, 10000);
  } catch { TRAINER_SNIPPETS = ""; }
}

// Health
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ferbot-api",
    time: new Date().toISOString(),
    openai: !!process.env.OPENAI_API_KEY,
    model_env: process.env.OPENAI_MODEL || "(unset)"
  });
});

// Reload trainer (acepta GET y POST)
app.get("/admin/reloadTrainer", async (_req, res) => {
  await loadTrainerIdentity();
  res.json({ ok: true, identity_len: TRAINER_IDENTITY.length, knowledge_len: TRAINER_SNIPPETS.length });
});
app.post("/admin/reloadTrainer", async (_req, res) => {
  await loadTrainerIdentity();
  res.json({ ok: true, identity_len: TRAINER_IDENTITY.length, knowledge_len: TRAINER_SNIPPETS.length });
});

// Assist
function fallbackWhy(stage, intent) {
  const map = {
    sondeo:     "Valido su meta y contexto para personalizar.",
    rebatir:    "Convierto la objeción en valor y acción.",
    pre_cierre: "Reafirmo valor anual y quito fricciones.",
    cierre:     "Concreto decisión con paso simple.",
    integracion:"Refuerzo hábito y primer paso claro."
  };
  return map[stage] || `Guío por valor y CTA (${intent}/${stage}).`;
}
function fallbackNext(stage) {
  const map = {
    sondeo:     "Haz 1 pregunta clave y confirma meta anual.",
    rebatir:    "Conecta valor→vida y pide mini OK.",
    pre_cierre: "Resume valor y pide confirmación.",
    cierre:     "Pide confirmación para activar hoy.",
    integracion:"Deja horario diario corto y seguimiento."
  };
  return map[stage] || "Cierra con un CTA claro.";
}

app.post("/assist_trainer", async (req, res) => {
  try {
    const { question = "", customerName = "", stage = "rebatir", intent: intentIn, context = "" } = req.body || {};
    const name = (customerName || "").trim() || "Cliente";
    const intent = intentIn || inferIntent(question);

    const rules = [
      "Eres FerBot (español Colombia, amable, dinámico, energía positiva).",
      "No vendes cursos sueltos: vendes transformación con SUSCRIPCIÓN ANUAL.",
      "Une características → beneficio de producto → beneficio de vida.",
      "No ofrezcas llamadas ni 'te envío material' ni clases gratis.",
      "Responde para WhatsApp: ≤220 caracteres, máx 2 frases.",
      "Formato estricto (3 líneas):",
      "REPLY: <mensaje listo y breve>",
      "WHY: <por qué responde así (≤100c, enseña táctica)>",
      "NEXT: <siguiente paso para el asesor (≤100c, orientado al anual)>"
    ].join("\n");

    const system = [
      TRAINER_IDENTITY || "",
      rules,
      TRAINER_SNIPPETS ? `Conocimiento adicional (resumen):\n${TRAINER_SNIPPETS}` : ""
    ].filter(Boolean).join("\n\n");

    const user = [
      `Nombre del cliente: ${name}`,
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
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    if (!r || !r.ok) {
      const errText = r ? (await r.text().catch(()=> "")) : "no_response";
      return res.status(500).json({ ok:false, error: "openai_failed", detail: errText });
    }

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || "";

    // Parse REPLY/WHY/NEXT
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

    res.json({
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
        intent, stage,
        persona: { name: "FerBot", brand: "Platzi" }
      }
    });
  } catch (err) {
    console.error("assist_trainer error", err);
    res.status(500).json({ ok:false, error:"assist_trainer_failed" });
  }
});

// Rating + Stats
app.post("/trackRate", async (req, res) => {
  try {
    const { intent = "_default", stage = "rebatir", text = "", rating = "regular" } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: "missing_text" });
    if (!["good","regular","bad"].includes(rating)) return res.status(400).json({ ok: false, error: "invalid_rating" });
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
        const wins  = Number(row.wins || 0);
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

// Dashboard simple
app.get("/admin/dashboard", async (_req, res) => {
  try {
    const apiBase = `http://localhost:${process.env.PORT || 3005}`;
    const resp = await fetch(`${apiBase}/stats`).then(r => r.json()).catch(()=>({ ok:false, rows:[] }));
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
  a.btn{display:inline-block;padding:8px 12px;border:1px solid rgba(255,255,255,.18);border-radius:10px;color:#e2e8f0;text-decoration:none;background:#101727;margin-right:8px}
</style>
</head>
<body>
  <h1>FerBot · Dashboard</h1>
  <div class="sub">Ranking por winrate y exposición (wins: buena=1, regular=0.5, mala=0)</div>
  <div style="margin:12px 0">
    <a class="btn" href="/stats" target="_blank">Ver JSON</a>
    <form method="POST" action="/admin/reloadTrainer" style="display:inline"><button class="btn" type="submit">Recargar Trainer</button></form>
    <a class="btn" href="/panel" target="_blank">Abrir Panel</a>
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

// Panel/Agent (mismo HTML)
app.get("/panel", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "panel.html")));
app.get("/agent", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "panel.html")));

// Boot
(async () => {
  await loadTrainerIdentity();
  const PORT = Number(process.env.PORT || 3005);
  app.listen(PORT, () => {
    console.log(`🔥 FerBot API escuchando en http://localhost:${PORT}`);
  });
})();
