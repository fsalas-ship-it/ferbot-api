// server.js
// FerBot API — Express + OpenAI + Explicación didáctica + Métricas sencillas

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fetch = (...args) => import("node-fetch").then(({default: f}) => f(...args));

const PORT = Number(process.env.PORT || 3005);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_FERBOT;
const MODEL = process.env.OPENAI_MODEL || "gpt-5"; // tu modelo en Render
const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---------- util fs (logs planos)
const F_STATS = path.join(process.cwd(), "stats.json");
const F_USAGE = path.join(process.cwd(), "usage.ndjson");

function appendUsage(entry){
  try {
    fs.appendFileSync(F_USAGE, JSON.stringify(entry)+"\n", "utf8");
  } catch {}
}
function readStats(){
  try { return JSON.parse(fs.readFileSync(F_STATS,"utf8")); }
  catch { return { requests:0, ratings:{good:0, ok:0, bad:0} }; }
}
function writeStats(s){ try { fs.writeFileSync(F_STATS, JSON.stringify(s,null,2)); } catch {} }

// ---------- explicación (por qué + siguiente paso)
function buildExplanation({intent, stage, name, userText}) {
  const why = (() => {
    if (intent === "precio") return "La persona comparó costos o pidió descuentos; primero damos valor y evitamos catálogos.";
    if (intent === "tiempo") return "Mostramos progreso con clases cortas y hábito diario; quitamos fricción.";
    if (intent === "cert") return "Buscan validación; conectamos con certificaciones verificables y ruta clara.";
    if (intent === "competencia") return "Quiere avanzar laboralmente; usamos rutas con práctica y resultados visibles.";
    return "Mantenemos conversación humana con CTA simple y accionable.";
  })();

  const next = (() => {
    if (stage === "sondeo") return "Propón 1 pregunta clave y ofrece armar la ruta en 2 pasos hoy.";
    if (stage === "integración") return "Envía 1 mini-tarea de hoy + agenda microseguimiento de 10 min.";
    if (stage === "rebatir") return "Responde la objeción con evidencia breve y cierra con CTA a ruta.";
    if (stage === "cierre") return "Ofrece el plan que mejor encaje (Expert/Duo/Family) y CTA directo.";
    return "Cierra con una acción concreta (ruta + 1 clase hoy).";
  })();

  const n = name || "cliente";
  return `POR QUÉ: ${why}\nSIGUIENTE PASO: ${next}`;
}

// ---------- heurística simple de intención
function guessIntent(text="") {
  const t = (text||"").toLowerCase();
  if (/tiempo|agenda|no me da el tiempo|poco tiempo/.test(t)) return "tiempo";
  if (/precio|caro|costo|cuánto vale|descuento|oferta/.test(t)) return "precio";
  if (/certificaci[oó]n|certificado|verificable/.test(t)) return "cert";
  if (/trabajo|empleo|competencia|cv|perfil/.test(t)) return "competencia";
  return "default";
}

// ---------- sentiment básico (neutro/positivo/negativo)
function analyzeSentiment(text=""){
  const t = text.toLowerCase();
  let score = 0;
  if (/gracias|perfecto|excelente|me interesa/.test(t)) score += 1;
  if (/no|duda|caro|difícil|miedo|complicado/.test(t)) score -= 1;
  if (/urgente|rápido|ya/.test(t)) score += 0.5;
  if (/no tengo tiempo|muy caro|no sé/.test(t)) score -= 0.5;
  return score > 0.3 ? "Positivo" : score < -0.3 ? "Negativo" : "Neutro";
}

// ---------- llamada a OpenAI (instrucciones + trainer)
async function callOpenAI({customerName, stage, context, userText}) {
  const sys = [
    "Eres FerBot, asesor de ventas de Platzi.",
    "Tono humano, cercano, claro, 100% en español.",
    "No vendas catálogos; ofrece 1–2 rutas máximo.",
    "Siempre cierra con CTA simple y accionable.",
    "Usa micro-acciones: hoy 5–10 min, progreso semanal.",
    "Evita 'hoy/mañana' si la etapa es integración/sondeo sin permiso explícito.",
    "Jamás menciones precios exactos si no está en promo activa.",
  ].join(" ");

  const trainer = fs.existsSync(path.join(process.cwd(),"trainer_identity.txt"))
    ? fs.readFileSync(path.join(process.cwd(),"trainer_identity.txt"),"utf8")
    : "";

  const prompt = `
Cliente: ${customerName||"Cliente"}
Etapa: ${stage||"integración"}
Contexto breve: ${context||"(sin notas)"}

Mensaje del cliente u objección:
"""
${userText||"(vacío)"}
"""

Responde en no más de 3 frases, natural y humana.
Incluye 1 acción concreta (CTA) al final.
No pidas datos personales; cierra con una micro-acción dentro del chat.
Evita catálogos y listas largas.
  `.trim();

  const body = {
    model: MODEL,
    messages: [
      {role:"system", content: sys},
      {role:"system", content: trainer.slice(0, 4000)},
      {role:"user", content: prompt}
    ],
    temperature: 0.7,
    max_tokens: 220
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":`Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if(!r.ok){
    const txt = await r.text().catch(()=> "");
    throw new Error(`OpenAI error ${r.status}: ${txt}`);
  }
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content?.trim() || "No pude generar respuesta.";
  return text;
}

// ---------- endpoints
app.get("/health", (_req,res)=> {
  res.json({ok:true, service:"ferbot-api", time:new Date().toISOString(), openai: !!OPENAI_API_KEY, model_env: MODEL});
});

app.post("/assist_openai", async (req,res)=>{
  const t0 = Date.now();
  try{
    const {customerName, stage, context, text} = req.body||{};
    const intent = guessIntent(text||"");
    const sentiment = analyzeSentiment(text||"");
    const assistant = await callOpenAI({customerName, stage, context, userText:text});
    const explanation = buildExplanation({intent, stage, name:customerName, userText:text});

    const payload = {
      ok:true,
      intent, sentiment,
      explanation,
      reply: assistant
    };

    appendUsage({
      type:"assist_openai",
      ts: Date.now(),
      ms: Date.now()-t0,
      stage, intent, sentiment
    });

    // actualizar stats
    const s = readStats();
    s.requests = (s.requests||0)+1;
    writeStats(s);

    res.json(payload);
  }catch(err){
    res.status(500).json({ok:false, error:String(err.message||err)});
  }
});

// rating
app.post("/trackRate", (req,res)=>{
  const {rating} = req.body||{};
  const s = readStats();
  s.ratings = s.ratings || {good:0, ok:0, bad:0};
  if (rating==="good") s.ratings.good++;
  else if (rating==="ok") s.ratings.ok++;
  else if (rating==="bad") s.ratings.bad++;
  writeStats(s);
  appendUsage({type:"rating", rating, ts: Date.now()});
  res.json({ok:true});
});

// sentimiento directo (si lo usas desde la extensión)
app.post("/analyze", (req,res)=>{
  const {text} = req.body||{};
  res.json({ok:true, sentiment: analyzeSentiment(text||"")});
});

// ---------- panel de emergencia (GitHub Pages alternativo lo puedes usar también)
app.get("/", (_req,res)=> res.redirect("/panel"));
app.get("/panel", (_req,res)=>{
  res.sendFile(path.join(process.cwd(),"panel.html"));
});

// serve estático si quieres adjuntar logos, etc.
app.use(express.static(process.cwd()));

app.listen(PORT, ()=> {
  console.log(`FerBot API escuchando en http://localhost:${PORT}`);
});
