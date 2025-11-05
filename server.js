import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const __root = path.resolve();
const app = express();

const PORT = process.env.PORT || 3000;
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// --- Rutas estáticas (panel unificado)
app.use(express.static(path.join(__root, "public")));

// --- Paths de data
const DATA_DIR = path.join(__root, "data");
const IDENTITY_PATH = path.join(DATA_DIR, "trainer_identity.txt");
const KNOW_DIR = path.join(DATA_DIR, "trainer_knowledge");
const STATS_PATH = path.join(DATA_DIR, "stats.json");
const MEMORY_PATH = path.join(DATA_DIR, "memory.json");

// --- Estado en memoria
let TRAINER_IDENTITY = "";
let TRAINER_KNOWLEDGE = ""; // concatenado
let STATS = { byKey: {} };

// ------------------------ Utilidades ------------------------
async function ensureFiles() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(KNOW_DIR, { recursive: true });
  if (!fs.existsSync(STATS_PATH)) {
    await fsp.writeFile(STATS_PATH, JSON.stringify({ byKey: {} }, null, 2));
  }
  if (!fs.existsSync(MEMORY_PATH)) {
    await fsp.writeFile(MEMORY_PATH, JSON.stringify({ items: [] }, null, 2));
  }
}

async function loadStats() {
  try {
    const raw = await fsp.readFile(STATS_PATH, "utf8");
    STATS = JSON.parse(raw);
  } catch {
    STATS = { byKey: {} };
  }
}

async function saveStats() {
  await fsp.writeFile(STATS_PATH, JSON.stringify(STATS, null, 2));
}

async function loadTrainer() {
  const idTxt = fs.existsSync(IDENTITY_PATH)
    ? await fsp.readFile(IDENTITY_PATH, "utf8")
    : "";

  const files = fs.existsSync(KNOW_DIR) ? await fsp.readdir(KNOW_DIR) : [];
  const md = [];
  for (const f of files) {
    if (f.endsWith(".md")) {
      const p = path.join(KNOW_DIR, f);
      const t = await fsp.readFile(p, "utf8");
      md.push(`\n# Archivo: ${f}\n${t}\n`);
    }
  }

  TRAINER_IDENTITY = idTxt;
  TRAINER_KNOWLEDGE = md.join("\n");
  return {
    identity_len: TRAINER_IDENTITY.length,
    knowledge_len: TRAINER_KNOWLEDGE.length
  };
}

function sig(str) {
  return Buffer.from(str).toString("base64").slice(0, 16);
}

function normalize(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function guessIntent(q = "") {
  const s = (q || "").toLowerCase();
  if (/(tiempo|no tengo tiempo|poco tiempo|agenda|horario|no alcanzo|ocupad)/.test(s)) return "tiempo";
  if (/(precio|caro|costo|costoso|vale|promoci|oferta|descuento)/.test(s)) return "precio";
  if (/(cert|certificado|certificación|certificaciones)/.test(s)) return "cert";
  if (/(coursera|udemy|alura|competenc)/.test(s)) return "competencia";
  if (/(qué es platzi|que es platzi|platzi|pitch)/.test(s)) return "pitch";
  return "_default";
}

// ------------------------ OpenAI (fetch directo) ------------------------
async function callOpenAI(messages) {
  if (!OPENAI_KEY) {
    // modo local sin key: devuelve dummy coherente para probar UI
    return {
      reply: "Entendido, avanzas con clases cortas y plan anual. ¿Te activo hoy?",
      why: "Reconozco tu objeción y la convierto en hábito flexible anual.",
      next: "Confirma y activo su plan anual y primera clase hoy."
    };
  }

  const body = {
    model: OPENAI_MODEL,
    messages,
    temperature: 0.4
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${t}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";

  // Extrae REPLY / WHY / NEXT (formato que imponemos)
  const reply = (text.match(/REPLY:\s*(.+)/i)?.[1] || text).trim().slice(0, 220);
  const why   = (text.match(/WHY:\s*(.+)/i)?.[1] || "").trim();
  const next  = (text.match(/NEXT:\s*(.+)/i)?.[1] || "").trim();

  return { reply, why, next, raw: text };
}

function buildSystemPrompt() {
  return [
    "Eres FerBot, asesor comercial de Platzi para Colombia.",
    "Tono: español Colombia, amable, dinámico y con energía positiva.",
    "No vendes cursos sueltos; vendes TRANSFORMACIÓN con suscripción ANUAL.",
    "Respeta ETAPAS (integracion, sondeo, rebatir, pre_cierre, cierre).",
    "Prohibido: llamadas, pedir correos, enviar material.",
    "Formato OBLIGATORIO (3 líneas):",
    "REPLY: <máx 220c, 1–2 frases, listo para WhatsApp>",
    "WHY: <por qué (≤100c) explicando la lógica comercial>",
    "NEXT: <siguiente paso para el asesor (≤100c) orientado a venta anual>"
  ].join("\n");
}

// ------------------------ Endpoints ------------------------
app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    service: "ferbot-api",
    time: new Date().toISOString(),
    openai: !!OPENAI_KEY,
    model_env: OPENAI_MODEL
  });
});

