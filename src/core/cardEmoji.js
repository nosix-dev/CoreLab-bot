'use strict';

// ───────────────────────────────────────────────────────────
// Emojis dans les cartes image (canvas)
//  - emojis Unicode  -> images Twemoji (CDN jsDelivr), mises en cache sur disque
//  - emojis custom Discord <:nom:id> / <a:nom:id> -> CDN Discord
// Les polices serveur ne gèrent pas les emojis : on les dessine comme des images.
//
// Utilisation :
//   await preloadEmojis([texte1, texte2, ...]);   // télécharge ce qui manque (async)
//   measureRich(ctx, texte, FONT, 30);            // largeur (sync)
//   drawRich(ctx, texte, x, y, FONT, 30, {...});  // dessin (sync)
// ───────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { loadImage } = require('@napi-rs/canvas');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'emoji_cache');
const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/';
const DISCORD_BASE = 'https://cdn.discordapp.com/emojis/';
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignoré */ }

const images = new Map();   // clé -> Image | null (null = introuvable)
const pending = new Map();  // clé -> Promise en cours

const EMOJI_RE = new RegExp(
  '<a?:\\w+:\\d+>' +
  '|[\\u{1F1E6}-\\u{1F1FF}]{2}' +
  '|[0-9#*]\\uFE0F?\\u20E3' +
  '|\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])?' +
  '(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])?)*',
  'gu'
);

// ™ © ® ↔ … sont "pictographiques" mais restent du texte tant qu'ils ne sont pas en présentation emoji
function isEmojiMatch(m) {
  if (m.startsWith('<') || /^[0-9#*]/.test(m)) return true;
  if (Array.from(m).length > 1) return true;
  if (m.codePointAt(0) >= 0x1F000) return true; // 🔈 etc. (emoji sans présentation par défaut)
  return /\p{Emoji_Presentation}/u.test(m);
}

function describe(m) {
  const custom = m.match(/^<a?:\w+:(\d+)>$/);
  if (custom) return { key: `c_${custom[1]}`, url: `${DISCORD_BASE}${custom[1]}.png?size=96` };
  let cps = Array.from(m).map(c => c.codePointAt(0));
  if (!cps.includes(0x200d)) cps = cps.filter(c => c !== 0xfe0f);
  const code = cps.map(c => c.toString(16)).join('-');
  return { key: `u_${code}`, url: `${TWEMOJI_BASE}${code}.png` };
}

// Retire les sélecteurs invisibles et convertit les lettres « fancy » (𝐉 𝐁 ᴴ Ⓐ ＡＢＣ) en lettres normales,
// que la police sait afficher (™ et autres symboles restent intacts)
const FANCY = /[\u{1D400}-\u{1D7FF}\u1D2C-\u1D6A\u24B6-\u24E9\uFF01-\uFF5E]/gu;
const textOf = v => v.replace(/[\uFE0F\u200D]/g, '').replace(FANCY, c => c.normalize('NFKC'));

// Découpe un texte en segments { t:'text', v } / { t:'emoji', raw, key, url }
function tokenize(str) {
  const s = String(str ?? '');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(EMOJI_RE)) {
    if (!isEmojiMatch(m[0])) continue;
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    out.push({ t: 'emoji', raw: m[0], ...describe(m[0]) });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out;
}

// Unités insécables : un emoji = 1 unité, un caractère = 1 unité
function splitUnits(str) {
  const out = [];
  for (const t of tokenize(str)) {
    if (t.t === 'emoji') out.push(t.raw);
    else out.push(...Array.from(textOf(t.v)));
  }
  return out;
}

// Tronque à n unités (sans casser un emoji) + « … »
function truncateRich(str, n) {
  const clean = String(str ?? '').replace(/\s+/g, ' ').trim();
  const units = splitUnits(clean);
  if (units.length <= n) return clean;
  return units.slice(0, n - 1).join('').trimEnd() + '…';
}

async function loadOne(key, url) {
  if (images.has(key)) return;
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    const file = path.join(CACHE_DIR, `${key}.png`);
    try {
      let buf = null;
      if (fs.existsSync(file)) {
        buf = fs.readFileSync(file);
      } else {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          buf = Buffer.from(await res.arrayBuffer());
          try { fs.writeFileSync(file, buf); } catch { /* cache disque facultatif */ }
        } else if (res.status === 404) {
          images.set(key, null);
          return;
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      }
      images.set(key, await loadImage(buf));
    } catch {
      // Échec réseau : on réessaiera dans 5 minutes
      images.set(key, null);
      setTimeout(() => images.delete(key), 5 * 60 * 1000).unref?.();
    }
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

// À appeler avant de dessiner : charge toutes les images d'emojis présentes dans ces textes
async function preloadEmojis(strings) {
  const wanted = new Map();
  for (const s of strings) {
    if (s === undefined || s === null) continue;
    for (const t of tokenize(s)) if (t.t === 'emoji') wanted.set(t.key, t.url);
  }
  await Promise.all([...wanted].map(([k, u]) => loadOne(k, u)));
}

const emojiW = size => Math.round(size * 1.12);
const GAP = 0.06;

function measureRich(ctx, str, family, size) {
  ctx.font = `${size}px ${family}`;
  let w = 0;
  for (const t of tokenize(str)) {
    if (t.t === 'text') w += ctx.measureText(textOf(t.v)).width;
    else if (images.get(t.key)) w += emojiW(size) + size * GAP;
  }
  return w;
}

// Dessine texte + emojis ; opts : { color, align: 'left'|'center'|'right' } ; retourne la largeur
function drawRich(ctx, str, x, y, family, size, opts = {}) {
  const total = measureRich(ctx, str, family, size);
  let cx = x;
  if (opts.align === 'right') cx = x - total;
  else if (opts.align === 'center') cx = x - total / 2;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  ctx.font = `${size}px ${family}`;
  if (opts.color) ctx.fillStyle = opts.color;
  for (const t of tokenize(str)) {
    if (t.t === 'text') {
      const v = textOf(t.v);
      ctx.fillText(v, cx, y);
      cx += ctx.measureText(v).width;
    } else {
      const img = images.get(t.key);
      if (!img) continue;
      const w = emojiW(size);
      const shadow = ctx.shadowBlur;
      ctx.shadowBlur = 0; // pas de halo néon autour des emojis
      ctx.drawImage(img, cx, y - size * 0.88, w, w);
      ctx.shadowBlur = shadow;
      cx += w + size * GAP;
    }
  }
  ctx.textAlign = prevAlign;
  return total;
}

// Réduit la taille jusqu'à ce que le texte tienne dans maxW ; retourne la taille retenue
function fitSize(ctx, str, family, size, maxW, min = 18) {
  let s = size;
  while (s > min && measureRich(ctx, str, family, s) > maxW) s -= 2;
  return s;
}

module.exports = {
  tokenize,
  splitUnits,
  truncateRich,
  preloadEmojis,
  measureRich,
  drawRich,
  fitSize
};