// extension/contentScript.js
(() => {
  // ========== CONFIG ==========
  const BASE = localStorage.getItem("ferbot_api_base") || "https://ferbot-api.onrender.com";
  const PLATZI_GREEN = "#97C93E";
  const DARK = "#0b0f19";
  const PANEL_BG = "rgba(11,15,25,0.92)";
  const GRAY = "#cbd5e1";

  if (document.getElementById("ferbot-fab") || document.getElementById("ferbot-styles")) return;

  // ========== STYLES ==========
  const style = document.createElement("style");
  style.id = "ferbot-styles";
  style.textContent = `
  @keyframes fbBlink { 0%{transform:scale(1)} 70%{transform:scale(1.06)} 100%{transform:scale(1)} }
  .ferbot-fab{
    position: fixed; right: 20px; bottom: 20px; z-index: 999999;
    width: 58px; height:58px; border-radius: 9999px; background: ${PLATZI_GREEN};
    display:flex; align-items:center; justify-content:center; cursor:pointer; user-select:none;
    box-shadow: 8px 28px 70px rgba(0,0,0,.35);
    font-size: 24px; color:#0b0f19; animation: fbBlink 1.8s infinite ease-out;
  }
  .ferbot-panel{
    position: fixed; right: 20px; bottom:86px; z-index:999999;
    width: min(480px, calc(100vw - 36px));
    background: ${PANEL_BG}; color: ${GRAY};
    border-radius:16px; box-shadow: 18px 40px 80px rgba(0,0,0,.36);
    border: 1px solid rgba(255,255,255,.06); backdrop-filter: blur(6px);
    max-height: 78vh; overflow: hidden; display: none;
  }
  .ferbot-header{
    display:flex; align-items:center; gap:10px; padding:14px 16px; background:rgba(255,255,255,0.03);
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .ferbot-title{ font-weight:700; color:#fff; }
  .ferbot-body{ padding: 14px 16px; overflow: auto; max-height: calc(78vh - 56px); }
  .ferbot-label{ font-size:12px; color:#93a2b6; margin:8px 0 6px; }
  .ferbot-input, .ferbot-textarea, .ferbot-select{
    width:100%; background:#0f1629; border:1px solid #243149; color:#dbe7ff; border-radius:10px;
    padding:12px 12px; outline:none; font-size:14px;
  }
  .ferbot-textarea{ min-height:70px; resize: vertical; }
  .ferbot-row{ display:flex; gap:10px; align-items:center; }
  .ferbot-actions{ display:flex; gap:12px; align-items:center; justify-content:flex-start; margin-top:10px; }
  .ferbot-btn{
    padding:12px 16px; border-radius:12px; border:none; cursor:pointer; font-weight:700;
  }
  .ferbot-btn-primary{ background:${PLATZI_GREEN}; color:#111; }
  .ferbot-btn-dark{ background:#10192b; color:#dbe7ff; border:1px solid #22304c; }
  .ferbot-chip{ display:inline-flex; align-items:center; gap:8px; border:1px solid #22304c; padding:4px 8px; border-radius:999px; }
  .ferbot-rating{ display:none; gap:10px; margin-top:8px; }
  .ferbot-badge{ display:none; }
  .ferbot-hint{ font-size:12px; color:#8aa0bd; }
  .ferbot-sent{ font-size:12px; padding:6px 10px; border-radius:10px; background:#10192b; border:1px solid #22304c; color:#9ec1ff;}
  .ferbot-count{ margin-left:auto; font-size:12px; color:#9ec1ff; }
  `;
  document.head.appendChild(style);

  // ========== FAB ==========
  const fab = document.createElement("div");
  fab.id = "ferbot-fab";
  fab.className = "ferbot-fab";
  fab.title = "FerBot";
  fab.textContent = "🤖";
  document.body.appendChild(fab);

  // ========== PANEL ==========
  const panel = document.createElement("div");
  panel.className = "ferbot-panel";
  panel.innerHTML = `
    <div class="ferbot-header">
      <div class="ferbot-title">FerBot</div>
      <span class="ferbot-count" id="fb-count"></span>
    </div>
    <div class="ferbot-body">
      <div class="ferbot-label">Nombre del cliente</div>
      <input id="fb-name" class="ferbot-input" placeholder="Ej. Laura" />

      <div class="ferbot-label">Etapa</div>
      <select id="fb-stage" class="ferbot-select">
        <option>Integración</option>
        <option>Sondeo</option>
        <option>Rebatir</option>
        <option>Cierre</option>
        <option>Integración</option>
      </select>

      <div class="ferbot-label">Contexto (opcional, para el bot)</div>
      <textarea id="fb-context" class="ferbot-textarea" placeholder="Notas breves: certificaciones, poco tiempo, habló de inglés..."></textarea>

      <div class="ferbot-row" style="align-items:center; gap:12px; margin-top:6px;">
        <div class="ferbot-label" style="margin:0;">Selecciona texto del chat o escribe una objeción, luego Generar.</div>
        <span class="ferbot-sent" id="fb-sentiment">Sentimiento: —</span>
      </div>
      <textarea id="fb-text" class="ferbot-textarea" placeholder="Pega/selecciona lo que dijo el cliente"></textarea>

      <div class="ferbot-label">Explicación (POR QUÉ + SIGUIENTE PASO)</div>
      <textarea id="fb-explain" class="ferbot-textarea" placeholder="Aquí el bot te enseña..." readonly></textarea>

      <div class="ferbot-label">Respuesta (lista para pegar)</div>
      <textarea id="fb-reply" class="ferbot-textarea" placeholder="Se generará aquí..." ></textarea>

      <div class="ferbot-actions">
        <button id="fb-gen"   class="ferbot-btn ferbot-btn-primary">Generar</button>
        <button id="fb-clear" class="ferbot-btn ferbot-btn-dark">Clear</button>
        <div class="ferbot-chip" id="fb-rating">
          <span>¿Te gustó esta respuesta?</span>
          <button class="ferbot-btn ferbot-btn-primary" data-rate="good">👍 Buena</button>
          <button class="ferbot-btn ferbot-btn-dark" data-rate="ok">🙂 Regular</button>
          <button class="ferbot-btn ferbot-btn-dark" data-rate="bad">👎 Mala</button>
        </div>
      </div>

      <div class="ferbot-hint" style="margin-top:8px;">Tip: haz doble clic en un mensaje del chat para copiarlo acá.</div>
    </div>
  `;
  document.body.appendChild(panel);

  // ========== estado ==========
  let open = false;
  let countdownTimer = null;

  function togglePanel(show){
    open = (show===undefined) ? !open : !!show;
    panel.style.display = open ? "block" : "none";
  }

  fab.addEventListener("click", ()=> togglePanel());

  // Doble clic en la página para llevar texto al área
  document.addEventListener("dblclick", (e)=>{
    const sel = window.getSelection()?.toString()?.trim();
    if(sel){
      document.getElementById("fb-text").value = sel;
      analyzeNow(sel);
    }
  });

  // Sentimiento local inmediato
  async function analyzeNow(text){
    try{
      const r = await fetch(`${BASE}/analyze`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({text})
      });
      const j = await r.json();
      const s = j?.sentiment || "—";
      document.getElementById("fb-sentiment").textContent = `Sentimiento: ${s}`;
    }catch{ /* silencioso */ }
  }

  // Generar
  document.getElementById("fb-gen").addEventListener("click", async ()=>{
    const name = document.getElementById("fb-name").value.trim() || "Cliente";
    const stage = document.getElementById("fb-stage").value || "Integración";
    const context = document.getElementById("fb-context").value.trim();
    const text = document.getElementById("fb-text").value.trim();

    if (!text){
      alert("Pega o escribe el mensaje del cliente.");
      return;
    }

    // countdown simple
    const lbl = document.getElementById("fb-count");
    let s = 7;
    lbl.textContent = `generando… ${s}s`;
    clearInterval(countdownTimer);
    countdownTimer = setInterval(()=>{
      s--; lbl.textContent = s>0 ? `generando… ${s}s` : "";
      if (s<=0) clearInterval(countdownTimer);
    }, 1000);

    try{
      const r = await fetch(`${BASE}/assist_openai`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({customerName:name, stage, context, text})
      });
      const j = await r.json();
      clearInterval(countdownTimer);
      lbl.textContent = "";

      if(!j.ok) throw new Error(j.error||"No se pudo generar. ¿API vigente?");

      // pintar
      document.getElementById("fb-explain").value = j.explanation || "";
      document.getElementById("fb-reply").value = j.reply || "";
      document.getElementById("fb-sentiment").textContent = `Sentimiento: ${j.sentiment||"—"}`;

      // mostrar rating (una sola vez por generación)
      const rate = document.getElementById("fb-rating");
      rate.style.display = "inline-flex";
      Array.from(rate.querySelectorAll("button[data-rate]")).forEach(b=>{
        b.disabled = false;
        b.onclick = async ()=>{
          try{
            await fetch(`${BASE}/trackRate`,{
              method:"POST",
              headers:{"Content-Type":"application/json"},
              body: JSON.stringify({rating: b.getAttribute("data-rate")})
            });
          }catch{}
          // ocultar tras votar
          rate.style.display = "none";
        };
      });

    }catch(err){
      clearInterval(countdownTimer);
      document.getElementById("fb-explain").value = "";
      document.getElementById("fb-reply").value = `No se pudo generar. ¿API vigente?\n${String(err.message||err)}`;
    }
  });

  // Clear
  document.getElementById("fb-clear").addEventListener("click", ()=>{
    ["fb-context","fb-text","fb-explain","fb-reply"].forEach(id=> document.getElementById(id).value = "");
    document.getElementById("fb-sentiment").textContent = "Sentimiento: —";
    document.getElementById("fb-rating").style.display = "none";
  });

})();
