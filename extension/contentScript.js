// FerBot content script — FAB + Panel con botón X, allowlist por dominio y atajo teclado.
// Lee allowlist desde chrome.storage.sync. Si dominio no está activo, no muestra el FAB.
// Modo debug: si localStorage.ferbot_force_on === "1", muestra FAB en cualquier dominio.

(() => {
  const BASE = "https://ferbot-api.onrender.com"; // API en Render (fijo)
  const PLATZI_GREEN = "#97C93E";
  const DARK = "#0b0f19";

  // Dominios activos por defecto
  const DEFAULT_ALLOW = {
    "app.hilos.io": true,
    "web.whatsapp.com": true,
    "fsalas-ship-it.github.io": true,
    "ferbot-api.onrender.com": true
  };

  const HARD_BLOCK = /^(chrome:|chrome-extension:|edge:|moz-extension:|about:|file:|chromewebstore\.google\.com)/i;

  if (window.__ferbot_loaded__) return;
  window.__ferbot_loaded__ = true;

  if (HARD_BLOCK.test(location.protocol) || /chromewebstore\.google\.com/.test(location.host)) {
    return;
  }

  // DEBUG FORCE (opcional)
  const FORCE = (() => {
    try { return localStorage.getItem("ferbot_force_on") === "1"; } catch { return false; }
  })();

  function getAllowlist() {
    return new Promise((resolve) => {
      try {
        chrome.storage?.sync?.get({ ferbot_allowlist: DEFAULT_ALLOW }, (res) => {
          resolve(res?.ferbot_allowlist || DEFAULT_ALLOW);
        });
      } catch {
        resolve(DEFAULT_ALLOW);
      }
    });
  }

  function isAllowedHost(allow) {
    if (FORCE) return true; // bypass temporal
    const host = location.hostname;
    if (allow[host]) return true;
    const parts = host.split(".");
    if (parts.length > 2) {
      const base = parts.slice(-2).join(".");
      if (allow[base]) return true;
    }
    return false;
  }

  const style = document.createElement("style");
  style.id = "ferbot-styles";
  style.textContent = `
  .ferbot-fab{
    position:fixed; right:20px; bottom:20px; z-index:2147483647;
    width:56px; height:56px; border-radius:999px; background:${PLATZI_GREEN};
    display:flex; align-items:center; justify-content:center;
    box-shadow:0 8px 28px rgba(0,0,0,.35); cursor:grab; user-select:none;
    font-size:24px; color:${DARK}; border:0; animation: ferbot-pulse 2s infinite;
  }
  @keyframes ferbot-pulse {
    0% { transform: scale(1); box-shadow:0 8px 28px rgba(0,0,0,.35); }
    50% { transform: scale(1.06); box-shadow:0 14px 38px rgba(0,0,0,.45); }
    100% { transform: scale(1); box-shadow:0 8px 28px rgba(0,0,0,.35); }
  }
  .ferbot-panel{
    position:fixed; right:20px; bottom:86px; z-index:2147483647;
    width:min(400px,92vw); background:#0b0f19E6; color:#e2e8f0;
    border-radius:16px; box-shadow:0 18px 40px rgba(0,0,0,.35);
    border:1px solid rgba(255,255,255,.10); display:flex; flex-direction:column;
    max-height:78vh; overflow:hidden; backdrop-filter: blur(6px);
  }
  .ferbot-header{
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    padding:8px 10px; background:rgba(255,255,255,.04); border-bottom:1px solid rgba(255,255,255,.08);
    cursor:move; user-select:none;
  }
  .ferbot-title{ font-weight:800; letter-spacing:.3px; font-size:13px; display:flex; align-items:center; gap:6px; }
  .ferbot-tools{ display:flex; align-items:center; gap:8px; }
  .ferbot-close{
    width:24px; height:24px; border-radius:6px; background:#121a2b; color:#cbd5e1; border:1px solid rgba(255,255,255,.12);
    display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:14px; line-height:1;
  }
  .ferbot-signal{
    display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#94a3b8;
    background:#121a2b; border:1px solid rgba(255,255,255,.10); border-radius:999px; padding:4px 8px;
  }
  .ferbot-bullet{ width:8px; height:8px; border-radius:12px; background:#ef4444; }
  .ferbot-bullet.ambar{ background:#f59e0b; }
  .ferbot-bullet.verde{ background:#22c55e; }
  .ferbot-timer{ font-variant-numeric:tabular-nums; opacity:.9; }
  .ferbot-body{ padding:10px 10px 78px; overflow:auto; }
  .ferbot-label{ font-size:11px; color:#94a3b8; margin:6px 0 4px; }
  .ferbot-row{ display:flex; align-items:center; gap:8px; }
  .ferbot-badge{ font-size:11px; padding:4px 8px; border-radius:999px; border:1px solid rgba(255,255,255,.10); background:#101727; color:#cbd5e1; display:inline-flex; align-items:center; gap:6px; }
  .ferbot-badge .dot{ width:7px; height:7px; border-radius:999px; background:#64748b; }
  .ferbot-badge.pos .dot{ background:#22c55e; } .ferbot-badge.neu .dot{ background:#f59e0b; } .ferbot-badge.neg .dot{ background:#ef4444; }
  .ferbot-input, .ferbot-output{
    width:100%; min-height:92px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
    background:#0f1524; color:#dbeafe; outline:none; padding:8px 9px; resize:vertical;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto; font-size:13px;
    box-shadow: inset 0 0 0 9999px rgba(255,255,255,.02);
  }
  .ferbot-output{ min-height:86px; }
  .ferbot-select, .ferbot-name, .ferbot-context{
    width:100%; padding:7px 9px; border-radius:9px; background:#0f1524; color:#dbeafe; border:1px solid rgba(255,255,255,.12); font-size:13px;
  }
  .ferbot-footer{
    position:absolute; left:0; right:0; bottom:0; display:flex; gap:6px; padding:8px 10px;
    background:rgba(255,255,255,.04); border-top:1px solid rgba(255,255,255,.08); flex-wrap:wrap;
  }
  .ferbot-btn{ flex:1; padding:7px 8px; border-radius:9px; border:0; cursor:pointer; font-weight:800; font-size:12px; }
  .ferbot-primary{ background:${PLATZI_GREEN}; color:${DARK}; }
  .ferbot-ghost{ background:#1b2333; color:#cbd5e1; }
  .ferbot-good{ background:#19c37d; color:#062d1f; display:none; }
  .ferbot-regular{ background:#fbbf24; color:#332200; display:none; }
  .ferbot-bad{ background:#ef4444; color:#fff; display:none; }
  .ferbot-autopaste{ display:flex; align-items:center; gap:6px; color:#94a3b8; font-size:12px; }
  `;
  document.head.appendChild(style);

  let fab, panel;

  function buildFab() {
    const b = document.createElement("button");
    b.id = "ferbot-fab";
    b.className = "ferbot-fab";
    b.title = "Abrir FerBot";
    b.textContent = "🤖";
    document.body.appendChild(b);

    let drag=false, offX=0, offY=0;
    b.addEventListener("mousedown",(e)=>{ drag=true; offX = e.clientX - b.getBoundingClientRect().left; offY = e.clientY - b.getBoundingClientRect().top; });
    window.addEventListener("mousemove",(e)=>{ if(!drag) return; b.style.right="auto"; b.style.bottom="auto"; b.style.left=`${e.clientX-offX}px`; b.style.top=`${e.clientY-offY}px`; });
    window.addEventListener("mouseup",()=> drag=false);

    b.addEventListener("click", togglePanel);
    return b;
  }

  function togglePanel() {
    if (panel && panel.isConnected) { panel.remove(); panel = null; return; }
    panel = buildPanel();
    document.body.appendChild(panel);
  }

  function buildPanel(){
    const div = document.createElement("div");
    div.className = "ferbot-panel";
    const savedName = (localStorage.getItem("ferbot_name") || "").replace(/"/g,"&quot;");
    const savedAuto = localStorage.getItem("ferbot_autopaste") === "1" ? "checked" : "";

    div.innerHTML = `
      <div class="ferbot-header" id="ferbot-drag-bar">
        <div class="ferbot-title">FerBot <span style="opacity:.8">🤖</span></div>
        <div class="ferbot-tools">
          <div class="ferbot-signal">
            <span class="ferbot-bullet" id="ferbot-bullet"></span>
            <span class="ferbot-timer" id="ferbot-timer">0.0s</span>
          </div>
          <button class="ferbot-close" id="ferbot-close" title="Cerrar">×</button>
        </div>
      </div>

      <div class="ferbot-body">
        <div class="ferbot-row" style="gap:10px">
          <div style="flex:1">
            <label class="ferbot-label">Nombre del cliente</label>
            <input id="ferbot-name" class="ferbot-name" placeholder="Ej. Laura" value="${savedName}">
          </div>
          <div style="width:48%">
            <label class="ferbot-label">Etapa</label>
            <select id="ferbot-stage" class="ferbot-select">
              <option value="integracion">Integración</option>
              <option value="sondeo">Sondeo</option>
              <option value="pre_cierre">Pre-cierre</option>
              <option value="rebatir" selected>Rebatir</option>
              <option value="cierre">Cierre</option>
            </select>
          </div>
        </div>

        <label class="ferbot-label" style="margin-top:6px;">Contexto (opcional, para el bot)</label>
        <input id="ferbot-context" class="ferbot-context" placeholder="Ej. preguntó por certificaciones; poco tiempo">

        <div class="ferbot-row" style="justify-content:space-between; margin-top:8px">
          <div class="ferbot-label">Selecciona texto del chat o escribe la objeción, luego <b>Generar</b>.</div>
          <label class="ferbot-autopaste">
            <input id="ferbot-autopaste" type="checkbox" ${savedAuto}/>
            Autopaste
          </label>
        </div>

        <div class="ferbot-row" style="align-items:flex-end">
          <div style="flex:1">
            <textarea id="ferbot-input" class="ferbot-input" placeholder="Texto/objeción del cliente..."></textarea>
          </div>
          <div id="ferbot-sentiment" class="ferbot-badge neu" title="Análisis de sentimiento">
            <span class="dot"></span><span id="ferbot-sentiment-text">Neutral</span>
          </div>
        </div>

        <label class="ferbot-label" style="margin-top:6px;">Explicación (POR QUÉ + SIGUIENTE PASO)</label>
        <textarea id="ferbot-guide" class="ferbot-output" placeholder="Aquí verás POR QUÉ y el SIGUIENTE PASO."></textarea>

        <label class="ferbot-label" style="margin-top:6px;">Respuesta (lista para pegar)</label>
        <textarea id="ferbot-output" class="ferbot-output" placeholder="Mensaje breve para el cliente (≤ 2 frases)."></textarea>
      </div>

      <div class="ferbot-footer">
        <button id="ferbot-generate" class="ferbot-btn ferbot-primary">Generar</button>
        <button id="ferbot-clear" class="ferbot-btn ferbot-ghost">Clear</button>
        <button id="ferbot-rate-good" class="ferbot-btn ferbot-good">👍 Buena</button>
        <button id="ferbot-rate-regular" class="ferbot-btn ferbot-regular">😐 Regular</button>
        <button id="ferbot-rate-bad" class="ferbot-btn ferbot-bad">👎 Mala</button>
      </div>
    `;

    // Drag del panel
    const drag = div.querySelector("#ferbot-drag-bar");
    let dragging=false, dx=0, dy=0;
    drag.addEventListener("mousedown",(e)=>{
      dragging=true; const r = div.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top;
      div.style.left = `${r.left}px`; div.style.top  = `${r.top}px`;
      div.style.right="auto"; div.style.bottom="auto";
    });
    window.addEventListener("mousemove",(e)=>{ if(!dragging) return; div.style.left=`${e.clientX-dx}px`; div.style.top=`${e.clientY-dy}px`; });
    window.addEventListener("mouseup",()=> dragging=false);

    // Cerrar con X
    div.querySelector("#ferbot-close").onclick = () => { div.remove(); panel = null; };

    // Refs
    const input   = div.querySelector("#ferbot-input");
    const output  = div.querySelector("#ferbot-output");
    const guide   = div.querySelector("#ferbot-guide");
    const nameEl  = div.querySelector("#ferbot-name");
    const stageEl = div.querySelector("#ferbot-stage");
    const ctxEl   = div.querySelector("#ferbot-context");
    const autoEl  = div.querySelector("#ferbot-autopaste");
    const badge   = div.querySelector("#ferbot-sentiment");
    const badgeTxt= div.querySelector("#ferbot-sentiment-text");
    const bullet  = div.querySelector("#ferbot-bullet");
    const timerEl = div.querySelector("#ferbot-timer");
    const btnGen  = div.querySelector("#ferbot-generate");
    const btnClear= div.querySelector("#ferbot-clear");
    const btnGood = div.querySelector("#ferbot-rate-good");
    const btnReg  = div.querySelector("#ferbot-rate-regular");
    const btnBad  = div.querySelector("#ferbot-rate-bad");

    nameEl.addEventListener("change", ()=> localStorage.setItem("ferbot_name", nameEl.value.trim()));
    autoEl.addEventListener("change", ()=> localStorage.setItem("ferbot_autopaste", autoEl.checked ? "1" : "0"));

    function updateSentimentBadge(text){
      const s = (text||"").toLowerCase();
      let cls = "neu", t = "Neutral";
      const pos = /(gracias|excelente|me interesa|bien|listo|perfecto|genial)/i;
      const neg = /(no puedo|caro|dif[ií]cil|malo|no me gusta|no sirve|no tengo tiempo|no s[ée])/i;
      if (neg.test(s)) { cls="neg"; t="Negativo"; }
      else if (pos.test(s)) { cls="pos"; t="Positivo"; }
      badge.classList.remove("pos","neu","neg");
      badge.classList.add(cls);
      badgeTxt.textContent = t;
    }

    function captureSelectionIntoInput() {
      try { const sel = window.getSelection()?.toString()?.trim() || ""; if (sel) input.value = sel; } catch {}
      updateSentimentBadge(input.value);
    }
    captureSelectionIntoInput();
    document.addEventListener("dblclick", captureSelectionIntoInput);
    document.addEventListener("mouseup", () => setTimeout(captureSelectionIntoInput, 30));
    input.addEventListener("input", ()=> updateSentimentBadge(input.value));

    toggleRatings(false);
    let lastReplyForRating = null;

    let t0 = 0, iv = null;
    function startTimer(){
      stopTimer();
      t0 = performance.now();
      setBullet("rojo");
      iv = setInterval(()=>{
        const dt = (performance.now()-t0)/1000;
        timerEl.textContent = dt.toFixed(1)+"s";
        if (dt < 2.0) setBullet("rojo");
        else if (dt < 4.0) setBullet("ambar");
        else setBullet("verde");
      }, 100);
    }
    function stopTimer(){ if (iv){ clearInterval(iv); iv=null; } }
    function setBullet(color){
      bullet.classList.remove("ambar","verde");
      if (color==="ambar") bullet.classList.add("ambar");
      else if (color==="verde") bullet.classList.add("verde");
    }

    btnGen.onclick = async () => {
      const q = (input.value || "").trim() || window.getSelection()?.toString()?.trim() || "";
      if (!q) { alert("Escribe la objeción/pregunta primero."); return; }
      const name  = nameEl.value.trim() || "Cliente";
      const stage = stageEl.value;
      const context = (ctxEl.value || "").trim();

      guide.value = "";
      output.value = "";
      toggleRatings(false);

      startTimer();
      try{
        const body = { question:q, customerName:name, stage, context, intent: guessIntent(q) };
        const res = await fetch(`${BASE}/assist_trainer`, {
          method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)
        });

        stopTimer(); setBullet("verde");

        if (!res.ok) {
          const txt = await res.text().catch(()=> "");
          alert(`No se pudo generar (HTTP ${res.status}). ${txt || ""}`);
          return;
        }
        const json = await res.json();

        const reply = (json?.result?.reply || json?.text || "").trim();
        const why   = (json?.result?.why  || "").trim();
        const next  = (json?.result?.next || "").trim();

        output.value = reply;
        guide.value  = `POR QUÉ: ${why}\nSIGUIENTE PASO: ${next}`;

        if (autoEl.checked) pasteToChat(reply);

        lastReplyForRating = reply;
        toggleRatings(true);

        btnGood.onclick = () => doRateAndHide("good", lastReplyForRating, stage);
        btnReg.onclick  = () => doRateAndHide("regular", lastReplyForRating, stage);
        btnBad.onclick  = () => doRateAndHide("bad", lastReplyForRating, stage);
      }catch(e){
        stopTimer();
        alert("No se pudo generar. Verifica que el servidor esté arriba.");
      }
    };

    btnClear.onclick = () => {
      guide.value = "";
      output.value = "";
      toggleRatings(false);
      stopTimer(); setBullet("rojo"); document.getElementById("ferbot-timer").textContent = "0.0s";
    };

    async function doRateAndHide(rating, replyText, stage){
      if (!replyText) return;
      try{
        await fetch(`${BASE}/trackRate`, {
          method:"POST", headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ intent: guessIntent(input.value), stage, text: replyText, rating })
        });
      }catch(_){}
      toggleRatings(false);
    }
    function toggleRatings(show){
      btnGood.style.display = show ? "inline-block" : "none";
      btnReg.style.display  = show ? "inline-block" : "none";
      btnBad.style.display  = show ? "inline-block" : "none";
    }

    return div;
  }

  function guessIntent(q=""){
    const s = (q||"").toLowerCase();
    if (/(tiempo|no tengo tiempo|poco tiempo|agenda|horario|no alcanzo|ocupad)/.test(s)) return "tiempo";
    if (/(precio|caro|costo|costoso|vale|promoci|oferta|descuento)/.test(s)) return "precio";
    if (/(cert|certificado|certificación|certificaciones)/.test(s)) return "cert";
    if (/(coursera|udemy|alura|competenc)/.test(s)) return "competencia";
    if (/(qué es platzi|que es platzi|platzi|pitch)/.test(s)) return "pitch";
    return "_default";
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
  function isInsidePanel(el){ return !!(el && el.closest && el.closest('.ferbot-panel')); }
  function isWritable(el){
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") { const t = (el.type || "text").toLowerCase(); return t === "text" || t === "search"; }
    return false;
  }
  function writeTo(el, text){
    try{
      el.focus();
      if (el.isContentEditable) {
        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(document.createTextNode(text));
      } else {
        const tag = (el.tagName || "").toLowerCase();
        if (tag === "textarea" || tag === "input") el.value = text;
      }
      try { document.execCommand("insertText", false, text); } catch {}
      el.dispatchEvent(new InputEvent("input", { bubbles:true }));
      el.dispatchEvent(new Event("change", { bubbles:true }));
      el.dispatchEvent(new Event("keyup", { bubbles:true }));
    } catch {}
  }

  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && (e.key === "F" || e.key === "f")) {
      if (!fab) return;
      e.preventDefault();
      fab.click();
    }
  });

  getAllowlist().then((allow) => {
    if (!isAllowedHost(allow)) return;
    fab = buildFab();
  });

})();
