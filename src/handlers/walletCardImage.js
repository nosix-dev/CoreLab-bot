'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Génération d'une image "carte bancaire" pour /economy wallet
// Format paysage large — même disposition verticale, carte élargie (1500×640)
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs   = require('fs');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { themedCtx } = require('../core/cardTheme');

const WIDTH  = 1500;
const HEIGHT = 640;
const RADIUS = 42;
const PAD    = 72;

// ── Polices ──
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT_FAMILY = 'sans-serif';
try {
  const boldPath    = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const regularPath = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(boldPath) && fs.existsSync(regularPath)) {
    GlobalFonts.registerFromPath(boldPath,    'WalletCardFont-Bold');
    GlobalFonts.registerFromPath(regularPath, 'WalletCardFont');
    FONT_FAMILY = 'WalletCardFont';
  }
} catch { /* police système */ }
const FONT_BOLD = FONT_FAMILY === 'WalletCardFont' ? 'WalletCardFont-Bold' : FONT_FAMILY;

// ────────────────────────────────────────────────
// Utilitaires (identiques à l'original)
// ────────────────────────────────────────────────

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

function formatAmount(n)  { return Math.floor(n).toLocaleString('fr-FR'); }

function formatSigned(n) {
  const rounded = Math.round(n);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toLocaleString('fr-FR')}`;
}
function formatSignedPct(n) {
  const rounded = Math.round(n * 10) / 10;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toLocaleString('fr-FR')}%`;
}

function drawCoin(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, r * 0.12); ctx.stroke();
  ctx.restore();
}

function drawCrownIcon(ctx, x, y, size, color) {
  const w = size, h = size * 0.72;
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, h); ctx.lineTo(0, h * 0.4);
  ctx.lineTo(w * 0.22, h * 0.75); ctx.lineTo(w * 0.5, h * 0.15);
  ctx.lineTo(w * 0.78, h * 0.75); ctx.lineTo(w, h * 0.4); ctx.lineTo(w, h);
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  ctx.restore();
}

function drawStarIcon(ctx, x, y, r, color) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const outerAngle = (Math.PI / 2) + i * ((2 * Math.PI) / 5);
    const innerAngle = outerAngle + Math.PI / 5;
    const ox = Math.cos(outerAngle) * r,      oy = -Math.sin(outerAngle) * r;
    const ix = Math.cos(innerAngle) * (r * 0.42), iy = -Math.sin(innerAngle) * (r * 0.42);
    if (i === 0) ctx.moveTo(ox, oy); else ctx.lineTo(ox, oy);
    ctx.lineTo(ix, iy);
  }
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  ctx.restore();
}

function drawMedalIcon(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.5); ctx.lineTo(cx + r * 0.28, cy);
  ctx.lineTo(cx, cy + r * 0.5); ctx.lineTo(cx - r * 0.28, cy);
  ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
  ctx.restore();
}

function drawCheckIcon(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, r * 0.28);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.55, cy);
  ctx.lineTo(cx - r * 0.1,  cy + r * 0.45);
  ctx.lineTo(cx + r * 0.6,  cy - r * 0.5);
  ctx.stroke(); ctx.restore();
}

function drawTrendArrow(ctx, x, y, size, up, color) {
  ctx.save(); ctx.translate(x, y);
  if (!up) ctx.scale(1, -1);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.16);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-size * 0.5, size * 0.35); ctx.lineTo(size * 0.5, -size * 0.35);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(size * 0.5, -size * 0.35);
  ctx.lineTo(size * 0.02, -size * 0.35);
  ctx.lineTo(size * 0.5,  size * 0.13);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawChip(ctx, x, y) {
  const w = 92, h = 68;
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#e9d9a8'); grad.addColorStop(0.5, '#c9ad6a'); grad.addColorStop(1, '#8a723f');
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 12);
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + w / 3, y);     ctx.lineTo(x + w / 3,       y + h);
  ctx.moveTo(x + 2*w/3, y);     ctx.lineTo(x + 2*w/3,       y + h);
  ctx.moveTo(x,         y+h/2); ctx.lineTo(x + w,            y + h/2);
  ctx.stroke();
  roundRectPath(ctx, x + w * 0.22, y + h * 0.28, w * 0.56, h * 0.44, 6);
  ctx.stroke();
  ctx.restore();
}

