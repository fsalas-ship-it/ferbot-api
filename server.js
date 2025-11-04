/**
 * FerBot API - server.js (versión estable)
 * Endpoints: /health, /assist_trainer, /trackRate, /admin/usage_json
 * Páginas: /install, /manual, /panel, /usability, /agent
 *
 * Requisitos de carpetas/archivos (si no existen, el servidor se auto-recupera):
 *  - data/trainer_identity.txt
 *  - data/trainer_knowledge/*.md
 *  - public/install.html, public/manual.html, public/panel.html, public/usability.html
 *
 * Variables de entorno (opcional):
 *  - OPENAI_API_KEY
 *  - OPENAI_MODEL  (por defecto: "gpt-5")
 *  - PORT          (por defecto: 10000 o lo que asigne Render)
 */

const express = require("express");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const cors = require("cors");
const morgan = require("morgan");

// -------------- Config básica --------------
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors());
app.use(morgan("tiny"));

// -------------- Paths y helpers --------------
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const PUB_DIR = path.join(ROOT, "public");

// Archivos de estado / métricas (persisten en disco)
const FILE_SHOWN = path.join(ROOT, "shown.json");         // conteo de "shown" por firma
const FILE_STATS = path.join(ROOT, "stats.json");         // conteo de calificaciones
const FILE_USAGE = path.join(ROOT, "usage.json");         // ranking consolidado (cache)
const FILE_LOG   = path.join(ROOT, "logs_server.out");    // logs simples

// Trainer
const TRAINER_IDENTITY = path.join(DATA_DIR, "trainer_identity.txt");
const TRAINER_KNOW_DIR = path.join(DATA_DIR, "trainer_knowledge");

// OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-5";

// Memoria en caliente
let TRAINER = {
  identity: "",
  knowledge: [],
  identity_len: 0,
  knowledge_len: 0,
  loaded_at: 0
};

// -------------- Utilidades de FS --------------
async function fileExists(p) {
  try { await fsp.access(p, fs.constants.F_OK); return true; }
  catch { return false; }
}

async function readJson(file, fallback) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  try {
    await fsp.writeFile(file, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("No se pudo escribir", file, e?.message);
  }
}

async function appendLog(line) {
  try {
    await fsp.appendFile(FILE_LOG, line + "\n", "utf8");
  } catch {}
}

// -------------- Carga del trainer --------------
async function ensureTrainerSkeleton() {
  // Si no hay data/, crea estructura mínima
  try { await fsp.mkdir(DATA_DIR, { recursive: true }); } catch {}
  try { await fsp.mkdir(TRAINER_KNOW_DIR, { recursive: true }); } catch {}

  if (!(await fileExists(TRAINER_IDENTITY))) {
    const fallbackIdentity = `Eres FerBot, asesor comercial de Platzi para Colombia.
Tono: español Colombia, amable, dinámico y con energía. Respuestas cortas (≤220c), 1–2 frases.
No ofreces llamadas ni "te envío material". Vendes transformación con suscripción anual.
Formato:
REPLY: <mensaje listo para WhatsApp>
WHY: <por qué responde así>
NEXT: <siguiente paso para el asesor>`;
    await fsp.writeFile(TRAINER_IDENTITY, fallbackIdentity, "utf8");
  }

  // Conocimiento mínimo
  const demoMd = path.join(TRAINER_KNOW_DIR, "demo.md");
  if (!(await fileExists(demoMd))) {
    const md = `# tiempo
Si el cliente dice "no tengo tiempo", enfoca en flexibilidad: clases cortas, progreso anual, hábito diario.

# precio
Mueve precio → valor: plan anual habilita todo (certificados, escuelas, offline) con retorno en el año.

# cert
Certificaciones digitales verificables que respaldan avance y empleabilidad.`;
    await fsp.writeFile(demoMd, md, "utf8");
  }
}

async function loadTrainer() {
  await ensureTrainerSkeleton();

  const identity = await fsp.readFile(TRAINER_IDENTITY, "utf8").catch(() => "");
  let knowledge = [];
  try {
    const files = await fsp.readdir(TRAINER_KNOW_DIR);
    for (const f of files) {
      if (f.toLowerCase().endsWith(".md")) {
        const md = await fsp.readFile(path.join(TRAINER_KNOW_DIR, f), "utf8").catch(() => "");
        if (md.trim()) knowledge.push({ file: f, text: md });
      }
    }
  } catch {}

  TRAINER = {
    identity,
    knowledge,
    identity_len: (identity || "").length,
    knowledge_len: knowledge.reduce((a, k) => a + (k.text?.length || 0), 0),
    loaded_at: Date.now()
  };
  await appendLog(`[trainer] identity=${TRAINER.identity_len}, knowledge=${TRAINER.knowledge_len}`);
  return TRAINER;
}

