'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Images des concours (/giveaway) : carte d'annonce + carte de résultat
// Même style que /economy wallet et /economy leaderboard (fond sombre, accents dorés)
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { themedCtx } = require('../core/cardTheme');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'GiveawayBold');
    GlobalFonts.registerFromPath(r, 'GiveawayRegular');
    FONT = 'GiveawayRegular';
    FONT_BOLD = 'GiveawayBold';
  }
} catch { /* police système */ }

const GOLD = '#f4c542';
// Couleurs d'accent de cette carte (recolorées par le thème du serveur ; fond noir teinté aussi)
const THEME_OPTS = { also: ['#f4c542', '#ffd766', '#b8860b'], tintDark: true };
const W = 1200;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

// Retourne au plus maxLines lignes ; la dernière est tronquée avec « … » si besoin
function wrapLines(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const test = cur ? `${cur} ${words[i]}` : words[i];
    if (ctx.measureText(test).width <= maxW || !cur) {
      cur = test;
    } else {
      lines.push(cur);
      cur = words[i];
      if (lines.length === maxLines - 1) {
        cur = words.slice(i).join(' ');
        break;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines).map((l, idx, arr) => (idx === arr.length - 1 ? fit(ctx, l, maxW) : l));
}

function background(ctx, H) {
  roundRect(ctx, 0, 0, W, H, 38);
  ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1a1a1d'); bg.addColorStop(1, '#050505');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const halo = ctx.createRadialGradient(W - 120, -40, 40, W - 120, -40, 700);
  halo.addColorStop(0, 'rgba(244,197,66,0.20)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.035; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  for (let i = -H; i < W; i += 34) {
    ctx.beginPath(); ctx.moveTo(i, H); ctx.lineTo(i + H, 0); ctx.stroke();
  }
  ctx.restore();
}

// Cadeau dessiné (pas de glyphe emoji : indépendant de la police du serveur)
function drawGift(ctx, x, y, s) {
  ctx.save(); ctx.translate(x, y);
  // corps
  ctx.fillStyle = GOLD;
  roundRect(ctx, s * 0.08, s * 0.42, s * 0.84, s * 0.55, s * 0.06); ctx.fill();
  // couvercle
  ctx.fillStyle = '#ffd766';
  roundRect(ctx, 0, s * 0.28, s, s * 0.2, s * 0.05); ctx.fill();
  // ruban vertical
  ctx.fillStyle = '#b8860b';
  ctx.fillRect(s * 0.44, s * 0.28, s * 0.12, s * 0.69);
  // nœud
  ctx.strokeStyle = '#ffd766'; ctx.lineWidth = s * 0.07; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.28);
  ctx.bezierCurveTo(s * 0.2, s * 0.0, s * 0.05, s * 0.2, s * 0.3, s * 0.28);
  ctx.moveTo(s * 0.5, s * 0.28);
  ctx.bezierCurveTo(s * 0.8, s * 0.0, s * 0.95, s * 0.2, s * 0.7, s * 0.28);
  ctx.stroke();
  ctx.restore();
}

function drawTrophy(ctx, x, y, s) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.moveTo(s * 0.2, 0); ctx.lineTo(s * 0.8, 0);
  ctx.lineTo(s * 0.72, s * 0.5);
  ctx.quadraticCurveTo(s * 0.5, s * 0.72, s * 0.28, s * 0.5);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = GOLD; ctx.lineWidth = s * 0.07;
  ctx.beginPath(); ctx.arc(s * 0.17, s * 0.22, s * 0.13, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(s * 0.83, s * 0.22, s * 0.13, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
  ctx.fillRect(s * 0.44, s * 0.6, s * 0.12, s * 0.2);
  roundRect(ctx, s * 0.26, s * 0.8, s * 0.48, s * 0.14, s * 0.04); ctx.fill();
  ctx.restore();
}

function chip(ctx, x, y, label, value, maxW) {
  const h = 84;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, x, y, maxW, h, 18); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#8b8f97'; ctx.font = `18px ${FONT}`;
  ctx.fillText(label, x + 22, y + 32);
  ctx.fillStyle = '#ffffff'; ctx.font = `28px ${FONT_BOLD}`;
  ctx.fillText(fit(ctx, value, maxW - 44), x + 22, y + 66);
}