function drawPill(ctx, x, y, text, { font, textColor, bgColor, borderColor, dot, icon }) {
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;
  const paddingX  = 16;
  const iconSpace = dot ? 16 : icon ? 22 : 0;
  const w = textWidth + paddingX * 2 + iconSpace;
  const h = 30;
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = bgColor; ctx.fill();
  if (borderColor) { ctx.strokeStyle = borderColor; ctx.lineWidth = 1.5; ctx.stroke(); }
  let textX = x + paddingX;
  if (dot) {
    ctx.beginPath(); ctx.arc(x + paddingX + 4, y + h / 2, 4, 0, Math.PI * 2);
    ctx.fillStyle = dot; ctx.fill();
    textX += iconSpace;
  } else if (icon) {
    icon(x + paddingX + 6, y + h / 2);
    textX += iconSpace;
  }
  ctx.fillStyle = textColor;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, textX, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
  return w;
}

function drawProgressBar(ctx, x, y, w, h, pct, color) {
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
  const fillW = Math.max(h, w * Math.min(1, Math.max(0, pct)));
  if (fillW > 0) {
    const grad = ctx.createLinearGradient(x, 0, x + fillW, 0);
    grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(255,255,255,0.85)');
    roundRectPath(ctx, x, y, fillW, h, h / 2);
    ctx.fillStyle = grad; ctx.fill();
  }
}

function computeTier(total) {
  const tiers = [
    { min: 0,      name: 'BRONZE',  color: '#c48a5a' },
    { min: 10000,  name: 'ARGENT',  color: '#c7ccd1' },
    { min: 100000, name: 'OR',      color: '#f4c542' },
    { min: 500000, name: 'DIAMANT', color: '#8ec9ff' },
  ];
  let current = tiers[0];
  for (const t of tiers) { if (total >= t.min) current = t; }
  const level = Math.max(1, Math.min(99, Math.floor(total / 25000) + 1));
  return { name: current.name, color: current.color, level };
}

function fakeCardNumber(userId) {
  const digits = String(userId).replace(/\D/g, '');
  const last4  = digits.slice(-4).padStart(4, '0');
  return { masked: `•••• •••• •••• ${last4}`, last4 };
}

function shortUserId(userId) {
  const digits = String(userId).replace(/\D/g, '');
  const last8  = digits.slice(-8).padStart(8, '0');
  return `${last8.slice(0, 4)} ${last8.slice(4)}`;
}

function decorativeExpiry() {
  const now   = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year  = String((now.getFullYear() + 3) % 100).padStart(2, '0');
  return `${month}/${year}`;
}

