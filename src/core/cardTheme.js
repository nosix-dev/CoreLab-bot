'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Thème des cartes image (canvas) — un seul endroit pour TOUTES les cartes.
//
// Principe : les cartes sont dessinées avec une palette verte codée en dur.
// Au lieu de réécrire chaque fichier, on enveloppe le contexte canvas avec
// `themedCtx(ctx, guildId)` : chaque couleur « verte » (fond, bordure, accent,
// halo, texte teinté…) est recolorée à la volée vers la couleur du serveur,
// en gardant la luminosité d'origine (donc le contraste reste identique).
// Les couleurs neutres (blanc, gris) et sémantiques (or/argent/bronze des
// podiums, rouge d'erreur…) ne bougent pas.
//
// Thème par défaut (vert) = aucune transformation → zéro régression.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'card_themes.json');

// ── Presets proposés dans le menu ──
const PRESETS = {
  vert: { label: 'Vert', emoji: '🟩', accent: '#2ecc71' },
  bleu: { label: 'Bleu', emoji: '🟦', accent: '#3b82f6' },
  cyan: { label: 'Cyan', emoji: '🩵', accent: '#06b6d4' },
  violet: { label: 'Violet', emoji: '🟪', accent: '#8b5cf6' },
  rose: { label: 'Rose', emoji: '💗', accent: '#ec4899' },
  rouge: { label: 'Rouge', emoji: '🟥', accent: '#ef4444' },
  orange: { label: 'Orange', emoji: '🟧', accent: '#f97316' },
  or: { label: 'Or', emoji: '🟨', accent: '#eab308' },
  gris: { label: 'Monochrome (défaut)', emoji: '⬜', accent: '#ffffff', mono: true }
};

// Intensité du fond : multiplicateur de luminosité appliqué aux surfaces sombres.
const BG_MODES = {
  noir: { label: 'Noir pur (AMOLED)', desc: 'Fond noir profond, contraste maximal', mul: 0.2, sat: 0.8 },
  profond: { label: 'Profond', desc: 'Très sombre, teinté par la couleur', mul: 0.45, sat: 0.9 },
  normal: { label: 'Normal', desc: 'Équilibré (défaut)', mul: 1, sat: 1 },
  doux: { label: 'Doux (plus clair)', desc: 'Fond plus clair, plus lumineux', mul: 1.7, sat: 0.85 },
  ardoise: { label: 'Ardoise', desc: 'Gris bleuté sobre', mul: 1.1, sat: 0.35 },
  minuit: { label: 'Bleu nuit', desc: 'Bleu profond', mul: 0.6, sat: 1 },
  aurore: { label: 'Aurore', desc: 'Dégradé vif multicolore', mul: 1.5, sat: 1.2 },
  crepuscule: { label: 'Crépuscule', desc: 'Violet, rose et orangé', mul: 1, sat: 1 }
};

// Style (« look ») de TOUTES les cartes du bot. « neon » = style historique.
//  - logs : 4 mises en page dédiées (néon / sobre / clair / compact) ; « fumé » = mise en page verre
//    dédiée pour la carte de niveau (voir core/glassCard.js), les autres cartes passent en fond très sombre
//  - autres cartes (niveau, classements, starboard, giveaway, wallet, stats, panneaux…) :
//    même mise en page, recolorée à la volée (sobre/compact = fond sombre uni sans halo,
//    clair = fond clair sans halo). Voir lookFn() plus bas.
const LOOKS = {
  neon: { label: 'Néon', emoji: '💡', desc: 'Bordure lumineuse et fond coloré' },
  sobre: { label: 'Sobre sombre', emoji: '⬛', desc: 'Fond uni, sans halo, accent discret' },
  clair: { label: 'Clair', emoji: '⬜', desc: 'Fond clair, texte sombre, sans halo' },
  compact: { label: 'Compact', emoji: '📏', desc: 'Tuile d\'icône + infos sur une ligne (toutes les cartes)' },
  fume: { label: 'Verre fumé (défaut)', emoji: '🌫️', desc: 'Verre dépoli sombre sur fond très sombre' }
};
const LOG_STYLES = LOOKS; // ancien nom (compatibilité)