app.get("/admin/reloadTrainer", async (_req, res) => {
  try {
    const r = await loadTrainer();
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Sirve el panel unificado (emergencia)
app.get("/agent", (_req, res) => {
  res.sendFile(path.join(__root, "public", "agent.html"));
});

// Consulta principal del bot
app.post("/assist_trainer", async (req, res) => {
  try {
    const { question = "", customerName = "Cliente", stage = "sondeo", context = "" } = req.body || {};
    const intent = guessIntent(question);

    const system = [
      buildSystemPrompt(),
      "",
      "=== Identidad ===",
      TRAINER_IDENTITY,
      "",
      "=== Conocimiento ===",
      TRAINER_KNOWLEDGE
    ].join("\n");

    const user = [
      `Cliente: ${customerName}`,
      `Etapa: ${stage}`,
      `Intent: ${intent}`,
      context ? `Contexto: ${context}` : "",
      `Mensaje del cliente: "${question}"`
    ].filter(Boolean).join("\n");

    const messages = [
      { role: "system", content: system },
      { role: "user", content: user }
    ];

    const out = await callOpenAI(messages);
    const reply = normalize(out.reply);
    const why = normalize(out.why);
    const next = normalize(out.next);

    // tracking de "shown"
    const key = `${intent}::${stage}::${sig(reply)}`;
    STATS.byKey[key] ??= { intent, stage, text: reply, shown: 0, wins: 0 };
    STATS.byKey[key].shown++;
    await saveStats();

    res.json({
      ok: true,
      text: reply,
      message: reply,
      answer: reply,
      result: {
        reply, why, next,
        guide: `POR QUÉ: ${why} · SIGUIENTE PASO: ${next}`,
        sections: { [stage]: reply },
        model: OPENAI_MODEL,
        confidence: 0.9,
        intent,
        stage,
        persona: { name: "FerBot", brand: "Platzi" }
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Calificación desde extensión o panel
app.post("/trackRate", async (req, res) => {
  try {
    const { intent = "_default", stage = "sondeo", text = "", rating = "good" } = req.body || {};
    const key = `${intent}::${stage}::${sig(text)}`;
    STATS.byKey[key] ??= { intent, stage, text, shown: 0, wins: 0 };
    if (rating === "good") STATS.byKey[key].wins += 1;
    if (rating === "regular") STATS.byKey[key].wins += 0.5;
    // "mala" no suma
    await saveStats();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// JSON crudo de stats (para gráficos si quieres)
app.get("/admin/usage.json", async (_req, res) => {
  await loadStats();
  res.json({ ok: true, stats: STATS });
});

// Redirecciones amigables que pediste antes
app.get("/admin/dashboard", (_req, res) => res.redirect("/agent"));
app.get("/admin/usability", (_req, res) => res.redirect("/agent"));

// Boot
await ensureFiles();
await loadStats();
await loadTrainer();
app.listen(PORT, () => {
  console.log(`[FerBot] API arriba en http://localhost:${PORT}`);
});
