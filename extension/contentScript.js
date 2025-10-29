// FerBot content script — Panel compacto con: countdown (segundos + colores),
// sentimiento local, rating 1 sola vez, autopaste opcional, y look "tech".
// Llama a /assist_trainer del backend configurado.
//
// BASE se toma en este orden:
// 1) window.FERBOT_API_BASE (si existe)
// 2) localStorage.ferbot_api_base
// 3) Render por defecto

(() => {
  const BASE =
    (typeof window !== "undefined" && window.FERBOT_API_BASE) ||
    localStorage.getItem("ferbot_api_base") ||
    "https://ferbot-api.onrender.com";

  const PLATZI_GREEN = "#97C93E";
  const DARK = "#0b0f19";

  // Evitar doble inyección
  if (document.getElementById("ferbot-fab") || document.getElementById("ferbot-styles")) return;

  // ====== ESTILOS ======
  const style = document.createElement("style");
  style.id = "ferbot-styles";
  style.textContent = `
  .ferbot-fab{
    position:fixed; right:20px; bottom:20px; z-index:2147483647;
    width:56px; height:56px; border-radius:999px; background:${PLATZI_GREEN};
    display:flex; align-items:center; justify-content:center;
    box-shadow:0 8px 28px rgba(0,0,0,.35); cursor:grab; user-select:none;
    font-size:24px; color:#0b0f19; border:0;
    animation: ferbot-pulse 2.2s ease-in-out infinite;
  }
  @keyframes ferbot-pulse {
    0% { box-shadow:0 0 0 0 rgba(151,201,62,.60) }
    70% { box-shadow:0 0 0 16px rgba(151,201,62,0) }
    100% { box-shadow:0 0 0 0 rgba(151,201,62,0) }
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
  .ferbot-title{ font-weight:800; letter-spacing:.3px; font-size:13px; display:flex; align-items:center; gap:8px }
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
  .ferbot-btn{ padding:7px 10px; border-radius:9px; border:0; cursor:pointer; font-weight:800; font-size:12px; }
  .ferbot-primary{ background:${PLATZI_GREEN}; color:#0b0f19; }
  .ferbot-ghost{ background:#1b2333; color:#cbd5e1; }
  .ferbot-good{ background:#19c37d; color:#062d1f; }
  .ferbot-regular{ background:#fbbf24; color:#332200; }
  .ferbot-bad{ background:#ef4444; color:#fff; }
  .ferbot-inline{ display:flex; gap:6px; align-items:center; flex-wrap:wrap }
  .ferbot-pill{ font-size:11px; padding:4px 8px; border-radius:999px; border:1px solid rgba(255,255,255,.12); color:#cbd5e1; background:#0e1424 }
  .ferbot-timer{ min-width:64px; text-align:center; padding:6px 10px; border-radius:999px; font-weight:800; font-variant-numeric:tabular-nums; background:#111827; border:1px solid rgba(255,255,255,.12) }
  .ferbot-timer.red{ color:#fff; background:#ef4444 }
  .ferbot-timer.yellow{ color:#231500; background:#f59e0b }
  .ferbot-timer.green{ color:#062d1f; background:#19c37d }
  .ferbot-hint{ font-size:11px; opacity:.8 }
  `;
  document.documentElement.appendChild(style);

  // ====== FAB ======
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

  // ====== PANEL ======
  let panel;
  fab.addEventListener("click", () => {
    if (panel && panel.isConnected) { panel.remove(); return; }
    panel = buildPanel();
    document.documentElement.appendChild(panel);
  });

  function buildPanel(){
    const panel = document.createElement("div");
    panel.className = "ferbot-panel";

    const savedName = (localStorage.getItem("ferbot_name") || "").replace(/"/g,"&quot;");
    const savedAuto = localStorage.getItem("ferbot_autopaste") === "1" ? "checked" : ""; // OFF por defecto

    panel.innerHTML = `
      <div class="ferbot-header" id="ferbot-drag-bar">
        <div class="ferbot-title">FerBot <span class="ferbot-hint">· hecho con amor 💚</span></div>
        <label class="ferbot-hint" style="display:flex;align-items:center;gap:6px;">
          <input id="ferbot-autopaste" type="checkbox" ${savedAuto}/> Autopaste
        </label>
      </div>
      <div class="ferbot-body">
        <label class="ferbot-label">Nombre del cliente</label>
        <input id="ferbot-name" class="ferbot-name" placeholder="Ej. Laura" value="${savedName}">

        <div class="ferbot-inline" style="margin-top:6px">
          <div style="flex:1">
            <label class="ferbot-label">Etapa</label>
            <select id="ferbot-stage" class="ferbot-select">
              <option value="integracion">Integración</option>
              <option value="sondeo">Sondeo</option>
              <option value="pre_cierre">Pre-cierre</option>
              <option value="rebatir" selected>Rebatir</option>
              <option value="cierre">Cierre</option>
            </select>
          </div>
          <div>
            <label class="ferbot-label">Sentimiento</label>
            <div id="ferbot-sent" class="ferbot-pill">Neutro</div>
          </div>
        </div>

        <label class="ferbot-label" style="margin-top:6px;">Contexto (opcional, para el bot)</label>
        <input id="ferbot-context" class="ferbot-context" placeholder="Ej. ya preguntó por certificaciones; poco tiempo al día">

        <div class="ferbot-label" style="margin-top:6px;">Selecciona texto del chat o escribe una objeción, luego <b>Generar</b>.</div>
        <textarea id="ferbot-input" class="ferbot-input" placeholder="Texto/objeción del cliente..."></textarea>

        <label class="ferbot-label" style="margin-top:6px;">Explicación (POR QUÉ + SIGUIENTE PASO)</label>
        <textarea id="ferbot-guide" class="ferbot-output" placeholder="Guía para el asesor (por qué se responde así y qué hacer después)." readonly></textarea>

        <label class="ferbot-label" style="margin-top:6px;">Respuesta (lista para pegar)</label>
        <textarea id="ferbot-output" class="ferbot-output" placeholder="Mensaje al cliente (máx. 2 líneas, claro y accionable)." readonly></textarea>
      </div>
      <div class="ferbot-footer">
        <button id="ferbot-generate" class="ferbot-btn ferbot-primary">Generar</button>
        <button id="ferbot-clear" class="ferbot-btn ferbot-ghost">Clear</button>

        <div class="ferbot-inline" style="margin-left:auto">
          <span class="ferbot-pill">Tiempo</span>
          <span id="ferbot-timer" class="ferbot-timer">00.0s</span>
        </div>

        <div id="ferbot-rate-row" class="ferbot-inline" style="width:100%; margin-top:6px; display:none">
          <span class="ferbot-pill">¿Te gustó esta respuesta?</span>
          <button id="ferbot-rate-good" class="ferbot-btn ferbot-good">👍 Buena</button>
          <button id="ferbot-rate-regular" class="ferbot-btn ferbot-regular">😐 Regular</button>
          <button id="ferbot-rate-bad" class="ferbot-btn ferbot-bad">👎 Mala</button>
          <span id="ferbot-rated" class="ferbot-pill" style="display:none">¡Gracias por calificar!</span>
        </div>
      </div>
    `;

    // Drag panel
    const drag = panel.querySelector("#ferbot-drag-bar");
    let dragging=false, dx=0, dy=0;
    drag.addEventListener("mousedown",(e)=>{
      dragging=true; const r = panel.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top;
      panel.style.left = `${r.left}px`; panel.style.top  = `${r.top}px`;
      panel.style.right="auto"; panel.style.bottom="auto";
    });
    window.addEventListener("mousemove",(e)=>{ if(!dragging) return; panel.style.left=`${e.clientX-dx}px`; panel.style.top=`${e.clientY-dy}px`; });
    window.addEventListener("mouseup",()=> dragging=false);

    // Refs
    const input   = panel.querySelector("#ferbot-input");
    const output  = panel.querySelector("#ferbot-output");
    const guide   = panel.querySelector("#ferbot-guide");
    const nameEl  = panel.querySelector("#ferbot-name");
    const stageEl = panel.querySelector("#ferbot-stage");
    const ctxEl   = panel.querySelector("#ferbot-context");
    const autoEl  = panel.querySelector("#ferbot-autopaste");
    const sentEl  = panel.querySelector("#ferbot-sent");
    const timerEl = panel.querySelector("#ferbot-timer");
    const rateRow = panel.querySelector("#ferbot-rate-row");
    const ratedOk = panel.querySelector("#ferbot-rated");

    nameEl.addEventListener("change", ()=> localStorage.setItem("ferbot_name", nameEl.value.trim()));
    autoEl.addEventListener("change", ()=> localStorage.setItem("ferbot_autopaste", autoEl.checked ? "1" : "0"));

    // Captura selección del chat → input
    function captureSelectionIntoInput() {
      try {
        const sel = window.getSelection()?.toString()?.trim() || "";
        if (sel) input.value = sel;
        updateSentiment(sel || input.value);
      } catch {}
    }
    captureSelectionIntoInput();
    document.addEventListener("dblclick", captureSelectionIntoInput);
    document.addEventListener("mouseup", () => { setTimeout(captureSelectionIntoInput, 30); });
    input.addEventListener("input", ()=> updateSentiment(input.value));

    // ====== COUNTDOWN ======
    let t0=0, tid=null;
    function startTimer(){
      stopTimer();
      t0 = performance.now();
      timerEl.classList.remove("green","yellow");
      timerEl.classList.add("red");
      tid = setInterval(()=>{
        const s = (performance.now()-t0)/1000;
        timerEl.textContent = s.toFixed(1)+"s";
        if (s >= 1.5 && s < 3) {
          timerEl.classList.remove("red","green");
          timerEl.classList.add("yellow");
        } else if (s >= 3) {
          timerEl.classList.remove("red","yellow");
          timerEl.classList.add("green");
        }
      }, 100);
    }
    function stopTimer(){ if (tid) clearInterval(tid); tid=null; }
    function markDone(){
      stopTimer();
      const s = (performance.now()-t0)/1000;
      timerEl.textContent = s.toFixed(1)+"s";
      timerEl.classList.remove("red","yellow");
      timerEl.classList.add("green");
    }

    // ====== Sentimiento local (heurístico simple)
    function updateSentiment(text=""){
      const s = (text||"").toLowerCase();
      const neg = /(no tengo tiempo|caro|no puedo|dificil|difícil|no me sirve|no quiero|muy caro|demasiado)/.test(s);
      const pos = /(me interesa|me gusta|quiero|perfecto|genial|excelente|sí|si)/.test(s);
      let label = "Neutro", color = "#94a3b8";
      if (neg && !pos) { label="Negativo"; color="#ef4444"; }
      else if (pos && !neg) { label="Positivo"; color="#19c37d"; }
      sentEl.textContent = label;
      sentEl.style.borderColor = color;
      sentEl.style.color = color;
    }

    // ====== GENERAR (usa /assist_trainer)
    panel.querySelector("#ferbot-generate").onclick = async () => {
      const q = (input.value || "").trim() || window.getSelection()?.toString()?.trim() || "";
      if (!q) { alert("Escribe la objeción/pregunta primero."); return; }
      const name  = nameEl.value.trim() || "Cliente";
      const stage = stageEl.value;
      const context = ctxEl.value.trim();

      // limpiar y ocultar rating
      guide.value = ""; output.value = "";
      rateRow.style.display = "none";
      ratedOk.style.display = "none";

      startTimer();
      try{
        const res = await fetch(`${BASE}/assist_trainer`, {
          method:"POST", headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ question:q, customerName:name, stage, context })
        });
        if (!res.ok) {
          const txt = await res.text().catch(()=> "");
          alert(`No se pudo generar (HTTP ${res.status}). ${txt || ""}`.trim());
          markDone();
          return;
        }
        const json = await res.json();

        const reply = (json?.result?.reply || json?.text || "").trim();
        const why   = (json?.result?.why   || "").trim();
        const next  = (json?.result?.next  || "").trim();

        guide.value  = `POR QUÉ: ${why || "-"}\nSIGUIENTE PASO: ${next || "-"}`;
        output.value = reply || "";

        // Mostrar rating 1 sola vez por generación
        rateRow.style.display = "flex";

        // Autopaste si está marcado
        if (autoEl.checked) pasteToChat(output.value);
      }catch(e){
        alert("No se pudo generar. ¿API vigente?");
      }finally{
        markDone();
      }
    };

    // ====== CLEAR
    panel.querySelector("#ferbot-clear").onclick = () => {
      guide.value = "";
      output.value = "";
      rateRow.style.display = "none";
      ratedOk.style.display = "none";
      timerEl.textContent = "00.0s";
      timerEl.classList.remove("red","yellow","green");
    };

    // ====== RATING (oculta tras calificar)
    async function sendRating(rating){
      const utter = (output.value || "").trim(); if(!utter) return;
      try{
        await fetch(`${BASE}/trackRate`, {
          method:"POST", headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ intent: "_ext_", stage: stageEl.value, text: utter, rating })
        });
      }catch(_){}
      rateRow.style.display = "none";
      ratedOk.style.display = "inline-flex";
    }
    panel.querySelector("#ferbot-rate-good").onclick    = ()=> sendRating("good");
    panel.querySelector("#ferbot-rate-regular").onclick = ()=> sendRating("regular");
    panel.querySelector("#ferbot-rate-bad").onclick     = ()=> sendRating("bad");

    return panel;
  }

  // ====== UTILIDADES Pegar en chat ======
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
})();