function formatDate(ms) {
  try {
    const d = new Date(ms);
    const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
    return `${date} · ${time.replace(':', 'h')}`;
  } catch {
    return '—';
  }
}

async function loadAvatar(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * Carte d'annonce d'un concours en cours.
 * @param {{prize:string, winnersCount:number, endsAt:number, roleName?:string|null, hostName?:string}} o
 */
async function generateGiveawayImage({ prize, winnersCount, endsAt, roleName = null, hostName = '', guildId = null }) {
  const cc = require('../core/compactCard');
  if (cc.isCompact(guildId)) {
    return cc.renderCompact({
      guildId, theme: 'orange', title: '🎁 Concours',
      blocks: [
        { label: 'Gagnants', value: String(winnersCount) },
        { label: 'Fin le', value: formatDate(endsAt) },
        ...(roleName ? [{ label: 'Rôle requis', value: roleName }] : [])
      ],
      quotes: [{ label: 'Lot à gagner', text: String(prize), maxLines: 2 }],
      footerLeft: hostName ? `Organisé par ${hostName}` : undefined,
      footerRight: 'Clique sur Participer !'
    });
  }
  const H = 500;
  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), guildId, THEME_OPTS);
  ctx.textBaseline = 'alphabetic';
  background(ctx, H);

  const PAD = 56;
  drawGift(ctx, PAD, 52, 120);

  ctx.fillStyle = GOLD; ctx.font = `26px ${FONT_BOLD}`;
  ctx.fillText('CONCOURS', PAD + 156, 84);
  ctx.fillStyle = '#8b8f97'; ctx.font = `20px ${FONT}`;
  ctx.fillText('Lot à gagner', PAD + 156, 114);

  // Lot (2 lignes max, police réduite si long)
  let size = 56;
  let lines;
  do {
    ctx.font = `${size}px ${FONT_BOLD}`;
    lines = wrapLines(ctx, prize, W - PAD * 2 - 156, 2);
    size -= 4;
  } while (size >= 36 && lines.some(l => ctx.measureText(l).width > W - PAD * 2 - 156) );
  size += 4;
  ctx.font = `${size}px ${FONT_BOLD}`;
  ctx.fillStyle = '#ffffff';
  lines.forEach((l, i) => ctx.fillText(l, PAD + 156, 176 + i * (size + 10)));

  // Pastilles d'infos
  const chipsY = 300;
  const items = [
    ['GAGNANTS', String(winnersCount)],
    ['FIN LE', formatDate(endsAt)]
  ];
  if (roleName) items.push(['RÔLE REQUIS', roleName]);
  const gap = 20;
  const cw = (W - PAD * 2 - gap * (items.length - 1)) / items.length;
  items.forEach(([label, value], i) => chip(ctx, PAD + i * (cw + gap), chipsY, label, value, cw));

  // Pied de carte
  ctx.fillStyle = '#6b7078'; ctx.font = `20px ${FONT}`;
  if (hostName) ctx.fillText(fit(ctx, `Organisé par ${hostName}`, W - PAD * 2), PAD, 448);
  ctx.textAlign = 'right';
  ctx.fillStyle = GOLD; ctx.font = `22px ${FONT_BOLD}`;
  ctx.fillText('Clique sur Participer !', W - PAD, 448);

  return canvas.toBuffer('image/png');
}

/**
 * Carte de résultat d'un concours terminé.
 * @param {{prize:string, winners:Array<{name:string, avatarURL?:string|null}>, participantsCount?:number}} o
 */
