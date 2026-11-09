'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Bannière des annonces de mise à jour (update.json) — générée à chaque publication.
//   « CoreLab » en grand, titre en bleu + sous-titre, pastilles des commandes,
//   et un petit graphique en barres à droite (dernière barre en jaune).
//
// Tout vient de update.json, rien à configurer. Champs optionnels :
//   "banniere": { "titre": "STATISTIQUES", "sousTitre": "D'ACTIVITÉ", "commandes": ["/server-stats", "/user-stats"] }
//   "image": false  → aucune bannière   |   "image": "assets/x.png" ou URL → ta propre image
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

for (const dossier of [
  path.join(__dirname, '..', '..', 'assets', 'fonts'),
  path.join(__dirname, '..', 'assets', 'fonts')
]) {
  try {
    if (!fs.existsSync(dossier)) continue;
    for (const f of fs.readdirSync(dossier)) {
      if (/\.(ttf|otf)$/i.test(f)) GlobalFonts.registerFromPath(path.join(dossier, f), 'BannerFont');
    }
  } catch { /* police système */ }
}

const FONT = '"BannerFont","Helvetica Neue","Liberation Sans","DejaVu Sans",Arial,sans-serif';
const W = 1200;
const H = 420;
const BG = '#1c1f26';
const BLUE = '#3b82f6';
const BLUE_LIGHT = '#93c5fd';
const JAUNE = '#f6c542';
const BOX = '#252932';
const LIGNE = '#262a33';

