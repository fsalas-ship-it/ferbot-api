// extension/fab-move.js
// Hace el FAB #ferbot-fab arrastrable, con límites y posición persistente (sin tocar tu lógica del panel)

(() => {
  const KEY = "ferbot_fab_xy";

  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

  function applySavedPosition(fab){
    try{
      const raw = localStorage.getItem(KEY);
      if(!raw) return;
      const { x, y } = JSON.parse(raw);
      if(typeof x === "number" && typeof y === "number"){
        fab.style.left = `${x}px`;
        fab.style.top  = `${y}px`;
        fab.style.right = "auto";
        fab.style.bottom = "auto";
      }
    }catch{}
  }

  function makeDraggable(fab){
    if(fab.__ferbotDraggable) return; // evitar doble enlace
    fab.__ferbotDraggable = true;

    // si trae estilos fijos (right/bottom), los pasamos a left/top la primera vez
    const r = fab.getBoundingClientRect();
    if(getComputedStyle(fab).right !== "auto" || getComputedStyle(fab).bottom !== "auto"){
      fab.style.left = `${r.left}px`;
      fab.style.top  = `${r.top}px`;
      fab.style.right = "auto";
      fab.style.bottom = "auto";
    }

    applySavedPosition(fab);

    let dragging = false, offX = 0, offY = 0;

    const onDown = (e) => {
      // solo arrastrar con botón principal o dedo
      if(e.type === "mousedown" && e.button !== 0) return;
      const pt = e.touches ? e.touches[0] : e;
      const rect = fab.getBoundingClientRect();
      offX = pt.clientX - rect.left;
      offY = pt.clientY - rect.top;
      dragging = true;
      e.preventDefault();
    };

    const onMove = (e) => {
      if(!dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = fab.offsetWidth;
      const h = fab.offsetHeight;

      let nx = clamp(pt.clientX - offX, 6, vw - w - 6);
      let ny = clamp(pt.clientY - offY, 6, vh - h - 6);

      fab.style.left = `${nx}px`;
      fab.style.top  = `${ny}px`;
      fab.style.right = "auto";
      fab.style.bottom = "auto";

      // guardar al vuelo
      try{ localStorage.setItem(KEY, JSON.stringify({ x:nx, y:ny })); }catch{}
    };

    const onUp = () => { dragging = false; };

    fab.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    fab.addEventListener("touchstart", onDown, { passive:false });
    window.addEventListener("touchmove", onMove, { passive:false });
    window.addEventListener("touchend", onUp);
  }

  // Observa la página y engancha el FAB cuando aparezca
  function huntFab(){
    const fab = document.getElementById("ferbot-fab");
    if(fab) makeDraggable(fab);
  }

  // primer intento inmediato
  huntFab();

  new MutationObserver(() => huntFab())
    .observe(document.documentElement || document.body, { childList:true, subtree:true });

  window.addEventListener("resize", () => {
    // Reajusta a límites si la ventana cambia
    const fab = document.getElementById("ferbot-fab");
    if(!fab) return;
    const rect = fab.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = fab.offsetWidth, h = fab.offsetHeight;
    const nx = clamp(rect.left, 6, vw - w - 6);
    const ny = clamp(rect.top,  6, vh - h - 6);
    fab.style.left = `${nx}px`;
    fab.style.top  = `${ny}px`;
    fab.style.right = "auto";
    fab.style.bottom = "auto";
    try{ localStorage.setItem(KEY, JSON.stringify({ x:nx, y:ny })); }catch{}
  });
})();