// -------------- Inferencia/intento/etapa --------------
function guessIntent(q = "") {
  const s = (q || "").toLowerCase();
  if (/(tiempo|no tengo tiempo|agenda|horari|ocupad)/.test(s)) return "tiempo";
  if (/(precio|caro|costo|promoci|oferta|descuento)/.test(s)) return "precio";
  if (/(cert|certificado|certificación|certificaciones)/.test(s)) return "cert";
  if (/(coursera|udemy|alura|competenc)/.test(s)) return "competencia";
  if (/(qué es platzi|que es platzi|platzi|pitch)/.test(s)) return "pitch";
  return "_default";
}

function safeStr(x) { return (x || "").toString().trim(); }

function buildPrompt({ question, customerName, stage, context }) {
  const kBlocks = TRAINER.knowledge.map(k => `### ${k.file}\n${k.text}`).join("\n\n");
  return `
${TRAINER.identity}

Contexto del asesor:
- Cliente: ${safeStr(customerName) || "Cliente"}
- Etapa: ${safeStr(stage) || "rebatir"}
- Texto del cliente: """${safeStr(question)}"""
- Notas del asesor: """${safeStr(context)}"""

Conocimiento:
${kBlocks}

Recuerda: máximo 220 caracteres en REPLY (1–2 frases), español Colombia, energía positiva, sin llamadas ni "te envío material".
Devuelve estrictamente:
REPLY: ...
WHY: ...
NEXT: ...
`.trim();
}

// -------------- OpenAI call (con fallback) --------------
async function callOpenAIChat(prompt) {
  if (!OPENAI_API_KEY) {
    // Fallback simple si no hay API key
    const reply = "Entiendo. Con el plan anual avanzas a tu ritmo y certificas tu progreso; ¿activamos hoy y te guío?";
    return {
      reply,
      why: "Conecto su necesidad con valor anual y acción hoy.",
      next: "Confirma y activa el plan anual; guía la primera meta."
    };
  }

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3
      })
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      await appendLog(`[openai_error] ${r.status} ${t}`);
      throw new Error(`OpenAI HTTP ${r.status}`);
    }

    const json = await r.json();
    const content = json?.choices?.[0]?.message?.content || "";
    // Parse formato:
    // REPLY: ...
    // WHY: ...
    // NEXT: ...
    const reply = (content.match(/REPLY:\s*([\s\S]*?)\n/i)?.[1] || "").trim() ||
                  (content.split("\n")[0] || "").replace(/^REPLY:\s*/i, "").trim();
    const why   = (content.match(/WHY:\s*([\s\S]*?)\n/i)?.[1] || "").trim();
    const next  = (content.match(/NEXT:\s*([\s\S]*?)$/i)?.[1] || "").trim();

    return { reply, why, next };
  } catch (e) {
    await appendLog(`[openai_exception] ${e?.message || e}`);
    // fallback
    return {
      reply: "Activa hoy tu plan anual: avanzas con clases cortas y certificaciones verificables. ¿Lo activo y te guío?",
      why: "Ofrezco valor anual y acción inmediata.",
      next: "Confirma y guía a elegir escuela/meta para iniciar hoy."
    };
  }
}

// -------------- Métricas (shown / ratings) --------------
async function bumpShown(signature, intent, stage, text) {
  const shown = await readJson(FILE_SHOWN, {});
  if (!shown[signature]) shown[signature] = { intent, stage, text, shown: 0 };
  shown[signature].shown += 1;
  // guarda snapshot de texto por si cambió
  shown[signature].text = text;
  shown[signature].intent = intent;
  shown[signature].stage = stage;
  await writeJson(FILE_SHOWN, shown);
}

async function bumpRating(signature, rating) {
  const stats = await readJson(FILE_STATS, {});
  if (!stats[signature]) stats[signature] = { good: 0, regular: 0, bad: 0 };
  if (rating === "good") stats[signature].good += 1;
  else if (rating === "regular") stats[signature].regular += 1;
  else if (rating === "bad") stats[signature].bad += 1;
  await writeJson(FILE_STATS, stats);
}

function signatureFor(text) {
  // Firma corta y estable por texto
  const s = (text || "").trim().slice(0, 300);
  const h = require("crypto").createHash("sha1").update(s).digest("hex").slice(0, 12);
  return `${h}`;
}

