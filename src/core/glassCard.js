'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Outils « verre fumé » pour les cartes image (style choisi dans /cartes-style).
//  - glassBackdrop : fond TRÈS sombre avec 3 halos colorés diffus (couleur d'accent du serveur)
//  - glassPanel    : panneau de verre dépoli (fond flouté + teinte sombre + reflet + bordure)
//  - glassBar      : barre de progression en verre avec remplissage lumineux
// Le flou est fait par réduction/agrandissement (aucune dépendance au support de ctx.filter).
// ─────────────────────────────────────────────────────────────────────────

const { createCanvas } = require('@napi-rs/canvas');

function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hsl(h, s, l) { return `hsl(${Math.round(((h % 360) + 360) % 360)},${Math.round(s * 100)}%,${Math.round(l * 100)}%)`; }

/** Accent sans teinte (blanc, gris) = thème noir et blanc. */
function isMono(accent) {
  return rgbToHsl(...hexToRgb(accent || '#ffffff'))[1] < 0.08;
}

/** Trois teintes dérivées de la couleur d'accent (accent, +70°, −70°) ; blanc / gris en noir et blanc. */
function palette(accent) {
  if (isMono(accent)) return ['#ffffff', '#f1f5f9', '#e2e8f0'];
  const [h, s] = rgbToHsl(...hexToRgb(accent || '#2ecc71'));
  const sat = Math.max(0.55, Math.min(0.9, s));
  return [hsl(h, sat, 0.5), hsl(h + 70, sat, 0.5), hsl(h - 70, sat, 0.45)];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Modes de fond (menu « Fond » de /card-style) appliqués au verre fumé.
//  mul  : multiplicateur de luminosité du fond teinté par l'accent (noir pur → doux)
//  fixed / hues : palettes dédiées (ardoise, minuit, aurore, crépuscule)
//  tint : couleur (r,g,b) du verre dépoli posé par-dessus
const GLASS_MODES = {
  noir: { mul: 0.18, tint: '6,6,8' },
  profond: { mul: 0.45, tint: '18,18,21' },
  normal: { mul: 1, tint: '34,34,38' },
  doux: { mul: 1.7, tint: '58,58,64' },
  ardoise: { fixed: { h: [215, 225, 205], s: 0.2, l: [0.15, 0.22, 0.17] }, tint: '34,40,50' },
  minuit: { fixed: { h: [228, 245, 215], s: 0.6, l: [0.08, 0.14, 0.1] }, tint: '14,20,42' },
  aurore: { hues: true, s: 0.7, l: [0.2, 0.3, 0.21], tint: '34,34,38' },
  crepuscule: { fixed: { h: [265, 330, 20], s: 0.5, l: [0.15, 0.2, 0.16] }, tint: '30,22,40' }
};

const clamp01 = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** Trois couleurs du dégradé de fond selon l'accent, la teinte de fond perso et le mode de fond. */
function backdropStops(accent, theme) {
  const m = GLASS_MODES[theme && theme.bgMode] || GLASS_MODES.normal;
  const src = (theme && theme.bg) || accent || '#2ecc71';
  const [h0, s0] = rgbToHsl(...hexToRgb(src));
  const mono = s0 < 0.08;
  if (m.fixed) return m.fixed.l.map((l, i) => hsl(m.fixed.h[i], m.fixed.s, l));
  if (m.hues) {
    const hs = mono ? [260, 200, 320] : [h0, h0 + 60, h0 - 60];
    return m.l.map((l, i) => hsl(hs[i], mono ? 0.5 : m.s, l));
  }
  if (mono) return [0.11, 0.17, 0.125].map(l => hsl(240, 0.05, clamp01(l * m.mul, 0, 0.4)));
  const sat = clamp01(s0, 0.35, 0.7);
  const L = [0.1, 0.17, 0.12].map(l => clamp01(l * m.mul, 0, 0.4));
  return [hsl(h0, sat, L[0]), hsl(h0 + 30, sat, L[1]), hsl(h0 - 30, sat, L[2])];
}

/** Teinte du verre dépoli selon le mode de fond (alpha au choix). */
function tintFor(theme, a = 0.55) {
  const m = GLASS_MODES[theme && theme.bgMode] || GLASS_MODES.normal;
  return `rgba(${m.tint},${a})`;
}

/** Fond en dégradé (très sombre par défaut) ; suit le mode de fond et la teinte perso. Retourne un canvas (réutilisé pour flouter derrière le verre). */
function glassBackdrop(W, H, accent, soft = false, theme = null) {
  const cv = createCanvas(W, H);
  const c = cv.getContext('2d');
  const stops = backdropStops(accent, theme);
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.5, stops[1]);
  g.addColorStop(1, stops[2]);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  return cv;
}

