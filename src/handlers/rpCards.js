// src/handlers/rpCards.js
'use strict';

const { createCanvas, loadImage } = require('@napi-rs/canvas');

// ────────────────────────────────────────────────
// Utilitaires communs
// ────────────────────────────────────────────────

async function loadAvatar(url, w, h) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Avatar fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const img = await loadImage(buf);
  return { img, w, h };
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fmt(v, fallback = '—') {
  return v !== undefined && v !== null && v !== '' ? String(v) : fallback;
}

function drawStar(ctx, cx, cy, r, points = 5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? r : r / 2.2;
    const angle = (Math.PI / points) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawEuroStars(ctx, cx, cy, radius, count = 12, starSize = 4) {
  ctx.fillStyle = '#FFCC00';
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 / count) * i - Math.PI / 2;
    drawStar(ctx, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, starSize);
  }
}

// MRZ helpers — norme OACI
function padMRZ(str, len, char = '<') {
  const s = String(str).toUpperCase().replace(/[^A-Z0-9]/g, '<');
  return (s + char.repeat(len)).slice(0, len);
}
function yymmddFromFr(dateFr, fallback = '900101') {
  if (!dateFr || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateFr)) return fallback;
  const [d, m, y] = dateFr.split('/');
  return `${y.slice(-2)}${m.padStart(2, '0')}${d.padStart(2, '0')}`;
}

// ────────────────────────────────────────────────
// CARTE NATIONALE D'IDENTITÉ — format 2021 (carte bancaire)
// ────────────────────────────────────────────────

