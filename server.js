// FerBot API — CommonJS para evitar fallas de arranque en Render (status 1)
// Incluye: normalización de stage + fallbacks por etapa + rutas de panel/agent/dashboard

const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json({ limit: "1mb" }));

// Archivos estáticos (panel, agent, manuales, etc.)
app.use(express.static(path.join(__dirname, "public")));

const MODEL = process.env.OPENAI_MODEL || "gpt-5";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

// =========================
// Trainer en memoria
// =========================
let IDENTITY = "";
let KNOWLEDGE = "";

function loadTrainer() {
  try {
    const p = path.join(__dirname, "data", "trainer_identity.txt");
    IDENTITY = fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : "";
  } catch {
    IDENTITY = "";
  }
  try {
    const dir = path.join(__dirname, "data", "trainer_knowledge");
    if (fs.existsSync(dir)) {
      const parts = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
      KNOWLEDGE = parts.join("\n\n").trim();
    } else {
      KNOWLEDGE = "";
    }
  } catch {
    KNOWLEDGE = "";
  }
}
loadTrainer();

// =========================
// Utilidades
// =========================
const STAGES = new Set(["sondeo", "rebatir", "pre_cierre", "cierre", "integracion"]);
function normStage(s = "") {
  s = String(s || "").toLowerCase().trim();
  if (!STAGES.has(s)) return "sondeo";
  return s;
}

function buildSystem() {
  const base = [
    `Eres FerBot. Aplica identidad y políticas. Español Colombia.`,
    `Formato OBLIGATORIO:\nREPLY: <≤220c, 1–2 frases>\nWHY: <≤100c>\nNEXT: <≤100c>`,
  ];
  if (IDENTITY) base.push(IDENTITY);
  return base.join("\n\n");
}

function buildUser({ question, customerName, stage, context, intent }) {
  return [
    `Cliente: ${customerName || "Cliente"}`,
    `Etapa: ${stage}`,
    `Intento: ${intent || "_default"}`,
    context ? `Contexto: ${context}` : ``,
    `Texto: ${question || ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Fallbacks distintos por etapa (evita “misma respuesta”)
const FALLBACKS = {
  sondeo: (name) => ({
    reply: `${name}, para ayudarte bien: ¿qué priorizas este año: empleo, subir ingresos o inglés? Te guío en ruta anual.`,
    why: `Pregunto meta para orientar valor.`,
    next: `Según respuesta, elige escuela y activa plan anual hoy.`,
  }),
  rebatir: (name) => ({
    reply: `${name}, enfoquemos valor anual: ruta clara, clases cortas y certificaciones. ¿Lo activamos hoy y te marco el primer paso?`,
    why: `Convierto objeción en beneficio + acción.`,
    next: `Si acepta, activa plan anual y envía 1ª clase.`,
  }),
  pre_cierre: (name) => ({
    reply: `${name}, el plan anual sostiene hábito y consolida resultados. ¿Lo activo ahora y dejo la ruta lista?`,
    why: `Refuerzo valor y quito fricción hacia la decisión.`,
    next: `Confirma medio de pago y horario hoy.`,
  }),
  cierre: (name) => ({
    reply: `${name}, ¿confirmo el plan anual y empezamos hoy con tu primera clase?`,
    why: `Cierre claro y amable.`,
    next: `Confirma y comparte acceso + 1ª clase.`,
  }),
  integracion: (name) => ({
    reply: `¡Hola ${name}! En Platzi transformas tu carrera con rutas anuales y certificaciones. ¿Qué priorizas hoy para empezar?`,
    why: `Enmarco valor y pido meta.`,
    next: `Según meta, elige escuela y activa acceso hoy.`,
  }),
};

// =========================
// Rutas de salud y admin
// =========================
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "ferbot-api",
    time: new Date().toISOString(),
    openai: !!process.env.OPENAI_API_KEY,
    model_env: MODEL,
  });
});

app.get("/admin/reloadTrainer", (req, res) => {
  loadTrainer();
  res.json({ ok: true, identity_len: IDENTITY.length, knowledge_len: KNOWLEDGE.length });
});

// Atajos UI (no rompen GitHub Pages)
app.get("/", (_req, res) => res.redirect("/panel.html"));
app.get("/agent", (_req, res) => res.redirect("/agent.html"));
app.get("/dashboard", (_req, res) => res.redirect("/usability.html"));

// =========================
app.post("/assist_trainer", async (req, res) => {
  try {
    const question = String(req.body?.question || "");
    const customerName = String(req.body?.customerName || "Cliente");
    const stage = normStage(req.body?.stage);
    const context = String(req.body?.context || "");
    const intent = String(req.body?.intent || "_default");

    let reply = "";
    let why = "";
    let next = "";

    // Solo intentamos LLM si hay API Key y hay identidad
    if (process.env.OPENAI_API_KEY && IDENTITY) {
      try {
        const chat = await openai.chat.completions.create({
          model: MODEL,
          temperature: 0.4,
          max_tokens: 300,
          messages: [
            { role: "system", content: buildSystem() },
            {
              role: "user",
              content: `Conoce estos conocimientos:\n${KNOWLEDGE || "(sin conocimiento)"}\n\n${buildUser({
                question,
                customerName,
                stage,
                context,
                intent,
              })}`,
            },
          ],
        });

        const text = (chat?.choices?.[0]?.message?.content || "").trim();
        const rx = /REPLY:\s*([\s\S]*?)\n+WHY:\s*([\s\S]*?)\n+NEXT:\s*([\s\S]*)/i;
        const m = rx.exec(text);
        if (m) {
          reply = (m[1] || "").trim();
          why = (m[2] || "").trim();
          next = (m[3] || "").trim();
        }
      } catch (e) {
        // caemos a fallback
      }
    }

    if (!reply) {
      const fb = FALLBACKS[stage](customerName);
      reply = fb.reply;
      why = fb.why;
      next = fb.next;
    }

    res.json({
      ok: true,
      text: reply,
      message: reply,
      answer: reply,
      result: {
        reply,
        why,
        next,
        guide: `Por qué: ${why} · Siguiente paso: ${next}`,
        sections: { [stage]: reply },
        model: MODEL,
        confidence: 0.9,
        intent,
        stage,
        persona: { name: "Ferney Salas", brand: "Platzi" },
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "assist_failed", detail: String(e) });
  }
});

// Telemetría simple (mantengo tu formato básico)
app.post("/trackRate", (req, res) => {
  try {
    const p = path.join(__dirname, "stats.json");
    const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { byKey: {} };

    const intent = String(req.body?.intent || "_default");
    const stage = normStage(req.body?.stage);
    const text = String(req.body?.text || "");
    const rating = String(req.body?.rating || "");

    const key = `${intent}::${stage}::${text.slice(0, 140)}`;
    data.byKey[key] = data.byKey[key] || { shown: 0, wins: 0, ratingCounts: { good: 0, regular: 0, bad: 0 } };
    data.byKey[key].shown++;
    if (rating === "good") data.byKey[key].wins++;
    if (rating && data.byKey[key].ratingCounts[rating] != null) data.byKey[key].ratingCounts[rating]++;

    fs.writeFileSync(p, JSON.stringify(data, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: "track_failed" });
  }
});

// Arranque
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FerBot API on :${PORT}`);
});
