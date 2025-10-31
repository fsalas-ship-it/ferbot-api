require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ----------------------------
// Paths
// ----------------------------
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const MEMORY_PATH   = path.join(DATA, "memory.json");
const VARIANTS_PATH = path.join(DATA, "variants.json");
const STATS_PATH    = path.join(DATA, "stats.json");
const TRAINER_TXT   = path.join(DATA, "trainer_identity.txt");
const TRAINER_KNOW  = path.join(DATA, "trainer_knowledge");
const USERS_PATH    = path.join(DATA, "users.json"); // NUEVO

if (!fssync.existsSync(DATA)) fssync.mkdirSync(DATA, { recursive:true });
if (!fssync.existsSync(PUBLIC)) fssync.mkdirSync(PUBLIC, { recursive:true });
if (!fssync.existsSync(MEMORY_PATH))   fssync.writeFileSync(MEMORY_PATH,   JSON.stringify({ items: [] }, null, 2));
if (!fssync.existsSync(VARIANTS_PATH)) fssync.writeFileSync(VARIANTS_PATH, JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(STATS_PATH))    fssync.writeFileSync(STATS_PATH,    JSON.stringify({ byKey: {} }, null, 2));
if (!fssync.existsSync(TRAINER_KNOW))  fssync.mkdirSync(TRAINER_KNOW, { recursive:true });
if (!fssync.existsSync(TRAINER_TXT))   fssync.writeFileSync(TRAINER_TXT, "");
if (!fssync.existsSync(USERS_PATH))    fssync.writeFileSync(USERS_PATH,    JSON.stringify({ byId:{} }, null, 2)); // NUEVO

app.use(express.static(PUBLIC));

// ----------------------------
// Utils
// ----------------------------
async function readJsonSafe(file, fallback){ try{ return JSON.parse(await fs.readFile(file,"utf8")); }catch{ return fallback; } }
async function writeJsonPretty(file, obj){ await fs.writeFile(file, JSON.stringify(obj, null, 2), "utf8"); }
function normalizeSpaces(s=""){ return String(s).replace(/\s+/g, " ").replace(/ ,/g, ",").replace(/ \./g, ".").trim(); }
function normKey(s=""){ return String(s||"").toLowerCase().replace(/\s+/g," ").trim(); }
// Firma robusta para agrupar textos equivalentes
function signatureForText(s=""){
  return normKey(s).replace(/[^\p{L}\p{N} ]/gu,"").replace(/\s+/g," ").slice(0,220);
}
function clampReplyToWhatsApp(text, maxChars=220){
  let t = (text || "").trim();
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  t = parts.slice(0,2).join(" ");
  if (t.length > maxChars) t = t.slice(0, maxChars-1).trimEnd()+"…";
  return t;
}

// ----------------------------
// Variants (offline)
// ----------------------------
let VAR_CACHE = { byKey:{} };
async function loadVariants(){
  const v = await readJsonSafe(VARIANTS_PATH, { byKey:{} });
  VAR_CACHE = v?.byKey ? v : { byKey:{} };
}
function pickVariant(intent, stage, name){
  const key = `${intent}::${stage}`;
  const block = VAR_CACHE.byKey[key];
  if (!block || !Array.isArray(block.variants) || block.variants.length===0){
    const fb = VAR_CACHE.byKey[`_default::${stage}`] || VAR_CACHE.byKey[`_default::rebatir`];
    const v = fb?.variants?.[0]?.text || `Hola ${name}, ¿Te explico cómo lo hacemos fácil y rápido?`;
    return v.replace(/{name}/g, name);
  }
  let list = block.variants;
  let total = list.reduce((a,v)=>a+(Number(v.weight||1)),0);
  let r = Math.random()*total;
  for (const v of list){
    r -= Number(v.weight||1);
    if (r<=0) return (v.text||"").replace(/{name}/g, name);
  }
  return (list[0].text||"").replace(/{name}/g, name);
}

function inferIntent(q=""){
  const s = (q||"").toLowerCase();
  if (/(precio|caro|costo|vale|promoci|oferta|descuento)/.test(s)) return "precio";
  if (/(tiempo|agenda|no tengo tiempo|horario|no alcanzo|ocupad)/.test(s)) return "tiempo";
  if (/(cert|certificado|certificacion|certificación)/.test(s)) return "cert";
  if (/(coursera|udemy|alura|competenc|otra plataforma)/.test(s)) return "competencia";
  if (/(pitch|qué es platzi|que es platzi|platzi)/.test(s)) return "pitch";
  return "_default";
}

