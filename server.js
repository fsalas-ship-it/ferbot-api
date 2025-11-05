// server.js — FerBot API (panel + trainer + métricas)
// Requiere: Node 18+, .env con OPENAI_API_KEY y OPENAI_MODEL=gpt-5
import express from "express";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import OpenAI from "openai";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.resolve();

app.use(bodyParser.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// ---------- Utilidades de archivo ----------
const ensureDir = async (p) => { if (!fs.existsSync(p)) await fsp.mkdir(p, { recursive: true }); };
const readText = async (p) => fs.existsSync(p) ? (await fsp.readFile(p, "utf8")) : "";
const writeJson = async (p, data) => { await ensureDir(path.dirname(p)); await fsp.writeFile(p, JSON.stringify(data, null, 2), "utf8"); };
const appendLine = async (p, line) => { await ensureDir(path.dirname(p)); await fsp.appendFile(p, line + "\n", "utf8"); };

// ---------- HEALTH ----------
app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    service: "ferbot-api",
    time: new Date().toISOString(),
    openai: !!process.env.OPENAI_API_KEY,
    model_env: process.env.OPENAI_MODEL || "none"
  });
});

// ---------- TRAINER: identidad + conocimiento ----------
const IDENTITY_PATH = path.join(__dirname, "data", "trainer_identity.txt");
const KNOW_DIR = path.join(__dirname, "data", "trainer_knowledge");

async function loadTrainer() {
  const identity = await readText(IDENTITY_PATH);
  let knowledge = "";
  if (fs.existsSync(KNOW_DIR)) {
    const files = (await fsp.readdir(KNOW_DIR)).filter(f => f.endsWith(".md"));
    for (const f of files) {
      knowledge += `\n\n### ${f}\n` + await readText(path.join(KNOW_DIR, f));
    }
  }
  return { identity, knowledge };
}

// Nivel mínimo de guardia para prompts “REPLY/WHY/NEXT”
function formatGuard(text) {
  const trimmed = (text || "").trim();
  if (/REPLY:/i.test(trimmed) && /WHY:/i.test(trimmed) && /NEXT:/i.test(trimmed)) return trimmed;
  // fallback para modelos que no respeten formato
  return `REPLY: ${trimmed}\nWHY: Conecto valor con objetivo del cliente.\nNEXT: Proponer siguiente paso anual y activar hoy.`;
}

app.get("/admin/reloadTrainer", async (_req, res) => {
  try {
    const { identity, knowledge } = await loadTrainer();
    res.json({ ok: true, identity_len: identity.length, knowledge_len: knowledge.length });
  } catch (err) {
    res.json({ ok: false, error: String(err) });
  }
});

// ---------- STATS (shown + ratings) ----------
const DATA_DIR   = path.join(__dirname, "data");
const STATS_JSON = path.join(DATA_DIR, "stats.json");
const USAGE_ND   = path.join(DATA_DIR, "usage.ndjson");

async function addShown(intent, stage, text) {
  const now = new Date().toISOString();
  await appendLine(USAGE_ND, JSON.stringify({ t: now, type: "shown", intent, stage, text }));
  const stats = fs.existsSync(STATS_JSON) ? JSON.parse(await readText(STATS_JSON)) : { bySig: {} };
  const sig = `${intent}__${stage}__${text}`;
  stats.bySig[sig] = stats.bySig[sig] || { intent, stage, text, shown: 0, wins: 0 };
  stats.bySig[sig].shown += 1;
  await writeJson(STATS_JSON, stats);
}

async function addRating(intent, stage, text, rating) {
  const now = new Date().toISOString();
  await appendLine(USAGE_ND, JSON.stringify({ t: now, type: "rating", intent, stage, text, rating }));
  const stats = fs.existsSync(STATS_JSON) ? JSON.parse(await readText(STATS_JSON)) : { bySig: {} };
  const sig = `${intent}__${stage}__${text}`;
  stats.bySig[sig] = stats.bySig[sig] || { intent, stage, text, shown: 0, wins: 0 };
  // scoring: buena=1, regular=0.5, mala=0
  const score = rating === "good" ? 1 : rating === "regular" ? 0.5 : 0;
  stats.bySig[sig].wins += score;
  await writeJson(STATS_JSON, stats);
}