function arrondi(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// Plus grande taille ≤ max pour que le texte tienne dans maxW
function taille(ctx, texte, poids, max, maxW, min = 26) {
  let s = max;
  while (s > min) {
    ctx.font = `${poids} ${s}px ${FONT}`;
    if (ctx.measureText(texte).width <= maxW) break;
    s -= 2;
  }
  ctx.font = `${poids} ${s}px ${FONT}`;
  return s;
}

function coupe(ctx, texte, maxW) {
  if (ctx.measureText(texte).width <= maxW) return texte;
  let t = texte;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

// « 📌 Mise a jour 5.5.32 — Agenda : nouveau look (5.5.32) » → « Agenda : nouveau look »
function titreNettoye(data) {
  let t = String(data.titre || '')
    .replace(/:[a-z0-9_+-]+:/gi, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/\(\s*v?\d+(?:\.\d+)+\s*\)/g, ' ')
    .replace(/^\s*mise\s+[aà]\s+jour\s+v?\d+(?:\.\d+)*\s*[—–:-]*\s*/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) t = `Mise à jour ${data.version || ''}`.trim();
  return t;
}

// Deux lignes : coupe sur « : » / « — », sinon équilibre les mots
function deuxLignes(titre) {
  const m = titre.match(/^(.+?)\s*[:—–]\s*(.+)$/);
  if (m) return [m[1].trim(), m[2].trim()];
  const mots = titre.split(' ');
  if (mots.length < 2) return [titre, ''];
  let meilleur = 1, ecart = Infinity;
  for (let i = 1; i < mots.length; i++) {
    const e = Math.abs(mots.slice(0, i).join(' ').length - mots.slice(i).join(' ').length);
    if (e < ecart) { ecart = e; meilleur = i; }
  }
  return [mots.slice(0, meilleur).join(' '), mots.slice(meilleur).join(' ')];
}

// Commandes citées dans les modifications (/agenda, /server-stats…), sans les sous-commandes
function commandesDetectees(data) {
  const brut = JSON.stringify(data.modifications ?? data.changes ?? '') + ' ' + String(data.intro || '');
  const texte = brut.replace(/\\n/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  const trouvees = [];
  for (const m of texte.matchAll(/(?:^|[\s*`("'])(\/[a-z][a-z0-9-]{1,30})(?![a-z0-9/-])/gi)) {
    const c = m[1].toLowerCase();
    if (!trouvees.includes(c)) trouvees.push(c);
  }
  return trouvees;
}

// Hauteurs des barres : croissantes, un peu différentes à chaque version
function hauteursBarres(version) {
  const base = [0.30, 0.45, 0.38, 0.68, 0.58, 0.82, 1.0];
  const h = crypto.createHash('sha1').update(String(version)).digest();
  return base.map((b, i) => (i === base.length - 1 ? 1.0 : Math.min(0.95, Math.max(0.2, b + ((h[i] / 255) - 0.5) * 0.16))));
}

/**
 * @param {object} data   contenu de update.json
 * @param {string} nomBot nom affiché en grand (par défaut « CoreLab »)
 * @returns {Buffer} PNG 1200×420
 */
function generateUpdateBanner(data, nomBot) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const cfg = data.banniere && typeof data.banniere === 'object' ? data.banniere : {};
  let [l1, l2] = cfg.titre ? [String(cfg.titre), String(cfg.sousTitre || '')] : deuxLignes(titreNettoye(data));
  l1 = l1.toUpperCase();
  l2 = l2.toUpperCase();

  const x = 70;
  const maxW = 500;

  // Nom du bot
  const nom = String(data.nom || nomBot || 'CoreLab');
  taille(ctx, nom, 'bold', 104, maxW + 40, 54);
  ctx.fillStyle = '#f7f8fa';
  ctx.fillText(nom, x, 172);

  // Titre bleu + sous-titre blanc
  taille(ctx, l1, 'bold', 56, maxW, 30);
  ctx.fillStyle = BLUE_LIGHT;
  ctx.fillText(coupe(ctx, l1, maxW), x + 2, 247);
  if (l2) {
    taille(ctx, l2, 'normal', 56, maxW, 30);
    ctx.fillStyle = '#f3f4f6';
    ctx.fillText(coupe(ctx, l2, maxW), x + 2, 310);
  }

  // Pastilles des commandes
  const cmds = (Array.isArray(cfg.commandes) ? cfg.commandes.map(String) : commandesDetectees(data)).slice(0, 3);
  let px = x;
  ctx.font = `bold 24px ${FONT}`;
  for (const c of cmds) {
    const largeur = Math.max(120, ctx.measureText(c).width + 56);
    if (px + largeur > x + maxW + 30) break;
    arrondi(ctx, px, 336, largeur, 46, 23);
    ctx.fillStyle = BOX;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = BLUE;
    ctx.stroke();
    ctx.fillStyle = '#f3f4f6';
    ctx.textBaseline = 'middle';
    ctx.fillText(c, px + 28, 360);
    ctx.textBaseline = 'alphabetic';
    px += largeur + 14;
  }

  // Graphique en barres
  ctx.fillStyle = LIGNE;
  for (const gy of [115, 170, 225, 280, 335]) ctx.fillRect(600, gy, 540, 2);

  const hauts = hauteursBarres(data.version);
  const bw = 56, gap = 24, baseY = 350, maxH = 250, x0 = 604;
  hauts.forEach((r, i) => {
    const hh = Math.round(maxH * r);
    const bx = x0 + i * (bw + gap);
    const by = baseY - hh;
    const dernier = i === hauts.length - 1;
    ctx.fillStyle = dernier ? JAUNE : `rgba(59,130,246,${(0.32 + (i / (hauts.length - 1)) * 0.6).toFixed(2)})`;
    // coins arrondis en haut seulement
    ctx.beginPath();
    ctx.moveTo(bx, baseY);
    ctx.lineTo(bx, by + 10);
    ctx.arcTo(bx, by, bx + 10, by, 10);
    ctx.lineTo(bx + bw - 10, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + 10, 10);
    ctx.lineTo(bx + bw, baseY);
    ctx.closePath();
    ctx.fill();
  });

  return canvas.toBuffer('image/png');
}

module.exports = { generateUpdateBanner, titreNettoye, deuxLignes, commandesDetectees };
