// FerBot content script — Render fijo + assist_trainer + WHY/NEXT + Promos
// Countdown (rojo→ámbar→verde), Sentimiento compacto, Ratings 1-vez, Autopaste OFF
(() => {
  // =========================
  // CONFIG
  // =========================
  const BASE = "https://ferbot-api.onrender.com"; // SIEMPRE Render
  const PLATZI_GREEN = "#97C93E";
  const DARK = "#0b0f19";
  const PANEL_BG = "#0b0f19E6";
  const GRAY = "#94a3b8";
  const VERSION = "v1.7-promos";

  // Campañas de promoción (no precios explícitos, lenguaje "precio especial anual")
  // Fechas inclusivas en horario local del navegador
  const PROMOS = [
    {
      id: "buen_fin",
      name: "Buen Fin",
      start: "2025-11-14", end: "2025-11-18",
      notes: "Campaña típica en MX. Enfasis en anual.",
      individualCopy:
        "Aprovecha precio especial anual por Buen Fin y mantén el ritmo todo el año. ¿Activo tu plan hoy?",
      groupCopy:
        "Para Grupos (3+), tenemos precio especial anual por Buen Fin y gestión sencilla de licencias. ¿Cuántas activamos hoy?"
    },
    {
      id: "black_friday",
      name: "Black Friday",
      // Black Friday: último viernes de noviembre (aprox. fijo 2025)
      start: "2025-11-28", end: "2025-11-29",
      notes: "Empuje global. Habla de plan anual como inversión.",
      individualCopy:
        "Black Friday: accede con precio especial anual y enfoca tu crecimiento todo el año. ¿Lo activo ahora?",
      groupCopy:
        "Black Friday para Grupos (3+): precio especial anual y todo centralizado. ¿Cuántas licencias necesitan?"
    },
    {
      id: "cyber_monday",
      name: "Cyber Monday",
      start: "2025-12-01", end: "2025-12-02",
      notes: "Secuencia de BF. Cierra rápido, tono directo.",
      individualCopy:
        "Cyber Monday: precio especial anual para consolidar tu avance este año. ¿Activo tu plan hoy?",
      groupCopy:
        "Cyber Monday para Grupos (3+): precio especial anual y administración fácil. ¿Cuántas licencias abrimos?"
    },
    {
      id: "grupos",
      name: "Lanzamiento Grupos (3+)",
      start: "2025-01-01", end: "2030-12-31",
      notes: "Disponible siempre como campaña perenne.",
      individualCopy:
        "Si buscas para ti, trabajamos con plan anual y rutas claras. ¿Confirmo tu activación hoy?",
      groupCopy:
        "Grupos (3+): suscripción anual con precio especial y licencias escalables. ¿Desde cuántas iniciamos?"
    }
  ];

  // Guard: no doble inyección
  if (document.getElementById("ferbot-fab") || document.getElementById("ferbot-styles")) return;

  // =========================
  // ESTILOS
  // =========================
  const style = document.createElement("style");
  style.id = "ferbot-styles";
  style.textContent = `
  .ferbot-fab{
    position:fixed; right:20px; bottom:20px; z-index:2147483647;
    width:56px; height:56px; border-radius:999px; background:${PLATZI_GREEN};
    display:flex; align-items:center; justify-content:center;
    box-shadow:0 8px 28px rgba(0,0,0,.35); cursor:grab; user-select:none;
    font-size:24px; color:#0b0f19; border:0;
    animation: ferbot-pulse 2s infinite;
  }
  @keyframes ferbot-pulse {
    0% { transform: scale(1); box-shadow:0 8px 28px rgba(0,0,0,.35); }
    50% { transform: scale(1.06); box-shadow:0 14px 38px rgba(0,0,0,.45); }
    100% { transform: scale(1); box-shadow:0 8px 28px rgba(0,0,0,.35); }
  }

  .ferbot-panel{
    position:fixed; right:20px; bottom:86px; z-index:2147483647;
    width:min(420px,92vw); background:${PANEL_BG}; color:#e2e8f0;
    border-radius:16px; box-shadow:0 18px 40px rgba(0,0,0,.35);
    border:1px solid rgba(255,255,255,.10); display:flex; flex-direction:column;
    max-height:80vh; overflow:hidden; backdrop-filter: blur(6px);
  }
  .ferbot-header{
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    padding:8px 10px; background:rgba(255,255,255,.04); border-bottom:1px solid rgba(255,255,255,.08);
    cursor:move; user-select:none;
  }
  .ferbot-title{ font-weight:800; letter-spacing:.3px; font-size:13px; display:flex; align-items:center; gap:6px; }
  .ferbot-signal{
    display:inline-flex; align-items:center; gap:6px; font-size:12px; color:${GRAY};
    background:#121a2b; border:1px solid rgba(255,255,255,.10); border-radius:999px; padding:4px 8px;
  }
  .ferbot-bullet{ width:8px; height:8px; border-radius:12px; background:#ef4444; }
  .ferbot-bullet.ambar{ background:#f59e0b; }
  .ferbot-bullet.verde{ background:#22c55e; }
  .ferbot-timer{ font-variant-numeric:tabular-nums; opacity:.9; }
  .ferbot-close{ background:transparent;border:0;color:${GRAY};cursor:pointer;font-size:18px;padding:2px 6px; }

  .ferbot-body{ padding:10px 10px 92px; overflow:auto; }
  .ferbot-label{ font-size:11px; color:${GRAY}; margin:6px 0 4px; }

  .ferbot-row{ display:flex; align-items:center; gap:8px; }
  .ferbot-col{ flex:1; min-width:0; }

  .ferbot-badge{
    font-size:11px; padding:4px 8px; border-radius:999px;
    border:1px solid rgba(255,255,255,.10); background:#101727; color:#cbd5e1;
    display:inline-flex; align-items:center; gap:6px;
  }
  .ferbot-badge .dot{ width:7px; height:7px; border-radius:999px; background:#64748b; }
  .ferbot-badge.pos .dot{ background:#22c55e; }
  .ferbot-badge.neu .dot{ background:#f59e0b; }
  .ferbot-badge.neg .dot{ background:#ef4444; }

  .ferbot-input, .ferbot-output{
    width:100%; min-height:92px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
    background:#0f1524; color:#dbeafe; outline:none; padding:8px 9px; resize:vertical;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto; font-size:13px;
    box-shadow: inset 0 0 0 9999px rgba(255,255,255,.02);
  }
  .ferbot-output{ min-height:86px; }

  .ferbot-select, .ferbot-name, .ferbot-context{
    width:100%; padding:7px 9px; border-radius:9px; background:#0f1524; color:#dbeafe; border:1px solid rgba(255,255,255,.12);
    font-size:13px;
  }

  .ferbot-footer{
    position:absolute; left:0; right:0; bottom:0; display:flex; gap:6px; padding:8px 10px;
    background:rgba(255,255,255,.04); border-top:1px solid rgba(255,255,255,.08); flex-wrap:wrap;
  }
  .ferbot-btn{ flex:1; padding:7px 8px; border-radius:9px; border:0; cursor:pointer; font-weight:800; font-size:12px; }
  .ferbot-primary{ background:${PLATZI_GREEN}; color:#0b0f19; }
  .ferbot-ghost{ background:#1b2333; color:#cbd5e1; }
  .ferbot-good{ background:#19c37d; color:#062d1f; display:none; }
  .ferbot-regular{ background:#fbbf24; color:#332200; display:none; }
  .ferbot-bad{ background:#ef4444; color:#fff; display:none; }
  .ferbot-autopaste{ display:flex; align-items:center; gap:6px; color:${GRAY}; font-size:12px; }
  .ferbot-switch{ display:inline-flex; align-items:center; gap:6px; font-size:12px; color:${GRAY}; }
  .ferbot-note{ font-size:11px; color:${GRAY}; opacity:.85; }

  /* Ajuste de labels y columnas para alineación impecable */
  .ferbot-grid2{ display:grid; grid-template-columns: 1fr 1fr; gap:8px; align-items:center; }
  `;
  document.head.appendChild(style);

  // =========================
  // FAB
  // =========================
  const fab = document.createElement("button");
  fab.id = "ferbot-fab";
  fab.className = "ferbot-fab";
  fab.title = "Abrir FerBot";
  fab.textContent = "🤖";
  document.body.appendChild(fab);

  // Drag FAB (libre en pantalla)
  let dragFab=false, offX=0, offY=0;
  fab.addEventListener("mousedown",(e)=>{ dragFab=true; offX = e.clientX - fab.getBoundingClientRect().left; offY = e.clientY - fab.getBoundingClientRect().top; });
  window.addEventListener("mousemove",(e)=>{ if(!dragFab) return; fab.style.right="auto"; fab.style.bottom="auto"; fab.style.left=`${e.clientX-offX}px`; fab.style.top=`${e.clientY-offY}px`; });
  window.addEventListener("mouseup",()=> dragFab=false);

  // =========================
  // PANEL
  // =========================
  let panel;
  fab.addEventListener("click", () => {
    if (panel && panel.isConnected) { panel.remove(); return; }
    panel = buildPanel();
    document.body.appendChild(panel);
  });

  function buildPanel(){
    const div = document.createElement("div");
    div.className = "ferbot-panel";
    const savedName = (localStorage.getItem("ferbot_name") || "").replace(/"/g,"&quot;");
    const savedAuto = localStorage.getItem("ferbot_autopaste") === "1" ? "checked" : ""; // OFF por defecto

    // Promo switches persisted
    const savedUsePromo = localStorage.getItem("ferbot_use_promo") === "1";
    const savedPromoId = localStorage.getItem("ferbot_promo_id") || "grupos";
    const savedAudience = localStorage.getItem("ferbot_audience") || "individual";

    const activePromos = computeActivePromos(PROMOS);

    div.innerHTML = `
      <div class="ferbot-header" id="ferbot-drag-bar">
        <div class="ferbot-title">FerBot <span style="opacity:.8">🤖</span> <span class="ferbot-note">${VERSION}</span></div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="ferbot-signal">
            <span class="ferbot-bullet" id="ferbot-bullet"></span>
            <span class="ferbot-timer" id="ferbot-timer">0.0s</span>
          </div>
          <button id="ferbot-close" class="ferbot-close" title="Cerrar">✕</button>
        </div>
      </div>

      <div class="ferbot-body">
        <div class="ferbot-grid2">
          <div class="ferbot-col">
            <label class="ferbot-label">Nombre del cliente</label>
            <input id="ferbot-name" class="ferbot-name" placeholder="Ej. Laura" value="${savedName}">
          </div>
          <div class="ferbot-col">
            <label class="ferbot-label">Etapa</label>
            <select id="ferbot-stage" class="ferbot-select">
              <option value="integracion">Integración</option>
              <option value="sondeo">Sondeo</option>
              <option value="pre_cierre">Pre-cierre</option>
              <option value="rebatir" selected>Rebatir</option>
              <option value="cierre">Cierre</option>
              <option value="promos">Promos</option>
            </select>
          </div>
        </div>

        <label class="ferbot-label" style="margin-top:6px;">Contexto (opcional, para el bot)</label>
        <input id="ferbot-context" class="ferbot-context" placeholder="Ej. preguntó por certificaciones; tiene poco tiempo">

        <div class="ferbot-row" style="justify-content:space-between; margin-top:8px">
          <div class="ferbot-label">Selecciona texto del chat o escribe la objeción, luego <b>Generar</b>.</div>
          <label class="ferbot-autopaste">
            <input id="ferbot-autopaste" type="checkbox" ${savedAuto}/>
            Autopaste
          </label>
        </div>

        <div class="ferbot-row" style="align-items:flex-end">
          <div class="ferbot-col">
            <textarea id="ferbot-input" class="ferbot-input" placeholder="Texto/objeción del cliente..."></textarea>
          </div>
          <div id="ferbot-sentiment" class="ferbot-badge neu" title="Análisis de sentimiento">
            <span class="dot"></span><span id="ferbot-sentiment-text">Neutral</span>
          </div>
        </div>

        <!-- Bloque PROMOS -->
        <div class="ferbot-grid2" style="margin-top:8px; align-items:end">
          <div class="ferbot-col">
            <label class="ferbot-switch">
              <input id="ferbot-use-promo" type="checkbox" ${savedUsePromo ? "checked":""}/>
              Usar promo
            </label>
            <select id="ferbot-promo-id" class="ferbot-select" ${savedUsePromo ? "" : "disabled"}>
              ${PROMOS.map(p => {
                const isActive = activePromos.some(a => a.id === p.id);
                const tag = isActive ? " (activa)" : "";
                const sel = (p.id === savedPromoId) ? "selected" : "";
                return `<option value="${p.id}" ${sel}>${p.name}${tag}</option>`;
              }).join("")}
            </select>
          </div>
          <div class="ferbot-col">
            <label class="ferbot-label">Público</label>
            <select id="ferbot-audience" class="ferbot-select" ${savedUsePromo ? "" : "disabled"}>
              <option value="individual" ${savedAudience==="individual"?"selected":""}>Individual</option>
              <option value="grupos" ${savedAudience==="grupos"?"selected":""}>Grupos (3+)</option>
            </select>
          </div>
        </div>
        <div class="ferbot-note" style="margin-top:4px">
          Lenguaje comercial: <b>“precio especial anual”</b> (sin decir “descuento”). Grupos = 3+ licencias.
        </div>

        <label class="ferbot-label" style="margin-top:10px;">Explicación (POR QUÉ + SIGUIENTE PASO)</label>
        <textarea id="ferbot-guide" class="ferbot-output" placeholder="Aquí verás POR QUÉ y el SIGUIENTE PASO, para enseñar al asesor."></textarea>

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

    // Drag panel
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

    // Close
    div.querySelector("#ferbot-close").onclick = ()=> div.remove();

    // Refs
    const input   = div.querySelector("#ferbot-input");
    const output  = div.querySelector("#ferbot-output");
    const guide   = div.querySelector("#ferbot-guide");
    const nameEl  = div.querySelector("#ferbot-name");
    const stageEl = div.querySelector("#ferbot-stage");
    const ctxEl   = div.querySelector("#ferbot-context");
    const autoEl  = div.querySelector("#ferbot-autopaste");

    const promoUseEl = div.querySelector("#ferbot-use-promo");
    const promoIdEl  = div.querySelector("#ferbot-promo-id");
    const audienceEl = div.querySelector("#ferbot-audience");

    const badge   = div.querySelector("#ferbot-sentiment");
    const badgeTxt= div.querySelector("#ferbot-sentiment-text");

    const bullet  = div.querySelector("#ferbot-bullet");
    const timerEl = div.querySelector("#ferbot-timer");

    const btnGen  = div.querySelector("#ferbot-generate");
    const btnClear= div.querySelector("#ferbot-clear");
    const btnGood = div.querySelector("#ferbot-rate-good");
    const btnReg  = div.querySelector("#ferbot-rate-regular");
    const btnBad  = div.querySelector("#ferbot-rate-bad");

    // Persist nombre y autopaste
    nameEl.addEventListener("change", ()=> localStorage.setItem("ferbot_name", nameEl.value.trim()));
    autoEl.addEventListener("change", ()=> localStorage.setItem("ferbot_autopaste", autoEl.checked ? "1" : "0"));

    // Persist promo toggles
    function refreshPromoEnabled(){
      const en = promoUseEl.checked;
      promoIdEl.disabled = !en;
      audienceEl.disabled = !en;
      localStorage.setItem("ferbot_use_promo", en ? "1":"0");
    }
    promoUseEl.addEventListener("change", refreshPromoEnabled);
    promoIdEl.addEventListener("change", ()=> localStorage.setItem("ferbot_promo_id", promoIdEl.value));
    audienceEl.addEventListener("change", ()=> localStorage.setItem("ferbot_audience", audienceEl.value));
    refreshPromoEnabled();

    // Captura selección del chat
    function captureSelectionIntoInput() {
      try {
        const sel = window.getSelection()?.toString()?.trim() || "";
        if (sel) input.value = sel;
      } catch {}
      updateSentimentBadge(input.value, badge, badgeTxt);
    }
    captureSelectionIntoInput();
    document.addEventListener("dblclick", captureSelectionIntoInput);
    document.addEventListener("mouseup", () => setTimeout(captureSelectionIntoInput, 30));
    input.addEventListener("input", ()=> updateSentimentBadge(input.value, badge, badgeTxt));

    // Rating: oculto hasta generar
    toggleRatings(false);
    let lastReplyForRating = null;

    // Countdown helpers
    let t0 = 0, iv = null;
    function startTimer(){
      stopTimer();
      t0 = performance.now();
      setBullet("rojo");
      iv = setInterval(()=>{
        const dt = (performance.now()-t0)/1000;
        timerEl.textContent = dt.toFixed(1)+"s";
        if (dt >= 0 && dt < 2.0) setBullet("rojo");
        else if (dt >= 2.0 && dt < 4.0) setBullet("ambar");
        else setBullet("verde");
      }, 100);
    }
    function stopTimer(){ if (iv){ clearInterval(iv); iv=null; } }
    function setBullet(color){
      bullet.classList.remove("ambar","verde");
      if (color==="ambar") bullet.classList.add("ambar");
      else if (color==="verde") bullet.classList.add("verde");
      // rojo: clase base
    }

    // GENERAR
    btnGen.onclick = async () => {
      const q = (input.value || "").trim() || window.getSelection()?.toString()?.trim() || "";
      if (!q) { alert("Escribe la objeción/pregunta primero."); return; }
      const name  = nameEl.value.trim() || "Cliente";
      const stage = stageEl.value;
      const context = (ctxEl.value || "").trim();

      // Limpia zonas de salida y UI
      guide.value = "";
      output.value = "";
      toggleRatings(false);

      // Timer ON
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

        let reply = (json?.result?.reply || json?.text || "").trim();
        const why   = (json?.result?.why  || "").trim();
        const next  = (json?.result?.next || "").trim();

        // Si “Usar promo” está activo, aplicamos el bloque comercial según campaña + audiencia
        if (promoUseEl.checked) {
          const selectedPromo = PROMOS.find(p => p.id === (promoIdEl.value || "grupos")) || PROMOS[0];
          const isGroup = (audienceEl.value === "grupos");
          const promoCopy = (isGroup ? selectedPromo.groupCopy : selectedPromo.individualCopy) || "";
          // Integración suave:
          // - Si el stage es "promos", centramos el mensaje en promo.
          // - En otros stages, reforzamos con una segunda frase.
          if (stage === "promos") {
            reply = clamp220(`${reply || ""} ${promoCopy}`.trim());
          } else {
            // Respetar máximo 2 frases → aseguramos con clamp por puntos.
            reply = clamp220(mergeTwoSentence(reply, promoCopy));
          }
        }

        output.value = reply;
        guide.value  = `POR QUÉ: ${why}\nSIGUIENTE PASO: ${next}`;

        // Autopaste opcional
        if (autoEl.checked) pasteToChat(reply);

        // Habilita rating 1 vez por respuesta
        lastReplyForRating = reply;
        toggleRatings(true);

        // Handlers de calificación (una vez por respuesta)
        btnGood.onclick = () => doRateAndHide("good", lastReplyForRating, stage);
        btnReg.onclick  = () => doRateAndHide("regular", lastReplyForRating, stage);
        btnBad.onclick  = () => doRateAndHide("bad", lastReplyForRating, stage);
      }catch(e){
        stopTimer();
        alert("No se pudo generar. Revisa que el servidor esté arriba.");
      }
    };

    // CLEAR
    btnClear.onclick = () => {
      guide.value = "";
      output.value = "";
      toggleRatings(false);
      stopTimer();
      setBullet("rojo");
      timerEl.textContent = "0.0s";
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

  // =========================
  // UTILIDADES
  // =========================
  function guessIntent(q=""){
    const s = (q||"").toLowerCase();
    if (/(tiempo|no tengo tiempo|poco tiempo|agenda|horario|no alcanzo|no me da el tiempo|ocupad)/.test(s)) return "tiempo";
    if (/(precio|caro|costo|costoso|vale|promoci|oferta|descuento)/.test(s)) return "precio";
    if (/(cert|certificado|certificación|certificaciones)/.test(s)) return "cert";
    if (/(coursera|udemy|alura|competenc)/.test(s)) return "competencia";
    if (/(qué es platzi|que es platzi|platzi|pitch)/.test(s)) return "pitch";
    if (/(promo|promoción|promocion|black friday|cyber monday|buen fin|grupos)/.test(s)) return "promos";
    return "_default";
  }

  function updateSentimentBadge(text, badge, label){
    const s = (text||"").toLowerCase();
    let cls = "neu", t = "Neutral";
    const posWords = /(gracias|excelente|me interesa|bien|listo|perfecto|genial)/i;
    const negWords = /(no puedo|caro|dif[ií]cil|malo|no me gusta|no sirve|no tengo tiempo|no s[eé]|presupuesto)/i;
    if (negWords.test(s)) { cls="neg"; t="Negativo"; }
    else if (posWords.test(s)) { cls="pos"; t="Positivo"; }
    else { cls="neu"; t="Neutral"; }
    badge.classList.remove("pos","neu","neg");
    badge.classList.add(cls);
    label.textContent = t;
  }

  function clamp220(text){
    let t = (text || "").trim();
    // máximo 2 frases
    const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
    t = parts.slice(0,2).join(" ");
    if (t.length > 220) t = t.slice(0, 219).trimEnd() + "…";
    return t;
  }

  function mergeTwoSentence(base, add){
    const a = (base || "").trim();
    const b = (add || "").trim();
    if (!a) return b;
    if (!b) return a;
    const combined = `${a} ${b}`;
    const parts = combined.split(/(?<=[.!?])\s+/).filter(Boolean);
    return parts.slice(0,2).join(" ");
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

  function computeActivePromos(list){
    const today = new Date();
    return (list || []).filter(p=>{
      try{
        const s = new Date(p.start+"T00:00:00");
        const e = new Date(p.end  +"T23:59:59");
        return today >= s && today <= e;
      }catch{ return false; }
    });
  }

  // Inyección y reinyección en SPAs (UI solo al abrir FAB)
  function ensureInjected(){ /* no-op */ }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    ensureInjected();
  } else {
    window.addEventListener("DOMContentLoaded", ensureInjected, { once:true });
  }
  let lastUrl = location.href;
  new MutationObserver(()=>{ if(location.href!==lastUrl){ lastUrl=location.href; setTimeout(ensureInjected,300);} })
    .observe(document, { subtree:true, childList:true });
})();