async function buildGuideFromKB(intent="_default"){
  const mem = await readJsonSafe(MEMORY_PATH, { items:[] });
  const items = Array.isArray(mem.items)?mem.items:[];
  let pool = items.filter(it=> it.tipo==="objecion" && it.tema===intent);
  if (pool.length===0) pool = items.filter(it=> it.tipo==="objecion" && it.tema==="_default");
  const bullets = pool.slice(0,3).map(it=>`• ${normalizeSpaces(it.contenido)}`);
  const suffix = "→ Cierra con un siguiente paso simple y accionable.";
  return normalizeSpaces(`${bullets.join(" ")} ${suffix}`);
}

// ----------------------------
// Tracking + Ratings (con firma)
// ----------------------------
function ensureStatEntry(stats, intent, stage, text){
  const key = `${intent}::${stage}`;
  if (!stats.byKey[key]) stats.byKey[key] = {};
  const sig = signatureForText(text);
  if (!stats.byKey[key][sig]){
    stats.byKey[key][sig] = { shown:0, wins:0, good:0, regular:0, bad:0, lastText: text };
  }else{
    // Guarda el último texto “bonito” para mostrar en dashboard
    if (text && text.length > (stats.byKey[key][sig].lastText||"").length){
      stats.byKey[key][sig].lastText = text;
    }
  }
  return { key, sig };
}
async function trackShown(intent, stage, replyText){
  const stats = await readJsonSafe(STATS_PATH, { byKey:{} });
  const { key, sig } = ensureStatEntry(stats, intent, stage, replyText);
  stats.byKey[key][sig].shown += 1;
  await writeJsonPretty(STATS_PATH, stats);
}
async function trackRating(intent, stage, replyText, rating){
  const stats = await readJsonSafe(STATS_PATH, { byKey:{} });
  const { key, sig } = ensureStatEntry(stats, intent, stage, replyText);
  stats.byKey[key][sig].shown = Math.max(stats.byKey[key][sig].shown, 1);
  if (rating==="good"){ stats.byKey[key][sig].good += 1; stats.byKey[key][sig].wins += 1; }
  else if (rating==="regular"){ stats.byKey[key][sig].regular += 1; stats.byKey[key][sig].wins += 0.5; }
  else if (rating==="bad"){ stats.byKey[key][sig].bad += 1; }
  await writeJsonPretty(STATS_PATH, stats);
}

// ----------------------------
// Trainer
// ----------------------------
let TRAINER_IDENTITY = "";
let TRAINER_SNIPPETS = "";
async function loadTrainerIdentity(){
  try{ TRAINER_IDENTITY = (await fs.readFile(TRAINER_TXT,"utf8")).trim(); }catch{ TRAINER_IDENTITY=""; }
  try{
    const files = await fs.readdir(TRAINER_KNOW);
    const texts = [];
    for (const f of files){
      if (!/\.(txt|md)$/i.test(f)) continue;
      const p = path.join(TRAINER_KNOW, f);
      const t = (await fs.readFile(p,"utf8")).trim();
      if (t) texts.push(`# ${f}\n${t}`);
    }
    TRAINER_SNIPPETS = texts.join("\n\n---\n\n").slice(0,10000);
  }catch{ TRAINER_SNIPPETS=""; }
}
app.post("/admin/reloadTrainer", async (_req,res)=>{
  await loadTrainerIdentity();
  res.json({ ok:true, identity_len: TRAINER_IDENTITY.length, knowledge_len: TRAINER_SNIPPETS.length });
});

// ----------------------------
// Health
// ----------------------------
app.get("/health", (_req,res)=>{
  res.json({
    ok:true, service:"ferbot-api", time:new Date().toISOString(),
    openai: !!process.env.OPENAI_API_KEY,
    model_env: process.env.OPENAI_MODEL || "gpt-5"
  });
});

