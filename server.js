// server.js — FerBot API (estable)
// Requisitos: Node 18+, OPENAI_API_KEY en el entorno

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const bodyParser = require("body-parser");

// ---------- Config ----------
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const TRAINER_IDENTITY = path.join(DATA_DIR, "trainer_identity.txt");
const TRAINER_KNOWLEDGE_DIR = path.join(DATA_DIR, "trainer_knowledge");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5"; // tu modelo en uso

// ---------- Estado en memoria ----------
let TRAINER = {
  identity: "",
  knowledge: "",
  loadedAt: null,
};

let STATS = {
  // estructura mínima para el dashboard
  shown: {}, // firma -> { intent, stage, text, shown, wins }
};

// ---------- Utilidades ----------
function safeRead(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

function loadKnowledgeFromDir(dir) {
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".md") || f.endsWith(".txt"));
  return files.map(f => `# ${f}\n` + safeRead(path.join(dir, f))).join("\n\n");
}

function signatureFor(text = "") {
  return text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

function ensureStatEntry(sig, intent, stage, text) {
  if (!STATS.shown[sig]) {
    STATS.shown[sig] = { intent, stage, text, shown: 0, wins: 0 };
  }
  return STATS.shown[sig];
}

async function callOpenAI(messages) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not set");
  }
  const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.4,
      max_tokens: 220,
    })
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(()=> "");
    const err = new Error(`OpenAI HTTP ${resp.status}: ${txt}`);
    err.status = resp.status;
    throw err;
  }
  const json = await resp.json();
  const text = json?.choices?.[0]?.message?.content || "";
  return text;
}

// ---------- Trainer ----------
function loadTrainer() {
  const identity = safeRead(TRAINER_IDENTITY);
  const knowledge = loadKnowledgeFromDir(TRAINER_KNOWLEDGE_DIR);
  TRAINER = { identity, knowledge, loadedAt: new Date() };
}

function buildSystemPrompt() {
  const id = TRAINER.identity || "Eres FerBot. Responde corto, claro, tono Colombia.";
  const kn = TRAINER.knowledge || "";
  return `${id}\n\n=== Conocimiento ===\n${kn}\n\n` +
    `Devuelve SIEMPRE:\nREPLY: <1-2 frases máx 220c>\nWHY: <por qué de la respuesta>\nNEXT: <siguiente paso para el asesor>`;
}

function guessIntent(q = "") {
  const s = (q || "").toLowerCase();
  if (/(tiempo|no tengo tiempo|agenda|horario|ocupad)/.test(s)) return "tiempo";
  if (/(precio|caro|costo|vale|descuento|promoci)/.test(s)) return "precio";
  if (/(cert|certificado|certificación|certificaciones)/.test(s)) return "cert";
  if (/(coursera|udemy|alura|competenc)/.test(s)) return "competencia";
  if (/(platzi|qué es platzi|que es platzi|pitch)/.test(s)) return "pitch";
  return "_default";
}

const FALLBACKS = {
  integracion: (name) => ({
    reply: `Hola ${name}, en Platzi transformas tu carrera con plan anual: rutas, clases cortas y certificaciones verificables. ¿Qué meta priorizas este año?`,
    why: "Integro saludo + valor anual y pido meta.",
    next: "Guía a elegir escuela/meta y activar hoy.",
  }),
  sondeo: (name) => ({
    reply: `${name}, cuéntame tu meta de este año (empleo, ingresos o inglés) y el tiempo que puedes dedicar. Te paso una ruta anual precisa.`,
    why: "Recojo meta/tiempo para personalizar ruta.",
    next: "Con la meta, propon ruta y activa hoy.",
  }),
  rebatir: (name) => ({
    reply: `${name}, cambiemos objeción por valor: plan anual, clases cortas y certificados que se convierten en oportunidades. ¿Te activo hoy?`,
    why: "Viro objeción a valor/resultado del año.",
    next: "Si confirma, activa plan y primera clase.",
  }),
  pre_cierre: (name) => ({
    reply: `${name}, dejemos listo hoy: plan anual con rutas y certificaciones; tú eliges ritmo y yo te guío. ¿Lo activamos ya?`,
    why: "Quito fricción y enfoco en decisión.",
    next: "Pide confirmación y comparte paso de pago.",
  }),
  cierre: (name) => ({
    reply: `${name}, perfecto: activo tu plan anual y te dejo ruta y primera clase. ¿Confirmas para habilitar acceso ya?`,
    why: "Cierre directo con siguiente acción.",
    next: "Confirma y comparte instrucciones de pago.",
  }),
  _default: (name) => ({
    reply: `Hola ${name}, enfoco en transformación anual: rutas, clases cortas y certificaciones. ¿Qué quieres lograr este año?`,
    why: "Aterrizo valor anual y pido meta.",
    next: "Con meta, arma ruta y activa hoy.",
  }),
};