// ────────────────────────────────────────────────
// Génération principale
// Même flux vertical que l'original, carte élargie 1500×640
// Les coordonnées Y sont proportionnellement compressées,
// les X sont centrées sur la nouvelle largeur.
// ────────────────────────────────────────────────
async function generateWalletCardImage(opts) {
  const {
    username,
    userId,
    avatarURL,
    wallet,
    bank,
    total,
    currencyName = 'Scarabée',
    isFounder    = false,
    isPremium    = false,
    goalAmount   = 1000000,
    weekDelta    = null,
    monthPct     = null,
  } = opts;

  const accent     = isFounder ? '#f4c542' : isPremium ? '#8ec9ff' : '#4b5563';
  const accentSoft = isFounder ? 'rgba(244,197,66,0.18)' : isPremium ? 'rgba(142,201,255,0.16)' : 'rgba(255,255,255,0.08)';
  const tier       = computeTier(total);
  const cc = require('../core/compactCard');
  if (cc.isCompact(opts.guildId)) {
    const pct = goalAmount > 0 ? Math.max(0, Math.min(1, total / goalAmount)) : 0;
    const pills = [];
    if (isFounder) pills.push({ text: 'Fondateur', tone: 'accent' });
    else if (isPremium) pills.push({ text: 'Premium', tone: 'accent' });
    if (weekDelta != null) pills.push({ text: `Semaine ${formatSigned(weekDelta)}`, tone: weekDelta >= 0 ? 'ok' : 'bad' });
    if (monthPct != null) pills.push({ text: `Mois ${formatSignedPct(monthPct)}`, tone: monthPct >= 0 ? 'ok' : 'bad' });
    return cc.renderCompact({
      guildId: opts.guildId, theme: isFounder ? 'orange' : isPremium ? 'cyan' : 'green',
      title: '💳 Porte-monnaie', sub: username,
      blocks: [
        { label: 'Portefeuille', value: `${formatAmount(wallet)} ${currencyName}` },
        { label: 'Banque', value: `${formatAmount(bank)} ${currencyName}` },
        { label: 'Total', value: `${formatAmount(total)} ${currencyName}` },
        { label: 'Niveau bancaire', value: `Niv. ${tier.level} · ${tier.name}` }
      ],
      progress: pct,
      pills,
      footerLeft: `Objectif : ${formatAmount(goalAmount)}`,
      footerRight: `${Math.floor(pct * 100)}%`
    });
  }

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx    = themedCtx(canvas.getContext('2d'), opts.guildId, { tintDark: true });

  // ── Fond ──
  roundRectPath(ctx, 0, 0, WIDTH, HEIGHT, RADIUS);
  ctx.clip();

  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, '#1a1a1d'); bg.addColorStop(1, '#050505');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const halo = ctx.createRadialGradient(WIDTH - 80, -60, 40, WIDTH - 80, -60, 620);
  halo.addColorStop(0, accentSoft); halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.save();
  ctx.globalAlpha = 0.04; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  for (let i = -HEIGHT; i < WIDTH; i += 34) {
    ctx.beginPath(); ctx.moveTo(i, HEIGHT); ctx.lineTo(i + HEIGHT, 0); ctx.stroke();
  }
  ctx.restore();

  roundRectPath(ctx, 4, 4, WIDTH - 8, HEIGHT - 8, RADIUS - 4);
  ctx.strokeStyle = accent; ctx.globalAlpha = 0.55; ctx.lineWidth = 3;
  ctx.stroke(); ctx.globalAlpha = 1;

  const smallFont = `600 18px ${FONT_FAMILY}`;

  // ════════════════════════════════════════════
  // EN-TÊTE : puce (gauche) + pills + marque (droite)
  // ════════════════════════════════════════════
  drawChip(ctx, PAD, 40);

  // Pills sous la puce
  let pillX = PAD;
  pillX += drawPill(ctx, pillX, 122, 'COMPTE ACTIF', {
    font: smallFont, textColor: '#c9f7d1', bgColor: 'rgba(52,199,89,0.14)',
    borderColor: 'rgba(52,199,89,0.35)', dot: '#34c759',
  }) + 10;
  drawPill(ctx, pillX, 122, 'VÉRIFIÉ', {
    font: smallFont, textColor: '#d6e8ff', bgColor: 'rgba(94,169,255,0.14)',
    borderColor: 'rgba(94,169,255,0.35)',
    icon: (cx, cy) => drawCheckIcon(ctx, cx, cy, 8, '#8ec9ff'),
  });

  // Marque droite
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 34px ${FONT_BOLD}`;
  ctx.fillText('CORELAB', WIDTH - PAD, 68);
  ctx.font = `500 18px ${FONT_FAMILY}`; ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.letterSpacing = '3px'; ctx.fillText('PORTE-MONNAIE', WIDTH - PAD, 94);
  ctx.letterSpacing = '0px';

  if (isFounder || isPremium) {
    const label = isFounder ? 'FONDATEUR' : 'PREMIUM';
    ctx.font = `700 20px ${FONT_BOLD}`; ctx.fillStyle = accent;
    const labelWidth = ctx.measureText(label).width;
    ctx.fillText(label, WIDTH - PAD, 124);
    if (isFounder) drawCrownIcon(ctx, WIDTH - PAD - labelWidth - 28, 104, 20, accent);
    else           drawStarIcon(ctx,  WIDTH - PAD - labelWidth - 20, 115, 10, accent);
  }

  // Séparateur horizontal
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, 168); ctx.lineTo(WIDTH - PAD, 168); ctx.stroke();

  // ════════════════════════════════════════════
  // SOLDE CENTRAL + BARRE DE PROGRESSION
  // ════════════════════════════════════════════
  ctx.textAlign = 'center';
  ctx.font = `600 17px ${FONT_FAMILY}`; ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.letterSpacing = '3px'; ctx.fillText('SOLDE TOTAL DISPONIBLE', WIDTH / 2, 202);
  ctx.letterSpacing = '0px';

  // Montant
  const totalStr = formatAmount(total);
  ctx.font = `800 68px ${FONT_BOLD}`;
  const totalWidth = ctx.measureText(totalStr).width;
  const groupWidth = totalWidth + 56;
  const groupStartX = WIDTH / 2 - groupWidth / 2;
  ctx.textAlign = 'left'; ctx.fillStyle = accent;
  ctx.fillText(totalStr, groupStartX, 280);
  drawCoin(ctx, groupStartX + totalWidth + 30, 260, 16, accent);

  // Évolution
  ctx.textAlign = 'center'; ctx.font = `500 16px ${FONT_FAMILY}`;
  if (weekDelta === null && monthPct === null) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('Historique en cours de collecte — revient dans quelques jours', WIDTH / 2, 306);
  } else {
    const parts = [];
    if (weekDelta !== null) parts.push({ up: weekDelta >= 0, text: `${formatSigned(weekDelta)} cette semaine` });
    if (monthPct  !== null) parts.push({ up: monthPct  >= 0, text: `${formatSignedPct(monthPct)} depuis le mois dernier` });
    const sep = '     •     ';
    const fullWidths = parts.map(p => { ctx.font = `500 16px ${FONT_FAMILY}`; return ctx.measureText(p.text).width + 22; });
    const sepWidth   = ctx.measureText(sep).width;
    const totalLineW = fullWidths.reduce((a, b) => a + b, 0) + sepWidth * (parts.length - 1);
    let cursorX = WIDTH / 2 - totalLineW / 2;
    ctx.textAlign = 'left';
    parts.forEach((p, i) => {
      const color = p.up ? '#7ee2a8' : '#ff8a8a';
      drawTrendArrow(ctx, cursorX + 8, 300, 14, p.up, color);
      ctx.fillStyle = color; ctx.fillText(p.text, cursorX + 22, 306);
      cursorX += fullWidths[i];
      if (i < parts.length - 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillText(sep, cursorX, 306);
        cursorX += sepWidth;
      }
    });
    ctx.textAlign = 'center';
  }

  // Barre de progression
  const barY = 326;
  const barW = WIDTH - PAD * 2;
  const pct  = goalAmount > 0 ? total / goalAmount : 0;
  ctx.textAlign = 'left'; ctx.font = `500 15px ${FONT_FAMILY}`; ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(`Objectif : ${formatAmount(goalAmount)}`, PAD, barY - 8);
  ctx.textAlign = 'right'; ctx.fillStyle = accent;
  ctx.fillText(`${Math.min(100, Math.floor(pct * 100))}%`, WIDTH - PAD, barY - 8);
  drawProgressBar(ctx, PAD, barY, barW, 12, pct, accent);

  // Séparateur
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, 362); ctx.lineTo(WIDTH - PAD, 362); ctx.stroke();

  // ════════════════════════════════════════════
  // PORTEFEUILLE / BANQUE / NIVEAU BANCAIRE  (même ligne)
  // ════════════════════════════════════════════
  const statY  = 390;
  // 3 colonnes équiréparties
  const colW   = (WIDTH - PAD * 2) / 3;

  ctx.textAlign = 'left';

  const drawAmountCol = (x, label, value) => {
    ctx.font = `600 16px ${FONT_FAMILY}`; ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.letterSpacing = '2px'; ctx.fillText(label, x, statY);
    ctx.letterSpacing = '0px';
    ctx.font = `700 36px ${FONT_BOLD}`; ctx.fillStyle = '#ffffff';
    const str = formatAmount(value);
    ctx.fillText(str, x, statY + 42);
    drawCoin(ctx, x + ctx.measureText(str).width + 22, statY + 28, 11, '#d1d5db');
  };

  drawAmountCol(PAD,              'PORTEFEUILLE', wallet);
  drawAmountCol(PAD + colW,       'BANQUE',       bank);

  // Tier
  const tierX = PAD + colW * 2;
  ctx.font = `600 16px ${FONT_FAMILY}`; ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.letterSpacing = '2px'; ctx.fillText('NIVEAU BANCAIRE', tierX, statY);
  ctx.letterSpacing = '0px';
  ctx.font = `700 28px ${FONT_BOLD}`; ctx.fillStyle = tier.color;
  ctx.fillText(`NIV. ${tier.level}`, tierX, statY + 38);
  drawMedalIcon(ctx, tierX + ctx.measureText(`NIV. ${tier.level}`).width + 24, tierX > 1 ? statY + 25 : statY + 25, 12, tier.color);
  ctx.font = `600 14px ${FONT_FAMILY}`; ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.letterSpacing = '2px'; ctx.fillText(tier.name, tierX, statY + 56);
  ctx.letterSpacing = '0px';

  // Séparateur
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, 466); ctx.lineTo(WIDTH - PAD, 466); ctx.stroke();

  // ════════════════════════════════════════════
  // NUMÉRO DE CARTE + EXPIRATION
  // ════════════════════════════════════════════
  const { masked } = fakeCardNumber(userId || username || '0000');
  ctx.textAlign = 'left';
  ctx.font = `600 36px ${FONT_BOLD}`; ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.letterSpacing = '4px'; ctx.fillText(masked, PAD, 512);
  ctx.letterSpacing = '0px';

  ctx.textAlign = 'right';
  ctx.font = `500 13px ${FONT_FAMILY}`; ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('EXP', WIDTH - PAD, 496);
  ctx.font = `700 24px ${FONT_BOLD}`; ctx.fillStyle = '#ffffff';
  ctx.fillText(decorativeExpiry(), WIDTH - PAD, 518);

  // Séparateur
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, 538); ctx.lineTo(WIDTH - PAD, 538); ctx.stroke();

  // ════════════════════════════════════════════
  // PIED : titulaire (gauche) + avatar (droite)
  // ════════════════════════════════════════════
  ctx.textAlign = 'left';
  ctx.font = `500 15px ${FONT_FAMILY}`; ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.letterSpacing = '2px'; ctx.fillText('TITULAIRE', PAD, 566);
  ctx.letterSpacing = '0px';

  ctx.font = `700 34px ${FONT_BOLD}`; ctx.fillStyle = '#ffffff';
  const displayName = (username || 'Utilisateur').toUpperCase();
  const maxNameW    = WIDTH - PAD * 2 - 180;
  let nameToShow    = displayName;
  while (ctx.measureText(nameToShow).width > maxNameW && nameToShow.length > 3)
    nameToShow = nameToShow.slice(0, -1);
  if (nameToShow !== displayName) nameToShow = nameToShow.slice(0, -1) + '…';
  ctx.fillText(nameToShow, PAD, 606);

  ctx.font = `400 15px ${FONT_FAMILY}`; ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(`ID • ${shortUserId(userId || '00000000')}  —  ${currencyName.toUpperCase()}`, PAD, 628);

  // Avatar
  const avatarR  = 52;
  const avatarCx = WIDTH - PAD - avatarR + 8;
  const avatarCy = HEIGHT - 58 - avatarR;

  ctx.save();
  ctx.beginPath(); ctx.arc(avatarCx, avatarCy, avatarR + 5, 0, Math.PI * 2);
  ctx.fillStyle = accent; ctx.globalAlpha = 0.9; ctx.fill();
  ctx.globalAlpha = 1; ctx.restore();

  let avatarImage = null;
  if (avatarURL) {
    try {
      const res = await fetch(avatarURL);
      const buf = Buffer.from(await res.arrayBuffer());
      avatarImage = await loadImage(buf);
    } catch { avatarImage = null; }
  }

  ctx.save();
  ctx.beginPath(); ctx.arc(avatarCx, avatarCy, avatarR, 0, Math.PI * 2);
  ctx.closePath(); ctx.clip();
  if (avatarImage) {
    ctx.drawImage(avatarImage, avatarCx - avatarR, avatarCy - avatarR, avatarR * 2, avatarR * 2);
  } else {
    ctx.fillStyle = '#2a2a2e';
    ctx.fillRect(avatarCx - avatarR, avatarCy - avatarR, avatarR * 2, avatarR * 2);
    ctx.font = `700 40px ${FONT_BOLD}`; ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((username || '?').slice(0, 1).toUpperCase(), avatarCx, avatarCy + 4);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();

  return canvas.toBuffer('image/png');
}

module.exports = { generateWalletCardImage };