// Vert d'origine des mises en page (sert de référence : accent = ce vert → aucune recoloration).
const SOURCE_ACCENT = '#2ecc71';
// Thème par défaut d'un serveur : verre fumé en noir et blanc (halos blancs).
const DEFAULT_THEME = Object.freeze({ preset: 'gris', accent: '#ffffff', bg: null, bgMode: 'normal', look: 'fume' });

// ── Stockage (fichier JSON à la racine, écriture asynchrone sérialisée) ──
let store = {};
try {
  if (fs.existsSync(FILE)) store = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
} catch (e) {
  console.error('[cardTheme] lecture impossible :', e.message);
  store = {};
}
let writing = Promise.resolve();
function persist() {
  const json = JSON.stringify(store, null, 2);
  writing = writing.catch(() => { }).then(() => fs.promises.writeFile(FILE, json, 'utf8'))
    .catch(e => console.error('[cardTheme] sauvegarde impossible :', e.message));
  return writing;
}

const HEX_RE = /^#?([0-9a-f]{6})$/i;
function normHex(v) {
  const m = String(v ?? '').trim().match(HEX_RE);
  return m ? `#${m[1].toLowerCase()}` : null;
}

/** Thème complet d'un serveur (toujours un objet valide). */
function getTheme(guildId) {
  const t = guildId ? store[String(guildId)] : null;
  if (!t) return { ...DEFAULT_THEME };
  return {
    preset: t.preset || 'perso',
    accent: normHex(t.accent) || SOURCE_ACCENT,
    bg: normHex(t.bg),
    bgMode: BG_MODES[t.bgMode] ? t.bgMode : 'normal',
    look: LOOKS[t.look || t.logStyle] ? (t.look || t.logStyle) : 'neon'
  };
}

function isDefault(theme) {
  return theme.accent === SOURCE_ACCENT && !theme.bg && theme.bgMode === 'normal';
}

/** Met à jour (fusion) le thème d'un serveur. Retourne le thème résultant. */
function setTheme(guildId, patch) {
  const cur = getTheme(guildId);
  const next = { ...cur, ...patch };
  if (patch.accent !== undefined) next.accent = normHex(patch.accent) || cur.accent;
  if (patch.bg !== undefined) next.bg = patch.bg ? normHex(patch.bg) : null;
  if (!BG_MODES[next.bgMode]) next.bgMode = 'normal';
  if (!LOOKS[next.look]) next.look = 'neon';
  store[String(guildId)] = { preset: next.preset, accent: next.accent, bg: next.bg, bgMode: next.bgMode, look: next.look };
  persist();
  return getTheme(guildId);
}

function resetTheme(guildId) {
  delete store[String(guildId)];
  persist();
  return { ...DEFAULT_THEME };
}

/** Applique un preset (couleur + monochrome éventuel). */
function applyPreset(guildId, key) {
  const p = PRESETS[key];
  if (!p) return getTheme(guildId);
  return setTheme(guildId, { preset: key, accent: p.accent });
}