// ----------------------------
// Core: assist_openai (simple) y assist_trainer (REPLY/WHY/NEXT)
// ----------------------------
app.post("/assist", async (req,res)=>{
  try{
    const { question="", customerName="Cliente", stage="rebatir" } = req.body||{};
    const name = customerName||"Cliente";
    const intent = inferIntent(question);
    const reply = clampReplyToWhatsApp(pickVariant(intent, stage, name));
    await trackShown(intent, stage, reply).catch(()=>{});
    res.json({ ok:true, text:reply, result:{ reply, intent, stage, model:"offline-variants" } });
  }catch(e){
    res.status(500).json({ ok:false, error:"assist_failed" });
  }
});

function fallbackWhy(stage,intent){
  const map = {
    sondeo: "Reconozco su interés y exploro meta para personalizar.",
    rebatir: "Valido objeción y la convierto en valor y acción.",
    pre_cierre: "Aclaro valor anual y facilito decisión.",
    cierre: "Cierre amable con acción clara.",
    integracion: "Refuerzo decisión y dejo hábito corto."
  };
  return map[stage] || `Conecto beneficio y CTA (${intent}/${stage}).`;
}
function fallbackNext(stage){
  const map = {
    sondeo: "Pide meta concreta y horario preferido.",
    rebatir: "Reafirma valor y propone activar hoy.",
    pre_cierre: "Resume valor y solicita confirmación.",
    cierre: "Confirma plan anual y activa acceso.",
    integracion: "Marca horario diario y seguimiento."
  };
  return map[stage] || "Cierra con CTA simple y accionable.";
}

