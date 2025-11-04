// FerBot content script — FIX etapas + intent + countdown + ratings 1-vez
(() => {
  const BASE = "https://ferbot-api.onrender.com"; // Render fijo

  // Guard doble inyección
  if (document.getElementById("ferbot-fab") || document.getElementById("ferbot-styles")) return;

  // ===== Estilos =====
  const css = `
  .ferbot-fab{position:fixed;right:20px;bottom:20px;z-index:2147483647;width:56px;height:56px;border-radius:999px;background:#97C93E;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 28px rgba(0,0,0,.35);cursor:grab;color:#0b0f19;font-size:24px;border:0;animation:ferbot-pulse 2s infinite}
  @keyframes ferbot-pulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}
  .ferbot-panel{position:fixed;right:20px;bottom:86px;z-index:2147483647;width:min(420px,92vw);background:#0b0f19E6;color:#e2e8f0;border-radius:16px;box-shadow:0 18px 40px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.10);display:flex;flex-direction:column;max-height:78vh;overflow:hidden;backdrop-filter:blur(6px)}
  .ferbot-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.08);user-select:none;cursor:move}
  .ferbot-title{font-weight:800;letter-spacing:.3px;font-size:13px;display:flex;align-items:center;gap:6px}
  .ferbot-signal{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#94a3b8;background:#121a2b;border:1px solid rgba(255,255,255,.10);border-radius:999px;padding:4px 8px}
  .ferbot-bullet{width:8px;height:8px;border-radius:12px;background:#ef4444}
  .ferbot-bullet.a{background:#f59e0b}
  .ferbot-bullet.v{background:#22c55e}
  .ferbot-body{padding:10px 10px 78px;overflow:auto}
  .ferbot-label{font-size:11px;color:#94a3b8;margin:6px 0 4px}
  .ferbot-row{display:flex;align-items:center;gap:8px}
  .ferbot-input,.ferbot-output{width:100%;min-height:90px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#0f1524;color:#dbeafe;outline:none;padding:8px 9px;resize:vertical;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto;font-size:13px}
  .ferbot-select,.ferbot-name,.ferbot-context{width:100%;padding:7px 9px;border-radius:9px;background:#0f1524;color:#dbeafe;border:1px solid rgba(255,255,255,.12);font-size:13px}
  .ferbot-badge{font-size:11px;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.10);background:#101727;color:#cbd5e1;display:inline-flex;align-items:center;gap:6px}
  .ferbot-badge .dot{width:7px;height:7px;border-radius:999px;background:#64748b}
  .ferbot-badge.pos .dot{background:#22c55e}.ferbot-badge.neu .dot{background:#f59e0b}.ferbot-badge.neg .dot{background:#ef4444}
  .ferbot-footer{position:absolute;left:0;right:0;bottom:0;display:flex;gap:6px;padding:8px 10px;background:rgba(255,255,255,.04);border-top:1px solid rgba(255,255,255,.08);flex-wrap:wrap}
  .ferbot-btn{flex:1;padding:7px 8px;border-radius:9px;border:0;cursor:pointer;font-weight:800;font-size:12px}
  .ferbot-primary{background:#97C93E;color:#0b0f19}.ferbot-ghost{background:#1b2333;color:#cbd5e1}
  .ferbot-good{background:#19c37d;color:#062d1f;display:none}.ferbot-regular{background:#fbbf24;color:#332200;display:none}.ferbot-bad{background:#ef4444;color:#fff;display:none}
  .ferbot-autopaste{display:flex;align-items:center;gap:6px;color:#94a3b8;font-size:12px}
  .ferbot-close{margin-left:6px;border:0;background:transparent;color:#94a3b8;font-weight:700;font-size:14px;cursor:pointer}
  `;
  const st = document.createElement("style"); st.id="ferbot-styles"; st.textContent=css; document.head.appendChild(st);

  // ===== FAB =====
  const fab = document.createElement("button");
  fab.id="ferbot-fab"; fab.className="ferbot-fab"; fab.title="Abrir FerBot"; fab.textContent="🤖";
  document.body.appendChild(fab);

  let dragFab=false, offX=0, offY=0;
  fab.addEventListener("mousedown",(e)=>{dragFab=true;offX=e.clientX-fab.getBoundingClientRect().left;offY=e.clientY-fab.getBoundingClientRect().top});
  window.addEventListener("mousemove",(e)=>{if(!dragFab)return;fab.style.right="auto";fab.style.bottom="auto";fab.style.left=`${e.clientX-offX}px`;fab.style.top=`${e.clientY-offY}px`});
  window.addEventListener("mouseup",()=>dragFab=false);

  // ===== Panel =====
  let panel;
  fab.addEventListener("click",()=>{ if(panel?.isConnected){panel.remove();return;} panel=buildPanel(); document.body.appendChild(panel); });

  function buildPanel(){
    const div=document.createElement("div"); div.className="ferbot-panel";
    const savedName=(localStorage.getItem("ferbot_name")||"").replace(/"/g,"&quot;");
    const savedAuto= localStorage.getItem("ferbot_autopaste")==="1" ? "checked" : "";
    div.innerHTML=`
      <div class="ferbot-header" id="ferbot-drag">
        <div class="ferbot-title">FerBot <span>🤖</span></div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="ferbot-signal"><span class="ferbot-bullet" id="f-b"></span><span id="f-t">0.0s</span></div>
          <button class="ferbot-close" title="Cerrar">✕</button>
        </div>
      </div>
      <div class="ferbot-body">
        <div class="ferbot-row" style="gap:10px">
          <div style="flex:1">
            <label class="ferbot-label">Nombre del cliente</label>
            <input id="f-name" class="ferbot-name" value="${savedName}" placeholder="Ej. Laura">
          </div>
          <div style="width:48%">
            <label class="ferbot-label">Etapa</label>
            <select id="f-stage" class="ferbot-select">
              <option value="integracion">Integración</option>
              <option value="sondeo">Sondeo</option>
              <option value="pre_cierre">Pre-cierre</option>
              <option value="rebatir" selected>Rebatir</option>
              <option value="cierre">Cierre</option>
            </select>
          </div>
        </div>

        <label class="ferbot-label" style="margin-top:6px;">Contexto (opcional, para el bot)</label>
        <input id="f-ctx" class="ferbot-context" placeholder="Ej. certificaciones; poco tiempo; habló de inglés">

        <div class="ferbot-row" style="justify-content:space-between;margin-top:8px">
          <div class="ferbot-label">Selecciona texto del chat o escribe la objeción, luego <b>Generar</b>.</div>
          <label class="ferbot-autopaste"><input id="f-auto" type="checkbox" ${savedAuto}/> Autopaste</label>
        </div>

        <div class="ferbot-row" style="align-items:flex-end">
          <div style="flex:1">
            <textarea id="f-in" class="ferbot-input" placeholder="Texto/objeción del cliente..."></textarea>
          </div>
          <div id="f-sent" class="ferbot-badge neu" title="Análisis de sentimiento"><span class="dot"></span><span id="f-sent-t">Neutral</span></div>
        </div>

        <label class="ferbot-label" style="margin-top:6px;">Explicación (POR QUÉ + SIGUIENTE PASO)</label>
        <textarea id="f-guide" class="ferbot-output" placeholder="Aquí verás POR QUÉ y el SIGUIENTE PASO."></textarea>

        <label class="ferbot-label" style="margin-top:6px;">Respuesta (lista para pegar)</label>
        <textarea id="f-out" class="ferbot-output" placeholder="Mensaje breve para el cliente (≤ 2 frases)."></textarea>
      </div>

      <div class="ferbot-footer">
        <button id="f-gen" class="ferbot-btn ferbot-primary">Generar</button>
        <button id="f-clear" class="ferbot-btn ferbot-ghost">Clear</button>
        <button id="f-good" class="ferbot-btn ferbot-good">👍 Buena</button>
        <button id="f-reg"  class="ferbot-btn ferbot-regular">😐 Regular</button>
        <button id="f-bad"  class="ferbot-btn ferbot-bad">👎 Mala</button>
      </div>
    `;
    // mover panel
    const drag=div.querySelector("#ferbot-drag");
    let dragging=false,dx=0,dy=0;
    drag.addEventListener("mousedown",(e)=>{dragging=true;const r=div.getBoundingClientRect();dx=e.clientX-r.left;dy=e.clientY-r.top;div.style.left=`${r.left}px`;div.style.top=`${r.top}px`;div.style.right="auto";div.style.bottom="auto";});
    window.addEventListener("mousemove",(e)=>{if(!dragging)return;div.style.left=`${e.clientX-dx}px`;div.style.top=`${e.clientY-dy}px`;});
    window.addEventListener("mouseup",()=>dragging=false);
    div.querySelector(".ferbot-close").onclick=()=>div.remove();

    // refs
    const nameEl=div.querySelector("#f-name");
    const stageEl=div.querySelector("#f-stage");
    const ctxEl  =div.querySelector("#f-ctx");
    const inEl   =div.querySelector("#f-in");
    const outEl  =div.querySelector("#f-out");
    const guideEl=div.querySelector("#f-guide");
    const autoEl =div.querySelector("#f-auto");
    const sent   =div.querySelector("#f-sent");
    const sentT  =div.querySelector("#f-sent-t");
    const b      =div.querySelector("#f-b");
    const t      =div.querySelector("#f-t");
    const gen    =div.querySelector("#f-gen");
    const clear  =div.querySelector("#f-clear");
    const good   =div.querySelector("#f-good");
    const reg    =div.querySelector("#f-reg");
    const bad    =div.querySelector("#f-bad");

    nameEl.addEventListener("change",()=>localStorage.setItem("ferbot_name",nameEl.value.trim()));
    autoEl.addEventListener("change",()=>localStorage.setItem("ferbot_autopaste",autoEl.checked?"1":"0"));

    function captureSelection(){try{const s=window.getSelection()?.toString()?.trim()||""; if(s) inEl.value=s;}catch{} updateSent(inEl.value);}
    document.addEventListener("mouseup",()=>setTimeout(captureSelection,30));
    document.addEventListener("dblclick",captureSelection);
    inEl.addEventListener("input",()=>updateSent(inEl.value));

    function updateSent(text){
      const s=(text||"").toLowerCase();
      let cls="neu", lbl="Neutral";
      if (/(caro|precio|cost|vale)/.test(s)) {cls="neg"; lbl="Negativo";}
      if (/(genial|gracias|me interesa|perfecto)/.test(s)) {cls="pos"; lbl="Positivo";}
      sent.classList.remove("pos","neu","neg"); sent.classList.add(cls); sentT.textContent=lbl;
    }

    function gIntent(q=""){ const s=(q||"").toLowerCase();
      if (/(tiempo|agenda|horario|no tengo tiempo|ocupad)/.test(s)) return "tiempo";
      if (/(precio|caro|costo|descuento|promoci)/.test(s)) return "precio";
      if (/(cert|certificado|certificación|certificaciones)/.test(s)) return "cert";
      if (/(coursera|udemy|competenc)/.test(s)) return "competencia";
      if (/(qué es platzi|que es platzi|platzi|pitch)/.test(s)) return "pitch";
      return "_default";
    }

    // ratings hidden until generate
    toggleRatings(false);
    let lastReply=null;

    let t0=0, iv=null;
    function start(){stop(); t0=performance.now(); setB("r"); iv=setInterval(()=>{const dt=(performance.now()-t0)/1000; t.textContent=dt.toFixed(1)+"s"; if(dt<2)setB("r"); else if(dt<4)setB("a"); else setB("v");},100);}
    function stop(){if(iv){clearInterval(iv);iv=null;}}
    function setB(k){b.classList.remove("a","v"); if(k==="a")b.classList.add("a"); else if(k==="v")b.classList.add("v"); /* rojo base */ }

    gen.onclick = async () => {
      const q=(inEl.value||"").trim()||window.getSelection()?.toString()?.trim()||"";
      if(!q){alert("Escribe o selecciona la objeción.");return;}
      const name=(nameEl.value||"Cliente").trim();
      const stage = (stageEl.value||"").trim(); // valores normalizados del <select>
      const context=(ctxEl.value||"").trim();
      const intent=gIntent(q);

      outEl.value=""; guideEl.value=""; toggleRatings(false); start();

      try{
        const res=await fetch(`${BASE}/assist_trainer`,{
          method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify({question:q, customerName:name, stage, context, intent})
        });
        stop(); setB("v");
        if(!res.ok){alert("No se pudo generar. HTTP "+res.status);return;}
        const json=await res.json();
        const reply=(json?.result?.reply||json?.text||"").trim();
        const why  =(json?.result?.why||"").trim();
        const next =(json?.result?.next||"").trim();

        outEl.value=reply;
        guideEl.value = `POR QUÉ: ${why}\nSIGUIENTE PASO: ${next}`;
        lastReply=reply; toggleRatings(true);
        good.onclick = ()=>rate("good");
        reg.onclick  = ()=>rate("regular");
        bad.onclick  = ()=>rate("bad");

        if(autoEl.checked) paste(reply);
      }catch(e){ stop(); alert("Error de red. Revisa que el servidor esté arriba."); }
    };

    clear.onclick=()=>{outEl.value=""; guideEl.value=""; toggleRatings(false); stop(); setB("r"); t.textContent="0.0s";};

    async function rate(r){ if(!lastReply) return;
      try{ await fetch(`${BASE}/trackRate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({intent:gIntent(inEl.value),stage:stageEl.value,text:lastReply,rating:r})}); }catch(_){}
      toggleRatings(false);
    }
    function toggleRatings(s){good.style.display=reg.style.display=bad.style.display = s?"inline-block":"none";}

    function paste(txt){
      const el=document.activeElement;
      if(el && !el.closest(".ferbot-panel") && (el.isContentEditable || /^(textarea|input)$/i.test(el.tagName))) { try{el.focus(); if(el.isContentEditable){el.textContent=""; el.appendChild(document.createTextNode(txt));} else {el.value=txt;} el.dispatchEvent(new InputEvent("input",{bubbles:true}));}catch{} return; }
      for(const node of document.querySelectorAll('div[contenteditable="true"],[role="textbox"],textarea,input[type="text"],input:not([type])')){
        if(node.offsetParent && !node.closest(".ferbot-panel")){ try{node.focus(); if(node.isContentEditable){node.textContent=""; node.appendChild(document.createTextNode(txt));} else {node.value=txt;} node.dispatchEvent(new InputEvent("input",{bubbles:true}));}catch{} break; }
      }
    }
    return div;
  }

  // SPA watcher (no reinyectamos nada más)
  let lastUrl=location.href;
  new MutationObserver(()=>{ if(location.href!==lastUrl){ lastUrl=location.href; }}).observe(document,{subtree:true,childList:true});
})();
