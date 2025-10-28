// FerBot content script — URL fija (/assist_openai) + override opcional; rating Bueno/Regular/Malo
(() => {
  // ====== CONFIG (URL BASE) ======
  // 1) Toma base de window.FERBOT_API_BASE si existe
  // 2) o de localStorage.ferbot_api_base si existe
  // 3) si no, usa la URL fija (ngrok actual). Para local: "http://127.0.0.1:3005"
  const BASE =
    (typeof window !== "undefined" && window.FERBOT_API_BASE) ||
    localStorage.getItem("ferbot_api_base") ||
    "https://carly-subcerebral-nongenealogically.ngrok-free.dev";

  const PLATZI_GREEN = "#97C93E";
  const DARK = "#0b0f19";

  // Evitar doble inyección
  if (document.getElementById("ferbot-fab") || document.getElementById("ferbot-styles")) return;

  // ====== ESTILOS ======
  const style = document.createElement("style");
  style.id = "ferbot-styles";
  style.textContent = `
  .ferbot-fab{
    position:fixed; right:20px; bottom:20px; z-index:999999;
    width:56px; height:56px; border-radius:999px; background:${PLATZI_GREEN};
    display:flex; align-items:center; justify-content:center;
    box-shadow:0 8px 28px rgba(0,0,0,.35); cursor:grab; user-select:none;
    font-size:24px; color:#0b0f19; border:0;
  }
  .ferbot-fab:active{ cursor:grabbing; }
  .ferbot-panel{
    position:fixed; right:20px; bottom:86px; z-index:999999;
    width:min(380px,92vw);
    background:${DARK}E6;
    color:#e2e8f0; border-radius:16px; box-shadow:0 18px 40px rgba(0,0,0,.35);
    border:1px solid rgba(255,255,255,.10); display:flex; flex-direction:column;
    max-height:78vh; overflow:hidden; backdrop-filter: blur(6px);
  }
  .ferbot-header{ display:flex; align-items:center; justify-content:space-between;
    padding:8px 10px; background:rgba(255,255,255,.04); border-bottom:1px solid rgba(255,255,255,.08);
    cursor:move; user-select:none; }
  .ferbot-title{ font-weight:800; letter-spacing:.3px; font-size:13px; display:flex; gap:8px; align-items:center; }
  .ferbot-timer{ font-size:11px; color:#9ec1ff; }
  .ferbot-body{ padding:10px 10px 72px; overflow:auto; }
  .ferbot-label{ font-size:11px; color:#94a3b8; margin:4px 0 4px; display:flex; align-items:center; gap:8px; }
  .ferbot-chip{ font-size:11px; color:#9ec1ff; background:#0f1a2b; border:1px solid rgba(255,255,255,.12); border-radius:999px; padding:2px 8px; }
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
    position:absolute; left:0; right:0; bottom:0; display:flex; gap:6px; padding:8px 10px;
    background:rgba(255,255,255,.04); border-top:1px solid rgba(255,255,255,.08);
  }
  .ferbot-btn{ flex:1; padding:7px 8px; border-radius:9px; border:0; cursor:pointer; font-weight:800; font-size:12px; }
  .ferbot-primary{ background:${PLATZI_GREEN}; color:#0b0f19; }
  .ferbot-ghost{ background:#1b2333; color:#cbd5e1; }
  .ferbot-good{ background:#19c37d; color:#062d1f; }
  .ferbot-regular{ background:#fbbf24; color:#332200; }
  .ferbot-bad{ background:#ef4444; color:#fff; }
  `;
  document.head.appendChild(style);

  // ====== FAB ======
  const fab = document.createElement("button");
  fab.id = "ferbot-fab";
  fab.className = "ferbot-fab";
  fab.title = "Abrir FerBot";
  fab.textContent = "🤖";
  document.body.appendChild(fab);

  // drag FAB
  let dragFab=false, offX=0, offY=0;
  fab.addEventListener("mousedown",(e)=>{ dragFab=true; offX = e.clientX - fab.getBoundingClientRect().left; offY = e.clientY - fab.getBoundingClientRect().top; });
  window.addEventListener("mousemove",(e)=>{ if(!dragFab) return; fab.style.right="auto"; fab.style.bottom="auto"; fab.style.left=`${e.clientX-offX}px`; fab.style.top=`${e.clientY-offY}px`; });
  window.addEventListener("mouseup",()=> dragFab=false);

  // ====== PANEL ======
  let panel;
  fab.addEventListener("click", () => {
    if (panel && panel.isConnected) { panel.remove(); return; }
    openPanel();
  });

  function openPanel(){
    panel = document.createElement("div");
    panel.className = "ferbot-panel";
    panel.innerHTML = `
      <div class="ferbot-header" id="ferbot-drag-bar">
        <div class="ferbot-title">
          <div>FerBot</div>
          <div id="ferbot-timer" class="ferbot-timer"></div>
        </div>
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

        <div class="ferbot-label">Selecciona texto del chat o escribe una frase y pulsa <b>Generar</b>.
          <span id="ferbot-sentiment" class="ferbot-chip" style="display:none;"></span>
        </div>

        <textarea id="ferbot-input" class="ferbot-input" placeholder="Texto/objeción del cliente..."></textarea>

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
    const input  = document.getElementById("ferbot-input");
    const output = document.getElementById("ferbot-output");
    const guide  = document.getElementById("ferbot-guide");
    const nameEl = document.getElementById("ferbot-name");
    const stageEl= document.getElementById("ferbot-stage");
    const timerEl= document.getElementById("ferbot-timer");
    const sentEl = document.getElementById("ferbot-sentiment");

    // ===== sentimiento local =====
    function analyzeSentimentLocal(txt=""){
      const s = (txt||"").toLowerCase();
      let score = 0;
      if (/gracias|perfecto|excelente|me interesa|bien/.test(s)) score += 1;
      if (/no|duda|caro|difícil|miedo|complicado|preocupad/.test(s)) score -= 1;
      if (/urgente|rápido|ya/.test(s)) score += 0.5;
      if (/no tengo tiempo|muy caro|no sé/.test(s)) score -= 0.5;
      return score > 0.3 ? "Positivo" : score < -0.3 ? "Negativo" : "Neutro";
    }
    function showSentiment(){
      const txt = (input.value || "").trim();
      if (!txt) { sentEl.style.display="none"; return; }
      const label = analyzeSentimentLocal(txt);
      sentEl.textContent = `Sentimiento: ${label}`;
      sentEl.style.display = "inline-block";
    }
    input.addEventListener("input", showSentiment);

    // CAPTURA SELECCIÓN → input
    function captureSelectionIntoInput() {
      const sel = window.getSelection()?.toString()?.trim() || "";
      if (sel) { input.value = sel; showSentiment(); }
    }
    captureSelectionIntoInput();
    document.addEventListener("dblclick", captureSelectionIntoInput);
    document.addEventListener("mouseup", () => { setTimeout(captureSelectionIntoInput, 30); });

    // guarda nombre
    nameEl.addEventListener("change", ()=> localStorage.setItem("ferbot_name", nameEl.value.trim()));

    // ======= GENERAR (usa /assist_openai) + countdown =======
    let countdownTimer = null;
    function startCountdown(sec=7){
      stopCountdown();
      let s = sec;
      timerEl.textContent = `generando… ${s}s`;
      countdownTimer = setInterval(()=>{
        s--;
        if (s > 0) timerEl.textContent = `generando… ${s}s`;
        else stopCountdown();
      }, 1000);
    }
    function stopCountdown(){
      if (countdownTimer) clearInterval(countdownTimer);
      countdownTimer = null;
      timerEl.textContent = "";
    }

    document.getElementById("ferbot-generate").onclick = async () => {
      const q = (input.value || "").trim() || window.getSelection()?.toString()?.trim() || "";
      if (!q) { alert("Escribe la objeción/pregunta primero."); return; }
      const name  = nameEl.value.trim() || "Cliente";
      const stage = stageEl.value;
      const intent = guessIntent(q);
      const body = { question:q, customerName:name, stage, intent };

      // inicia countdown
      startCountdown(7);

      try{
        const res = await fetch(`${BASE}/assist_openai`, {
          method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)
        });
        if (!res.ok) {
          const txt = await res.text().catch(()=> "");
          stopCountdown();
          alert(`No se pudo generar (HTTP ${res.status}). ${txt || ""}`.trim());
          return;
        }
        const json = await res.json();
        stopCountdown();

        const rawGuide = json?.result?.guide || json?.result?.message || json?.text || "";
        let rawReply = json?.result?.sections?.[stage] || json?.result?.reply || json?.text || "";

        const cleanGuide = tidyPunctuation(normalizeSpace(bulletsToSentence(rawGuide || "")));
        const cleanReply = postProcessText(rawReply || "", name);

        guide.value  = cleanGuide;
        output.value = cleanReply;

        // Evitar que el foco quede dentro del panel
        const active = document.activeElement;
        if (active && active.closest && active.closest('.ferbot-panel')) active.blur();

        // Autopaste en área de chat (SE MANTIENE COMO EN TU VERSIÓN)
        const ok = pasteToHilos(cleanReply);
        if (!ok) { try { await navigator.clipboard.writeText(cleanReply); } catch {} }

        // mostrar rating y ocultarlo tras votar
        setupRatingOnce();

      }catch(e){
        stopCountdown();
        alert("No se pudo generar. Revisa que el servidor esté arriba.");
      }
    };

    function setupRatingOnce(){
      const btnGood = document.getElementById("ferbot-rate-good");
      const btnReg  = document.getElementById("ferbot-rate-regular");
      const btnBad  = document.getElementById("ferbot-rate-bad");
      const inputEl = document.getElementById("ferbot-input");
      const stageEl2= document.getElementById("ferbot-stage");
      const outEl   = document.getElementById("ferbot-output");

      const once = async (rating)=>{
        const utter = (outEl.value || "").trim(); if(!utter) return;
        try{
          await fetch(`${BASE}/trackRate`, {
            method:"POST", headers:{ "Content-Type":"application/json" },
            body: JSON.stringify({ intent: guessIntent(inputEl.value), stage: stageEl2.value, text: utter, rating })
          });
        }catch{}
        // Ocultar botones tras votar
        btnGood.style.display = "none";
        btnReg.style.display  = "none";
        btnBad.style.display  = "none";
      };

      // restablecer visibles por si ya se ocultaron antes
      ["ferbot-rate-good","ferbot-rate-regular","ferbot-rate-bad"].forEach(id=>{
        const b = document.getElementById(id);
        b.style.display = "block";
      });

      btnGood.onclick = ()=> once("good");
      btnReg.onclick  = ()=> once("regular");
      btnBad.onclick  = ()=> once("bad");
    }

    // ======= CLEAR =======
    document.getElementById("ferbot-clear").onclick = () => {
      guide.value = "";
      output.value = "";
      // restablecer sentimiento y contador
      sentEl.style.display = "none";
      stopCountdown();
      // re-mostramos botones de rating para la próxima vez (se volverán a ocultar tras votar)
      ["ferbot-rate-good","ferbot-rate-regular","ferbot-rate-bad"].forEach(id=>{
        const b = document.getElementById(id);
        b.style.display = "block";
      });
    };

    // ====== INTENT HEURÍSTICA ======
    function guessIntent(q=""){
      const s = (q||"").toLowerCase();
      if (/(tiempo|no tengo tiempo|poco tiempo|agenda|horario|no alcanzo|no me da el tiempo)/i.test(s)) return "tiempo";
      if (/(precio|caro|costo|costoso|muy caro|vale|promoci|oferta|descuento)/i.test(s)) return "precio";
      if (/(cert|certificado|certificación|certificaciones)/i.test(s)) return "cert";
      if (/(coursera|udemy|alura|competenc)/i.test(s)) return "competencia";
      return "_default";
    }

    // ====== UTILIDADES TEXTO ======
    function normalizeSpace(s){ return (s||"").replace(/\s{2,}/g," ").trim(); }
    function stripBadTokens(s){ return (s||"").replace(/[🔵🟢🟣🔴◆◇▪︎•●◦■□▶️►]/g, "").replace(/\s{2,}/g, " "); }
    function fixNumbers(s){
      if(!s) return s;
      s = s.replace(/\b5\s*0?\s*[-–]?\s*10\b/g, "5–10");
      s = s.replace(/\b7\s*0?\s*[-–]?\s*14\b/g, "7–14");
      s = s.replace(/(\d+)\s*-\s*(\d+)/g, "$1–$2");
      return s;
    }
    function bulletsToSentence(s){ return (s||"").replace(/^\s*[•\-·]\s*/gm, "").replace(/\n+/g, " "); }
    function removeBlockBackToBackDup(s){ const m = (s||"").match(/^([\s\S]{50,}?)\1$/); return m ? m[1] : s; }
    function dedupeSentences(s){
      const parts = (s||"").split(/(?<=[.!?])\s+|\n+/).map(x=>x.trim()).filter(Boolean);
      const seen = new Set(); const out=[];
      for(const p of parts){ const key = p.toLowerCase().replace(/\s+/g," "); if(!seen.has(key)){ seen.add(key); out.push(p); } }
      return out.join(" ");
    }
    function cleanGreeting(s, name){
      if(!s) return s;
      const hi = name ? `Hola ${name}` : "Hola";
      s = s.replace(/(^|\.\s+)\s*hola[^,]*,\s*hola/gi, `$1${hi}`);
      s = s.replace(/^(\s*hola[^,]*,\s*)+/i, `${hi}, `);
      s = s.replace(/\.?\s*hola[^,]*,\s*/gi, ". ");
      return s;
    }
    function ensureOneHola(s, name){
      const hi = name ? `Hola ${name}, ` : "Hola,";
      const t = (s||"").trim();
      if (!/^hola\b/i.test(t)) return hi + t;
      return t.replace(/^hola[^,]*,\s*/i, hi);
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
    function postProcessText(raw, name){
      let t = raw || "";
      t = stripBadTokens(t);
      t = fixNumbers(t);
      t = bulletsToSentence(t);
      t = removeBlockBackToBackDup(t);
      t = dedupeSentences(t);
      t = cleanGreeting(t, name);
      t = ensureOneHola(t, name);
      t = tidyPunctuation(t);
      t = normalizeSpace(t);
      return t;
    }

    // ====== AUTOPASTE (se mantiene exactamente igual) ======
    function pasteToHilos(text){
      const active = document.activeElement;
      if (active && active.closest && active.closest('.ferbot-panel')) { try { active.blur(); } catch {} }
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
  }
})();
