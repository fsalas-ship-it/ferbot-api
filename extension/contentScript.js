// FerBot content script — con rating diferido (una sola vez) + guía (POR QUÉ / SIGUIENTE PASO) + Autopaste opcional (OFF por defecto)
// Usa /assist_openai y, si existe, rellena guía con json.result.guide; si no, construye una guía breve.
(function () {
  // ====== CONFIG ======
  // Resolución de BASE (prioridad):
  // 1) window.FERBOT_API_BASE (por si inyectas desde consola)
  // 2) localStorage.ferbot_api_base (fácil de cambiar sin recompilar)
  // 3) Render (fallback seguro)
  const BASE =
    (typeof window !== "undefined" && window.FERBOT_API_BASE) ||
    localStorage.getItem("ferbot_api_base") ||
    "https://ferbot-api.onrender.com";

  const PLATZI_GREEN = "#97C93E";
  const DARK = "#0b0f19";

  try { console.log("[FerBot] contentScript cargado en", location.href, "→ BASE:", BASE); } catch (_) {}

  // ====== GUARD (no doble inyección) ======
  function alreadyInjected() {
    return !!document.getElementById("ferbot-fab") || !!document.getElementById("ferbot-styles");
  }

  // ====== UI ======
  function injectUI() {
    if (alreadyInjected()) return;

    const style = document.createElement("style");
    style.id = "ferbot-styles";
    style.textContent = `
    .ferbot-fab{
      position:fixed; right:20px; bottom:20px; z-index:2147483647;
      width:56px; height:56px; border-radius:999px; background:${PLATZI_GREEN};
      display:flex; align-items:center; justify-content:center;
      box-shadow:0 8px 28px rgba(0,0,0,.35); cursor:grab; user-select:none;
      font-size:24px; color:#0b0f19; border:0;
      animation: ferbotBlink 1.8s infinite ease-in-out;
    }
    @keyframes ferbotBlink {
      0% { filter: brightness(1); transform: scale(1); }
      60% { filter: brightness(1.08); transform: scale(1.02); }
      100% { filter: brightness(1); transform: scale(1); }
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
    .ferbot-title{ font-weight:800; letter-spacing:.3px; font-size:13px; }
    .ferbot-body{ padding:10px 10px 104px; overflow:auto; }
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
    .ferbot-btn{ padding:7px 8px; border-radius:9px; border:0; cursor:pointer; font-weight:800; font-size:12px; }
    .ferbot-primary{ background:${PLATZI_GREEN}; color:#0b0f19; }
    .ferbot-ghost{ background:#1b2333; color:#cbd5e1; }
    .ferbot-good{ background:#19c37d; color:#062d1f; }
    .ferbot-regular{ background:#fbbf24; color:#332200; }
    .ferbot-bad{ background:#ef4444; color:#fff; }
    .ferbot-tiny{ font-size:11px; opacity:.85; }
    .ferbot-grow{ flex:1; }
    .ferbot-ratewrap{ display:none; width:100%; gap:6px; align-items:center; }
    .ferbot-ratewrap .hint{ font-size:12px; color:#cbd5e1; margin-right:6px; }
    .ferbot-ratewrap .ferbot-btn{ flex:0 0 auto; }
    `;
    document.documentElement.appendChild(style);

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

    let panel;
    fab.addEventListener("click", () => {
      if (panel && panel.isConnected) { panel.remove(); return; }
      panel = buildPanel();
      document.documentElement.appendChild(panel);
    });

    console.log("[FerBot] UI inyectada");
  }

  function buildPanel(){
    const panel = document.createElement("div");
    panel.className = "ferbot-panel";

    const savedName = (localStorage.getItem("ferbot_name") || "").replace(/"/g,"&quot;");
    const savedAuto = localStorage.getItem("ferbot_autopaste") === "1" ? "checked" : ""; // OFF por defecto

    panel.innerHTML = `
      <div class="ferbot-header" id="ferbot-drag-bar">
        <div class="ferbot-title">FerBot</div>
        <label class="ferbot-tiny" style="display:flex;align-items:center;gap:6px;">
          <input id="ferbot-autopaste" type="checkbox" ${savedAuto}/> Autopaste
        </label>
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
        <div class="ferbot-grow">
          <button id="ferbot-generate" class="ferbot-btn ferbot-primary">Generar</button>
          <button id="ferbot-clear" class="ferbot-btn ferbot-ghost">Clear</button>
        </div>
        <div id="ferbot-ratewrap" class="ferbot-ratewrap">
          <span class="hint">¿Te gustó esta respuesta?</span>
          <button id="ferbot-rate-good"    class="ferbot-btn ferbot-good">👍 Buena</button>
          <button id="ferbot-rate-regular" class="ferbot-btn ferbot-regular">😐 Regular</button>
          <button id="ferbot-rate-bad"     class="ferbot-btn ferbot-bad">👎 Mala</button>
        </div>
      </div>
    `;

    // drag panel
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

    // refs
    const input   = panel.querySelector("#ferbot-input");
    const output  = panel.querySelector("#ferbot-output");
    const guide   = panel.querySelector("#ferbot-guide");
    const nameEl  = panel.querySelector("#ferbot-name");
    const stageEl = panel.querySelector("#ferbot-stage");
    const ctxEl   = panel.querySelector("#ferbot-context");
    const autoEl  = panel.querySelector("#ferbot-autopaste");
    const rateWrap= panel.querySelector("#ferbot-ratewrap");
    const rateGood= panel.querySelector("#ferbot-rate-good");
    const rateReg = panel.querySelector("#ferbot-rate-regular");
    const rateBad = panel.querySelector("#ferbot-rate-bad");

    // Estado de rating (una sola vez por generación)
    let ratingEnabled = false;

    nameEl.addEventListener("change", ()=> localStorage.setItem("ferbot_name", nameEl.value.trim()));
    autoEl.addEventListener("change", ()=> localStorage.setItem("ferbot_autopaste", autoEl.checked ? "1" : "0"));

    // Captura selección del chat → input
    function captureSelectionIntoInput() {
      try {
        const sel = window.getSelection()?.toString()?.trim() || "";
        if (sel) input.value = sel;
      } catch {}
    }
    captureSelectionIntoInput();
    document.addEventListener("dblclick", captureSelectionIntoInput);
    document.addEventListener("mouseup", () => { setTimeout(captureSelectionIntoInput, 30); });

    // ====== GENERAR (usa /assist_openai) ======
    panel.querySelector("#ferbot-generate").onclick = async () => {
      const q = (input.value || "").trim() || window.getSelection()?.toString()?.trim() || "";
      if (!q) { alert("Escribe la objeción/pregunta primero."); return; }
      const name  = nameEl.value.trim() || "Cliente";
      const stage = stageEl.value;
      const context = ctxEl.value.trim();
      const intent = guessIntent(q);

      // Oculta rating hasta que haya resultado nuevo
      rateWrap.style.display = "none";
      ratingEnabled = false;

      const body = { question: q, customerName: name, stage, intent, context };

      try{
        const res = await fetch(`${BASE}/assist_openai`, {
          method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)
        });

        // Si vino 500/400, muestra detalle legible
        if (!res.ok) {
          const txt = await res.text().catch(()=> "");
          console.error("[FerBot] HTTP error:", res.status, txt);
          alert(`No se pudo generar (HTTP ${res.status}). ${txt || ""}`.trim());
          return;
        }

        const json = await res.json();

        // Texto al cliente
        const reply = (json?.text || json?.result?.reply || "").trim();

        // Guía / explicación
        const serverGuide = (json?.result?.guide || "").trim();
        const why  = (json?.result?.why  || "").trim();
        const next = (json?.result?.next || "").trim();
        const built = buildGuide(serverGuide, intent, stage, context);

        guide.value  = formatWhyNext(why, next, built);
        output.value = reply;

        // Autopaste solo si está marcado
        if (autoEl.checked) pasteToChat(reply);

        // Activa y muestra rating SOLO ahora (una vez por generación)
        ratingEnabled = true;
        rateWrap.style.display = "flex";

      }catch(e){
        console.error("[FerBot] Error fetch:", e);
        alert("No se pudo generar. Revisa que el servidor esté arriba.");
      }
    };

    // ====== CLEAR ======
    panel.querySelector("#ferbot-clear").onclick = () => {
      guide.value = "";
      output.value = "";
      // input NO se borra
    };

    // ====== RATING (una sola vez por respuesta) ======
    async function sendRatingOnce(rating){
      if (!ratingEnabled) return;
      ratingEnabled = false; // bloquea repetición

      const utter = (output.value || "").trim();
      if (!utter) { rateWrap.style.display = "none"; return; }

      try {
        await fetch(`${BASE}/trackRate`, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ intent: guessIntent(input.value), stage: stageEl.value, text: utter, rating })
        });
      } catch(_) {}

      // feedback visual simple
      rateWrap.innerHTML = `<span class="hint">¡Gracias por calificar!</span>`;
      setTimeout(() => { rateWrap.style.display = "none"; }, 1500);
    }
    rateGood.onclick = () => sendRatingOnce("good");
    rateReg.onclick  = () => sendRatingOnce("regular");
    rateBad.onclick  = () => sendRatingOnce("bad");

    return panel;
  }

  // ====== UTILIDADES ======
  function formatWhyNext(why, next, fallbackGuide){
    const safeWhy  = (why  && why.length  > 2) ? why  : "-";
    const safeNext = (next && next.length > 2) ? next : (fallbackGuide?.next || "-");
    return `POR QUÉ: ${safeWhy}\nSIGUIENTE PASO: ${safeNext}`;
  }

  function buildGuide(serverGuide, intent, stage, ctx){
    const nextDefaultByStage = {
      sondeo: "Haz 1–2 preguntas de meta/tiempo y pide permiso para enviar una ruta.",
      rebatir: "Conecta beneficio → vida; ofrece enviar 1 clase para hoy.",
      pre_cierre: "Propón plan (Expert/Duo/Family) y CTA de activación.",
      cierre: "Confirma plan y método de pago; agenda seguimiento en 7 días.",
      integracion: "Felicita, deja mini agenda de 5–10 min/día y fecha de revisión."
    };
    const nextByIntent = {
      precio: "Enfoca en resultado y certificaciones verificables; ofrece ruta + 1 clase hoy.",
      tiempo: "Propón micro-hábito de 5–10 min/día y ruta guiada.",
      cert: "Menciona certificados digitales verificables y opcionales físicos en rutas pro.",
      competencia: "Diferencia por rutas, comunidad y certificaciones; envía ruta comparativa.",
      pitch: "Explica transformación + CTA claro para probar hoy."
    };
    const next = nextByIntent[intent] || nextDefaultByStage[stage] || "Ofrece ruta y 1 clase para hoy.";
    return { next, guide: serverGuide, ctx };
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

  // ====== INYECTA Y REINYECTA EN SPA ======
  function ensureInjected(){ try{ injectUI(); }catch(e){} }
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
