// server.js — FerBot API + estáticos del panel y guía
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// === STATIC ===
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR, { index: false }));

// Salud
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ferbot-api",
    time: new Date().toISOString(),
    openai: true,
    model_env: "gpt-5",
  });
});

// Panel (consulta web)
app.get("/agent", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "panel.html"));
});

// Guía (instalación/uso)
app.get("/guide", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "guide.html"));
});

// (Rutas API existentes de tu app… deja aquí tu /assist_trainer, /trackRate, etc.)

// Fallback 404 amable para rutas desconocidas
app.use((req, res) => {
  res.status(404).send(`Not Found: ${req.method} ${req.url}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FerBot server listening on port ${PORT}`);
});
