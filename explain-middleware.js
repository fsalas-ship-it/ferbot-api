// explain-middleware.js — agrega POR QUÉ + SIGUIENTE PASO y filtra cierres fuera de etapa
// CommonJS para encajar con tu server.js actual (require/ module.exports)

function guessIntent(msg = "") {
  const t = (msg || "").toLowerCase();
  if (/(tiempo|no tengo tiempo|poco tiempo|agenda|horario|no me da el tiempo)/.test(t)) return "tiempo";
  if (/(precio|caro|costo|costoso|muy caro|promo|promoción|oferta|descuento)/.test(t)) return "precio";
  if (/(certificaci[oó]n|certificaciones|diploma|credencial)/.test(t)) return "certificacion";
  if (/(empleo|trabajo|remoto|ingresos|sueldo|salario)/.test(t)) return "empleo";
  return "general";
}

function buildWhy({ customerName, intent, stage, contextNote }) {
  const bullets = [];
  if (intent === "tiempo") {
    bullets.push("Menciona falta de tiempo → sugerimos microclases de 5–10 min y rutina diaria.");
  } else if (intent === "precio") {
    bullets.push("Menciona costo → enfocamos en transformación y valor medible, no catálogo.");
  } else if (intent === "certificacion") {
    bullets.push("Busca validación → resaltamos certificaciones verificables (digital y física).");
  } else if (intent === "empleo") {
    bullets.push("Busca impacto laboral → conectamos con rutas orientadas a salida profesional.");
  } else {
    bullets.push("Meta general → priorizamos claridad, primer paso y progreso visible.");
  }
  if (stage) bullets.push(`Etapa declarada: ${stage}.`);
  if (contextNote) bullets.push(`Usamos el contexto: “${contextNote}”.`);
  const prefix = customerName ? `Hola ${customerName}, ` : "";
  return `${prefix}respondemos así porque:\n• ${bullets.join("\n• ")}`;
}

function buildNextStep(stage) {
  const map = {
    integracion: "Para empezar bien: cuéntame tu meta 30–60 días y te envío ruta + primera clase hoy.",
    sondeo: "Con eso te doy la ruta exacta y la primera clase para hoy. ¿Qué ruta quieres iniciar?",
    rebatir: "Te propongo una ruta corta con clases de 5–10 min/día. ¿Qué ruta quieres iniciar?",
    pre_cierre: "Confirmo tu ruta y te dejo 2 clases + checkpoint en 7 días. ¿La iniciamos?",
    cierre: "¿Prefieres Expert individual o Duo para estudiar con alguien más?",
    poscierre: "Mini agenda: 10 min/día. Te escribo en una semana para revisar avances."
  };
  return map[stage] || "Te envío la ruta + primera clase hoy y hacemos checkpoint en 7 días.";
}

// Sanea saludos duplicados, puntos, espacios
function tidyText(s = "") {
  let t = String(s);
  t = t.replace(/\s{2,}/g, " ").trim();
  // Elimina doble saludo tipo “Hola Diego, Claro, Diego…”
  t = t.replace(/^(\s*hola[^,]*,\s*)+/i, (m) => m.split(",")[0] + ", ");
  t = t.replace(/hola\s+([^,]+),\s*hola[^,]*,/i, "Hola $1, ");
  // Puntos suspensivos y espacios
  t = t.replace(/\s*\.\s*\.\s*/g, ". ").replace(/\.\.+/g, ".");
  return t;
}

// Filtro anti-cierre para etapas tempranas (NO precios, NO agendar, NO links)
function sanitizeByStage(text = "", stage = "") {
  const early = ["integracion", "sondeo", "rebatir"];
  if (!early.includes((stage || "").toLowerCase())) return text;

  let t = " " + text + " "; // márgenes para regexs
  const ban = [
    /\b(precio|precios|costo|cuesta|tarifa|pagos?)\b/gi,
    /\b(agenda(r|mos)?|demo|llamada|hoy\s*o\s*mañana|link\s+de\s+pago|pago\s+ahora)\b/gi,
    /\b(enviar[eé]?\s+(precios|tarifas|cotizaci[oó]n))\b/gi
  ];
  for (const re of ban) t = t.replace(re, ""); // quita frases
  // Si quedó muy corto, mantenlo limpio
  t = t.replace(/\s{2,}/g, " ").trim();
  // CTA seguro
  if (!/ruta/i.test(t)) {
    const cta = " ¿Qué ruta quieres iniciar: Bases de Datos desde Cero o SQL para Analítica?";
    t = tidyText(t + cta);
  }
  return tidyText(t);
}

function explainMiddleware() {
  return function (req, res, next) {
    const _json = res.json.bind(res);

    res.json = function (payload) {
      try {
        // Solo actúa en respuestas exitosas que traen texto
        if (payload && payload.ok && typeof payload.text === "string") {
          const body = req.body || {};
          const stage = (body.stage || body.etapa || "").toLowerCase() || "integracion";
          const customerName = body.customerName || body.name || "";
          const contextNote = (body.context || body.note || "").trim();
          const userMsg = body.question || body.text || body.message || "";

          // 1) filtra cierres fuera de etapa
          payload.text = sanitizeByStage(tidyText(payload.text), stage);

          // 2) adjunta explain si no viene
          if (!payload.explain) {
            const intent = guessIntent(userMsg);
            payload.explain = {
              why: buildWhy({ customerName, intent, stage, contextNote }),
              next_step: buildNextStep(stage),
              intent,
              confidence: 0.72
            };
          }
        }
      } catch (e) {
        // fallar silencioso, no romper respuesta original
        // console.error("explain-middleware failed:", e);
      }
      return _json(payload);
    };

    next();
  };
}

module.exports = explainMiddleware;
