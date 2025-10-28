const fs   = require('fs');
const path = require('path');

const PROMOS_PATH = path.join(__dirname, 'promos.json');
let cache = { active: false };

function loadPromos() {
  try {
    const raw = fs.readFileSync(PROMOS_PATH, 'utf8');
    const json = JSON.parse(raw);
    cache = (json && typeof json === 'object') ? json : { active: false };
    console.log('🟢 promos.json cargado. active =', !!cache.active);
  } catch (e) {
    console.warn('⚠️ No se pudo leer promos.json. Promos inactivas.');
    cache = { active: false };
  }
}

function watchPromos() {
  try {
    fs.watch(PROMOS_PATH, { persistent: false }, () => {
      console.log('♻️ promos.json cambió; recargando…');
      loadPromos();
    });
  } catch {}
}

function getPromos() { return cache; }

function buildPromoCTA() {
  const p = getPromos();
  if (!p || !p.active) return '';
  const parts = [
    `**${p.title || 'Promoción'}**`,
    p.price   ? `Precio: ${p.price}` : '',
    p.code    ? `Cupón: ${p.code}`  : '',
    p.expires ? `Vigencia: ${p.expires}` : '',
    p.landing ? `Link: ${p.landing}` : '',
    p.note    ? p.note : ''
  ].filter(Boolean);
  return parts.length ? '\n\n' + parts.join('\n') : '';
}

function maybeAppendPromo(reply, stage, userText='') {
  const p = getPromos();
  if (!p || !p.active) return reply;

  const s  = String(stage || '').toLowerCase();
  const ut = String(userText || '').toLowerCase();

  const isPromoStage =
    s === 'promos' || s === 'promociones' || s === 'promoción' || s === 'promocion';

  const mentionsPrice =
    /(precio|vale|descuento|oferta|promo|black\s*friday|bf)/i.test(ut);

  if (isPromoStage || mentionsPrice) return (reply || '') + buildPromoCTA();
  return reply;
}

module.exports = { loadPromos, watchPromos, getPromos, maybeAppendPromo, buildPromoCTA };

