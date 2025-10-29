// FerBot content script — contador de segundos + rating post-respuesta (una vez)
// Mantiene nombre, etapa, contexto, guía y respuesta como antes.
// No cambia endpoints ni autopaste por defecto.

(function () {
  // ====== CONFIG ======
  const BASE =
    (typeof window !== "undefined" && window.FERBOT_API_BASE) ||
    localStorage.getItem("ferbot_api_base") ||
    "https://ferbot-api.onrender.com"; // fallback sano

  const PLATZI_GREEN = "#97C93E";
  const DARK = "#0b0f19";

  // ====== LOG INICIAL ======
  try { console.log("[FerBot] contentScript cargado en", location.href); } catch(_) {}

  // ====== GUARD (no doble inyección) ======
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
  @keyframes ferbot-pulse{
    0%{ box-shadow:0 0 0 0 rgba(151,201,62,.55); }
    70%{ box-shadow:0 0 0 14px rgba(151,201,62,0); }
    100%{ box-shadow:0 0 0 0 rgba(151,201,62,0); }
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
    cursor:move; user-select:none; gap:8px; }
  .ferbot-title{ font-weight:800; letter-spacing:.3px; font-size:13px; display:flex; align-items:center; gap:8px; }
  .ferbot-timer{
    margin-left:auto; font-weight:800; font-size:12px;
    padding:3px 8px; border-radius:999px; background:#1f2937; color:#e5e7eb; border:1px solid rgba(255,255,255,.08);
  }
  .t-red{ background:#3b0d0d; color:#fecaca; border-color:#7f1d1d; }
  .t-amber{ background:#38280a; color:#fde68a; border-color:#b45309; }
  .t-green{ background:#063; color:#bbf7d0; border-color:#14532d; }

  .ferbot-body{ padding:10px 10px 98px; overflow:auto; }
  .ferbot-label{ font-size:11px; color:#94a3b8; margin:4px 0 4px; }
  .ferbot-input, .ferbot-output, .ferbot-context, .ferbot-name, .ferbot-select{
    width:100%; border-radius:10px; border:1px solid rgba(255,255,255,.12);
    background:#0f1524; color:#dbeafe; outline:none; padding:8px 9px; resize:vertical;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto; font-size:13px;
  }
  .ferbot-input{ min-height:88px; }
  .ferbot-output{ min-height:96px; }

  .ferbot-footer{
    position:absolute; left:0; right:0; bottom:0;
    display:flex; gap:6px; padding:8px 10px; background:rgba(255,255,255,.04);
    border-top:1px solid rgba(255,255,255,.08); flex-wrap:wrap; align-items:center;
  }
  .ferbot-btn{ padding:7px 10px; border-radius:9px; border:0; cursor:pointer; font-weight:800; font-size:12px; }
  .ferbot-primary{ background:${PLATZI_GREEN}; color:#0b0f19; }
  .ferbot-ghost{ background:#1b2333; color:#cbd5e1; }
  .ferbot-good{ background:#19c37d; color:#062d1f; }
  .ferbot-regular{ background:#fbbf24; color:#332200; }
  .ferbot-bad{ background:#ef4444; color:#fff; }
  .ferbot-spacer{ flex:1; }

  .ferbot-rate-wrap{ width:100%; display:none; align-items:center; gap:6px; margin-top:2px; }
  .ferbot-rate-q{ font-size:12px; color:#cbd5e1; opacity:.9; }

  .ferbot-made{ margin-left:auto; font-size:11px; color:#a7f3d0; display:flex; align-items:center; gap:6px; }
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
    const p = document.createElement("div");
    p.className = "ferbot-panel";

    const savedName = (localStorage.getItem("ferbot_name") || "").replace(/"/g,"&quot;");

    p.innerHTML = `
      <div class="ferbot-header" id="ferbot-drag-bar">
        <div class="ferbot-title">
          <span>FerBot</span>
          <span id="ferbot-timer" class="ferbot-timer" title="Tiempo de generación" style="display:none;">00.0s</span>
        </div>
        <div class="ferbot-made">hecho con amor <span title="Platzi" aria-label="corazón">💚</span></div>
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

        <label class="ferbot-label" style="margin-top:6px;">Contexto (opcional)</label>
        <input id="ferbot-context" class="ferbot-context" placeholder="Ej. poco tiempo, pide certificación, quiere remoto">

        <div class="ferbot-label" style="margin-top:6px;">Selecciona texto del chat o escribe la objeción y pulsa <b>Generar</b>.</div>
        <textarea id="ferbot-input" class="ferbot-input" placeholder="Texto/objeción del cliente..."></textarea>

        <label class="ferbot-label" style="margin-top:6px;">Explicación (POR QUÉ + SIGUIENTE PASO)</label>
        <textarea id="ferbot-guide" class="ferbot-output" placeholder="Guía para el asesor (por qué se responde así y qué hacer después)."></textarea>

        <label class="ferbot-label" style="margin-top:6px;">Respuesta (lista para pegar)</label>
        <textarea id="ferbot-output" class="ferbot-output" placeholder="Mensaje al cliente (máx. 2 líneas, claro y accionable)."></textarea>
      </div>
      <div class="ferbot-footer">
        <button id="ferbot-generate" class="ferbot-btn ferbot-primary">Generar</button>
        <button id="ferbot-clear" class="ferbot-btn ferbot-ghost">Clear</button>
        <div class="ferbot-spacer"></div>
        <div id="ferbot-rate-wrap" class="ferbot-rate-wrap">
          <span class="ferbot-rate-q">¿Te gustó esta respuesta?</span>
          <button id="ferbot-rate-good" class="ferbot-btn ferbot-good" title="Buena">👍</button>
          <button id="ferbot-rate-regular" class="ferbot-btn ferbot-regular" title="Regular">😐</button>
          <button id="ferbot-rate-bad" class="ferbot-btn ferbot-bad" title="Mala">👎</button>
        </div>
      </div>
    `;

    // Drag del panel
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

    // Refs
    const input   = p.querySelector("#ferbot-input");
    const output  = p.querySelector("#ferbot-output");
    const guide   = p.querySelector("#ferbot-guide");
    const nameEl  = p.querySelector("#ferbot-name");
    const stageEl = p.querySelector("#ferbot-stage");
    const ctxEl   = p.querySelector("#ferbot-context");
    const timerEl = p.querySelector("#ferbot-timer");
    const rateWrap= p.querySelector("#ferbot-rate-wrap");
    const btnGen  = p.querySelector("#ferbot-generate");
    const btnClr  = p.querySelector("#ferbot-clear");
    const btnGood = p.querySelector("#ferbot-rate-good");
    const btnReg  = p.querySelector("#ferbot-rate-regular");
    const btnBad  = p.querySelector("#ferbot-rate-bad");

    nameEl.addEventListener("change", ()=> localStorage.setItem("ferbot_name", nameEl.value.trim()));

    // Captura selección → input
    function captureSelectionIntoInput() {
      try {
        const sel = window.getSelection()?.toString()?.trim() || "";
        if (sel) input.value = sel;
      } catch {}
    }
    captureSelectionIntoInput();
    document.addEventListener("dblclick", captureSelectionIntoInput);
    document.addEventListener("mouseup", () => { setTimeout(captureSelectionIntoInput, 30); });

    // ====== TIMER (contador + colores) ======
    let tickInt = null, startTs = 0, ratedThisRound = false;

    function startTimer(){
      startTs = performance.now();
      timerEl.style.display = "";
      timerEl.textContent = "00.0s";
      timerEl.classList.remove("t-green","t-amber","t-red");
      timerEl.classList.add("t-red");
      if (tickInt) clearInterval(tickInt);
      tickInt = setInterval(()=>{
        const ms = performance.now() - startTs;
        const s = ms/1000;
        timerEl.textContent = s.toFixed(1)+"s";
        // colores: <2s rojo, 2–5s ámbar, >5s verde (cuando complete lo forzamos a verde)
        if (s >= 5 && !timerEl.classList.contains("t-green")) {
          timerEl.classList.remove("t-red","t-amber");
          timerEl.classList.add("t-amber");
        } else if (s >= 2 && !timerEl.classList.contains("t-amber")) {
          timerEl.classList.remove("t-red","t-green");
          timerEl.classList.add("t-amber");
        }
      }, 150);
    }
    function stopTimerSuccess(){
      if (tickInt) { clearInterval(tickInt); tickInt = null; }
      // Pinta verde y congela conteo final
      timerEl.classList.remove("t-red","t-amber");
      timerEl.classList.add("t-green");
    }
    function hideTimer(){
      if (tickInt) { clearInterval(tickInt); tickInt = null; }
      timerEl.style.display = "none";
      timerEl.classList.remove("t-red","t-amber","t-green");
    }

    // ====== GENERAR ======
    btnGen.onclick = async () => {
      const q = (input.value || "").trim() || window.getSelection()?.toString()?.trim() || "";
      if (!q) { alert("Escribe la objeción/pregunta primero."); return; }
      const name  = nameEl.value.trim() || "Cliente";
      const stage = stageEl.value;
      const context = ctxEl.value.trim();
      const intent = guessIntent(q);

      // Estado inicial de ronda
      guide.value = "";
      output.value = "";
      ratedThisRound = false;
      rateWrap.style.display = "none";

      startTimer();

      const body = { question: q, customerName: name, stage, intent, context };

      try{
        const res = await fetch(`${BASE}/assist_trainer`, {
          method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)
        });

        if (!res.ok) {
          const txt = await res.text().catch(()=> "");
          hideTimer();
          alert(`No se pudo generar (HTTP ${res.status}). ${txt || ""}`.trim());
          return;
        }

        const json = await res.json();

        // Relleno de salida
        const reply = (json?.text || json?.result?.reply || "").trim();
        const why   = (json?.result?.why || "").trim();
        const next  = (json?.result?.next || "").trim();
        const built = formatWhyNext(why, next);

        guide.value  = built;
        output.value = reply;

        stopTimerSuccess();      // se pintará verde
        rateWrap.style.display = "flex"; // ahora sí se muestran los botones de rating
      }catch(e){
        hideTimer();
        console.error("[FerBot] Error fetch:", e);
        alert("No se pudo generar. Revisa que el servidor esté arriba.");
      }
    };

    // ====== CLEAR ======
    btnClr.onclick = () => {
      guide.value = "";
      output.value = "";
      rateWrap.style.display = "none";
      ratedThisRound = false;
      hideTimer();
    };

    // ====== RATING (una sola vez por generación) ======
    async function sendRatingOnce(rating){
      if (ratedThisRound) return; // evita múltiples envíos
      const utter = (output.value || "").trim(); if(!utter) return;
      ratedThisRound = true;
      disableRateUI();
      try{
        await fetch(`${BASE}/trackRate`, {
          method:"POST", headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ intent: guessIntent(input.value), stage: stageEl.value, text: utter, rating })
        });
        // Oculta los botones tras calificar
        setTimeout(()=>{ rateWrap.style.display = "none"; }, 100);
      }catch(_){
        // si falla, igual ocultamos para evitar duplicados
        setTimeout(()=>{ rateWrap.style.display = "none"; }, 100);
      }
    }
    function disableRateUI(){
      [btnGood, btnReg, btnBad].forEach(b=>{
        b.disabled = true;
        b.style.opacity = .6;
        b.style.cursor = "default";
      });
    }
    function enableRateUI(){
      [btnGood, btnReg, btnBad].forEach(b=>{
        b.disabled = false;
        b.style.opacity = 1;
        b.style.cursor = "pointer";
      });
    }

    btnGood.onclick = ()=> sendRatingOnce("good");
    btnReg.onclick  = ()=> sendRatingOnce("regular");
    btnBad.onclick  = ()=> sendRatingOnce("bad");

    return p;
  }

  // ====== UTILIDADES ======
  function formatWhyNext(why, next){
    const w = (why  && why.length  > 2) ? why  : "Anclamos beneficio real y proponemos micro-acción.";
    const n = (next && next.length > 2) ? next : "Envía ruta + 1 clase para hoy y pide OK.";
    return `POR QUÉ: ${w}\nSIGUIENTE PASO: ${n}`;
  }

  function guessIntent(q=""){
    const s = (q||"").toLowerCase();
    if (/(tiempo|no tengo tiempo|poco tiempo|agenda|horario|no alcanzo|no me da el tiempo)/i.test(s)) return "tiempo";
    if (/(precio|caro|costo|costoso|muy caro|vale|promoci|oferta|descuento)/i.test(s)) return "precio";
    if (/(cert|certificado|certificación|certificaciones)/i.test(s)) return "cert";
    if (/(coursera|udemy|alura|competenc)/i.test(s)) return "competencia";
    if (/(pitch|qué es platzi|que es platzi|platzi)/i.test(s)) return "pitch";
    return "_default";
  }

  // Inyección inicial y reintento en SPA
  function ensurePanel(){ /* solo deja el FAB; el panel se crea al hacer click */ }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    ensurePanel();
  } else {
    window.addEventListener("DOMContentLoaded", ensurePanel, { once:true });
  }
  // Reinyecta guardando solo FAB (ya insertado arriba)
})();