async function generateCarteIdentite(profile, avatarUrl) {
  { const cc = require('../core/compactCard');
    if (cc.isCompact(profile.guildId || null)) {
      return cc.renderCompact({
        guildId: profile.guildId || null, theme: 'violet', title: "🪪 Carte d'identité",
        sub: `${fmt(profile.prenom, '')} ${fmt(profile.nom, '')}`.trim().toUpperCase(),
        blocks: [
          { label: 'Né(e) le', value: fmt(profile.dateNaissance) },
          { label: 'Lieu de naissance', value: fmt(profile.lieuNaissance) },
          { label: 'Sexe', value: fmt(profile.sexe) },
          { label: 'Nationalité', value: fmt(profile.nationalite) },
          { label: 'Délivrée le', value: fmt(profile.dateDelivrance) },
          { label: 'Expire le', value: fmt(profile.dateExpiration) }
        ],
        footerLeft: `N° ${fmt(profile.numeroCi)}`, footerRight: 'Carte fictive · RP'
      });
    } }
  const W = 1011, H = 638;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fond global légèrement crème
  ctx.fillStyle = '#f7f6f2';
  ctx.fillRect(0, 0, W, H);

  // ─────── Bandeau bleu européen ───────
  ctx.fillStyle = '#003399';
  ctx.fillRect(0, 0, W, 95);

  // Étoiles européennes (coin haut gauche)
  drawEuroStars(ctx, 42, 48, 18, 12, 4);

  // Titre bilingue
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px Sans';
  ctx.fillText('RÉPUBLIQUE FRANÇAISE', 92, 50);
  ctx.font = '16px Sans';
  ctx.fillStyle = '#dfe6ff';
  ctx.fillText("CARTE NATIONALE D'IDENTITÉ", 92, 76);

  ctx.font = 'bold 13px Sans';
  ctx.fillStyle = '#FFCC00';
  ctx.fillText('IDENTITY CARD', 720, 45);
  ctx.font = '12px Sans';
  ctx.fillStyle = '#dfe6ff';
  ctx.fillText('CARTE NATIONALE', 720, 62);
  ctx.fillText("D'IDENTITÉ", 720, 78);

  // Bande tricolore sous le bleu
  ctx.fillStyle = '#003399'; ctx.fillRect(0, 95, W / 3, 6);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(W / 3, 95, W / 3, 6);
  ctx.fillStyle = '#EF4135'; ctx.fillRect((W / 3) * 2, 95, W / 3, 6);

  // Filigrane RF
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#003399';
  ctx.font = 'bold 320px Sans';
  ctx.fillText('RF', 620, 580);
  ctx.restore();

  // Photo
  const photoX = 40, photoY = 135, photoW = 210, photoH = 270;
  try {
    const { img: avatar } = await loadAvatar(avatarUrl, photoW, photoH);
    roundedRect(ctx, photoX, photoY, photoW, photoH, 6);
    ctx.save();
    ctx.clip();
    ctx.drawImage(avatar, photoX, photoY, photoW, photoH);
    ctx.restore();
    ctx.strokeStyle = '#b0b0b0';
    ctx.lineWidth = 2;
    roundedRect(ctx, photoX, photoY, photoW, photoH, 6);
    ctx.stroke();
  } catch (e) {
    console.error('[RP] Erreur chargement avatar CI :', e.message);
    ctx.fillStyle = '#dcdcdc';
    roundedRect(ctx, photoX, photoY, photoW, photoH, 6);
    ctx.fill();
  }

  // Champs officiels
  const labelX = 285;
  let y = 135;
  const field = (label, value, opts = {}) => {
    ctx.fillStyle = '#6b6b6b';
    ctx.font = '11px Sans';
    ctx.fillText(label.toUpperCase(), labelX, y);

    ctx.fillStyle = '#111111';
    ctx.font = `bold ${opts.fontSize || 19}px Sans`;
    ctx.fillText(fmt(value), labelX, y + 22);

    y += opts.gap || 42;
  };

  field('Nom / Surname', (profile.nom || '—').toUpperCase(), { fontSize: 20 });
  field('Prénom(s) / Given names', profile.prenom || '—', { fontSize: 20 });
  field('Sexe / Sex', profile.sexe || '—');
  field('Date de naissance / Date of birth', profile.dateNaissance || '—');
  field('Lieu de naissance / Place of birth', profile.lieuNaissance || '—');
  field('Nationalité / Nationality', profile.nationalite || 'Française');

  // N° de carte
  ctx.fillStyle = '#003399';
  ctx.font = 'bold 15px Sans';
  ctx.fillText('N° DE CARTE / CARD No.', 640, 440);
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 20px Sans';
  ctx.fillText(fmt(profile.numeroCi), 640, 464);

  // ─────── MRZ (TD1 — 3 lignes de 30 caractères) ───────
  const mrzTop = H - 100;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, mrzTop, W, 100);
  ctx.strokeStyle = '#d0d0d0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mrzTop);
  ctx.lineTo(W, mrzTop);
  ctx.stroke();

  const nomMRZ = padMRZ(profile.nom || 'UNKNOWN', 20);
  const prenomMRZ = padMRZ(profile.prenom || 'UNKNOWN', 15);
  const numCard = padMRZ(profile.numeroCi || '000000000', 9, '0');
  const ddnMRZ = yymmddFromFr(profile.dateNaissance, '900101');
  const sexeMRZ = (profile.sexe || 'X').toUpperCase()[0] || 'X';
  const expMRZ = yymmddFromFr(profile.dateExpiration || '01/01/2035', '350101');

  const mrzL1 = `${'FRA'}${nomMRZ}<<${prenomMRZ}`.slice(0, 30).padEnd(30, '<');
  const mrzL2 = `${numCard}FRA${ddnMRZ}${sexeMRZ}${expMRZ}`.padEnd(30, '<');
  const mrzL3 = `IDFRA${numCard}<<<<<<<<<<<<<<<<`.slice(0, 30).padEnd(30, '<');

  ctx.fillStyle = '#000000';
  ctx.font = 'bold 22px "Courier New", Courier, monospace';
  ctx.fillText(mrzL1, 40, mrzTop + 30);
  ctx.fillText(mrzL2, 40, mrzTop + 60);
  ctx.fillText(mrzL3, 40, mrzTop + 90);

  return canvas.toBuffer('image/png');
}

// ────────────────────────────────────────────────
// PERMIS DE CONDUIRE — format carte bancaire 2013+
// ────────────────────────────────────────────────

const CATEGORIES_PERMIS = ['AM', 'A1', 'A2', 'A', 'B1', 'B', 'BE', 'C1', 'C', 'D1', 'D'];

