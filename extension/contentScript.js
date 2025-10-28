// FerBot content script — estable (sin autopaste, con countdown y calificación)
// Usa BASE desde localStorage o Render por defecto.
// Campos: Nombre · Etapa · Contexto · Explicación (POR QUÉ + SIGUIENTE PASO) · Respuesta
(() => {
  // ====== CONFIG (no tocar si no es necesario) ======
  const BASE = localStorage.getItem("ferbot_api_base") || "https://ferbot-api.onrender.com";
  const PLATZI_GREEN = "#97C93E";
  const DARK = "#0b0f19";
  const PANEL_BG = "#0b0f19CC"; // semi-transparente (más claro)
  const GRAY = "#cbd5e1";

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
      animation: ferbot-pulse 2s infinite;
    }
    @keyframes ferbot-pulse{
      0%{ box-shadow:0 0 0 0 rgba(151,201,62,.6) }
      70%{ box-shadow:0 0 0 16px rgba(151,201,62,0) }
      100%{ box-shadow:0 0 0 0 rgba(151,201,62,0) }
    }
    .ferbot-fab:active{ cursor:grabbing; }

    .ferbot-panel{
      position:fixed; right:20px; bottom:86px; z-index:999999;
      width:min(420px,92vw);
      background:${PANEL_BG}; color:#e2e8f0;
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
    .ferbot-body{ padding:10px 10px 72px; overflow:auto; }
    .ferbot-label{ font-size:11px; color:#94a3b8; margin:4px 0 4px; }

    /* Áreas de texto opacas (no tocar fondo) */
    .ferbot-input, .ferbot-output{
      width:100%; min-height:92px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
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

    .ferbot-count{
      font-size:11px; color:#cbd5e1; opacity:.85; margin:6px 0 0;
    }
    .ferbot-dots::after{
      display:inline-block; width:1.2em; text-align:left; content:"";
      animation: ferbot-dots 1.2s infinite steps(4);
    }
    @keyframes ferbot-dots{
      0%{ content:"" } 25%{ content:"." } 50%{ content:".." } 75%{ content:"..." }
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
    const savedName = (localStorage.getItem("ferbot_name") || "").replace(/"/g,"&quot;");
    panel.innerHTML = `
      <div class="ferbot-header" id="ferbot-drag-bar">
        <div class="ferbot-title">FerBot</div>
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

        <label class="ferbot-label" style="margin-top:6px;">Contexto (opcional — metas, dudas, profesión, mensajes previos)</label>
        <textarea id="ferbot-context" class="ferbot-input" placeholder="Ej. Quiere trabajar remoto, 56 años, está en SENA y busca ruta de bases de datos."></textarea>

        <div class="ferbot-label">Selecciona texto del chat (doble clic o arrastre) o escribe una frase, luego <b>Generar</b>.</div>
        <textarea id="ferbot-input" class="ferbot-input" placeholder="Texto/objeción del cliente..."></textarea>

        <div class="ferbot-count" id="ferbot-count" style="display:none">Generando<span class="ferbot-dots"></span> <span id="ferbot-secs">0</span>s</div>

        <label class="ferbot-label" style="margin-top:6px;">Por qué + siguiente paso (para ti)</label>
        <textarea id="ferbot-guide" class="ferbot-output" placeholder="Aquí verás la explicación pedagógica (por qué proponemos esto y cuál es el siguiente paso)."></textarea>

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
    const input   = document.getElementById("ferbot-input");
    const output  = document.getElementById("ferbot-output");
    const guide   = document.getElementById("ferbot-guide");
    const nameEl  = document.getElementById("ferbot-name");
    const stageEl = document.getElementById("ferbot-stage");
    const ctxEl   = document.getElementById("ferbot-context");
    const countEl = document.getElementById("ferbot-count");
    const secsEl  = document.getElementById("ferbot-secs");

    // CAPTURA SELECCIÓN → input
    function captureSelectionIntoInput() {
      const sel = window.getSelection()?.toString()?.trim() || "";
      if (sel) input.value = sel;
    }
    captureSelectionIntoInput();
    document.addEventListener("dblclick", captureSelectionIntoInput);
    document.addEventListener("mouseup", () => { setTimeout(captureSelectionIntoInput, 30); });

    // guarda nombre
    nameEl.addEventListener("change", ()=> localStorage.setItem("ferbot_name", nameEl.value.trim()));

    // ======= GENERAR =======
    document.getElementById("ferbot-generate").onclick = async () => {
      const q = (input.value || "").trim() || window.getSelection()?.toString()?.trim() || "";
      if (!q) { alert("Escribe o selecciona el texto del cliente primero."); return; }
      const name  = nameEl.value.trim() || "Cliente";
      const stage = stageEl.value;
      const context = (ctxEl.value || "").trim();

      // Countdown (sin pacman)
      let t0 = Date.now(), timer;
      countEl.style.display = "";
      secsEl.textContent = "0";
      timer = setInterval(()=> { secsEl.textContent = Math.floor((Date.now()-t0)/1000).toString(); }, 250);

      const intent = guessIntent(q);

      const payload = {
        question: q,
        customerName: name,
        stage,
        intent,
        // Pasamos contexto para mejorar explicación
        context
      };

      try{
        // 1) Intento con OpenAI (si está activo en tu backend)
        let res = await fetch(`${BASE}/assist_openai`, {
          method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload)
        });
        if (!res.ok) {
          // 2) Fallback a offline /assist
          res = await fetch(`${BASE}/assist`, {
            method:"POST", headers:{ "Content-Type":"application/json" },
            body: JSON.stringify({ question: q, customerName: name, stage })
          });
        }
        const json = await res.json();

        // GUIDE (arriba) y REPLY (abajo) — priorizamos explicación
        // Usamos result.guide si existe; si no, reconstruimos algo útil
        const rawGuide = json?.result?.guide
              || buildFallbackGuide(intent, context)
              || "";

        let rawReply = json?.result?.sections?.[stage]
                || json?.result?.reply
                || json?.text
                || "";

        const cleanGuide = tidy(normalizeSpace(rawGuide));
        const cleanReply = tidy(postProcessReply(rawReply, name));

        guide.value  = cleanGuide;
        output.value = cleanReply;

      }catch(e){
        alert("No se pudo generar. Revisa que el servidor esté arriba.");
      }finally{
        clearInterval(timer); countEl.style.display = "none";
      }
    };

    // ======= CLEAR =======
    document.getElementById("ferbot-clear").onclick = () => {
      guide.value = "";
      output.value = "";
      // input/context NO se borran
    };

    // ======= RATING =======
    async function sendRating(rating){
      const utter = (output.value || "").trim(); if(!utter) return;
      try{
        await fetch(`${BASE}/trackRate`, {
          method:"POST", headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ intent: guessIntent(input.value), stage: stageEl.value, text: utter, rating })
        });
      }catch{}
    }
    document.getElementById("ferbot-rate-good").onclick    = ()=> sendRating("good");
    document.getElementById("ferbot-rate-regular").onclick = ()=> sendRating("regular");
    document.getElementById("ferbot-rate-bad").onclick     = ()=> sendRating("bad");
  }

  // ====== LIMPIEZA TEXTO ======
  function normalizeSpace(s){ return (s||"").replace(/\s{2,}/g," ").trim(); }
  function tidy(s){
    if(!s) return s;
    s = s.replace(/\s*:\s*/g, ": ");
    s = s.replace(/\s*,\s*/g, ", ");
    s = s.replace(/\s*\.\s*\.\s*/g, ". ");
    s = s.replace(/\.\.+/g, ".");
    s = s.replace(/\s{2,}/g, " ");
    return s.trim();
  }
  function postProcessReply(raw, name){
    let t = raw || "";
    t = t.replace(/[🔵🟢🟣🔴◆◇▪︎•●◦■□▶️►]/g, "").replace(/\s{2,}/g, " ");
    // Evitar duplicados de oración
    const parts = t.split(/(?<=[.!?])\s+|\n+/).map(x=>x.trim()).filter(Boolean);
    const seen = new Set(); const out=[];
    for(const p of parts){ const key = p.toLowerCase(); if(!seen.has(key)){ seen.add(key); out.push(p); } }
    t = out.join(" ");
    // Asegurar saludo limpio
    const hi = name ? `Hola ${name}, ` : "Hola, ";
    if (!/^hola\b/i.test(t.trim())) t = hi + t.trim();
    else t = t.replace(/^hola[^,]*,\s*/i, hi);
    return t;
  }

  // ====== INTENT HEURÍSTICA ======
  function guessIntent(q=""){
    const s = (q||"").toLowerCase();
    if (/(tiempo|no tengo tiempo|poco tiempo|agenda|horario|no alcanzo|no me da el tiempo)/i.test(s)) return "tiempo";
    if (/(precio|caro|costo|costoso|muy caro|vale|promoci|oferta|descuento|black friday)/i.test(s)) return "precio";
    if (/(cert|certificado|certificación|certificaciones)/i.test(s)) return "cert";
    if (/(coursera|udemy|alura|competenc)/i.test(s)) return "competencia";
    if (/(ruta|camino|itinerario|plan de estudio)/i.test(s)) return "ruta";
    return "_default";
  }

  // ====== Fallback de guía si el backend no envía una explicación ======
  function buildFallbackGuide(intent, context){
    const base = [
      "• Empatiza con la meta real del cliente.",
      "• Conecta la propuesta con su resultado deseado.",
      "• Cierra con un siguiente paso concreto (CTA)."
    ];
    const map = {
      tiempo: [
        "• Reafirma que puede avanzar con 5–10 minutos/día.",
        "• Propón una micro-agenda y primer hito en 7–14 días."
      ],
      precio: [
        "• Reenfoca a inversión y resultado, no costo.",
        "• Ofrece comparar plan según objetivo de carrera."
      ],
      cert: [
        "• Menciona certificaciones digitales verificables y físicas en rutas.",
        "• Enlaza la certificación con su meta laboral."
      ],
      competencia: [
        "• Diferencia por comunidad, rutas guiadas y certificaciones verificables.",
        "• Propón probar 1–2 clases para medir avance real."
      ],
      ruta: [
        "• Propón 1 ruta principal y 1 apoyo, no catálogos largos.",
        "• Explica el primer módulo y el hito de 2 semanas."
      ],
      _default: []
    };
    const ctx = context ? `• Contexto: ${context}` : null;
    return ["Guía para el asesor:", ctx, ...base, ...(map[intent]||[])].filter(Boolean).join(" ");
  }
})();
