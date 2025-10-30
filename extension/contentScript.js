// FerBot content script — usa /assist_trainer; WHY/NEXT visibles; countdown; rating 1 sola vez
(function () {
  // ====== CONFIG ======
  const BASE =
    (typeof window !== "undefined" && window.FERBOT_API_BASE) ||
    localStorage.getItem("ferbot_api_base") ||
    "https://ferbot-api.onrender.com";

  const PLATZI_GREEN = "#97C93E";
  const DARK = "#0b0f19";

  // ====== GUARD ======
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
    animation: ferbot-pulse 1.8s infinite ease-in-out;
  }
  @keyframes ferbot-pulse{
    0%{ transform:scale(1); box-shadow:0 0 0 0 rgba(151,201,62,.6); }
    70%{ transform:scale(1.08); box-shadow:0 0 0 14px rgba(151,201,62,0); }
    100%{ transform:scale(1); box-shadow:0 0 0 0 rgba(151,201,62,0); }
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
  .ferbot-title{ font-weight:800; letter-spacing:.3px; font-size:13px; display:flex; align-items:center; gap:8px; }
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
    border-top:1px solid rgba(255,255,255,.08); flex-wrap:wrap;
  }
  .ferbot-btn{ flex:1; padding:7px 8px; border-radius:9px; border:0; cursor:pointer; font-weight:800; font-size:12px; }
  .ferbot-primary{ background:${PLATZI_GREEN}; color:#0b0f19; }
  .ferbot-ghost{ background:#1b2333; color:#cbd5e1; }
  .pill{
    display:none; align-items:center; gap:8px; padding:6px 10px; border-radius:999px;
    background:#1b2333; color:#cbd5e1; font-size:12px; border:1px solid rgba(255,255,255,.08)
  }
  .dot{width:8px;height:8px;border-radius:999px;background:#ef4444;box-shadow:0 0 10px #ef4444}
  .dot.warn{background:#fbbf24;box-shadow:0 0 10px #fbbf24}
  .dot.ok{background:#19c37d;box-shadow:0 0 10px #19c37d}
  .rate{display:none;gap:6px}
  .rate.show{display:flex}
  `;
  document.documentElement.appendChild(style);

  // ====== FAB ======
  const fab = document.createElement("button");
  fab.id = "ferbot-fab";
  fab.className = "ferbot-fab";
  fab.title = "Abrir FerBot";
  fab.textContent = "🤖";
  document.documentElement.appendChild(fab);

  // drag FAB
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
        <div class="ferbot-title">FerBot <span id="pulse" class="pill"><span id="dot" class="dot"></span><span id="tlabel">Generando… 0.0s</span></span></div>
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
        <input id="ferbot-context" class="ferbot-context" placeholder="Ej. ya preguntó por certificaciones; poco tiempo al día">

        <div class="ferbot-label" style="margin-top:6px;">Selecciona texto del chat o escribe una objeción, luego <b>Generar</b>.</div>
        <textarea id="ferbot-input" class="ferbot-input" placeholder="Texto/objeción del cliente..."></textarea>

        <label class="ferbot-label" style="margin-top:6px;">POR QUÉ</label>
        <textarea id="ferbot-why" class="ferbot-output" placeholder="Motivo de la respuesta (del Trainer)." readonly></textarea>

        <label class="ferbot-label" style="margin-top:6px;">SIGUIENTE PASO</label>
        <textarea id="ferbot-next" class="ferbot-output" placeholder="Siguiente paso para el asesor." readonly></textarea>

        <label class="ferbot-label" style="margin-top:6px;">Respuesta (lista para pegar)</label>
        <textarea id="ferbot-output" class="ferbot-output" placeholder="Mensaje final para WhatsApp." readonly></textarea>
        <div id="ferbot-rate" class="rate" style="margin-top:8px">
          <button id="ferbot-rate-good" class="ferbot-btn ferbot-primary">👍 Buena</button>
          <button id="ferbot-rate-regular" class="ferbot-btn ferbot-ghost">😐 Regular</button>
          <button id="ferbot-rate-bad" class="ferbot-btn ferbot-ghost" style="background:#2a1c1c;color:#fff">👎 Mala</button>
        </div>
      </div>
      <div class="ferbot-footer">
        <button id="ferbot-generate" class="ferbot-btn ferbot-primary">Generar</button>
        <button id="ferbot-clear" class="ferbot-btn ferbot-ghost">Clear</button>
      </div>
    `;

    // drag
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

    // refs
    const input   = p.querySelector("#ferbot-input");
    const output  = p.querySelector("#ferbot-output");
    const whyEl   = p.querySelector("#ferbot-why");
    const nextEl  = p.querySelector("#ferbot-next");
    const nameEl  = p.querySelector("#ferbot-name");
    const stageEl = p.querySelector("#ferbot-stage");
    const ctxEl   = p.querySelector("#ferbot-context");

    const rateBox = p.querySelector("#ferbot-rate");
    const rGood   = p.querySelector("#ferbot-rate-good");
    const rReg    = p.querySelector("#ferbot-rate-regular");
    const rBad    = p.querySelector("#ferbot-rate-bad");

    const pulse = p.querySelector("#pulse");
    const dot   = p.querySelector("#dot");
    const tlabel= p.querySelector("#tlabel");
    let t0=0, tick=null;

    function startPulse(){
      t0=performance.now();
      pulse.style.display='inline-flex';
      dot.className='dot';
      tlabel.textContent='Generando… 0.0s';
      if (tick) clearInterval(tick);
      tick=setInterval(()=>{
        const dt=(performance.now()-t0)/1000;
        tlabel.textContent=`Generando… ${dt.toFixed(1)}s`;
        if (dt<2){ dot.className='dot'; }
        else if (dt<5){ dot.className='dot warn'; }
        else { dot.className='dot ok'; }
      },100);
    }
    function stopPulse(){
      if (tick) { clearInterval(tick); tick=null; }
      const dt=(performance.now()-t0)/1000;
      dot.className='dot ok';
      tlabel.textContent=`Listo en ${dt.toFixed(1)}s`;
      setTimeout(()=>{ pulse.style.display='none'; }, 1200);
    }

    function captureSelectionIntoInput(){
      try{
        const sel = window.getSelection()?.toString()?.trim() || "";
        if (sel) input.value = sel;
      }catch(_){}
    }
    captureSelectionIntoInput();
    document.addEventListener("dblclick", captureSelectionIntoInput);
    document.addEventListener("mouseup", () => { setTimeout(captureSelectionIntoInput, 30); });

    nameEl.addEventListener("change", ()=> localStorage.setItem("ferbot_name", nameEl.value.trim()));

    function guessIntent(s=''){
      s = (s||'').toLowerCase();
      if (/(tiempo|no tengo tiempo|poco tiempo|agenda|horario|no alcanzo)/.test(s)) return 'tiempo';
      if (/(precio|caro|costo|vale|promoci|oferta|descuento)/.test(s)) return 'precio';
      if (/(cert|certificado|certificacion|certificación)/.test(s)) return 'cert';
      if (/(coursera|udemy|alura|competenc)/.test(s)) return 'competencia';
      if (/(pitch|qué es platzi|que es platzi|platzi)/.test(s)) return 'pitch';
      return '_default';
    }

    function showRatingOnce(){
      rateBox.classList.add('show');
      const disableAll=()=>{
        rateBox.classList.remove('show');
        rGood.disabled=rReg.disabled=rBad.disabled=true;
        setTimeout(()=>{ rGood.disabled=rReg.disabled=rBad.disabled=false; }, 600);
      };
      rGood.onclick = ()=> { sendRate('good'); disableAll(); };
      rReg.onclick  = ()=> { sendRate('regular'); disableAll(); };
      rBad.onclick  = ()=> { sendRate('bad'); disableAll(); };
    }

    async function sendRate(rating){
      const intent = guessIntent(input.value||'');
      const stage  = stageEl.value;
      const text   = (output.value||'').trim();
      if (!text) return;
      try{
        await fetch(`${BASE}/trackRate`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ intent, stage, text, rating })
        });
      }catch(_){}
    }

    p.querySelector("#ferbot-generate").onclick = async ()=>{
      const q = (input.value || "").trim() || window.getSelection()?.toString()?.trim() || "";
      if (!q){ alert("Escribe la objeción/pregunta primero."); return; }

      whyEl.value = ""; nextEl.value=""; output.value="";
      showRatingOnce();
      startPulse();

      const body = {
        question: q,
        customerName: (nameEl.value||'').trim() || 'Cliente',
        stage: stageEl.value,
        context: (ctxEl.value||'').trim()
      };

      try{
        const res = await fetch(`${BASE}/assist_trainer`, {
          method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body)
        });
        const json = await res.json().catch(()=> ({}));
        stopPulse();

        const why  = (json?.result?.why  || json?.result?.guide || '').toString().trim();
        const next = (json?.result?.next || '').toString().trim();
        const rep  = (json?.result?.reply|| json?.text || '').toString().trim();

        whyEl.value  = why || "-";
        nextEl.value = next || "-";
        output.value = rep  || "-";
      }catch(e){
        stopPulse();
        alert("No se pudo generar. Revisa que el servidor esté arriba.");
      }
    };

    p.querySelector("#ferbot-clear").onclick = ()=>{
      whyEl.value = nextEl.value = output.value = "";
    };

    return p;
  }
})();