async function generatePermis(profile, avatarUrl) {
  { const cc = require('../core/compactCard');
    if (cc.isCompact(profile.guildId || null)) {
      const cats = (profile.permisCategories || '').split(',').filter(Boolean);
      return cc.renderCompact({
        guildId: profile.guildId || null, theme: 'amber', title: '🚗 Permis de conduire',
        sub: `${fmt(profile.prenom, '')} ${fmt(profile.nom, '')}`.trim().toUpperCase(),
        blocks: [
          { label: 'Né(e) le', value: fmt(profile.dateNaissance) },
          { label: 'Lieu de naissance', value: fmt(profile.lieuNaissance) },
          { label: 'Délivré le', value: fmt(profile.dateDelivrance) },
          { label: 'Expire le', value: fmt(profile.dateExpiration) }
        ],
        pills: cats.length ? cats.map(c => ({ text: c, tone: 'accent' })) : [{ text: 'Aucune catégorie', tone: 'bad' }],
        footerLeft: `N° ${fmt(profile.numeroPermis)}`, footerRight: 'Permis fictif · RP'
      });
    } }
  const W = 1011, H = 638;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fond crème/rosé (fond officiel du permis FR)
  ctx.fillStyle = '#fdf6f0';
  ctx.fillRect(0, 0, W, H);

  // Décor en haut : bandeau rose/rouge
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#d62839');
  grad.addColorStop(1, '#a11a2a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 95);

  // Étoiles européennes
  drawEuroStars(ctx, 42, 48, 18, 12, 4);

  // Titre bilingue
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px Sans';
  ctx.fillText('PERMIS DE CONDUIRE', 92, 48);
  ctx.font = '14px Sans';
  ctx.fillStyle = '#ffdcdc';
  ctx.fillText('RÉPUBLIQUE FRANÇAISE', 92, 72);
  ctx.fillText('DRIVING LICENCE', 92, 88);

  ctx.font = 'bold 12px Sans';
  ctx.fillStyle = '#ffdcdc';
  ctx.fillText('RÉPUBLIQUE', 720, 42);
  ctx.fillText('FRANÇAISE', 720, 58);
  ctx.font = '11px Sans';
  ctx.fillText('FRANCE', 720, 78);

  // Filigrane RF
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#a11a2a';
  ctx.font = 'bold 340px Sans';
  ctx.fillText('RF', 600, 590);
  ctx.restore();

  // Photo d'identité
  const photoX = 40, photoY = 130, photoW = 190, photoH = 250;
  try {
    const { img: avatar } = await loadAvatar(avatarUrl, photoW, photoH);
    roundedRect(ctx, photoX, photoY, photoW, photoH, 6);
    ctx.save();
    ctx.clip();
    ctx.drawImage(avatar, photoX, photoY, photoW, photoH);
    ctx.restore();
    ctx.strokeStyle = '#b0b0b0';
    ctx.lineWidth = 2;
    roundedRect(ctx, photoX, photoY, photoW, photoH, 6);
    ctx.stroke();
  } catch (e) {
    console.error('[RP] Erreur chargement avatar permis :', e.message);
    ctx.fillStyle = '#dcdcdc';
    roundedRect(ctx, photoX, photoY, photoW, photoH, 6);
    ctx.fill();
  }

  // Infos — disposition à 2 colonnes après la photo
  const col1X = 260;
  const col2X = 620;
  let y1 = 140;
  let y2 = 140;

  const field = (x, y, label, value, opts = {}) => {
    ctx.fillStyle = '#8b5a5a';
    ctx.font = '11px Sans';
    ctx.fillText(label.toUpperCase(), x, y);

    ctx.fillStyle = '#1a0a0a';
    ctx.font = `bold ${opts.fontSize || 17}px Sans`;
    ctx.fillText(fmt(value), x, y + 22);
  };

  field(col1X, y1, '1. Nom / Surname', (profile.nom || '—').toUpperCase(), { fontSize: 18 });
  y1 += 48;
  field(col1X, y1, '2. Prénom(s) / Given names', profile.prenom || '—', { fontSize: 18 });
  y1 += 48;
  field(col1X, y1, '3. Date de naissance / Date of birth', profile.dateNaissance || '—');
  y1 += 48;
  field(col1X, y1, '4a. Date de délivrance', profile.dateDelivrance || '—');
  y1 += 48;
  field(col1X, y1, '4b. Date d\'expiration', profile.dateExpiration || '—');

  field(col2X, y2, '5. N° du permis / Licence No.', profile.numeroPermis || '—', { fontSize: 18 });
  y2 += 48;
  field(col2X, y2, '6. Photo du titulaire', '—');
  y2 += 48;
  field(col2X, y2, '7. Signature', '—');
  y2 += 48;
  field(col2X, y2, '8. Adresse', '—');
  y2 += 48;
  field(col2X, y2, '9. Catégories', '');

  // ─────── Bloc CATÉGORIES (cases officielles) ───────
  const catStartY = 430;
  ctx.fillStyle = '#8b5a5a';
  ctx.font = 'bold 13px Sans';
  ctx.fillText('CATÉGORIES / CATEGORIES', 40, catStartY - 8);

  const selected = new Set((profile.permisCategories || '').split(',').filter(Boolean));
  let x = 40;
  const cellW = 78, cellH = 55, gap = 6;

  for (const cat of CATEGORIES_PERMIS) {
    const active = selected.has(cat);

    // Case avec fond
    ctx.fillStyle = active ? '#d62839' : '#efe8e2';
    roundedRect(ctx, x, catStartY + 6, cellW, cellH, 6);
    ctx.fill();

    if (active) {
      ctx.strokeStyle = '#8b1826';
      ctx.lineWidth = 2;
      roundedRect(ctx, x, catStartY + 6, cellW, cellH, 6);
      ctx.stroke();
    }

    ctx.fillStyle = active ? '#ffffff' : '#8a8a8a';
    ctx.font = 'bold 20px Sans';
    ctx.fillText(cat, x + 22, catStartY + 44);

    x += cellW + gap;
  }

  // ─────── MRZ (TD1 — 3 lignes de 30) ───────
  const mrzTop = H - 100;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, mrzTop, W, 100);
  ctx.strokeStyle = '#d0d0d0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mrzTop);
  ctx.lineTo(W, mrzTop);
  ctx.stroke();

  const nomMRZ = padMRZ(profile.nom || 'UNKNOWN', 15);
  const prenomMRZ = padMRZ(profile.prenom || 'UNKNOWN', 15);
  const numPermis = padMRZ(profile.numeroPermis || '0000000000', 15, '0');
  const ddnMRZ = yymmddFromFr(profile.dateNaissance, '900101');
  const delivMRZ = yymmddFromFr(profile.dateDelivrance, '200101');
  const expMRZ = yymmddFromFr(profile.dateExpiration || '01/01/2030', '300101');
  const sexeMRZ = (profile.sexe || 'X').toUpperCase()[0] || 'X';

  const mrzL1 = `FRA${nomMRZ}${prenomMRZ}`.slice(0, 30).padEnd(30, '<');
  const mrzL2 = `${numPermis}FRA${ddnMRZ}${sexeMRZ}${delivMRZ}${expMRZ}`.slice(0, 30).padEnd(30, '<');
  const mrzL3 = `${padMRZ('', 30)}`;

  ctx.fillStyle = '#000000';
  ctx.font = 'bold 22px "Courier New", Courier, monospace';
  ctx.fillText(mrzL1, 40, mrzTop + 30);
  ctx.fillText(mrzL2, 40, mrzTop + 60);
  ctx.fillText(mrzL3, 40, mrzTop + 90);

  return canvas.toBuffer('image/png');
}