// ── Couleurs : parsing / conversion ──
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else[r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const toHex = ([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

const RGBA_RE = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i;

// Parse '#rgb' | '#rrggbb' | 'rgb()' | 'rgba()' → { rgb:[r,g,b], a } ou null (couleur nommée, etc.)
function parseColor(str) {
  const s = String(str).trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) return { rgb: m[1].split('').map(c => parseInt(c + c, 16)), a: null };
  m = s.match(HEX_RE);
  if (m) return { rgb: hexToRgb(`#${m[1]}`), a: null };
  m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/i); // ex. '#3ddc8455' (couleur + alpha)
  if (m) return { rgb: hexToRgb(`#${m[1]}`), a: +(parseInt(m[2], 16) / 255).toFixed(3) };
  m = s.match(RGBA_RE);
  if (m) return { rgb: [+m[1], +m[2], +m[3]], a: m[4] !== undefined ? +m[4] : null };
  return null;
}

function formatColor(rgb, a) {
  return a === null ? toHex(rgb) : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

// Famille « verte » d'origine des cartes (teinte ~ 145°).
const SRC_HUE = 145;
const SRC_MIN = 75;
const SRC_MAX = 175;

/**
 * Construit la fonction de recoloration d'un thème.
 * @param {object} theme   { accent, bg, bgMode, preset }
 * @param {string[]} [alsoAccent]  couleurs hex supplémentaires à traiter comme « accent »
 *   (ex. l'or du giveaway, qui est l'accent de cette carte-là).
 */
function hexSat(hex) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsl(r, g, b)[1];
}

function buildRemapper(theme, alsoAccent = [], tintDark = false) {
  const preset = PRESETS[theme.preset];
  // Couleur sans teinte (blanc, gris, noir) = thème monochrome : pas de teinte résiduelle (sinon rose/rouge)
  const mono = !!preset?.mono || hexSat(theme.accent) < 0.08;
  const [ar, ag, ab] = hexToRgb(theme.accent);
  const [aH, aS, aL] = rgbToHsl(ar, ag, ab);
  const mode = BG_MODES[theme.bgMode] || BG_MODES.normal;

  // Facteur de saturation : on s'aligne sur la vivacité de la couleur choisie
  // (le vert d'origine a une saturation ≈ 0.62 en moyenne).
  const satScale = mono ? 0.06 : clamp(aS / 0.62, 0.15, 1.35);

  let bgH = null, bgS = null;
  if (theme.bg) {
    const [r, g, b] = hexToRgb(theme.bg);
    const [h, s] = rgbToHsl(r, g, b);
    bgH = h; bgS = s;
  }
  // Accent très clair (blanc, jaune pâle…) : les éléments d'accent d'origine (luminosité ~0.5) sont éclaircis
  const lightT = aL > 0.7 ? clamp((aL - 0.52) / 0.48) : 0;
  const also = new Set(alsoAccent.map(c => String(c).toLowerCase()));
  const cache = new Map();

  return function remap(input) {
    if (typeof input !== 'string') return input;
    const hit = cache.get(input);
    if (hit !== undefined) return hit;

    const p = parseColor(input);
    let out = input;
    if (p) {
      const [h, s, l] = rgbToHsl(...p.rgb);
      const key = toHex(p.rgb);
      const isAlso = also.has(key);
      const inFamily = s >= 0.12 && h >= SRC_MIN && h <= SRC_MAX;

      if (isAlso) {
        // Accent « externe » (ex. or du giveaway) → couleur du thème, même luminosité.
        const ns = mono ? 0.05 : clamp(Math.max(s * 0.8, aS * 0.9));
        out = formatColor(hslToRgb(aH, ns, l), p.a);
      } else if (tintDark && s < 0.12 && l < 0.2) {
        // Cartes à fond noir neutre (giveaway, wallet, classement éco) : léger voile de la couleur du thème.
        const th = bgH !== null ? bgH : aH;
        const ts = mono ? 0 : clamp(0.28 * satScale, 0, 0.35);
        out = formatColor(hslToRgb(th, ts, clamp(l * mode.mul, 0, 0.3)), p.a);
      } else if (inFamily) {
        const surface = l < 0.32;
        let nh = aH + (h - SRC_HUE) * 0.2;
        let ns = clamp(s * satScale);
        let nl = l;
        if (surface) {
          if (bgH !== null) { nh = bgH; ns = clamp(s * (mono ? 0.06 : clamp(bgS / 0.45, 0.1, 1.4))); }
          nl = clamp(l * mode.mul, 0, 0.5);
          ns = clamp(ns * mode.sat);
        }
        if (!surface && lightT > 0 && s >= 0.45) nl = clamp(nl + (1 - nl) * lightT);
        out = formatColor(hslToRgb(nh, ns, nl), p.a);
      }
    }
    cache.set(input, out);
    return out;
  };
}

/**
 * Transformation « look » appliquée après la recoloration du thème :
 *  - sobre / compact : fonds sombres → gris neutres, textes atténués → gris, plus de halo
 *  - clair : fonds → clairs, texte blanc → sombre, accents clairs assombris, plus de halo
 * Renvoie null pour le look néon (aucune transformation).
 */
function lookFn(look) {
  if (!look || look === 'neon' || !LOOKS[look]) return null;
  const light = look === 'clair';
  const smoked = look === 'fume';
  const cache = new Map();
  return function (input) {
    if (typeof input !== 'string') return input;
    const hit = cache.get(input);
    if (hit !== undefined) return hit;
    const p = parseColor(input);
    let out = input;
    if (p) {
      const [h, s, l] = rgbToHsl(...p.rgb);
      let nh = h, ns = s, nl = l;
      if (l < 0.32) {                       // surfaces / bordures sombres
        nh = 220;
        ns = 0.05;
        nl = light ? 0.985 - l * 0.55 : smoked ? 0.1 + l * 0.45 : 0.075 + l * 0.6;
      } else if (s < 0.45) {                // blancs, gris, textes atténués
        if (light) {
          nh = 220;
          nl = l > 0.82 ? 0.11 : 0.12 + (1 - l) * 0.5;
          ns = 0.05;
        } else {
          ns = s * 0.25;
        }
      } else if (light && l > 0.52) {        // accents clairs (titres, valeurs) → plus foncés sur fond clair
        nl = l * 0.62;
      }
      out = formatColor(hslToRgb(nh, ns, nl), p.a);
    }
    cache.set(input, out);
    return out;
  };
}

const COLOR_PROPS = new Set(['fillStyle', 'strokeStyle', 'shadowColor']);

// proxy de dégradé → vrai dégradé natif (le canvas refuse un Proxy en fillStyle/strokeStyle)
const RAW_GRADIENT = new WeakMap();

function wrapGradient(grad, remap) {
  const proxy = new Proxy(grad, {
    get(t, prop) {
      if (prop === 'addColorStop') return (offset, color) => t.addColorStop(offset, remap(color));
      const v = Reflect.get(t, prop, t);
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
  RAW_GRADIENT.set(proxy, grad);
  return proxy;
}

/**
 * Enveloppe un contexte 2D : toutes les couleurs écrites passent par la recoloration.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string|null} guildId      serveur dont on applique le thème
 * @param {{theme?:object, also?:string[], tintDark?:boolean}} [opts]
 *        theme : forcer un thème (aperçu) ; also : couleurs d'accent propres à la carte ;
 *        tintDark : teinter aussi les fonds noirs neutres (cartes sans vert)
 * @returns le même ctx (thème par défaut) ou un proxy
 */
function themedCtx(ctx, guildId, opts = {}) {
  const theme = opts.theme || getTheme(guildId);
  const look = LOOKS[theme.look] ? theme.look : 'neon';
  const lf = lookFn(look);
  if (isDefault(theme) && !lf) return ctx;
  const base = isDefault(theme) ? (c => c) : buildRemapper(theme, opts.also || [], !!opts.tintDark);
  const themed = proxyCtx(ctx, lf ? (c => lf(base(c))) : base, !!lf);
  return look === 'fume' ? require('./glassCard').glassProxy(ctx, themed, theme.accent, theme) : themed;
}

/**
 * Applique uniquement le look (sans recoloration du thème) : pour les cartes dont les couleurs
 * sont fixes par type (ex. cartes vocales : vert / rouge / orange).
 */
function lookCtx(ctx, guildId, opts = {}) {
  const theme = opts.theme || getTheme(guildId);
  const lk = LOOKS[theme.look] ? theme.look : 'neon';
  const lf = lookFn(lk);
  if (!lf) return ctx;
  const themed = proxyCtx(ctx, lf, true);
  return lk === 'fume' ? require('./glassCard').glassProxy(ctx, themed, theme.accent, theme) : themed;
}

function proxyCtx(ctx, remap, noGlow) {
  return new Proxy(ctx, {
    set(t, prop, value) {
      if (COLOR_PROPS.has(prop)) {
        t[prop] = typeof value === 'string' ? remap(value) : (RAW_GRADIENT.get(value) || value);
      } else if (noGlow && prop === 'shadowBlur') {
        t[prop] = 0; // pas de halo lumineux hors du style néon
      } else {
        t[prop] = value;
      }
      return true;
    },
    get(t, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createConicGradient') {
        return (...args) => wrapGradient(t[prop](...args), remap);
      }
      const v = Reflect.get(t, prop, t);
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
}

/** Couleur d'accent en entier (pour les barres de Container / embeds). */
function accentInt(guildId) {
  return parseInt(getTheme(guildId).accent.slice(1), 16);
}

/** Couleur de la barre des Containers : celle du thème, ou `fallback` si le serveur garde le thème par défaut. */
function containerAccent(guildId, fallback = 0xFFFFFF) {
  const t = getTheme(guildId);
  return isDefault(t) ? fallback : parseInt(t.accent.slice(1), 16);
}

module.exports = {
  containerAccent,
  PRESETS,
  BG_MODES,
  LOOKS,
  LOG_STYLES,
  lookCtx,
  DEFAULT_THEME,
  getTheme,
  setTheme,
  resetTheme,
  applyPreset,
  themedCtx,
  accentInt,
  normHex
};
