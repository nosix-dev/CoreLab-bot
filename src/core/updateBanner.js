'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Bannière automatique des annonces `update.json` (image en bas du message).
//  generateUpdateBanner(data) → Buffer PNG 1920×800
//
// Style « Règlement » : fond sombre, halo orange, logo CoreLab, tuiles en verre,
// titre dégradé, trait orange, accroche en italique, texte gris, pastilles.
//
// Tout est déduit de update.json, rien à fournir :
//  • pastille du haut : « MISE À JOUR » + version + date
//  • titre (2 lignes)  : `banniere.titre` / `banniere.sousTitre`, sinon `titre` nettoyé
//  • accroche italique : `banniere.accroche`, sinon 1re phrase de `intro`
//  • texte gris        : le reste de `intro`, sinon le nom des sections de `modifications`
//  • pastilles du bas  : `banniere.commandes`, sinon les /commandes citées + « N changements »
//  • pied (à droite)   : `pied`
// Facultatif : "banniere": { "titre": "", "sousTitre": "", "accroche": "Simple. Pour tous.", "badge": "NOUVEAUTÉ", "commandes": ["/xxx"] }
// (l'ancienne clé "banner": { ligne1, ligne2, commandes } fonctionne toujours)
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
try {
  if (fs.existsSync(FONT_DIR)) {
    for (const f of fs.readdirSync(FONT_DIR)) {
      if (/\.(ttf|otf)$/i.test(f)) GlobalFonts.registerFromPath(path.join(FONT_DIR, f), 'Inter');
    }
  }
} catch { /* police système */ }

const FAMILLE = '"Inter","Helvetica Neue","Liberation Sans","DejaVu Sans",Arial,sans-serif';
const police = (poids, taille, italique = false) => `${italique ? 'italic ' : ''}${poids} ${taille}px ${FAMILLE}`;

const W = 1920;
const H = 800;
const ORANGE = '#e8510d';
const ORANGE_CLAIR = '#ff8a45';
const ORANGE_FONCE = '#c9420a';
const GRIS = '#9a8d85';
const BLANC = '#ffffff';
const MOIS = ['JAN.', 'FÉV.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.'];

// ── Utilitaires texte ────────────────────────────────────────────────────

