// ===============================
// FerBot API — Servidor principal
// ===============================
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ===============================
// CONFIG GENERAL
// ===============================
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";

// ===============================
// HEALTH CHECK
// ===============================
app.get("/health", async (req, res) => {
  res.json({
    ok: true,
    service: "ferbot-api",
    time: new Date().toISOString(),
    openai: !!OPENAI_API_KEY,
    model_env: OPENAI_MODEL
  });
});

// ===============================
// RUTA DE TEST
// ===============================
app.get("/assist_trainer/test", (req, res) => {
  res.json({
    ok: true,
    sample: "Ruta de prueba del asistente FerBot activa.",
    model: OPENAI_MODEL,
    time: new Date().toISOString()
  });
});

// ===============================
// ASISTENTE PRINCIPAL
// ===============================
app.post("/assist_trainer", async (req, res) => {
  try {
    const { question, customerName, stage, context, intent } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Falta 'question' en el cuerpo." });
    }

    // Construir prompt (ajustado al Trainer)
    const prompt = `
Eres FerBot, asesor comercial de Platzi.
Etapa: ${stage || "rebatir"}.
Cliente: ${customerName || "Cliente"}.
Contexto: ${context || "sin contexto"}.
Intención: ${intent || "_default"}.

Pregunta o mensaje: "${question}".

Responde en formato:
REPLY: <respuesta para WhatsApp (máx 2 frases, ≤220 caracteres)>
WHY: <por qué se da esta respuesta, útil para que el asesor aprenda>
NEXT: <siguiente paso comercial para el asesor>
    `.trim();

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: "Eres un experto asesor comercial de Platzi, breve, claro y con tono humano." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 200
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: "Error de OpenAI", details: data });
    }

    const raw = data.choices?.[0]?.message?.content || "Sin respuesta";
    const replyMatch = raw.match(/REPLY:(.*)/i);
    const whyMatch = raw.match(/WHY:(.*)/i);
    const nextMatch = raw.match(/NEXT:(.*)/i);

    const result = {
      reply: replyMatch ? replyMatch[1].trim() : raw,
      why: whyMatch ? whyMatch[1].trim() : "",
      next: nextMatch ? nextMatch[1].trim() : "",
      model: OPENAI_MODEL
    };

    res.json({
      ok: true,
      result
    });
  } catch (err) {
    console.error("Error en /assist_trainer:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===============================
// TRACK RATE (Calificaciones)
// ===============================
app.post("/trackRate", async (req, res) => {
  const { intent, stage, text, rating } = req.body;
  if (!text || !rating) return res.status(400).json({ error: "Faltan datos" });
  console.log(`[RATE] ${rating.toUpperCase()} | ${stage} | ${intent} → ${text.slice(0, 80)}...`);
  res.json({ ok: true });
});

// ===============================
// INICIO
// ===============================
app.listen(PORT, () => {
  console.log(`✅ FerBot API lista en puerto ${PORT}`);
});