/** Copie floutée du fond (flou par réduction puis agrandissement, répété pour adoucir). */
function blurred(back, W, H) {
  let cur = back;
  for (const k of [10, 6]) {
    const sw = Math.max(8, Math.round(W / k)), sh = Math.max(8, Math.round(H / k));
    const small = createCanvas(sw, sh);
    const sc = small.getContext('2d');
    sc.imageSmoothingEnabled = true; sc.imageSmoothingQuality = 'high';
    sc.drawImage(cur, 0, 0, sw, sh);
    const big = createCanvas(W, H);
    const bc = big.getContext('2d');
    bc.imageSmoothingEnabled = true; bc.imageSmoothingQuality = 'high';
    bc.drawImage(small, 0, 0, W, H);
    cur = big;
  }
  return cur;
}

/**
 * Panneau de verre dépoli.
 * @param {object} o  { tint?: couleur de teinte (défaut verre fumé sombre) }
 */
function glassPanel(ctx, back, blur, x, y, w, h, r, o = {}) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(blur, 0, 0);
  ctx.fillStyle = o.tint || tintFor(o.theme, 0.55);
  ctx.fillRect(x, y, w, h);
  const sh = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
  sh.addColorStop(0, 'rgba(255,255,255,0.22)');
  sh.addColorStop(0.35, 'rgba(255,255,255,0.03)');
  sh.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  const b = ctx.createLinearGradient(x, y, x + w, y + h);
  b.addColorStop(0, 'rgba(255,255,255,0.7)');
  b.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  b.addColorStop(1, 'rgba(255,255,255,0.4)');
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, r);
  ctx.strokeStyle = b;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** Barre de progression en verre (ratio 0..1). */
function glassBar(ctx, x, y, w, h, ratio) {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const fw = Math.max(h, w * Math.max(0, Math.min(1, ratio)));
  const f = ctx.createLinearGradient(x, 0, x + w, 0);
  f.addColorStop(0, 'rgba(255,255,255,0.95)');
  f.addColorStop(1, 'rgba(255,255,255,0.6)');
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.6)';
  ctx.shadowBlur = 14;
  roundRect(ctx, x, y, fw, h, h / 2);
  ctx.fillStyle = f;
  ctx.fill();
  ctx.restore();
}


// ─────────────────────────────────────────────────────────────────────────
// Verre fumé AUTOMATIQUE pour toutes les cartes (look « fume » de /card-style)
//
// glassProxy(rawCtx, ctx, accent) enveloppe le contexte de la carte :
//  • le fond plein écran (fillRect / fill couvrant toute la carte) devient le fond sombre à halos
//  • chaque grand panneau sombre (fill() ou fillRect() assez grand) devient du verre dépoli :
//    fond flouté + teinte sombre + reflet + ombre douce
//  • les bordures sombres de grands panneaux deviennent un liseré blanc translucide
// Les petits éléments (barres, pastilles, textes) ne sont pas touchés : ils gardent le dessin
// d'origine, recoloré en noir et blanc par le thème. Aucune carte n'a besoin d'être réécrite.
// ─────────────────────────────────────────────────────────────────────────

const PATH_OPS = new Set(['beginPath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'rect', 'roundRect', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo']);
const BACK_CACHE = new Map();

function backFor(W, H, accent, theme) {
  const key = `${W}x${H}:${accent}:${(theme && theme.bgMode) || 'normal'}:${(theme && theme.bg) || ''}`;
  let e = BACK_CACHE.get(key);
  if (!e) {
    if (BACK_CACHE.size > 24) BACK_CACHE.clear();
    const back = glassBackdrop(W, H, accent, true, theme);
    e = { back, blur: blurred(back, W, H) };
    BACK_CACHE.set(key, e);
  }
  return e;
}