// ────────────────────────────────────────────────
// PASSEPORT FRANÇAIS — double page (identité + visas)
// ────────────────────────────────────────────────

async function generatePasseport(profile, avatarUrl) {
  { const cc = require('../core/compactCard');
    if (cc.isCompact(profile.guildId || null)) {
      return cc.renderCompact({
        guildId: profile.guildId || null, theme: 'cyan', title: '🛂 Passeport',
        sub: `${fmt(profile.prenom, '')} ${fmt(profile.nom, '')}`.trim().toUpperCase(),
        blocks: [
          { label: 'Né(e) le', value: fmt(profile.dateNaissance) },
          { label: 'Lieu de naissance', value: fmt(profile.lieuNaissance) },
          { label: 'Sexe', value: fmt(profile.sexe) },
          { label: 'Nationalité', value: fmt(profile.nationalite) },
          { label: 'Délivré le', value: fmt(profile.dateDelivrance) },
          { label: 'Expire le', value: fmt(profile.dateExpiration) }
        ],
        footerLeft: `N° ${fmt(profile.numeroCi)}`, footerRight: 'Passeport fictif · RP'
      });
    } }
  const W = 1400, H = 900;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fond bleu marine profond (couleur passeport FR)
  ctx.fillStyle = '#1b2a4a';
  ctx.fillRect(0, 0, W, H);

  // Séparation centrale (reliure)
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(W / 2 - 6, 0, 12, H);

  // ═══════════════ PAGE DE GAUCHE ═══════════════
  const LX = 0;
  const LW = W / 2 - 6;

  // Fond intérieur de page (crème légèrement)
  ctx.fillStyle = '#f5efe0';
  ctx.fillRect(LX + 20, 20, LW - 30, H - 40);

  // Titre pays en haut
  ctx.fillStyle = '#1b2a4a';
  ctx.font = 'bold 22px Sans';
  ctx.fillText('RÉPUBLIQUE FRANÇAISE', LX + 50, 70);
  ctx.font = 'italic 14px Sans';
  ctx.fillText('French Republic / République Française', LX + 50, 92);

  // Étoiles UE
  drawEuroStars(ctx, LX + 40, 55, 14, 12, 3);

  // Type de document
  ctx.fillStyle = '#1b2a4a';
  ctx.font = 'bold 12px Sans';
  ctx.fillText('TYPE / TYPE', LX + 50, 130);
  ctx.font = 'bold 26px Sans';
  ctx.fillText('P', LX + 50, 158);

  ctx.font = 'bold 12px Sans';
  ctx.fillText('CODE / CODE', LX + 160, 130);
  ctx.font = 'bold 26px Sans';
  ctx.fillText('FRA', LX + 160, 158);

  ctx.font = 'bold 12px Sans';
  ctx.fillText('N° DU PASSEPORT / PASSPORT No.', LX + 300, 130);
  ctx.font = 'bold 26px Sans';
  ctx.fillText(fmt(profile.numeroCi), LX + 300, 158);

  // Filigrane Marianne/RF
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#1b2a4a';
  ctx.font = 'bold 380px Sans';
  ctx.fillText('RF', LX + 40, 700);
  ctx.restore();

  // Photo d'identité
  const photoX = LX + 50, photoY = 200, photoW = 200, photoH = 260;
  try {
    const { img: avatar } = await loadAvatar(avatarUrl, photoW, photoH);
    roundedRect(ctx, photoX, photoY, photoW, photoH, 4);
    ctx.save();
    ctx.clip();
    ctx.drawImage(avatar, photoX, photoY, photoW, photoH);
    ctx.restore();
    ctx.strokeStyle = '#8a8a8a';
    ctx.lineWidth = 2;
    roundedRect(ctx, photoX, photoY, photoW, photoH, 4);
    ctx.stroke();
  } catch (e) {
    console.error('[RP] Erreur chargement avatar passeport :', e.message);
    ctx.fillStyle = '#dcdcdc';
    roundedRect(ctx, photoX, photoY, photoW, photoH, 4);
    ctx.fill();
  }

  // Champs identité
  let y = 220;
  const field = (label, value, opts = {}) => {
    ctx.fillStyle = '#4a4a4a';
    ctx.font = 'italic 11px Sans';
    ctx.fillText(label.toUpperCase(), LX + 290, y);

    ctx.fillStyle = '#0a0a0a';
    ctx.font = `bold ${opts.fontSize || 20}px Sans`;
    ctx.fillText(fmt(value), LX + 290, y + 24);

    y += opts.gap || 48;
  };

  field('Nom / Surname', (profile.nom || '—').toUpperCase(), { fontSize: 22 });
  field('Prénom(s) / Given names', profile.prenom || '—', { fontSize: 22 });
  field('Nationalité / Nationality', profile.nationalite || 'Française');
  field('Date de naissance / Date of birth', profile.dateNaissance || '—');
  field('Lieu de naissance / Place of birth', profile.lieuNaissance || '—');
  field('Sexe / Sex', profile.sexe || '—');

  // Bas de page : dates + signature
  ctx.fillStyle = '#4a4a4a';
  ctx.font = 'italic 11px Sans';
  ctx.fillText('DATE DE DÉLIVRANCE / DATE OF ISSUE', LX + 50, 520);
  ctx.fillStyle = '#0a0a0a';
  ctx.font = 'bold 18px Sans';
  ctx.fillText(fmt(profile.dateDelivrance), LX + 50, 542);

  ctx.fillStyle = '#4a4a4a';
  ctx.font = 'italic 11px Sans';
  ctx.fillText('DATE D\'EXPIRATION / DATE OF EXPIRY', LX + 300, 520);
  ctx.fillStyle = '#0a0a0a';
  ctx.font = 'bold 18px Sans';
  ctx.fillText(fmt(profile.dateExpiration || '—'), LX + 300, 542);

  ctx.fillStyle = '#4a4a4a';
  ctx.font = 'italic 11px Sans';
  ctx.fillText('AUTORITÉ / AUTHORITY', LX + 50, 590);
  ctx.fillStyle = '#0a0a0a';
  ctx.font = 'bold 15px Sans';
  ctx.fillText('PRÉFECTURE DE PARIS', LX + 50, 612);

  // Zone de signature manuscrite
  ctx.strokeStyle = '#8a8a8a';
  ctx.lineWidth = 1;
  ctx.strokeRect(LX + 300, 580, 250, 60);
  ctx.fillStyle = '#8a8a8a';
  ctx.font = 'italic 11px Sans';
  ctx.fillText('Signature du titulaire', LX + 300, 575);

  // MRZ page gauche (TD3 sur 2 lignes)
  const mrzTopL = H - 100;
  const nomMRZ = padMRZ(profile.nom || 'UNKNOWN', 39);
  const prenomMRZ = padMRZ(profile.prenom || 'UNKNOWN', 39);
  const numPass = padMRZ(profile.numeroCi || '000000000', 9, '0');
  const ddnMRZ = yymmddFromFr(profile.dateNaissance, '900101');
  const expMRZ = yymmddFromFr(profile.dateExpiration || '01/01/2035', '350101');
  const sexeMRZ = (profile.sexe || 'X').toUpperCase()[0] || 'X';

  const mrzL1 = `P<FRA${nomMRZ}<<${prenomMRZ}`.slice(0, 44).padEnd(44, '<');
  const mrzL2 = `${numPass}FRA${ddnMRZ}${sexeMRZ}${expMRZ}${padMRZ('', 14, '0')}`.slice(0, 44).padEnd(44, '<');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(LX + 20, mrzTopL, LW - 30, 90);

  ctx.fillStyle = '#000000';
  ctx.font = 'bold 18px "Courier New", Courier, monospace';
  ctx.fillText(mrzL1, LX + 35, mrzTopL + 35);
  ctx.fillText(mrzL2, LX + 35, mrzTopL + 65);

  // ═══════════════ PAGE DE DROITE (visas) ═══════════════
  const RX = W / 2 + 6;
  const RW = W / 2 - 6;

  ctx.fillStyle = '#f5efe0';
  ctx.fillRect(RX + 10, 20, RW - 30, H - 40);

  // Titre "VISAS"
  ctx.fillStyle = '#1b2a4a';
  ctx.font = 'bold 24px Sans';
  ctx.fillText('VISAS', RX + 40, 70);

  // Filigrane sur la page visas
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.fillStyle = '#1b2a4a';
  ctx.font = 'bold 300px Sans';
  ctx.fillText('RF', RX + 40, 700);
  ctx.restore();

  // Cases de visas (quadrillage réaliste)
  const gridX = RX + 40;
  const gridY = 100;
  const cols = 2;
  const rows = 4;
  const cellW = (RW - 100) / cols;
  const cellH = 150;

  ctx.strokeStyle = '#c8bfa8';
  ctx.lineWidth = 1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = gridX + c * cellW;
      const cy = gridY + r * cellH;

      // Case
      ctx.strokeRect(cx, cy, cellW - 10, cellH - 10);
      ctx.fillStyle = '#eae2cf';
      ctx.fillRect(cx + 8, cy + 8, cellW - 26, 20);

      ctx.fillStyle = '#1b2a4a';
      ctx.font = 'bold 10px Sans';
      ctx.fillText('VISA / VISA', cx + 12, cy + 24);

      ctx.fillStyle = '#8a8a8a';
      ctx.font = 'italic 10px Sans';
      ctx.fillText('Emplacement disponible', cx + 12, cy + cellH / 2);

      // Petites lignes de saisie
      ctx.strokeStyle = '#d5cdb8';
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + 12, cy + 40 + i * 22);
        ctx.lineTo(cx + cellW - 30, cy + 40 + i * 22);
        ctx.stroke();
      }
    }
  }

  // Numérotation des pages en bas
  ctx.fillStyle = '#8a8a8a';
  ctx.font = '11px Sans';
  ctx.fillText('Page 1 / 32', LX + LW / 2 - 30, H - 20);
  ctx.fillText('Page 2 / 32', RX + RW / 2 - 30, H - 20);

  return canvas.toBuffer('image/png');
}

module.exports = {
  CATEGORIES_PERMIS,
  generateCarteIdentite,
  generatePermis,
  generatePasseport,
};
