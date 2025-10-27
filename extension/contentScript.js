// FerBot content script — UI ligera con Analizador de Sentimiento + Countdown (sin Pac-Man)
// Requisitos: servidor FerBot con /assist_openai, /assist, /trackRate, /analyze
(() => {
  // ====== CONFIG ======
  const BASE = localStorage.getItem("ferbot_api_base") || "https://ferbot-api.onrender.com";
  const PLATZI_GREEN = "#97C93E";
  const DARK = "#0b0f19";
  const PANEL_BG = "#0b0f19B8"; // más transparente que antes
  const GRAY = "#cbd5e1";

  // Evitar doble inyección
  if (document.getElementById("ferbot-fab") || document.getElementById("ferbot-styles")) return;

  // ====== ESTILOS ======
  const style = document.createElement("style");
  style.id = "ferbot-styles";
  style.textContent = `
  @keyframes ferbotBlink {
    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(151,201,62,.6) }
    70% { transform: scale(1.06); box-shadow: 0 0 0 14px rgba(151,201,62,0) }
    100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(151,201,62,0) }
  }
  .ferbot-fab{
    position:fixed; right:20px; bottom:20px; z-index:999999;
    width:56px; height:56px; border-radius:999px; background:${PLATZI_GREEN};
    display:flex; align-items:center; justify-content:center;
    box-shadow:0 8px 28px rgba(0,0,0,.35); cursor:pointer; user-select:none;
    font-size:24px; color:#0b0f19; border:0; animation: ferbotBlink 1.8s infinite ease-out;
  }
  .ferbot-fab:hover{ filter: brightness(1.05); }

  .ferbot-panel{
    position:fixed; right:20px; bottom:86px; z-index:999999;
    width:min(380px,92vw);
    background:${PANEL_BG}; /* más transparente */
    color:#e2e8f0;
    border-radius:16px; box-shadow:0 18px 40px rgba(0,0,0,.35);
    border:1px solid rgba(255,255,255,.10); display:flex; flex-direction:column;
    max-height:78vh; overflow:hidden; backdrop-filter: blur(6px);
  }
  .ferbot-header{
    display:flex; align-items:center; justify-content:space-between;
    padding:8px 10px; background:rgba(255,255,255,.04); border-bottom:1px solid rgba(255,255,255,.08);
    cursor:move; user-select:none;
  }
  .ferbot-title{ font-weight:800; letter-spacing:.3px; font-size:13px; }
  .ferbot-body{ padding:10px 10px 78px; overflow:auto; }
  .ferbot-label{ font-size:11px; color:#94a3b8; margin:4px 0 4px; }

  /* NO tocamos estilos base de los cuadros, sólo aseguramos contraste */
  .ferbot-input, .ferbot-output{
    width:100%; min-height:96px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
    background:#0f1524; color:#dbeafe; outline:none; padding:8px 9px; resize:vertical;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto;
    box-shadow: inset 0 0 0 9999px rgba(255,255,255,.02);
    font-size:13px;
  }
  .ferbot-select, .ferbot-name{
    width:100%; padding:7px 9px; border-radius:9px; background:#0f1524; color:#dbeafe; border:1px solid rgba(255,255,255,.12);
    font-size:13px;
  }

  .ferbot-footer{
    position:absolute; left:0; right:0; bottom:0;
    display:flex; gap:6px; padding:8px 10px; background:rgba(255,255,255,.04);
    border-top:1px solid rgba(255,255,255,.08);
  }
  .ferbot-btn{ flex:1; padding:7px 8px; border-radius:9px; border:0; cursor:pointer; font-weight:800; font-size:12px; }
  .ferbot-primary{ background:${PLATZI_GREEN}; color:#0b0f19; }
  .ferbot-ghost{ background:#1b2333; color:#cbd5e1; }
  .ferbot-good{ background:#19c37d; color:#062d1f; }
  .ferbot-regular{ background:#fbbf24; color:#332200; }
  .ferbot-bad{ background:#ef4444; color:#fff; }

  .ferbot-analyze{
    background:#0f1524; border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:8px 9px; font-size:12px;
    color:#cbd5e1;
  }
  .ferbot-analyze .label{ color:#94a3b8; font-size:11px; margin-bottom:4px; }
  .ferbot-analyze .pill{ display:inline-block; padding:3px 8px; border-radius:999px; font-weight:800; font-size:11px; }
  .pill-pos{ background:#073d2b; color:#a7f3d0; border:1px solid #115e42 }
  .pill-neu{ background:#1e293b; color:#cbd5e1; border:1px solid #334155 }
  .pill-neg{ background:#3f1d22; color:#fecaca; border:1px solid #7f1d1d }

  .ferbot-countdown{
    position:absolute; right:12px; bottom:46px; font-size:11px; color:#94a3b8; background:rgba(0,0,0,.35);
    padding:4px 8px; border-radius:8px; border:1px solid rgba(255,255,255,.1);
  }
  `;
  document.head.appendChild(style);

  // ====== FAB ======
  const fab = document.createElement("button");
  fab.id = "ferbot-fab";
  fab.className = "ferbot-fab";
  fab.title = "Abrir FerBot";
  fab.textContent = "🤖";
  document.body.appendChild(fab);

  // Drag sencillo del FAB
  let dragFab=false, offX=0, offY=0;
  fab.addEventListener("mousedown",(e)=>{ dragFab=true; offX = e.clientX - fab.getBoundingClientRect().left; offY = e.clientY - fab.getBoundingClientRect().top; });
  window.addEventListener("mousemove",(e)=>{ if(!dragFab) return; fab.style.right="auto"; fab.style.bottom="auto"; fab.style.left=`${e.clientX-offX}px`; fab.style.top=`${e.clientY-offY}px`; });
  window.addEventListener("mouseup",()=> dragFab=false);

  // ====== PANEL ======
  let panel, countdownEl, countdownTimer;
  fab.addEventListener("click", () => {
    if (panel && panel.isConnected) { panel.remove(); return; }
    openPanel();
  });

  function openPanel(){
    panel = document.createElement("div");
    panel.className = "ferbot-panel";
    panel.innerHTML = `
      <div class="ferbot-header" id="ferbot-drag-bar">
        <div class="ferbot-title">FerBot</div>
      </div>
      <div class="ferbot-body">
        <label class="ferbot-label">Nombre del cliente</label>
        <input id="ferbot-name" class="ferbot-name" placeholder="Ej. Ferney" value="${(localStorage.getItem("ferbot_name")||"").replace(/"/g,"&quot;")}">

        <label class="ferbot-label" style="margin-top:6px;">Etapa</label>
        <select id="ferbot-stage" class="ferbot-select">
          <option value="integracion">Integración</option>
          <option value="sondeo">Sondeo</option>
          <option value="pre_cierre">Pre-cierre</option>
          <option value="rebatir" selected>Rebatir</option>
          <option value="cierre">Cierre</option>
        </select>

        <div class="ferbot-label">Selecciona texto del chat (doble clic o arrastre) o escribe una frase, luego <b>Generar</b>.</div>
        <textarea id="ferbot-input" class="ferbot-input" placeholder="Texto/objeción del cliente..."></textarea>

        <div class="ferbot-analyze" style="margin-top:8px">
          <div class="label">Sentimiento y feedback</div>
          <div id="ferbot-sentiment">Sin analizar</div>
        </div>

        <label class="ferbot-label" style="margin-top:6px;">Explicación (para ti)</label>
        <textarea id="ferbot-guide" class="ferbot-output" placeholder="Aquí verás la guía/explicación para el asesor."></textarea>

        <label class="ferbot-label" style="margin-top:6px;">Respuesta (para pegar)</label>
        <textarea id="ferbot-output" class="ferbot-output" placeholder="Aquí verás la respuesta lista para pegar."></textarea>
      </div>
      <div class="ferbot-footer">
        <button id="ferbot-generate" class="ferbot-btn ferbot-primary">Generar</button>
        <button id="ferbot-clear" class="ferbot-btn ferbot-ghost">Clear</button>
        <button id="ferbot-rate-good" class="ferbot-btn ferbot-good">👍 Buena</button>
        <button id="ferbot-rate-regular" class="ferbot-btn ferbot-regular">😐 Regular</button>
        <button id="ferbot-rate-bad" class="ferbot-btn ferbot-bad">👎 Mala</button>
      </div>
      <div id="ferbot-countdown" class="ferbot-countdown" style="display:none">Generando…</div>
    `;
    document.body.appendChild(panel);

    // drag panel
    const drag = document.getElementById("ferbot-drag-bar");
    let dragging=false, dx=0, dy=0;
    drag.addEventListener("mousedown",(e)=>{
      dragging=true; const r = panel.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top;
      panel.style.left = `${r.left}px`; panel.style.top  = `${r.top}px`;
      panel.style.right="auto"; panel.style.bottom="auto";
    });
    window.addEventListener("mousemove",(e)=>{ if(!dragging) return; panel.style.left=`${e.clientX-dx}px`; panel.style.top=`${e.clientY-dy}px`; });
    window.addEventListener("mouseup",()=> dragging=false);

    // refs
    const input   = document.getElementById("ferbot-input");
    const output  = document.getElementById("ferbot-output");
    const guide   = document.getElementById("ferbot-guide");
    const nameEl  = document.getElementById("ferbot-name");
    const stageEl = document.getElementById("ferbot-stage");
    const sentiEl = document.getElementById("ferbot-sentiment");
    countdownEl   = document.getElementById("ferbot-countdown");

    nameEl.addEventListener("change", ()=> localStorage.setItem("ferbot_name", nameEl.value.trim()));

    // Captura selección → input
    function captureSelectionIntoInput() {
      const sel = window.getSelection()?.toString()?.trim() || "";
      if (sel) input.value = sel;
    }
    captureSelectionIntoInput();
    document.addEventListener("dblclick", captureSelectionIntoInput);
    document.addEventListener("mouseup", () => { setTimeout(captureSelectionIntoInput, 30); });

    // ANALIZAR (auto al escribir/pegar) — sólo “cómo se siente” + “cómo responder”
    let analyzeTimer;
    async function runAnalyzeNow(){
      const txt = (input.value || "").trim();
      if (!txt) { sentiEl.textContent = "Sin analizar"; return; }
      try{
        const r = await fetch(`${BASE}/analyze`, {
          method:"POST", headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ text: txt })
        }).then(x=>x.json());

        // Mapea a feedback breve
        let pill = "pill-neu", lab = "NEUTRAL";
        if (r.label === "positivo"){ pill = "pill-pos"; lab = "POSITIVO"; }
        if (r.label === "negativo"){ pill = "pill-neg"; lab = "NEGATIVO"; }
        const feedback = (r.tips && r.tips[0]) ? r.tips[0] : "Avanza con una acción pequeña y clara.";

        sentiEl.innerHTML = `
          <div>Se siente: <span class="pill ${pill}">${lab}</span></div>
          <div style="margin-top:4px">Sugerencia: ${escapeHtml(feedback)}</div>
        `;
      } catch {
        sentiEl.textContent = "No se pudo analizar.";
      }
    }
    function triggerAnalyze(){
      clearTimeout(analyzeTimer);
      analyzeTimer = setTimeout(runAnalyzeNow, 350);
    }
    input.addEventListener("input", triggerAnalyze);
    runAnalyzeNow();

    // COUNTDOWN (sin Pac-Man)
    function startCountdown(seconds=10){
      let remain = seconds;
      countdownEl.style.display = "block";
      countdownEl.textContent = `Generando… ${remain}s`;
      clearInterval(countdownTimer);
      countdownTimer = setInterval(()=>{
        remain -= 1;
        if (remain <= 0) {
          countdownEl.textContent = `Generando…`;
          clearInterval(countdownTimer);
        } else {
          countdownEl.textContent = `Generando… ${remain}s`;
        }
      }, 1000);
    }
    function stopCountdown(){
      countdownEl.style.display = "none";
      clearInterval(countdownTimer);
    }

    // GENERAR
    document.getElementById("ferbot-generate").onclick = async () => {
      const q = (input.value || "").trim() || window.getSelection()?.toString()?.trim() || "";
      if (!q) { alert("Escribe la objeción/pregunta primero."); return; }
      const name  = nameEl.value.trim() || "Cliente";
      const stage = stageEl.value;

      startCountdown(10);
      try{
        const res = await fetch(`${BASE}/assist_openai`, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ question:q, customerName:name, stage, user_id: (window.__ferbotUser||"unknown"), metadata:{ channel:"extension" } })
        });
        const json = await res.json();

        const rawGuide = json?.result?.guide || json?.result?.message || json?.text || "";
        let rawReply  = json?.result?.sections?.[stage] || json?.result?.reply || json?.text || "";

        guide.value  = tidyPunctuation(normalizeSpace(stripBadTokens(rawGuide || "")));
        output.value = tidyPunctuation(normalizeSpace(stripBadTokens(rawReply || "")));

      }catch(e){
        alert("No se pudo generar. Revisa que el servidor esté arriba.");
      }finally{
        stopCountdown();
      }
    };

    // CLEAR
    document.getElementById("ferbot-clear").onclick = () => {
      guide.value  = "";
      output.value = "";
      // input queda para volver a analizar/generar
    };

    // RATING
    async function sendRating(rating){
      const utter = (output.value || "").trim(); if(!utter) return;
      await fetch(`${BASE}/trackRate`, {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ intent: guessIntent(input.value), stage: stageEl.value, text: utter, rating })
      }).catch(()=>{});
    }
    document.getElementById("ferbot-rate-good").onclick    = ()=> sendRating("good");
    document.getElementById("ferbot-rate-regular").onclick = ()=> sendRating("regular");
    document.getElementById("ferbot-rate-bad").onclick     = ()=> sendRating("bad");
  }

  // ====== UTILS ======
  function escapeHtml(s=""){ return String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m])); }
  function normalizeSpace(s){ return (s||"").replace(/\s{2,}/g," ").trim(); }
  function stripBadTokens(s){
    if(!s) return s;
    return s.replace(/[🔵🟢🟣🔴◆◇▪︎•●◦■□▶️►]/g, "").replace(/\s{2,}/g, " ");
  }
  function tidyPunctuation(s){
    if(!s) return s;
    s = s.replace(/\s*:\s*/g, ": ");
    s = s.replace(/\s*,\s*/g, ", ");
    s = s.replace(/\s*\.\s*\.\s*/g, ". ");
    s = s.replace(/\.\.+/g, ".");
    s = s.replace(/\s{2,}/g, " ");
    return s.trim();
  }
  function guessIntent(q=""){
    const s = (q||"").toLowerCase();
    if (/(tiempo|no tengo tiempo|poco tiempo|agenda|horario|no alcanzo|no me da el tiempo)/i.test(s)) return "tiempo";
    if (/(precio|caro|costo|costoso|muy caro|vale|promoci|oferta|descuento)/i.test(s)) return "precio";
    if (/(cert|certificado|certificación|certificaciones)/i.test(s)) return "cert";
    if (/(coursera|udemy|alura|competenc)/i.test(s)) return "competencia";
    if (/(pitch|presenta|qué hace platzi|que hace platzi)/i.test(s)) return "pitch";
    return "_default";
  }
})();