async function buildUsageRanking() {
  const shown = await readJson(FILE_SHOWN, {});
  const stats = await readJson(FILE_STATS, {});
  const arr = [];

  Object.keys(shown).forEach(sig => {
    const sh = shown[sig]?.shown || 0;
    const st = stats[sig] || { good: 0, regular: 0, bad: 0 };
    const wins = (st.good || 0) + 0.5 * (st.regular || 0); // compuesto
    arr.push({
      signature: sig,
      intent: shown[sig]?.intent || "",
      stage: shown[sig]?.stage || "",
      text: shown[sig]?.text || "",
      shown: sh,
      wins: wins,
      goods: st.good || 0,
      bads: st.bad || 0,
      winrate: sh ? (wins / sh) : 0
    });
  });

  // Ordenar por winrate y exposición
  arr.sort((a, b) => {
    if (b.winrate !== a.winrate) return b.winrate - a.winrate;
    return (b.shown || 0) - (a.shown || 0);
  });

  const usage = {
    updated_at: Date.now(),
    ranking: arr
  };
  await writeJson(FILE_USAGE, usage);
  return usage;
}

// -------------- Endpoints API --------------
app.get("/health", async (_, res) => {
  res.json({
    ok: true,
    service: "ferbot-api",
    time: new Date().toISOString(),
    openai: !!OPENAI_API_KEY,
    model_env: OPENAI_MODEL
  });
});

// Carga trainer al arranque
loadTrainer().catch(() => {});

// (opcional) recargar trainer manualmente
app.get("/admin/reloadTrainer", async (_, res) => {
  const t = await loadTrainer();
  res.json({ ok: true, identity_len: t.identity_len, knowledge_len: t.knowledge_len });
});

// Core: generar respuesta
app.post("/assist_trainer", async (req, res) => {
  try {
    const { question, customerName, stage, context, intent: intentIn } = req.body || {};
    const intent = intentIn || guessIntent(question || "");
    const prompt = buildPrompt({ question, customerName, stage, context });

    const { reply, why, next } = await callOpenAIChat(prompt);
    const guide = `Por qué: ${why} · Siguiente paso: ${next}`;

    // métrica "shown"
    const sig = signatureFor(reply);
    await bumpShown(sig, intent, stage || "rebatir", reply);

    const payload = {
      ok: true,
      text: reply,
      whatsapp: reply,
      message: reply,
      answer: reply,
      result: {
        reply,
        why,
        next,
        guide,
        sections: { [stage || "rebatir"]: reply },
        model: OPENAI_MODEL,
        confidence: 0.9,
        intent,
        stage: stage || "rebatir",
        persona: { name: "FerBot", brand: "Platzi" }
      }
    };
    res.json(payload);
  } catch (e) {
    await appendLog(`[assist_error] ${e?.message || e}`);
    res.status(500).json({ ok: false, error: "assist_failed" });
  }
});

// Registrar calificación
app.post("/trackRate", async (req, res) => {
  try {
    const { text, rating } = req.body || {};
    if (!text || !rating) return res.status(400).json({ ok: false, error: "missing_params" });
    const sig = signatureFor(text);
    await bumpRating(sig, rating);
    // re-construir ranking en background (no bloquear)
    buildUsageRanking().catch(()=>{});
    res.json({ ok: true });
  } catch (e) {
    await appendLog(`[rate_error] ${e?.message || e}`);
    res.status(500).json({ ok: false, error: "track_failed" });
  }
});

// JSON para dashboard
app.get("/admin/usage_json", async (_, res) => {
  try {
    const u = await buildUsageRanking();
    res.json(u);
  } catch (e) {
    await appendLog(`[usage_error] ${e?.message || e}`);
    res.status(500).json({ ok: false, error: "usage_failed" });
  }
});

// -------------- Páginas (HTML) --------------
app.use(express.static(PUB_DIR));

// Alias/ rutas limpias
app.get("/install",   (_, res) => res.sendFile(path.join(PUB_DIR, "install.html")));
app.get("/manual",    (_, res) => res.sendFile(path.join(PUB_DIR, "manual.html")));
app.get("/panel",     (_, res) => res.sendFile(path.join(PUB_DIR, "panel.html")));
app.get("/usability", (_, res) => res.sendFile(path.join(PUB_DIR, "usability.html")));
app.get("/agent",     (_, res) => res.sendFile(path.join(PUB_DIR, "panel.html"))); // alias del panel
app.get("/guide",     (_, res) => res.redirect(301, "/install"));                  // compatibilidad

// -------------- Arranque --------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`FerBot API escuchando en :${PORT}`);
});
