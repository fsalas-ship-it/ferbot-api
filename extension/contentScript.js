// FerBot content script — UI flotante para Hilos
// Incluye: Semáforo (countdown), Sentimiento local, Autopaste opcional y pie "hecho con amor 💚"
(function () {
  // ========= CONFIG =========
  // URL base del API. Respeta override por localStorage o window.FERBOT_API_BASE.
  const BASE =
    (typeof window !== "undefined" && window.FERBOT_API_BASE) ||
    localStorage.getItem("ferbot_api_base") ||
    "https://ferbot-api.onrender.com"; // <-- deja tu Render aquí si quieres fijo

  const PLATZI_GREEN = "#97C93E";
  const DARK = "#0b0f19";

  // ========= GUARD (no doble inyección) =========
  if (document.getElementById("ferbot-fab") || document.getElementById("ferbot-styles")) return;

  // ========= ESTILOS =========
  const style = document.createElement("style");
  style.id = "ferbot-styles";
  style.textContent = `
    .ferbot-fab{
      position:fixed; right:20px; bottom:20px; z-index:2147483647;
      width:56px; height:56px; border-radius:999px; background:${PLATZI_GREEN};
      display:flex; align-items:center; justify-content:center;
      box-shadow:0 8px 28px rgba(0,0,0,.35); cursor:grab; user-select:none;
      font-size:24px; color:#0b0f19; border:0;
    }
    .ferbot-panel{
      position:fixed; right:20px; bottom:86px; z-index:2147483647;
      width:min(380px,92vw);
      background:${DARK}E6; color:#e2e8f0;
      border-radius:16px; box-shadow:0 18px 40px rgba(0,0,0,.35);
      border:1px solid rgba(255,255,255,.10); display:flex; flex-direction:column;
      max-height:78vh; overflow:hidden; backdrop-filter: blur(6px);
    }
    .ferbot-header{ display:flex; align-items:center; justify-content:space-between;
      padding:8px 10px; background:rgba(255,255,255,.04); border-bottom:1px solid rgba(255,255,255,.08);
      cursor:move; user-select:none; }
    .ferbot-title{ font-weight:800; letter-spacing:.3px; font-size:13px; display:flex; align-items:center }
    .ferbot-body{ padding:10px 10px 86px; overflow:auto; }
    .ferbot-label{ font-size:11px; color:#94a3b8; margin:4px 0 4px; }
    .ferbot-input, .ferbot-output{
      width:100%; min-height:96px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
      background:#0f1524; color:#dbeafe; outline:none; padding:8px 9px; resize:vertical;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto; font-size:13px;
    }
    .ferbot-select, .ferbot-name, .ferbot-context{
      width:100%; padding:7px 9px; border-radius:9px; background:#0f1524; color:#dbeafe; border:1px solid rgba(255,255,255,.12);
      font-size:13px;
    }
    .ferbot-footer{
      position:absolute; left:0; right:0; bottom:0;
      display:flex; gap:6px; padding:8px 10px; background:rgba(255,255,255,.04);
      border-top:1px solid rgba(255,255,255,.08); flex-wrap: wrap; align-items:center;
    }
    .ferbot-btn{ flex:1; padding:7px 8px; border-radius:9px; border:0; cursor:pointer; font-weight:800; font-size:12px; }
    .ferbot-primary{ background:${PLATZI_GREEN}; color:#0b0f19; }
    .ferbot-ghost{ background:#1b2333; color:#cbd5e1; }
    .ferbot-good{ background:#19c37d; color:#062d1f; }
    .ferbot-regular{ background:#fbbf24; color:#332200; }
    .ferbot-bad{ background:#ef4444; color:#fff; }
    .ferbot-tiny{ font-size:11px; opacity:.85; }

    /* --- Semáforo / Status --- */
    .ferbot-head-right{display:flex;align-items:center;gap:10px}
    .ferbot-status{
      display:inline-block;width:10px;height:10px;border-radius:999px;margin-right:6px;
      box-shadow:0 0 0 0 rgba(255,255,255,.2);transition:all .25s ease;
    }
    .ferbot-red{ background:#ef4444; animation: ferPulse 1s ease-in-out infinite; }
    .ferbot-yellow{ background:#fbbf24; animation: ferPulse 1.2s ease-in-out infinite; }
    .ferbot-green{ background:#22c55e; animation: ferPulse 1.4s ease-in-out 4; } /* 4 latidos */
    .ferbot-idle{ background:#64748b; }

    @keyframes ferPulse{
      0%{ box-shadow:0 0 0 0 rgba(255,255,255,.20); transform:scale(1) }
      70%{ box-shadow:0 0 0 8px rgba(255,255,255,0); transform:scale(1.06) }
      100%{ box-shadow:0 0 0 0 rgba(255,255,255,0); transform:scale(1) }
    }

    /* --- Sentimiento --- */
    .ferbot-chip{
      display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;
      font-size:11px; line-height:16px; border:1px solid rgba(255,255,255,.12);
      background:#0f1524; color:#cbd5e1; min-width:72px; justify-content:center;
    }
    .sent-pos{ color:#16a34a; border-color:rgba(34,197,94,.35); }
    .sent-neu{ color:#eab308; border-color:rgba(234,179,8,.35); }
    .sent-neg{ color:#ef4444; border-color:rgba(239,68,68,.35); }

    /* --- Pie “hecho con amor” --- */
    .ferbot-made{ margin-left:auto; font-size:11px; opacity:.8; user-select:none; }
  `;
  document.documentElement.appendChild(style);

  // ========= FAB =========
  const fab = document.createElement("button");
  fab.id = "ferbot-fab";
  fab.className = "ferbot-fab";
  fab.title = "Abrir FerBot";
  fab.textContent = "🤖";
  document.documentElement.appendChild(fab);

  // Drag FAB
  let dragFab=false, offX=0, offY=0;
  fab.addEventListener("mousedown",(e)=>{ dragFab=true; offX = e.clientX - fab.getBoundingClientRect().left; offY = e.clientY - fab.getBoundingClientRect().top; });
  window.addEventListener("mousemove",(e)=>{ if(!dragFab) return; fab.style.right="auto"; fab.style.bottom="auto"; fab.style.left=`${e.clientX-offX}px`; fab.style.top=`${e.clientY-offY}px`; });
  window.addEventListener("mouseup",()=> dragFab=false);

  // ========= PANEL =========
  let panel;
  fab.addEventListener("click", () => {
    if (panel && panel.isConnected) { panel.remove(); return; }
    panel = buildPanel();
    document.documentElement.appendChild(panel);
  });

  function buildPanel(){
    const p = document.createElement("div");
    p.className = "ferbot-panel";

    const savedName = (localStorage.getItem("ferbot_name") || "").replace(/"/g,"&quot;");
    const savedAuto = localStorage.getItem("ferbot_autopaste") === "1" ? "checked" : "";

    p.innerHTML = `
      <div class="ferbot-header" id="ferbot-drag-bar">
        <div class="ferbot-title">
          <span class="ferbot-status ferbot-idle" id="ferbot-status"></span>FerBot
        </div>
        <div class="ferbot-head-right">
          <span id="ferbot-sentiment" class="ferbot-chip sent-neu">—</span>
          <label class="ferbot-tiny" style="display:flex;align-items:center;gap:6px;">
            <input id="ferbot-autopaste" type="checkbox" ${savedAuto}/> Autopaste
          </label>
        </div>
      </div>

      <div class="ferbot-body">
        <label class="ferbot-label">Nombre del cliente</label>
        <input id="ferbot-name" class="ferbot-name" placeholder="Ej. Laura" value="${savedName}">

        <label class="ferbot-label" style="margin-top:6px;">Etapa</label>
        <select id="ferbot-stage" class="ferbot-select">
          <option value="integracion">Integración</option>
          <option value="sondeo">Sondeo</option>
          <option value="pre_cierre">Pre-cierre</option>
          <option value="rebatir" selected>Rebatir</option>
          <option value="cierre">Cierre</option>
        </select>

        <label class="ferbot-label" style="margin-top:6px;">Contexto (opcional, para el bot)</label>
        <input id="ferbot-context" class="ferbot-context" placeholder="Ej. ya preguntó por certificaciones; poco tiempo al día">

        <div class="ferbot-label" style="margin-top:6px;">Selecciona texto del chat o escribe una objeción, luego <b>Generar</b>.</div>
        <textarea id="ferbot-input" class="ferbot-input" placeholder="Texto/objeción del cliente..."></textarea>

        <label class="ferbot-label" style="margin-top:6px;">Explicación (POR QUÉ + SIGUIENTE PASO)</label>
        <textarea id="ferbot-guide" class="ferbot-output" placeholder="Guía para el asesor (por qué se responde así y qué hacer después)."></textarea>

        <label class="ferbot-label" style="margin-top:6px;">Respuesta (lista para pegar)</label>
        <textarea id="ferbot-output" class="ferbot-output" placeholder="Mensaje al cliente (máx. 2 líneas, claro y accionable)."></textarea>
      </div>

      <div class="ferbot-footer">
        <button id="ferbot-generate" class="ferbot-btn ferbot-primary">Generar</button>
        <button id="ferbot-clear" class="ferbot-btn ferbot-ghost">Clear</button>
        <button id="ferbot-rate-good" class="ferbot-btn ferbot-good">👍 Buena</button>
        <button id="ferbot-rate-regular" class="ferbot-btn ferbot-regular">😐 Regular</button>
        <button id="ferbot-rate-bad" class="ferbot-btn ferbot-bad">👎 Mala</button>
        <div class="ferbot-made">hecho con amor 💚</div>
      </div>
    `;

    // ---- Drag panel
    const drag = p.querySelector("#ferbot-drag-bar");
    let dragging=false, dx=0, dy=0;
    drag.addEventListener("mousedown",(e)=>{
      dragging=true; const r = p.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top;
      p.style.left = `${r.left}px`; p.style.top  = `${r.top}px`;
      p.style.right="auto"; p.style.bottom="auto";
    });
    window.addEventListener("mousemove",(e)=>{ if(!dragging) return; p.style.left=`${e.clientX-dx}px`; p.style.top=`${e.clientY-dy}px`; });
    window.addEventListener("mouseup",()=> dragging=false);

    // ---- Refs
    const input   = p.querySelector("#ferbot-input");
    const output  = p.querySelector("#ferbot-output");
    const guide   = p.querySelector("#ferbot-guide");
    const nameEl  = p.querySelector("#ferbot-name");
    const stageEl = p.querySelector("#ferbot-stage");
    const ctxEl   = p.querySelector("#ferbot-context");
    const autoEl  = p.querySelector("#ferbot-autopaste");
    const statusEl = p.querySelector("#ferbot-status");
    const sentEl   = p.querySelector("#ferbot-sentiment");

    nameEl.addEventListener("change", ()=> localStorage.setItem("ferbot_name", nameEl.value.trim()));
    autoEl.addEventListener("change", ()=> localStorage.setItem("ferbot_autopaste", autoEl.checked ? "1" : "0"));

    // ---- Semáforo helpers
    let statusTimer1 = null, statusTimer2 = null;
    function setStatus(cls){
      const classes = ["ferbot-red","ferbot-yellow","ferbot-green","ferbot-idle"];
      statusEl.classList.remove(...classes);
      statusEl.classList.add(cls);
    }
    function startCountdown(){
      clearCountdown();
      setStatus("ferbot-red");
      statusTimer1 = setTimeout(()=> setStatus("ferbot-yellow"), 1800);
    }
    function finishCountdown(){
      clearCountdown();
      setStatus("ferbot-green");
      statusTimer2 = setTimeout(()=> setStatus("ferbot-idle"), 5000);
    }
    function clearCountdown(){
      if (statusTimer1) clearTimeout(statusTimer1);
      if (statusTimer2) clearTimeout(statusTimer2);
      statusTimer1 = statusTimer2 = null;
    }

    // ---- Sentimiento (simple local)
    function sentimentScore(text=""){
      const t = (text||"").toLowerCase();
      const pos = ["gracias","perfecto","genial","me sirve","me interesa","bien","bueno","listo","excelente","sí "," ok "];
      const neg = ["caro","carísimo","no puedo","no tengo tiempo","no me sirve","mal","malo","difícil","complicado","no sé","duda"];
      let score = 0;
      for(const w of pos){ if (t.includes(w)) score += 1; }
      for(const w of neg){ if (t.includes(w)) score -= 1; }
      if (/\?$/.test(t)) score -= 0.1;
      return score;
    }
    function renderSentiment(score){
      sentEl.classList.remove("sent-pos","sent-neu","sent-neg");
      if (score > 0.4){ sentEl.classList.add("sent-pos"); sentEl.textContent = "Positivo"; }
      else if (score < -0.4){ sentEl.classList.add("sent-neg"); sentEl.textContent = "Negativo"; }
      else { sentEl.classList.add("sent-neu"); sentEl.textContent = "Neutro"; }
    }
    function updateSentimentFromInput(){
      const q = (input.value || "").trim() || (window.getSelection()?.toString()?.trim() || "");
      renderSentiment(sentimentScore(q));
    }
    input.addEventListener("input", updateSentimentFromInput);
    document.addEventListener("selectionchange", () => setTimeout(updateSentimentFromInput, 50));
    updateSentimentFromInput();

    // Captura selección del chat → input (comodidad)
    function captureSelectionIntoInput() {
      try {
        const sel = window.getSelection()?.toString()?.trim() || "";
        if (sel) input.value = sel;
      } catch {}
    }
    captureSelectionIntoInput();
    document.addEventListener("dblclick", captureSelectionIntoInput);
    document.addEventListener("mouseup", () => { setTimeout(captureSelectionIntoInput, 30); });

    // ========= GENERAR =========
    p.querySelector("#ferbot-generate").onclick = async () => {
      const q = (input.value || "").trim() || window.getSelection()?.toString()?.trim() || "";
      if (!q) { alert("Escribe la objeción/pregunta primero."); return; }
      const name  = nameEl.value.trim() || "Cliente";
      const stage = stageEl.value;
      const context = ctxEl.value.trim();
      const intent = guessIntent(q);
      const body = { question:q, customerName:name, stage, intent, context };

      renderSentiment(sentimentScore(q));
      try{
        startCountdown();

        // Usa tu endpoint preferido; mantenemos /assist_openai por compatibilidad
        const res = await fetch(`${BASE}/assist_openai`, {
          method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)
        });
        if (!res.ok) {
          const txt = await res.text().catch(()=> "");
          clearCountdown(); setStatus("ferbot-idle");
          alert(`No se pudo generar (HTTP ${res.status}). ${txt || ""}`.trim());
          return;
        }
        const json = await res.json();

        const rawGuide = (json?.result?.guide || json?.result?.why || json?.message || json?.text || "").trim();
        const rawReply = (json?.result?.reply || json?.text || "").trim();

        guide.value  = rawGuide;
        output.value = rawReply;

        // Autopaste si está marcado
        if (autoEl.checked) pasteToChat(rawReply);

        finishCountdown();
      }catch(e){
        clearCountdown(); setStatus("ferbot-idle");
        alert("No se pudo generar. Revisa que el servidor esté arriba.");
      }
    };

    // ========= CLEAR =========
    p.querySelector("#ferbot-clear").onclick = () => {
      guide.value = "";
      output.value = "";
    };

    // ========= RATING =========
    async function sendRating(rating){
      const utter = (output.value || "").trim(); if(!utter) return;
      const intent = guessIntent(input.value);
      try{
        await fetch(`${BASE}/trackRate`, {
          method:"POST", headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ intent, stage: stageEl.value, text: utter, rating })
        });
      }catch(_){}
    }
    p.querySelector("#ferbot-rate-good").onclick    = ()=> sendRating("good");
    p.querySelector("#ferbot-rate-regular").onclick = ()=> sendRating("regular");
    p.querySelector("#ferbot-rate-bad").onclick     = ()=> sendRating("bad");

    return p;
  }

  // ========= UTILIDADES =========
  function guessIntent(q=""){
    const s = (q||"").toLowerCase();
    if (/(tiempo|no tengo tiempo|poco tiempo|agenda|horario|no alcanzo|no me da el tiempo)/i.test(s)) return "tiempo";
    if (/(precio|caro|costo|costoso|muy caro|vale|promoci|oferta|descuento)/i.test(s)) return "precio";
    if (/(cert|certificado|certificación|certificaciones)/i.test(s)) return "cert";
    if (/(coursera|udemy|alura|competenc)/i.test(s)) return "competencia";
    if (/(pitch|qué es platzi|que es platzi|platzi)/i.test(s)) return "pitch";
    return "_default";
  }

  function isInsidePanel(el){ return !!(el && el.closest && el.closest('.ferbot-panel')); }
  function isWritable(el){
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      const t = (el.type || "text").toLowerCase();
      return t === "text" || t === "search";
    }
    return false;
  }
  function writeTo(el, text){
    try{
      el.focus();
      const tag = (el.tagName || "").toLowerCase();
      if (el.isContentEditable) {
        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(document.createTextNode(text));
      } else if (tag === "textarea" || tag === "input") {
        el.value = text;
      }
      try { document.execCommand("insertText", false, text); } catch {}
      el.dispatchEvent(new InputEvent("input", { bubbles:true }));
      el.dispatchEvent(new Event("change", { bubbles:true }));
      el.dispatchEvent(new Event("keyup", { bubbles:true }));
    } catch {}
  }
  function pasteToChat(text){
    const focus = document.activeElement;
    if (focus && isWritable(focus) && !isInsidePanel(focus)) { writeTo(focus, text); return true; }
    const editables = Array.from(document.querySelectorAll('div[contenteditable="true"], [role="textbox"]'))
      .filter(n => n.offsetParent !== null && !isInsidePanel(n));
    for (const el of editables) { writeTo(el, text); return true; }
    const tas = Array.from(document.querySelectorAll('textarea'))
      .filter(n => n.offsetParent !== null && !isInsidePanel(n));
    for (const el of tas) { writeTo(el, text); return true; }
    const ins = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'))
      .filter(n => n.offsetParent !== null && !isInsidePanel(n));
    for (const el of ins) { writeTo(el, text); return true; }
    return false;
  }

  // ========= INYECCIÓN / RE-INALAMBRADO SPA =========
  function ensureInjected(){ /* solo nos aseguramos del FAB cargado ya */ }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    ensureInjected();
  } else {
    window.addEventListener("DOMContentLoaded", ensureInjected, { once:true });
  }
  setInterval(ensureInjected, 2000);
  let lastUrl = location.href;
  new MutationObserver(()=>{ if(location.href!==lastUrl){ lastUrl=location.href; setTimeout(ensureInjected,300);} })
    .observe(document, { subtree:true, childList:true });
})();
