'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Bannière automatique des annonces `update.json` (image en bas du message).
//  generateUpdateBanner(data) → Buffer PNG
//
// Tout est déduit de update.json, rien à fournir :
//  • titre de la bannière : `titre` sans emoji, sans « Mise a jour x.y.z — » ni « (x.y.z) »
//  • pastilles            : les commandes /xxx citées dans `modifications` (3 max), sinon « Version x.y.z »
// Personnalisable (facultatif) : "banner": { "ligne1": "STATISTIQUES", "ligne2": "D'ACTIVITÉ", "commandes": ["/server-stats"] }
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
let POLICE_OK = false;
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'UpdBannerBold');
    GlobalFonts.registerFromPath(r, 'UpdBannerRegular');
    FONT = 'UpdBannerRegular';
    FONT_BOLD = 'UpdBannerBold';
    POLICE_OK = true;
  }
} catch { /* police système */ }

// Police : Poppins si disponible, sinon police système (le gras est alors demandé explicitement)
const police = (taille, gras) => (POLICE_OK ? `${taille}px ${gras ? FONT_BOLD : FONT}` : `${gras ? 'bold ' : ''}${taille}px sans-serif`);

const W = 1200;
const H = 420;
const BLEU = '#78a9ea';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Titre nettoyé : sans emoji / :code:, sans « Mise a jour 5.5.37 — », sans « (5.5.37) » final
function titreNettoye(data) {
  let t = String(data.titre || '')
    .replace(/:[a-z0-9_+-]+:/gi, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/\*\*|`/g, '')
    .replace(/^\s*mise\s+[àa]\s+jour\s+v?[\d.]+\s*[—–:-]\s*/i, '')
    .replace(/\s*\(v?[\d.]+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) t = 'Mise à jour';
  return t;
}

function commandes(data) {
  const b = data.banner?.commandes;
  if (Array.isArray(b) && b.length) return b.map(String).slice(0, 3);
  const texte = JSON.stringify(data.modifications ?? data.changes ?? '');
  const trouvees = [...new Set((texte.match(/(?<![\w/:.])\/[a-z][\w-]*/gi) || []).map(c => c.toLowerCase()))];
  return trouvees.slice(0, 3);
}

function wrap(ctx, texte, maxW) {
  const mots = texte.split(' ');
  const lignes = [];
  let cur = '';
  for (const m of mots) {
    const essai = cur ? `${cur} ${m}` : m;
    if (cur && ctx.measureText(essai).width > maxW) { lignes.push(cur); cur = m; } else cur = essai;
  }
  if (cur) lignes.push(cur);
  return lignes;
}

function generateUpdateBanner(data) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fond
  ctx.fillStyle = '#16181e';
  ctx.fillRect(0, 0, W, H);

  // Barres décoratives à droite (dégradé bleu → jaune)
  const barres = [
    { h: 120, c: '#2b3a63' }, { h: 150, c: '#2f4478' }, { h: 118, c: '#34518f' },
    { h: 200, c: '#3b63b4' }, { h: 175, c: '#3c6ac8' }, { h: 255, c: '#3f72d6' }, { h: 305, c: '#f2c441' },
  ];
  const bw = 62, gap = 22;
  const x0 = W - 70 - (barres.length * bw + (barres.length - 1) * gap);
  const base = H - 60;
  barres.forEach((b, i) => {
    ctx.fillStyle = b.c;
    roundRect(ctx, x0 + i * (bw + gap), base - b.h, bw, b.h, 10);
    ctx.fill();
  });

  const gauche = 70;
  const maxW = x0 - gauche - 40;

  // Nom du bot
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = police(92, true);
  ctx.fillText('CoreLab', gauche, 132);

  // Titre : 1er mot en bleu gras, le reste en blanc (2 lignes max)
  const titre = titreNettoye(data).toUpperCase();
  let ligne1 = data.banner?.ligne1 ? String(data.banner.ligne1).toUpperCase() : null;
  let ligne2 = data.banner?.ligne2 ? String(data.banner.ligne2).toUpperCase() : null;
  if (!ligne1) {
    const mots = titre.split(' ');
    ligne1 = mots.shift();
    ligne2 = mots.join(' ');
  }
  let t1 = 58;
  ctx.font = police(t1, true);
  while (ctx.measureText(ligne1).width > maxW && t1 > 30) { t1 -= 2; ctx.font = police(t1, true); }
  ctx.fillStyle = BLEU;
  let y = 200;
  ctx.fillText(ligne1, gauche, y);

  if (ligne2) {
    let t2 = 46;
    ctx.font = police(t2, false);
    let lignes = wrap(ctx, ligne2, maxW);
    while ((lignes.length > 2 || lignes.some(l => ctx.measureText(l).width > maxW)) && t2 > 26) {
      t2 -= 2; ctx.font = police(t2, false); lignes = wrap(ctx, ligne2, maxW);
    }
    ctx.fillStyle = '#f2f3f5';
    for (const l of lignes.slice(0, 2)) { y += t2 + 8; ctx.fillText(l, gauche, y); }
  }

  // Pastilles : commandes citées dans l'annonce, sinon la version
  const pastilles = commandes(data);
  if (!pastilles.length) pastilles.push(`Version ${String(data.version ?? '').trim()}`.trim());
  ctx.font = police(26, true);
  let px = gauche;
  const py = H - 78;
  for (const p of pastilles) {
    const w = Math.ceil(ctx.measureText(p).width) + 44;
    if (px + w > x0 - 30) break;
    ctx.fillStyle = '#1b2236';
    roundRect(ctx, px, py, w, 50, 25);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3f5f9a';
    ctx.stroke();
    ctx.fillStyle = '#dbe6f7';
    ctx.textBaseline = 'middle';
    ctx.fillText(p, px + 22, py + 26);
    ctx.textBaseline = 'alphabetic';
    px += w + 14;
  }

  return canvas.toBuffer('image/png');
}

module.exports = { generateUpdateBanner };