function nettoyer(s) {
  return String(s ?? '')
    .replace(/:[a-z0-9_+-]+:/gi, ' ')
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ' ')
    .replace(/^\s*\[(?:\+|-|~|i|!)\]\s*/, '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\*\*|__|`|~~/g, '')
    .replace(/\\n|\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// « 📌 Mise a jour 5.5.42 — Interserveur : comment ça marche (5.5.42) » → « Interserveur : comment ça marche »
function titreNettoye(data) {
  let t = nettoyer(data.titre)
    .replace(/^\s*mise\s+[àa]\s+jour\s+v?[\d.]+\s*[—–:-]*\s*/i, '')
    .replace(/\s*\(\s*v?[\d.]+\s*\)\s*$/, '')
    .trim();
  if (!t) t = 'Mise à jour';
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

function sections(data) {
  const m = data.modifications ?? data.changes;
  if (Array.isArray(m)) return [{ nom: '', items: m }];
  if (m && typeof m === 'object') {
    return Object.entries(m).map(([nom, items]) => ({ nom: nettoyer(nom), items: Array.isArray(items) ? items : [items] }));
  }
  return [];
}

function commandes(data, cfg) {
  if (Array.isArray(cfg.commandes) && cfg.commandes.length) return cfg.commandes.map(String).slice(0, 3);
  const texte = JSON.stringify(data.modifications ?? data.changes ?? '') + ' ' + String(data.intro || '');
  const sans = texte.replace(/https?:\/\/\S+/g, ' ').replace(/\\n/g, ' ');
  const trouvees = [...new Set((sans.match(/(?<![\w/:.])\/[a-z][\w-]{1,30}(?![\w/-])/gi) || []).map(c => c.toLowerCase()))];
  return trouvees.slice(0, 3);
}

function dateFr(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${parseInt(m[3], 10)} ${MOIS[parseInt(m[2], 10) - 1] || ''} ${m[1]}`.trim();
}

// Plus grande taille ≤ max pour que le texte tienne dans maxW
function ajuster(ctx, texte, poids, max, maxW, min, italique = false) {
  let s = max;
  ctx.font = police(poids, s, italique);
  while (s > min && ctx.measureText(texte).width > maxW) { s -= 2; ctx.font = police(poids, s, italique); }
  return s;
}

function couper(ctx, texte, maxW) {
  if (ctx.measureText(texte).width <= maxW) return texte;
  let t = texte;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  const i = t.lastIndexOf(' ');
  if (i > t.length * 0.5) t = t.slice(0, i);
  return t.replace(/[\s,;:.-]+$/, '') + '…';
}

function lignesMax(ctx, texte, maxW, max) {
  const lignes = [];
  let cur = '';
  const mots = texte.split(' ');
  for (let i = 0; i < mots.length; i++) {
    const essai = cur ? `${cur} ${mots[i]}` : mots[i];
    if (cur && ctx.measureText(essai).width > maxW) {
      lignes.push(cur);
      cur = mots[i];
      if (lignes.length === max - 1) { cur = mots.slice(i).join(' '); break; }
    } else cur = essai;
  }
  if (cur) lignes.push(couper(ctx, cur, maxW));
  return lignes.slice(0, max);
}

function espace(ctx, texte, x, y, ecart) {
  let cx = x;
  for (const c of texte) {
    ctx.fillText(c, cx, y);
    cx += ctx.measureText(c).width + ecart;
  }
  return cx - ecart;
}
function largeurEspacee(ctx, texte, ecart) {
  let w = 0;
  for (const c of texte) w += ctx.measureText(c).width + ecart;
  return w - ecart;
}

// ── Formes ───────────────────────────────────────────────────────────────

function arrondi(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function etincelle(ctx, x, y, r, couleur) {
  ctx.fillStyle = couleur;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

function point(ctx, x, y, r) {
  ctx.save();
  ctx.shadowColor = 'rgba(255,150,80,0.9)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#ffd7bd';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Logo : quatre croisillons (un par quadrant), avec un crochet vers l'extérieur
function logo(ctx, cx, cy) {
  const centres = [[-88, -92, -1, 1], [88, -92, 1, 1], [-88, 92, -1, -1], [88, 92, 1, -1]];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ORANGE;
  ctx.shadowColor = 'rgba(255,90,10,0.85)';
  ctx.shadowBlur = 50;
  for (const [dx, dy, sx, sy] of centres) {
    const x = cx + dx, y = cy + dy;
    ctx.lineWidth = 42;
    ctx.beginPath();
    ctx.moveTo(x - 40, y - 40); ctx.lineTo(x + 40, y + 40);
    ctx.moveTo(x + 40, y - 40); ctx.lineTo(x - 40, y + 40);
    ctx.stroke();
    // crochet extérieur (vers la ligne médiane)
    ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.moveTo(x + sx * 62, y + sy * 14);
    ctx.quadraticCurveTo(x + sx * 96, y + sy * 8, x + sx * 98, y + sy * 52);
    ctx.stroke();
  }
  ctx.restore();
}

function tuile(ctx, x, y, taille, rot, dessin, { orange = false } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const r = taille * 0.27;
  if (orange) {
    ctx.shadowColor = 'rgba(255,100,20,0.75)';
    ctx.shadowBlur = 60;
    const g = ctx.createLinearGradient(-taille / 2, -taille / 2, taille / 2, taille / 2);
    g.addColorStop(0, '#ff8a45');
    g.addColorStop(1, '#c9420a');
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
  }
  arrondi(ctx, -taille / 2, -taille / 2, taille, taille, r);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (!orange) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();
  }
  ctx.strokeStyle = orange ? '#2a0f05' : 'rgba(255,225,205,0.78)';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = orange ? 9 : 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  dessin(ctx, taille * (orange ? 0.5 : 0.42));
  ctx.restore();
}

const ICONES = {
  bouclier(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, -s / 2);
    ctx.lineTo(s * 0.42, -s * 0.32);
    ctx.lineTo(s * 0.42, s * 0.08);
    ctx.quadraticCurveTo(s * 0.4, s * 0.34, 0, s / 2);
    ctx.quadraticCurveTo(-s * 0.4, s * 0.34, -s * 0.42, s * 0.08);
    ctx.lineTo(-s * 0.42, -s * 0.32);
    ctx.closePath();
    ctx.stroke();
  },
  coeur(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.42);
    ctx.bezierCurveTo(-s * 0.7, -s * 0.05, -s * 0.38, -s * 0.5, 0, -s * 0.2);
    ctx.bezierCurveTo(s * 0.38, -s * 0.5, s * 0.7, -s * 0.05, 0, s * 0.42);
    ctx.stroke();
  },
  eclair(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(s * 0.12, -s / 2);
    ctx.lineTo(-s * 0.3, s * 0.08);
    ctx.lineTo(0, s * 0.08);
    ctx.lineTo(-s * 0.12, s / 2);
    ctx.lineTo(s * 0.3, -s * 0.1);
    ctx.lineTo(0, -s * 0.1);
    ctx.closePath();
    ctx.stroke();
  },
  cloche(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.4, s * 0.25);
    ctx.quadraticCurveTo(-s * 0.3, s * 0.1, -s * 0.3, -s * 0.1);
    ctx.arc(0, -s * 0.1, s * 0.3, Math.PI, 0);
    ctx.quadraticCurveTo(s * 0.3, s * 0.1, s * 0.4, s * 0.25);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, s * 0.38, s * 0.07, 0, Math.PI * 2);
    ctx.stroke();
  },
  // Tuile orange : flèche vers le haut (mise à jour) dans une page
  maj(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.32, -s * 0.5);
    ctx.lineTo(s * 0.1, -s * 0.5);
    ctx.lineTo(s * 0.34, -s * 0.26);
    ctx.lineTo(s * 0.34, s * 0.5);
    ctx.lineTo(-s * 0.32, s * 0.5);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, s * 0.3);
    ctx.lineTo(0, -s * 0.08);
    ctx.moveTo(-s * 0.15, s * 0.07);
    ctx.lineTo(0, -s * 0.08);
    ctx.lineTo(s * 0.15, s * 0.07);
    ctx.stroke();
  }
};

// ── Bannière ─────────────────────────────────────────────────────────────

function generateUpdateBanner(data) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const cfg = (data.banniere && typeof data.banniere === 'object' ? data.banniere : null)
    || (data.banner && typeof data.banner === 'object' ? data.banner : {});

  // Fond + halo orange
  ctx.fillStyle = '#0d0806';
  ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(510, 340, 20, 510, 340, 620);
  g.addColorStop(0, 'rgba(232,81,13,0.38)');
  g.addColorStop(0.5, 'rgba(150,50,8,0.16)');
  g.addColorStop(1, 'rgba(13,8,6,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(1500, 330, 10, 1500, 330, 520);
  g.addColorStop(0, 'rgba(232,81,13,0.10)');
  g.addColorStop(1, 'rgba(13,8,6,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Cadre arrondi
  arrondi(ctx, 22, 22, W - 44, H - 44, 56);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,140,60,0.16)';
  ctx.stroke();

  // Orbites
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(255,150,90,0.28)';
  ctx.beginPath(); ctx.ellipse(520, 350, 330, 285, 0.05, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(520, 360, 355, 235, -0.2, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([5, 7]);
  ctx.strokeStyle = 'rgba(255,150,90,0.22)';
  ctx.beginPath(); ctx.ellipse(520, 350, 290, 200, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,130,60,0.5)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(750, 200, 170, -1.0, 0.55); ctx.stroke();

  // Lueur au sol
  g = ctx.createRadialGradient(510, 655, 5, 510, 655, 170);
  g.addColorStop(0, 'rgba(232,81,13,0.42)');
  g.addColorStop(1, 'rgba(232,81,13,0)');
  ctx.save();
  ctx.translate(0, 655); ctx.scale(1, 0.18); ctx.translate(0, -655);
  ctx.fillStyle = g;
  ctx.fillRect(300, 480, 420, 350);
  ctx.restore();

  logo(ctx, 510, 325);

  // Tuiles + décor
  tuile(ctx, 207, 163, 96, -0.14, ICONES.bouclier);
  tuile(ctx, 450, 78, 66, 0.12, ICONES.eclair);
  tuile(ctx, 850, 535, 84, -0.1, ICONES.coeur);
  tuile(ctx, 214, 582, 70, 0.14, ICONES.cloche);
  tuile(ctx, 766, 162, 168, 0.17, ICONES.maj, { orange: true });
  etincelle(ctx, 362, 154, 14, 'rgba(255,190,150,0.8)');
  etincelle(ctx, 146, 408, 20, 'rgba(255,190,150,0.7)');
  etincelle(ctx, 740, 682, 14, 'rgba(255,190,150,0.7)');
  point(ctx, 202, 440, 11);
  point(ctx, 690, 424, 11);

  // ── Colonne de droite ──
  const X = 962;
  const maxW = 880;

  // Pastille du haut : MISE À JOUR · version
  const version = String(data.version ?? '').trim();
  const badge = nettoyer(cfg.badge || (version ? `MISE À JOUR ${version}` : 'MISE À JOUR')).toUpperCase();
  ctx.font = police(600, 25);
  const bw = largeurEspacee(ctx, badge, 6) + 118;
  arrondi(ctx, X, 148, bw, 64, 32);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(232,81,13,0.55)';
  ctx.stroke();
  ctx.fillStyle = ORANGE;
  ctx.beginPath(); ctx.arc(X + 34, 180, 20, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(X + 34, 180);
  ctx.strokeStyle = '#2a0f05'; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -8); ctx.moveTo(-6, -2); ctx.lineTo(0, -8); ctx.lineTo(6, -2); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#f3e7df';
  ctx.font = police(600, 25);
  espace(ctx, badge, X + 76, 190, 6);
  const date = dateFr(data.date);
  if (date) {
    ctx.font = police(500, 24);
    ctx.fillStyle = GRIS;
    ctx.fillText(date, X + bw + 26, 190);
  }

  // Titre sur deux lignes
  let [l1, l2] = cfg.titre || cfg.ligne1
    ? [nettoyer(cfg.titre || cfg.ligne1), nettoyer(cfg.sousTitre || cfg.ligne2 || '')]
    : deuxLignes(titreNettoye(data));
  l1 = l1.toUpperCase();
  l2 = l2.toUpperCase();
  let ts = 112;
  for (const l of [l1, l2]) if (l) ts = Math.min(ts, ajuster(ctx, l, 800, 112, maxW, 44));
  ctx.font = police(800, ts);
  const y1 = 330;
  const y2 = y1 + Math.round(ts * 0.9);

  g = ctx.createLinearGradient(X, y1 - ts, X + maxW, y1);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#ffe2d0');
  ctx.fillStyle = g;
  ctx.fillText(couper(ctx, l1, maxW), X, y1);

  if (l2) {
    ctx.save();
    ctx.shadowColor = 'rgba(255,100,20,0.55)';
    ctx.shadowBlur = 40;
    g = ctx.createLinearGradient(X, y2 - ts, X + maxW, y2);
    g.addColorStop(0, ORANGE_CLAIR);
    g.addColorStop(1, ORANGE_FONCE);
    ctx.fillStyle = g;
    ctx.font = police(800, ts);
    ctx.fillText(couper(ctx, l2, maxW), X, y2);
    ctx.restore();
  }

  // Trait orange
  const yTrait = (l2 ? y2 : y1) + 58;
  ctx.fillStyle = ORANGE;
  arrondi(ctx, X, yTrait, 120, 6, 3);
  ctx.fill();

  // Accroche + texte gris
  const intro = nettoyer(data.intro);
  const secs = sections(data);
  let accroche = '';
  let reste = '';
  if (cfg.accroche) {
    accroche = Array.isArray(cfg.accroche) ? cfg.accroche.map(nettoyer).join(' ') : nettoyer(cfg.accroche);
    reste = intro;
  } else if (intro) {
    const m = intro.match(/^(.+?)(?:\s*:\s+|(?<=[.!?])\s+)(.+)$/);
    accroche = m ? m[1] : intro;
    reste = m ? m[2] : '';
  } else {
    accroche = version ? `Nouveautés de la version ${version}` : 'Nouveautés';
  }
  if (!reste) reste = secs.map(s => s.nom).filter(Boolean).join(' · ');

  const yAcc = yTrait + 70;
  const tAcc = ajuster(ctx, accroche, 500, 44, maxW, 28, true);
  ctx.font = police(500, tAcc, true);
  const accCoupee = couper(ctx, accroche, maxW);
  // Première partie en blanc, dernière partie en orange (coupe sur « . » / « ? » / « ! » / milieu des mots)
  let p1 = accCoupee, p2 = '';
  const mp = accCoupee.match(/^(.+?[.!?])\s+(.+)$/);
  if (Array.isArray(cfg.accroche) && cfg.accroche.length > 1) {
    p1 = nettoyer(cfg.accroche[0]); p2 = nettoyer(cfg.accroche.slice(1).join(' '));
  } else if (mp) { p1 = mp[1]; p2 = mp[2]; }
  else {
    const mots = accCoupee.split(' ');
    if (mots.length > 3) { const k = Math.ceil(mots.length * 0.55); p1 = mots.slice(0, k).join(' '); p2 = mots.slice(k).join(' '); }
  }
  ctx.fillStyle = BLANC;
  ctx.fillText(p1, X, yAcc);
  if (p2) {
    const w1 = ctx.measureText(p1 + ' ').width;
    ctx.fillStyle = ORANGE_CLAIR;
    ctx.fillText(couper(ctx, p2, Math.max(60, maxW - w1)), X + w1, yAcc);
  }

  // Texte gris (2 lignes max, dernière ligne en blanc)
  let yBas = yAcc;
  if (reste) {
    ctx.font = police(400, 32);
    const lignes = lignesMax(ctx, reste, maxW, 2);
    lignes.forEach((l, i) => {
      yBas = yAcc + 52 + i * 44;
      ctx.fillStyle = lignes.length > 1 && i === lignes.length - 1 ? '#f1e7e0' : GRIS;
      ctx.fillText(l, X, yBas);
    });
  }

  // Pastilles du bas : commandes + nombre de changements
  const total = secs.reduce((n, s) => n + s.items.length, 0);
  const pastilles = commandes(data, cfg).map(c => ({ t: c, cmd: true }));
  if (total) pastilles.push({ t: `${total} changement${total > 1 ? 's' : ''}`, cmd: false });
  if (pastilles.length) {
    const py = Math.max(yBas + 34, 668);
    let px = X;
    ctx.font = police(700, 26);
    for (const p of pastilles) {
      const w = Math.ceil(ctx.measureText(p.t).width) + 52;
      if (px + w > X + maxW + 40) break;
      arrondi(ctx, px, py, w, 54, 27);
      ctx.fillStyle = p.cmd ? 'rgba(232,81,13,0.14)' : 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = p.cmd ? 'rgba(255,125,55,0.75)' : 'rgba(255,255,255,0.18)';
      ctx.stroke();
      ctx.fillStyle = p.cmd ? '#ffe3d2' : '#cfc3bb';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.t, px + 26, py + 28);
      ctx.textBaseline = 'alphabetic';
      px += w + 16;
    }
  }

  // Pied (bas à droite)
  const pied = nettoyer(data.pied);
  if (pied) {
    ctx.font = police(500, 22);
    ctx.fillStyle = 'rgba(154,141,133,0.8)';
    ctx.textAlign = 'center';
    ctx.fillText(couper(ctx, pied, 760), 510, H - 58);
    ctx.textAlign = 'left';
  }

  return canvas.toBuffer('image/png');
}

module.exports = { generateUpdateBanner, titreNettoye, deuxLignes };