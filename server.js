// FerBot API — FIX normalización de stage + fallbacks por etapa
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const MODEL = process.env.OPENAI_MODEL || "gpt-5";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ===== Trainer in-memory =====
let IDENTITY = "";
let KNOWLEDGE = "";

function loadTrainer() {
  try {
    const id = fs.readFileSync(path.join(__dirname, "data", "trainer_identity.txt"), "utf8");
    IDENTITY = id.trim();
  } catch { IDENTITY = ""; }
  try {
    const dir = path.join(__dirname, "data", "trainer_knowledge");
    const parts = fs.readdirSync(dir)
      .filter(f => f.endsWith(".md"))
      .map(f => fs.readFileSync(path.join(dir, f), "utf8"));
    KNOWLEDGE = parts.join("\n\n").trim();
  } catch { KNOWLEDGE = ""; }
}
loadTrainer();

// ===== Utils =====
const STAGES = new Set(["sondeo","rebatir","pre_cierre","cierre","integracion"]);
function normStage(s=""){ s=(s||"").toLowerCase().trim(); if(!STAGES.has(s)) return "sondeo"; return s; }

function buildSystem() {
  return [
    `Eres FerBot. Aplica estrictamente la identidad y políticas. Español Colombia.`,
    `Responde SIEMPRE con formato:
REPLY: <máx 220c, 1–2 frases>
WHY: <máx 100c>
NEXT: <máx 100c>`,
    IDENTITY
  ].filter(Boolean).join("\n\n");
}

function buildUser({question, customerName, stage, context, intent}) {
  return [
    `Cliente: ${customerName||"Cliente"}`,
    `Etapa: ${stage}`,
    `Intento: ${intent||"_default"}`,
    context ? `Contexto: ${context}` : ``,
    `Texto: ${question}`
  ].filter(Boolean).join("\n");
}

// Fallbacks distintos por etapa (nunca repiten la misma frase)
const FALLBACKS = {
  sondeo: (name)=>({
    reply: `${name}, para ayudarte bien: ¿qué buscas este año: empleo, subir ingresos o inglés? Te guío con la mejor ruta anual.`,
    why:   `Abro con una pregunta clave para entender objetivo.`,
    next:  `Según respuesta, elige escuela y propone activar plan anual hoy.`
  }),
  rebatir: (name)=>({
    reply: `${name}, enfocamos valor anual: ruta clara, clases cortas y certificaciones verificables. ¿Activamos hoy y te marco el primer paso?`,
    why:   `Tomo la objeción y la convierto en beneficio y acción.`,
    next:  `Si acepta, activa plan anual y envía primera clase guiada.`
  }),
  pre_cierre: (name)=>({
    reply: `${name}, con el plan anual sostienes el hábito y consolidas resultados. ¿Lo activo ahora y te dejo la ruta lista?`,
    why:   `Refuerzo valor percibido y quito fricción hacia la decisión.`,
    next:  `Confirma medio de pago y deja ruta/horario definido hoy.`
  }),
  cierre: (name)=>({
    reply: `${name}, listo para activar el plan anual y empezar hoy con tu primera clase?`,
    why:   `Cierre directo, amable y claro.`,
    next:  `Confirma y envía acceso + primera clase de la ruta.`
  }),
  integracion: (name)=>({
    reply: `¡Hola ${name}! En Platzi transformas tu carrera con rutas anuales y certificaciones. ¿Qué priorizas hoy para empezar?`,
    why:   `Enmarco valor y pido meta para guiar el inicio.`,
    next:  `Según meta, elige escuela y activa acceso hoy.`
  })
};

// ===== Rutas =====
app.get("/health", (req,res)=> {
  res.json({ ok:true, service:"ferbot-api", time:new Date().toISOString(), openai: !!process.env.OPENAI_API_KEY, model_env: MODEL });
});

app.get("/admin/reloadTrainer", (req,res)=>{
  loadTrainer();
  res.json({ ok:true, identity_len: IDENTITY.length, knowledge_len: KNOWLEDGE.length });
});

// Atajos UI que ya usas
app.get("/", (_req,res)=> res.redirect("/panel.html"));
app.get("/agent", (_req,res)=> res.redirect("/agent.html"));
app.get("/dashboard", (_req,res)=> res.redirect("/usability.html"));

// Core
app.post("/assist_trainer", async (req,res)=>{
  try {
    const { question="", customerName="Cliente", stage="", context="", intent="" } = req.body || {};
    const stg = normStage(stage);
    const sys = buildSystem();
    const user = buildUser({question, customerName, stage: stg, context, intent});

    let reply="", why="", next="";

    // Solo intentamos LLM si tenemos identidad cargada
    if (IDENTITY && process.env.OPENAI_API_KEY) {
      try{
        const chat = await openai.chat.completions.create({
          model: MODEL,
          temperature: 0.4,
          max_tokens: 300,
          messages: [
            { role:"system", content: sys },
            { role:"user", content: `Conoce estos conocimientos:\n${KNOWLEDGE || "(sin conocimiento)"}\n\n${user}` }
          ]
        });
        const text = (chat?.choices?.[0]?.message?.content || "").trim();

        // Parse formato REPLY/WHY/NEXT (líneas)
        const rx = /REPLY:\s*([\s\S]*?)\n+WHY:\s*([\s\S]*?)\n+NEXT:\s*([\s\S]*)/i;
        const m = rx.exec(text);
        if (m) { reply=m[1].trim(); why=m[2].trim(); next=m[3].trim(); }
      }catch(e){
        // caemos a fallback
      }
    }

    if (!reply) {
      const fb = FALLBACKS[stg](customerName);
      reply = fb.reply; why = fb.why; next = fb.next;
    }

    res.json({
      ok:true,
      text: reply,
      message: reply,
      answer: reply,
      result: {
        reply, why, next,
        guide: `Por qué: ${why} · Siguiente paso: ${next}`,
        sections: { [stg]: reply },
        model: MODEL,
        confidence: 0.9,
        intent: intent || "_default",
        stage: stg,
        persona: { name: "Ferney Salas", brand: "Platzi" }
      }
    });
  } catch (e) {
    res.status(500).json({ ok:false, error:"assist_failed", detail:String(e) });
  }
});

// rating ya existente (no lo tocamos)
app.post("/trackRate", (req,res)=>{
  try{
    const p = path.join(__dirname,"stats.json");
    const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,"utf8")) : { byKey:{} };
    const { intent="_default", stage="sondeo", text="", rating="" } = req.body || {};
    const key = `${intent}::${stage}::${(text||"").slice(0,140)}`;
    data.byKey[key] = data.byKey[key] || { shown:0, wins:0, ratingCounts:{good:0,regular:0,bad:0} };
    data.byKey[key].shown++;
    if (rating==="good") data.byKey[key].wins++;
    if (rating && data.byKey[key].ratingCounts[rating]!=null) data.byKey[key].ratingCounts[rating]++;
    fs.writeFileSync(p, JSON.stringify(data,null,2));
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error:"track_failed" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`FerBot API on :${PORT}`));