async function generateGiveawayResultImage({ prize, winners, participantsCount = null, guildId = null }) {
  const cc = require('../core/compactCard');
  if (cc.isCompact(guildId)) {
    const top = winners.slice(0, 6);
    const more = winners.length - top.length;
    return cc.renderCompact({
      guildId, theme: 'orange', title: '🏆 Concours terminé',
      sub: participantsCount != null ? `${participantsCount} participant${participantsCount > 1 ? 's' : ''}` : 'Lot remporté',
      blocks: top.map((w, i) => ({ label: top.length > 1 ? `Gagnant ${i + 1}` : 'Gagnant', value: w.name || 'Inconnu' })),
      quotes: [{ label: 'Lot', text: String(prize), maxLines: 2 }, ...(top.length ? [] : [{ label: 'Résultat', text: 'Aucun participant valide', dim: true }])],
      footerLeft: more > 0 ? `+ ${more} autre${more > 1 ? 's' : ''} gagnant${more > 1 ? 's' : ''}` : undefined
    });
  }
  const shown = winners.slice(0, 6);
  const extra = winners.length - shown.length;
  const has = shown.length > 0;
  const rows = has ? Math.ceil(shown.length / 2) : 0;
  const HEAD = 236;
  const H = HEAD + (has ? rows * 96 + 40 : 60);
  const avatars = await Promise.all(shown.map(w => loadAvatar(w.avatarURL)));

  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), guildId, THEME_OPTS);
  ctx.textBaseline = 'alphabetic';
  background(ctx, H);

  const PAD = 56;
  drawTrophy(ctx, PAD, 44, 110);

  ctx.fillStyle = GOLD; ctx.font = `26px ${FONT_BOLD}`;
  ctx.fillText('CONCOURS TERMINÉ', PAD + 144, 78);
  ctx.fillStyle = '#8b8f97'; ctx.font = `20px ${FONT}`;
  const sub = participantsCount != null ? `${participantsCount} participant${participantsCount > 1 ? 's' : ''}` : 'Lot remporté';
  ctx.fillText(sub, PAD + 144, 108);

  ctx.fillStyle = '#ffffff';
  let size = 52;
  ctx.font = `${size}px ${FONT_BOLD}`;
  while (size > 30 && ctx.measureText(prize).width > W - PAD * 2 - 144) {
    size -= 2; ctx.font = `${size}px ${FONT_BOLD}`;
  }
  ctx.fillText(fit(ctx, prize, W - PAD * 2 - 144), PAD + 144, 168);

  if (!has) {
    ctx.fillStyle = '#9aa0a8'; ctx.font = `30px ${FONT_BOLD}`;
    ctx.fillText('Aucun participant valide', PAD, HEAD + 20);
    return canvas.toBuffer('image/png');
  }

  const colW = (W - PAD * 2 - 24) / 2;
  shown.forEach((w, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = PAD + col * (colW + 24);
    const y = HEAD + row * 96;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, x, y, colW, 80, 20); ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke();

    const ar = 28, ax = x + 48, ay = y + 40;
    ctx.save();
    ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.clip();
    if (avatars[i]) {
      ctx.drawImage(avatars[i], ax - ar, ay - ar, ar * 2, ar * 2);
    } else {
      ctx.fillStyle = '#2a2d33'; ctx.fillRect(ax - ar, ay - ar, ar * 2, ar * 2);
      ctx.fillStyle = '#9aa0a8'; ctx.font = `26px ${FONT_BOLD}`; ctx.textAlign = 'center';
      ctx.fillText((w.name || '?').charAt(0).toUpperCase(), ax, ay + 9);
      ctx.textAlign = 'left';
    }
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff'; ctx.font = `28px ${FONT_BOLD}`;
    ctx.fillText(fit(ctx, w.name || 'Inconnu', colW - 110), x + 92, y + 51);
  });

  if (extra > 0) {
    ctx.fillStyle = '#8b8f97'; ctx.font = `22px ${FONT}`;
    ctx.fillText(`+ ${extra} autre${extra > 1 ? 's' : ''} gagnant${extra > 1 ? 's' : ''}`, PAD, H - 26);
  }

  return canvas.toBuffer('image/png');
}

/**
 * Carte du panneau de configuration de /giveaway (même style que la carte /protect-settings :
 * bandeau titre + pastille de statut + tuiles). Synchrone, aucun réseau.
 * @param {{prize?:string|null, durationLabel?:string|null, winnersCount?:number|null, roleName?:string|null, winMessage?:string|null}} o
 */