// ---------- App ----------
const app = express();
app.use(cors());
app.use(morgan("tiny"));
app.use(bodyParser.json({ limit: "2mb" }));

// Static y alias
app.use(express.static(PUBLIC_DIR));
app.get("/panel", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "panel.html")));
app.get("/agent", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "agent.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "usability.html")));
app.get("/", (req, res) => res.redirect("/panel"));

// Health
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "ferbot-api",
    time: new Date().toISOString(),
    openai: !!OPENAI_API_KEY,
    model_env: OPENAI_MODEL,
  });
});

// Reload trainer
app.get("/admin/reloadTrainer", (req, res) => {
  loadTrainer();
  res.json({
    ok: true,
    identity_len: TRAINER.identity.length,
    knowledge_len: TRAINER.knowledge.length,
    loadedAt: TRAINER.loadedAt,
  });
});

// Assist endpoint
app.post("/assist_trainer", async (req, res) => {
  try {
    const { question, customerName, stage, context } = req.body || {};
    const q = (question || "").trim();
    const name = (customerName || "Cliente").trim();
    const stageKey = (stage || "_default").trim();
    const ctx = (context || "").trim();

    if (!q) return res.status(400).json({ ok:false, error:"question_required" });

    const sys = buildSystemPrompt();
    const intent = guessIntent(q);

    const user = [
      `Etapa: ${stageKey}`,
      `Intento: ${intent}`,
      ctx ? `Contexto: ${ctx}` : null,
      `Mensaje del cliente (${name}): ${q}`,
      `Formato obligatorio:\nREPLY: ...\nWHY: ...\nNEXT: ...`,
    ].filter(Boolean).join("\n");

    let text = "";
    try {
      text = await callOpenAI([
        { role:"system", content: sys },
        { role:"user", content: user },
      ]);
    } catch (err) {
      // fallback si OpenAI falla
      const f = (FALLBACKS[stageKey] || FALLBACKS._default)(name);
      return res.json({
        ok: true,
        text: f.reply,
        result: { reply: f.reply, why: f.why, next: f.next, stage: stageKey, intent, model: "fallback" }
      });
    }

    // parsea REPLY/WHY/NEXT (tolerante)
    const lines = text.split("\n").map(s=>s.trim());
    let reply="", why="", next="";
    for (const ln of lines) {
      if (!reply && /^reply:/i.test(ln)) reply = ln.replace(/^reply:/i,"").trim();
      else if (!why && /^why:/i.test(ln)) why = ln.replace(/^why:/i,"").trim();
      else if (!next && /^next:/i.test(ln)) next = ln.replace(/^next:/i,"").trim();
    }
    if (!reply) reply = lines.filter(Boolean).join(" ").slice(0, 220);

    // registra estadística básica
    const sig = signatureFor(reply);
    const stat = ensureStatEntry(sig, intent, stageKey, reply);
    stat.shown += 1;

    return res.json({
      ok: true,
      text: reply,
      result: { reply, why, next, stage: stageKey, intent, model: OPENAI_MODEL }
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error:"assist_failed" });
  }
});

// Rating simple
app.post("/trackRate", (req, res) => {
  try {
    const { text, intent, stage, rating } = req.body || {};
    if (!text) return res.json({ ok:true }); // tolerante
    const sig = signatureFor(text);
    const stat = ensureStatEntry(sig, intent || "_", stage || "_", text);
    if (rating === "good") stat.wins += 1;
    return res.json({ ok:true });
  } catch {
    return res.json({ ok:true });
  }
});

// 404 controlado (para que sepas si falta un archivo en /public)
app.use((req, res) => {
  res.status(404).send(`Not Found: ${req.originalUrl}`);
});

// Arranque
loadTrainer();
app.listen(PORT, () => {
  console.log(`FerBot API on :${PORT}`);
});
