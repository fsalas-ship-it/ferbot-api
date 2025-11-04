// public/promos.js
// Motor simple de promociones para FerBot (cliente). No requiere backend nuevo.

(function(global){
  const promos = [
    // Ejemplo 1: promo mensual temporal
    {
      id: "NOVIEMBRE_30",
      startsAt: "2025-11-01T00:00:00-05:00",
      endsAt:   "2025-11-30T23:59:59-05:00",
      channels: ["panel","extension"],   // dónde se aplica
      stages:   ["pre_cierre","cierre"], // etapas objetivo
      intents:  ["precio"],              // o vacío para todos
      badge:    "Promo activa",
      label:    "Nov: 30% en anual",
      shortCta: "Actívalo hoy y aseguras 30% en tu plan anual."
    },
    // Ejemplo 2: promo siempre activa de referencia (fallback)
    {
      id: "ANUAL_ESTANDAR",
      startsAt: "2024-01-01T00:00:00-05:00",
      endsAt:   "2026-12-31T23:59:59-05:00",
      channels: ["panel","extension"],
      stages:   ["pre_cierre","cierre"],
      intents:  [],
      badge:    "Plan anual",
      label:    "Mejor relación valor/tiempo",
      shortCta: "El anual concentra valor y te sostiene todo el año."
    }
  ];

  function now(){ return new Date(); }
  function inRange(p, d){
    const s = new Date(p.startsAt).getTime();
    const e = new Date(p.endsAt).getTime();
    const t = d.getTime();
    return t >= s && t <= e;
  }
  function matchChannel(p, ch){ return !p.channels?.length || p.channels.includes(ch); }
  function matchStage(p, st){   return !p.stages?.length  || p.stages.includes(st); }
  function matchIntent(p, it){  return !p.intents?.length || p.intents.includes(it); }

  function selectActive({ channel, stage, intent }){
    const d = now();
    const list = promos
      .filter(p => inRange(p,d))
      .filter(p => matchChannel(p, channel))
      .filter(p => matchStage(p, stage))
      .filter(p => matchIntent(p, intent));
    // prioriza la primera definida (puedes ordenar por prioridad si quieres)
    return list[0] || null;
  }

  // Expone helpers
  global.FerbotPromos = {
    getActive: selectActive,
    applyCTA(reply, ctx){
      const p = selectActive(ctx || {});
      if(!p) return reply;
      // Agrega CTA cortita en una segunda frase si cabe
      if(!reply || typeof reply !== "string") return reply;
      const trimmed = reply.trim();
      const space = trimmed.endsWith(".") ? " " : ". ";
      const cta = p.shortCta || "";
      if(!cta) return trimmed;
      const final = trimmed + space + cta;
      // límite suave 260c por si el agente quiere 2 frases cortas
      return final.length <= 260 ? final : trimmed;
    },
    badgeFor(ctx){
      const p = selectActive(ctx || {});
      return p ? { text: p.badge, label: p.label } : null;
    }
  };
})(window);