function generateGiveawayConfigImage({ prize = null, durationLabel = null, winnersCount = null, roleName = null, winMessage = null, guildId = null }) {
  const cc = require('../core/compactCard');
  if (cc.isCompact(guildId)) {
    const required = [prize, durationLabel, winnersCount];
    const done = required.filter(Boolean).length;
    const ready = done === required.length;
    const dot = on => (on ? '#3ddc84' : '#8b8f97');
    return cc.renderCompactSync({
      guildId, theme: 'orange', title: '🎁 Configuration du giveaway',
      sub: `${done}/${required.length} infos obligatoires`,
      blocks: [
        { label: 'Lot', value: prize || 'Non défini', dot: dot(!!prize) },
        { label: 'Durée', value: durationLabel || 'Non définie', dot: dot(!!durationLabel) },
        { label: 'Gagnants', value: winnersCount ? String(winnersCount) : 'Non défini', dot: dot(!!winnersCount) },
        { label: 'Rôle requis', value: roleName || 'Aucun', dot: dot(!!roleName) }
      ],
      quotes: [{ label: 'Message gagnant', text: winMessage || 'Par défaut', dim: !winMessage, maxLines: 2 }],
      pills: [{ text: ready ? 'PRÊT' : 'INCOMPLET', tone: ready ? 'ok' : 'bad' }]
    });
  }
  const PAD = 30, GAP = 12, HEAD = 118, TILE_H = 104, COLS = 3;
  const H = HEAD + TILE_H * 2 + GAP + PAD;
  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), guildId, THEME_OPTS);
  ctx.textBaseline = 'alphabetic';
  background(ctx, H);

  const required = [prize, durationLabel, winnersCount];
  const done = required.filter(Boolean).length;
  const ready = done === required.length;

  // Titre + sous-titre
  drawGift(ctx, PAD + 4, 26, 64);
  ctx.fillStyle = '#ffffff'; ctx.font = `40px ${FONT_BOLD}`;
  ctx.fillText('Configuration du giveaway', PAD + 92, 62);
  ctx.fillStyle = '#8b8f97'; ctx.font = `22px ${FONT}`;
  ctx.fillText(`${done}/${required.length} infos obligatoires`, PAD + 92, 94);

  // Pastille de statut
  const status = ready ? 'PRÊT' : 'INCOMPLET';
  const sColor = ready ? '#3ddc84' : GOLD;
  ctx.font = `20px ${FONT_BOLD}`;
  const pw = ctx.measureText(status).width + 58;
  ctx.fillStyle = sColor + '33';
  roundRect(ctx, W - PAD - pw, 38, pw, 44, 22); ctx.fill();
  ctx.fillStyle = sColor;
  ctx.beginPath(); ctx.arc(W - PAD - pw + 22, 60, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillText(status, W - PAD - pw + 38, 67);

  // Tuiles : [label, valeur, défini ?, texte si vide, colonnes occupées]
  const tiles = [
    ['LOT',             prize,                              !!prize,          'Non défini',   1],
    ['DURÉE',           durationLabel,                      !!durationLabel,  'Non définie',  1],
    ['GAGNANTS',        winnersCount ? String(winnersCount) : null, !!winnersCount, 'Non défini', 1],
    ['RÔLE REQUIS',     roleName,                           !!roleName,       'Aucun',        1],
    ['MESSAGE GAGNANT', winMessage,                         !!winMessage,     'Par défaut',   2]
  ];
  const tileW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  let col = 0, row = 0;
  for (const [label, value, on, empty, span] of tiles) {
    if (col + span > COLS) { col = 0; row++; }
    const x = PAD + col * (tileW + GAP);
    const y = HEAD + row * (TILE_H + GAP);
    const w = tileW * span + GAP * (span - 1);

    ctx.fillStyle = on ? 'rgba(244,197,66,0.10)' : 'rgba(255,255,255,0.05)';
    roundRect(ctx, x, y, w, TILE_H, 16); ctx.fill();
    ctx.strokeStyle = on ? 'rgba(244,197,66,0.55)' : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = on ? GOLD : '#5a5e66';
    ctx.beginPath(); ctx.arc(x + 26, y + 32, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8b8f97'; ctx.font = `18px ${FONT_BOLD}`;
    ctx.fillText(label, x + 46, y + 38);

    const text = on ? String(value).replace(/\s+/g, ' ') : empty;
    let size = 30;
    ctx.font = `${size}px ${FONT_BOLD}`;
    while (size > 20 && ctx.measureText(text).width > w - 44) { size -= 1; ctx.font = `${size}px ${FONT_BOLD}`; }
    ctx.fillStyle = on ? '#ffffff' : '#6b7078';
    ctx.fillText(fit(ctx, text, w - 44), x + 22, y + 82);

    col += span;
  }

  return canvas.toBuffer('image/png');
}

module.exports = { generateGiveawayImage, generateGiveawayResultImage, generateGiveawayConfigImage };
