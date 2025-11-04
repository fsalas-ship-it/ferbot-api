// server.js — versión estable FerBot API
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

// === TEST HEALTH ===
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "ferbot-api",
    time: new Date().toISOString(),
    openai: true,
    model_env: "gpt-5"
  });
});

// === TEST ASSIST TRAINER ===
app.get("/assist_trainer/test", (req, res) => {
  res.json({
    ok: true,
    sample: "Ruta de prueba del asistente FerBot activa.",
    model: "gpt-5",
    time: new Date().toISOString()
  });
});

// === POST ASSIST TRAINER ===
app.post("/assist_trainer", async (req, res) => {
  try {
    const { question, customerName, stage, context, intent } = req.body;

    const reply = `${customerName || "Cliente"}, gracias por tu mensaje sobre "${question}". Estamos procesando tu consulta en la etapa "${stage}".`;

    const response = {
      ok: true,
      result: {
        reply,
        why: `Reconoce y valida la inquietud de ${customerName || "el cliente"}.`,
        next: "Proporcionar orientación personalizada y cerrar con suscripción anual."
      }
    };
    res.json(response);
  } catch (err) {
    console.error("Error en /assist_trainer:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === TRACK RATE ===
app.post("/trackRate", async (req, res) => {
  console.log("📊 Rating recibido:", req.body);
  res.json({ ok: true });
});

// === RUTA POR DEFECTO ===
app.use((req, res) => {
  res.status(404).send("Ruta no encontrada.");
});

app.listen(PORT, () => console.log(`✅ FerBot API corriendo en puerto ${PORT}`));