app.post("/trackShown", async (req, res) => {
  try {
    const { intent = "_panel", stage = "integracion", text = "" } = req.body || {};
    await addShown(intent, stage, text);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/trackRate", async (req, res) => {
  try {
    const { intent = "_panel", stage = "integracion", text = "", rating = "regular" } = req.body || {};
    await addRating(intent, stage, text, rating);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- ASSIST_TRAINER ----------
function guessIntent(q = "") {
  const s = (q || "").toLowerCase();
  if (/(tiempo|agenda|horario|no tengo tiempo|ocupad)/.test(s)) return "tiempo";
  if (/(precio|caro|costo|descuento|promoci)/.test(s)) return "precio";
  if (/(cert|certificado|certificación)/.test(s)) return "cert";
  if (/(coursera|udemy|alura|competenc)/.test(s)) return "competencia";
  if (/(platzi|pitch|que es platzi|qué es platzi)/.test(s)) return "pitch";
  return "_default";
}

app.post("/assist_trainer", async (req, res) => {
  const { question = "", customerName = "Cliente", stage = "sondeo", context = "" } = req.body || {};
  const intent = guessIntent(question);

  try {
    const { identity, knowledge } = await loadTrainer();
    const sys = `${identity}\n\n${knowledge}`.trim();
    const user = [
      `Cliente: ${customerName}`,
      `Etapa: ${stage}`,
      context ? `Contexto: ${context}` : null,
      `Mensaje: ${question}`,
      `Formato estricto (máx 220c):`,
      `REPLY: ...`,
      `WHY: ... (breve, didáctico)`,
      `NEXT: ... (paso accionable anual, sin llamadas ni enviar material)`,
    ].filter(Boolean).join("\n");

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const chat = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-5",
      messages: [
        { role: "system", content: sys },
        { role: "user",   content: user }
      ],
      temperature: 0.7,
      max_tokens: 320
    });

    const raw = chat.choices?.[0]?.message?.content || "";
    const text = formatGuard(raw);

    // Parse REPLY / WHY / NEXT
    const reply = (text.match(/REPLY:\s*([\s\S]*?)\n\s*WHY:/i)?.[1] || "").trim() || text.trim();
    const why   = (text.match(/WHY:\s*([\s\S]*?)\n\s*NEXT:/i)?.[1] || "").trim();
    const next  = (text.match(/NEXT:\s*([\s\S]*)$/i)?.[1] || "").trim();

    await addShown(intent, stage, reply);

    res.json({
      ok: true,
      text: reply,
      message: reply,
      answer: reply,
      result: {
        reply, why, next,
        guide: `POR QUÉ: ${why} · SIGUIENTE PASO: ${next}`,
        sections: { [stage]: reply },
        model: process.env.OPENAI_MODEL || "gpt-5",
        confidence: 0.9,
        intent, stage
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ---------- PANEL UNIFICADO ----------
app.get(["/agent", "/panel"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "agent.html"));
});

// ---------- USO / ADMIN ----------
app.get("/admin/usage", async (_req, res) => {
  const stats = fs.existsSync(STATS_JSON) ? JSON.parse(await readText(STATS_JSON)) : { bySig: {} };
  const rows = Object.values(stats.bySig);
  rows.sort((a, b) => (b.wins / Math.max(1, b.shown)) - (a.wins / Math.max(1, a.shown)));
  res.json({ ok: true, rows, total: rows.length });
});

// ---------- START ----------
app.listen(PORT, () => {
  console.log(`FerBot API ready on :${PORT}`);
});
