// FerBot UI mínima — FAB llamativo + Countdown + (Nombre, Contexto, POR QUÉ, Respuesta) + Rating
(() => {
  // ========= CONFIG =========
  const BASE = localStorage.getItem("ferbot_api_base") || "https://ferbot-api.onrender.com";
  const PLATZI_GREEN = "#97C93E";
  const DARK = "#0b0f19";
  const PANEL_BG = "#0b0f19CC";
  const GRAY = "#cbd5e1";

  // Evitar doble inyección
  if (document.getElementById("ferbot-fab") || document.getElementById("ferbot-styles")) return;

  // ========= ESTILOS =========
  const style = document.createElement("style");
  style.id = "ferbot-styles";
  style.textContent = `
  .ferbot-fab{
    position:fixed; right:20px; bottom:20px; z-index:999999;
    width:58px; height:58px; border-radius:999px; background:${PLATZI_GREEN};
    display:flex; align-items:center; justify-content:center; border:0; cursor:pointer;
    box-shadow:0 12px 28px rgba(0,0,0,.35);
    font-size:22px; color:#0b0f19; font-weight:900;
    animation: ferbotPulse 1.6s ease-in-out infinite;
  }
  @keyframes ferbotPulse{
    0%{ transform: scale(1); box-shadow:0 12px 28px rgba(0,0,0,.35); }
    50%{ transform: scale(1.07); box-shadow:0 16px 36px rgba(0,0,0,.42); }
    100%{ transform: scale(1); box-shadow:0 12px 28px rgba(0,0,0,.35); }
  }
  .ferbot-panel{
    position:fixed; right:20px; bottom:86px; z-index:999999;
    width:min(420px,92vw);
    background:${PANEL_BG}; color:#e2e8f0; border-radius:16px;
    box-shadow:0 18px 40px rgba(0,0,0,.35); border:1px solid rgba(255,255,255,.10);
    overflow:hidden; backdrop-filter: blur(6px);
  }
  .ferbot-header{
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    padding:10px 12px; background:rgba(255,255,255,.04); border-bottom:1px solid rgba(255,255,255,.08);
    user-select:none; cursor:move;
  }
  .ferbot-title{ font-weight:800; letter-spacing:.3px; font-size:13px; }
  .ferbot-badge{ font-size:11px; color:#94a3b8; background:#0f1524; border:1px solid rgba(255,255,255,.12); padding:2px 6px; border-radius:999px;}
  .ferbot-body{ padding:12px; display:flex; flex-direction:column; gap:10px; }

  .ferbot-label{ font-size:12px; color:#9fb2c8; }
  .ferbot-input, .ferbot-output{
    width:100%; min-height:90px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
    background:#0f1524; color:#dbeafe; outline:none; padding:9px 10px; resize:vertical;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto; font-size:13px;
  }
  .ferbot-name, .ferbot-context{
    width:100%; border-radius:10px; border:1px solid rgba(255,255,255,.12);
    background:#0f1524; color:#dbeafe; outline:none; padding:9px 10px; font-size:13px;
  }

  .ferbot-footer{
    display:flex; gap:8px; padding:10px 12px; background:rgba(255,255,255,.04);
    border-top:1px solid rgba(255,255,255,.08);
  }
  .ferbot-btn{ flex:1; padding:10px 10px; border-radius:10px; border:0; cursor:pointer; font-weight:800; font-size:13px; }
  .ferbot-primary{ background:${PLATZI_GREEN}; color:#0b0f19; }
  .ferbot-ghost{ background:#1b2333; color:#cbd5e1; }
  .ferbot-good{ background:#19c37d; color:#062d1f; }
  .ferbot-regular{ background:#fbbf24; color:#332200; }
  .ferbot-bad{ background:#ef4444; color:#fff; }

  .ferbot-row{ display:flex; flex-direction:column; gap:6px; }

  .ferbot-countdown{
    font-size:12px; color:#a5b4fc; padding:2px 8px; border-radius:999px; border:1px solid rgba(165,180,252,.25);
    align-self:flex-start; background:rgba(49,46,129,.3); display:none;
  }
  `;
  document.head.appendChild(style);

  // ========= FAB =========
  const fab = document.createElement("button");
  fab.id = "ferbot-fab";
  fab.className = "ferbot-fab";
  fab.title = "Abrir FerBot";
  fab.textContent = "🤖";
  document.body.appendChild(fab);

  // ========= Panel =========
  let panel;
  fab.addEventListener("click", () => {
    if (panel && panel.isConnected) { panel.remove(); return; }
    openPanel();
  });

  function openPanel(){
    panel = document.createElement("div");
    panel.className = "ferbot-panel";
    panel.innerHTML = `
      <div class="ferbot-header" id="ferbot-drag">
        <div class="ferbot-title">FerBot</div>
        <div class="ferbot-badge">API: ${new URL(BASE).host}</div>
      </div>
      <div class="ferbot-body">
        <div class="ferbot-row">
          <label class="ferbot-label">Nombre del cliente</label>
          <input id="ferbot-name" class="ferbot-name" placeholder="Ej. Ferney" value="${(localStorage.getItem("ferbot_name")||"").replace(/"/g,"&quot;")}">
        </div>

        <div class="ferbot-row">
          <label class="ferbot-label">Contexto (opcional)</label>
          <input id="ferbot-context" class="ferbot-context" placeholder="Notas breves que ayuden al bot…">
        </div>

        <span id="ferbot-countdown" class="ferbot-countdown">Generando… 10s</span>

        <div class="ferbot-row">
          <label class="ferbot-label">Explicación (POR QUÉ)</label>
          <textarea id="ferbot-why" class="ferbot-output" placeholder="Aquí verás el POR QUÉ de la respuesta."></textarea>
        </div>

        <div class="ferbot-row">
          <label class="ferbot-label">Respuesta (lista para pegar)</label>
          <textarea id="ferbot-reply" class="ferbot-output" placeholder="Aquí verás la respuesta."></textarea>
        </div>
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

    // Drag Panel
    const drag = document.getElementById("ferbot-drag");
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
    const nameEl   = document.getElementById("ferbot-name");
    const ctxEl    = document.getElementById("ferbot-context");
    const whyEl    = document.getElementById("ferbot-why");
    const replyEl  = document.getElementById("ferbot-reply");
    const countdownEl = document.getElementById("ferbot-countdown");

    // Persistir nombre
    nameEl.addEventListener("change", ()=> localStorage.setItem("ferbot_name", nameEl.value.trim()));

    // Generar
    document.getElementById("ferbot-generate").onclick = async () => {
      // Tomar selección del chat
      const q = window.getSelection()?.toString()?.trim() || "";
      if (!q) { alert("Selecciona texto del chat (la pregunta/objeción del cliente) y vuelve a presionar Generar."); return; }

      const name = nameEl.value.trim() || "Cliente";
      const context = ctxEl.value.trim();

      // Countdown (10 → 0)
      let t = 10; countdownEl.textContent = `Generando… ${t}s`; countdownEl.style.display="inline-block";
      const timer = setInterval(()=>{ t--; if (t>=0) countdownEl.textContent = `Generando… ${t}s`; if (t<=0) clearInterval(timer); }, 1000);

      try{
        const body = { question:q, user_id:"ferney", customerName:name, stage:"rebatir", context };
        const res = await fetch(`${BASE}/assist_openai`, {
          method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)
        });
        const json = await res.json();

        const rawGuide = json?.result?.guide || json?.result?.message || json?.text || "";
        const rawReply = json?.result?.reply || json?.text || "";

        whyEl.value   = cleanGuide(rawGuide);
        replyEl.value = postProcess(rawReply, name);

      }catch(e){
        alert("No se pudo generar. Verifica que el servidor esté arriba.");
      }finally{
        countdownEl.style.display="none";
        clearInterval(timer);
      }
    };

    // Clear
    document.getElementById("ferbot-clear").onclick = () => {
      whyEl.value = "";
      replyEl.value = "";
    };

    // Rating
    async function sendRating(rating){
      const utter = (replyEl.value || "").trim(); if(!utter) return;
      try{
        await fetch(`${BASE}/trackRate`, {
          method:"POST", headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ intent:"_default", stage:"rebatir", text: utter, rating })
        });
      }catch(_e){}
    }
    document.getElementById("ferbot-rate-good").onclick    = ()=> sendRating("good");
    document.getElementById("ferbot-rate-regular").onclick = ()=> sendRating("regular");
    document.getElementById("ferbot-rate-bad").onclick     = ()=> sendRating("bad");
  }

  // ========= Helpers de limpieza =========
  function cleanGuide(s){
    s = (s||"").replace(/^\s*[•\-·]\s*/gm, "");
    s = s.replace(/\n+/g, " ");
    s = s.replace(/\s{2,}/g, " ").trim();
    // si el modelo devuelve la guía “→ Cierra …” como a veces, la dejamos tal cual
    return s;
  }
  function postProcess(raw, name){
    let t = raw || "";
    t = t.replace(/[🔵🟢🟣🔴◆◇▪︎•●◦■□▶️►]/g, "");
    t = t.replace(/\s{2,}/g, " ").trim();
    // Asegurar saludo limpio si vino doble
    if (/^hola\b/i.test(t)) t = t.replace(/^hola[^,]*,\s*/i, `Hola ${name}, `);
    return t;
  }
})();