function parseCss(str) {
  const s = String(str).trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) { const [r, g, b] = hexToRgb(m[1]); return { l: rgbToHsl(r, g, b)[2], a: 1 }; }
  m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) { const [r, g, b] = m[1].split('').map(ch => parseInt(ch + ch, 16)); return { l: rgbToHsl(r, g, b)[2], a: 1 }; }
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/i);
  if (m) return { l: rgbToHsl(+m[1], +m[2], +m[3])[2], a: m[4] !== undefined ? +m[4] : 1 };
  return null;
}

function glassProxy(raw, ctx, accent, theme = null) {
  const cv = raw.canvas;
  // Cartes dessinées en résolution x2 (ctx.scale) : on raisonne en coordonnées LOGIQUES
  let sc = 1;
  try { const m = raw.getTransform(); if (m && m.a > 0) sc = m.a; } catch { /* pas de transformation */ }
  const CW = cv.width / sc, CH = cv.height / sc;
  const { back, blur } = backFor(cv.width, cv.height, accent, theme);
  const T55 = tintFor(theme, 0.55), T52 = tintFor(theme, 0.52);
  let bb = null;            // boîte englobante du chemin courant
  let backDrawn = false;
  const grow = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!bb) bb = { x1: x, y1: y, x2: x, y2: y };
    else { bb.x1 = Math.min(bb.x1, x); bb.y1 = Math.min(bb.y1, y); bb.x2 = Math.max(bb.x2, x); bb.y2 = Math.max(bb.y2, y); }
  };
  const track = (op, a) => {
    switch (op) {
      case 'beginPath': bb = null; break;
      case 'moveTo': case 'lineTo': grow(a[0], a[1]); break;
      case 'arcTo': grow(a[0], a[1]); grow(a[2], a[3]); break;
      case 'arc': grow(a[0] - a[2], a[1] - a[2]); grow(a[0] + a[2], a[1] + a[2]); break;
      case 'ellipse': grow(a[0] - a[2], a[1] - a[3]); grow(a[0] + a[2], a[1] + a[3]); break;
      case 'rect': case 'roundRect': grow(a[0], a[1]); grow(a[0] + a[2], a[1] + a[3]); break;
      case 'quadraticCurveTo': grow(a[0], a[1]); grow(a[2], a[3]); break;
      case 'bezierCurveTo': grow(a[0], a[1]); grow(a[2], a[3]); grow(a[4], a[5]); break;
      default: break;
    }
  };
  const size = b => ({ w: b.x2 - b.x1, h: b.y2 - b.y1 });
  const isFull = b => { const { w, h } = size(b); return b.x1 <= 2 && b.y1 <= 2 && w >= CW - 4 && h >= CH - 4; };
  const isPanel = b => { const { w, h } = size(b); return w * h >= CW * CH * 0.06 && w >= CW * 0.2 && h >= CH * 0.1; };
  const bigPanel = b => { const { w, h } = size(b); return w * h >= CW * CH * 0.4; };
  const darkFill = () => { const st = ctx.fillStyle; if (typeof st !== 'string') return !!bb && bigPanel(bb); const p = parseCss(st); return !!p && p.l < 0.22 && p.a >= 0.5; };

  // Panneau de verre en retrait (marge autour) peint juste après le fond plein écran :
  // c'est lui qui donne le look « verre » aux cartes dont le fond occupe tout le canvas.
  function insetPanel() {
    const m = 6;
    const r = Math.max(18, Math.min(32, Math.round(Math.min(CW, CH) * 0.07)));
    const P2 = require('@napi-rs/canvas').Path2D;
    const p = new P2();
    p.roundRect(m, m, CW - 2 * m, CH - 2 * m, r);
    raw.save();
    raw.restore();
    raw.save();
    raw.clip(p);
    raw.drawImage(blur, 0, 0, CW, CH);
    raw.fillStyle = T55;
    raw.fillRect(m, m, CW - 2 * m, CH - 2 * m);
    const g = raw.createLinearGradient(m, m, m + (CW - 2 * m) * 0.6, CH - m);
    g.addColorStop(0, 'rgba(255,255,255,0.2)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.03)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    raw.fillStyle = g;
    raw.fillRect(m, m, CW - 2 * m, CH - 2 * m);
    raw.restore();
    const bg = raw.createLinearGradient(m, m, CW - m, CH - m);
    bg.addColorStop(0, 'rgba(255,255,255,0.7)');
    bg.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    bg.addColorStop(1, 'rgba(255,255,255,0.4)');
    const pb = new P2();
    pb.roundRect(m + 1, m + 1, CW - 2 * m - 2, CH - 2 * m - 2, r);
    raw.save(); raw.strokeStyle = bg; raw.lineWidth = 2; raw.stroke(pb); raw.restore();
  }

  // Remplit le chemin courant (déjà défini sur le contexte) avec le fond sombre ou du verre.
  function paintPath(b) {
    if (isFull(b)) {
      if (backDrawn) return true;      // fonds suivants (voiles, dégradés) ignorés
      backDrawn = true;
      insetPanel();
      return true;
    }
    backDrawn = true;
    raw.save();
    raw.restore();
    raw.save();
    raw.clip();
    raw.drawImage(blur, 0, 0, CW, CH);
    raw.fillStyle = T52;
    raw.fillRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
    const g = raw.createLinearGradient(b.x1, b.y1, b.x1 + (b.x2 - b.x1) * 0.6, b.y2);
    g.addColorStop(0, 'rgba(255,255,255,0.2)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.03)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    raw.fillStyle = g;
    raw.fillRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
    raw.restore();
    return true;
  }

  const wrap = {
    fill(...args) {
      if (!bb || (typeof args[0] === 'object' && args[0] !== null) || (typeof args[0] === 'string' && args[0] !== 'nonzero' && args[0] !== 'evenodd')) return ctx.fill(...args);
      if ((isFull(bb) && !backDrawn) || (isPanel(bb) && darkFill() && !isFull(bb))) { paintPath(bb); return undefined; }
      if (isFull(bb) && backDrawn) return undefined;
      return ctx.fill(...args);
    },
    fillRect(x, y, w, h) {
      const b = { x1: x, y1: y, x2: x + w, y2: y + h };
      if (isFull(b)) {
        if (!backDrawn) { backDrawn = true; insetPanel(); }
        return undefined;
      }
      if (isPanel(b) && darkFill()) {
        const saved = bb;
        const p = new (require('@napi-rs/canvas').Path2D)();
        p.rect(x, y, w, h);
        raw.save();
        raw.restore();
        raw.save(); raw.clip(p); raw.drawImage(blur, 0, 0, CW, CH);
        raw.fillStyle = T52; raw.fillRect(x, y, w, h);
        raw.restore();
        bb = saved;
        return undefined;
      }
      return ctx.fillRect(x, y, w, h);
    },
    stroke(...args) {
      if (bb && backDrawn && typeof args[0] !== 'object') {
        // cadre d'origine (plein écran ou quasi) : remplacé par la bordure du panneau de verre
        const { w, h } = size(bb);
        if (w >= CW * 0.9 && h >= CH * 0.85 && bb.x1 <= CW * 0.06 && bb.y1 <= CH * 0.1) return undefined;
      }
      if (bb && isPanel(bb) && typeof args[0] !== 'object') {
        const st = ctx.strokeStyle;
        const p = typeof st === 'string' ? parseCss(st) : null;
        if (p && p.l < 0.5) {
          const g = raw.createLinearGradient(bb.x1, bb.y1, bb.x2, bb.y2);
          g.addColorStop(0, 'rgba(255,255,255,0.6)');
          g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
          g.addColorStop(1, 'rgba(255,255,255,0.35)');
          raw.save(); raw.strokeStyle = g; raw.stroke(); raw.restore();
          return undefined;
        }
      }
      return ctx.stroke(...args);
    }
  };

  return new Proxy(ctx, {
    get(t, prop) {
      if (Object.prototype.hasOwnProperty.call(wrap, prop)) return wrap[prop];
      const v = Reflect.get(t, prop, t);
      if (typeof v !== 'function') return v;
      if (PATH_OPS.has(prop)) return (...a) => { track(prop, a); return v.apply(t, a); };
      return v.bind(t);
    },
    set(t, prop, value) { t[prop] = value; return true; }
  });
}

module.exports = { glassProxy, isMono, tintFor, GLASS_MODES, glassBackdrop, blurred, glassPanel, glassBar, roundRect };