app.post("/assist_trainer", async (req,res)=>{
  try{
    const { question="", customerName="", stage="rebatir", intent:intentIn, context="" } = req.body||{};
    const name = (customerName||"").trim();
    const safeName = name || "Cliente";
    const intent = intentIn || inferIntent(question);

    const rules = [
      "Asesor comercial (español Colombia), claro, corto (≤220c, hasta 2 frases).",
      "No llamadas ni enviar material; enfoque suscripción anual y transformación.",
      "Refuerza lo que dice el cliente, tono amable y con energía positiva.",
      "Formato ESTRICTO de 3 líneas: REPLY/WHY/NEXT (WHY y NEXT enseñan táctica)."
    ].join("\n");

    const system = [
      TRAINER_IDENTITY || "",
      rules,
      TRAINER_SNIPPETS ? `Conocimiento:\n${TRAINER_SNIPPETS}` : ""
    ].filter(Boolean).join("\n\n");

    const user = [
      name ? `Nombre del cliente: ${name}` : "Nombre del cliente: (no provisto)",
      `Stage: ${stage}`,
      `Intent: ${intent}`,
      context ? `Contexto: ${context}` : "",
      `Mensaje del cliente: ${question}`,
      "Devuelve REPLY/WHY/NEXT."
    ].filter(Boolean).join("\n");

    const apiKey = process.env.OPENAI_API_KEY;
    const model  = process.env.OPENAI_MODEL || "gpt-5";
    if (!apiKey) return res.status(400).json({ ok:false, error:"missing_openai_api_key" });

    const r = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{ "Content-Type":"application/json","Authorization":`Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages:[{role:"system",content:system},{role:"user",content:user}] })
    });

    if (!r.ok){
      const errText = await r.text().catch(()=> "");
      return res.status(500).json({ ok:false, error:"openai_failed", detail:errText });
    }
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || "";

    const mReply = content.match(/REPLY:\s*([\s\S]*?)(?:\n+WHY:|\n+NEXT:|$)/i);
    const mWhy   = content.match(/WHY:\s*(.*?)(?:\n+NEXT:|$)/i);
    const mNext  = content.match(/NEXT:\s*(.*)$/i);

    let reply = (mReply && mReply[1] || content).trim();
    let why   = (mWhy && mWhy[1]   || "").trim();
    let next  = (mNext && mNext[1] || "").trim();

    reply = clampReplyToWhatsApp(reply, 220);
    if (!why)  why  = fallbackWhy(stage, intent);
    if (!next) next = fallbackNext(stage);

    await trackShown(intent, stage, reply).catch(()=>{});

    res.json({
      ok:true,
      text: reply,
      result:{
        reply, why, next,
        guide: `POR QUÉ: ${why} · SIGUIENTE PASO: ${next}`,
        sections:{ [stage]: reply },
        model, intent, stage
      }
    });
  }catch(e){
    res.status(500).json({ ok:false, error:"assist_trainer_failed" });
  }
});

// ----------------------------
// Tracking endpoints
// ----------------------------
app.post("/trackRate", async (req,res)=>{
  try{
    const { intent="_default", stage="rebatir", text="", rating="regular" } = req.body||{};
    if (!text) return res.status(400).json({ ok:false, error:"missing_text" });
    if (!["good","regular","bad"].includes(rating)) return res.status(400).json({ ok:false, error:"invalid_rating" });
    await trackRating(intent, stage, text, rating);
    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error:"track_rate_failed" });
  }
});

// NUEVO: actividad de usuarios (panel o extensión)
app.post("/trackUser", async (req,res)=>{
  try{
    const { agentId="", source="panel", userHint="" } = req.body||{};
    if (!agentId) return res.status(400).json({ ok:false, error:"missing_agentId" });
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").toString().split(",")[0].trim();
    const users = await readJsonSafe(USERS_PATH, { byId:{} });
    const now = Date.now();
    users.byId[agentId] = {
      lastSeen: now,
      source,
      userHint: (userHint||"").slice(0,120),
      ip
    };
    await writeJsonPretty(USERS_PATH, users);
    res.json({ ok:true, now });
  }catch(e){
    res.status(500).json({ ok:false, error:"track_user_failed" });
  }
});

// ----------------------------
// Dashboard JSON/API para /admin/usability
// ----------------------------
app.get("/stats", async (_req,res)=>{
  try{
    const stats = await readJsonSafe(STATS_PATH, { byKey:{} });
    const rows=[];
    for (const key of Object.keys(stats.byKey||{})){
      const [intent, stage] = key.split("::");
      const map = stats.byKey[key];
      for (const sig of Object.keys(map)){
        const row = map[sig];
        const shown = Number(row.shown||0);
        const wins  = Number(row.wins||0);
        const winrate = shown>0 ? +(wins/shown).toFixed(3) : 0;
        rows.push({
          intent, stage,
          text: row.lastText || "",
          shown, wins, winrate,
          good:Number(row.good||0), regular:Number(row.regular||0), bad:Number(row.bad||0),
          sig
        });
      }
    }
    rows.sort((a,b)=> (b.winrate - a.winrate) || (b.shown - a.shown));
    res.json({ ok:true, rows });
  }catch(e){
    res.status(500).json({ ok:false, error:"stats_failed" });
  }
});

// HTML del dashboard “tech”
app.get("/admin/usability", async (_req,res)=>{
  try{
    const stats = await (await fetchLocalStats()).json();
    const users = await readJsonSafe(USERS_PATH, { byId:{} });
    const now = Date.now();
    const active5m = Object.values(users.byId).filter(u => now - Number(u.lastSeen||0) <= 5*60*1000).length;
    const activeToday = Object.values(users.byId).filter(u => {
      const d = new Date(Number(u.lastSeen||0));
      const td = new Date();
      return d.getUTCFullYear()===td.getUTCFullYear() && d.getUTCMonth()===td.getUTCMonth() && d.getUTCDate()===td.getUTCDate();
    }).length;

    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.end(renderUsability(stats.rows||[], { active5m, activeToday }));
  }catch(e){
    res.status(500).send("Error");
  }
});

function escapeHtml(s=""){return s.replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]))}
async function fetchLocalStats(){
  const stats = await readJsonSafe(STATS_PATH, { byKey:{} });
  const rows=[];
  for (const key of Object.keys(stats.byKey||{})){
    const [intent, stage] = key.split("::");
    const map = stats.byKey[key];
    for (const sig of Object.keys(map)){
      const row = map[sig];
      const shown = Number(row.shown||0);
      const wins  = Number(row.wins||0);
      const winrate = shown>0 ? +(wins/shown).toFixed(3) : 0;
      rows.push({
        intent, stage,
        text: row.lastText || "",
        shown, wins, winrate,
        good:Number(row.good||0), regular:Number(row.regular||0), bad:Number(row.bad||0),
        sig
      });
    }
  }
  rows.sort((a,b)=> (b.winrate - a.winrate) || (b.shown - a.shown));
  return { json: async()=>({ ok:true, rows }) };
}

function renderUsability(rows, users){
  const kpis = {
    shown: rows.reduce((a,r)=>a+r.shown,0),
    winrate: (()=> {
      const s = rows.reduce((a,r)=>a+r.shown,0);
      const w = rows.reduce((a,r)=>a+r.wins,0);
      return s>0 ? ((w/s)*100).toFixed(1) : "0.0";
    })(),
    good: rows.reduce((a,r)=>a+r.good,0),
    bad: rows.reduce((a,r)=>a+r.bad,0)
  };
  const rowsHtml = rows.slice(0,30).map(r => `
    <tr>
      <td>${escapeHtml(r.intent)}</td>
      <td>${escapeHtml(r.stage)}</td>
      <td>${escapeHtml(r.text)}</td>
      <td style="text-align:right">${r.shown}</td>
      <td style="text-align:right">${r.wins}</td>
      <td style="text-align:right">${(r.winrate*100).toFixed(1)}%</td>
    </tr>
  `).join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>FerBot · Usabilidad</title>
<style>
  :root{
    --bg:#0b0f19; --panel:#0f1524; --ink:#e2e8f0; --muted:#94a3b8; --green:#97C93E;
    --ok:#19c37d; --warn:#fbbf24; --bad:#ef4444; --card:#0f1524CC;
  }
  html,body{background:var(--bg); color:var(--ink); font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial; margin:0;}
  .wrap{max-width:1200px;margin:16px auto; padding:0 12px;}
  .row{display:grid; grid-template-columns: 1.2fr 1.2fr 1fr; gap:12px;}
  .card{background:var(--card); border:1px solid rgba(255,255,255,.08); border-radius:16px; padding:14px; box-shadow:0 10px 30px rgba(0,0,0,.35); backdrop-filter: blur(6px);}
  h1{display:flex;align-items:center;gap:8px;font-size:18px;margin:0 0 10px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px}
  .kpi{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px}
  .kpi .v{font-size:20px;font-weight:800}
  .kpi .s{color:var(--muted);font-size:12px}
  table{width:100%;border-collapse:collapse}
  th,td{padding:10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px}
  th{color:#cbd5e1;text-align:left}
  .pill{display:inline-flex;align-items:center;gap:6px;background:#121a2b;border:1px solid rgba(255,255,255,.1);padding:4px 8px;border-radius:999px;font-size:12px;color:#cbd5e1}
  .ok{color:#062d1f;background:#0bd98133;border-color:#0bd98155}
  .badge{font-size:12px;color:#cbd5e1}
  .muted{color:var(--muted)}
  .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
  .top .right{display:flex;align-items:center;gap:8px}
</style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <h1>FerBot · Usabilidad <span class="badge">⚡</span></h1>
      <div class="right">
        <span class="pill">Activos 5m: <b>${users.active5m}</b></span>
        <span class="pill">Activos hoy: <b>${users.activeToday}</b></span>
        <span class="pill">Auto-refresh 5s</span>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="s">Respuestas mostradas</div><div class="v">${kpis.shown}</div></div>
      <div class="kpi"><div class="s">Winrate compuesto</div><div class="v">${kpis.winrate}%</div></div>
      <div class="kpi"><div class="s">👍 Buenas</div><div class="v">${kpis.good}</div></div>
      <div class="kpi"><div class="s">👎 Malas</div><div class="v">${kpis.bad}</div></div>
    </div>

    <div class="card">
      <h1>Top respuestas (efectivas)</h1>
      <table>
        <thead><tr><th>Intent</th><th>Stage</th><th>Texto</th><th>Shown</th><th>Wins</th><th>Winrate</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  </div>
<script>
  setTimeout(()=>{ location.reload(); }, 5000);
</script>
</body>
</html>`;
}

// /agent → panel de emergencia si lo tienes
app.get("/agent", (_req,res)=> res.redirect("/panel.html"));

// ----------------------------
// Boot
// ----------------------------
(async ()=>{
  await loadVariants();
  await loadTrainerIdentity();
  const PORT = Number(process.env.PORT || 3005);
  app.listen(PORT, ()=> console.log(`🔥 FerBot API en http://localhost:${PORT}`));
})();


