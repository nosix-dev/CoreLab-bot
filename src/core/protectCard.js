'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Panneau /protect-settings : carte image (canvas) + 2 menus + boutons
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const {
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  MessageFlags
} = require('discord.js');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { themedCtx } = require('./cardTheme');
const { getGuildConfig } = require('./config');

// ── Police (même logique que walletCardImage.js) ──
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'ProtectCardBold');
    GlobalFonts.registerFromPath(r, 'ProtectCard');
    FONT = 'ProtectCard';
    FONT_BOLD = 'ProtectCardBold';
  }
} catch { /* police système */ }

// ── Modules ──
// kind 'toggle' : le menu du haut l'active/coupe directement (champ cfg = key)
// kind 'config' : le menu du bas ouvre son panneau de réglage
const MODULES = [
  { key: 'raidmode',   kind: 'config', label: 'RaidMode',        on: c => c.raidmode_enabled,       sub: c => `${c.raidmode_threshold || 10} arrivées / ${c.raidmode_window_seconds || 30} s` },
  { key: 'antiddos',   kind: 'config', label: 'Anti-DDoS',       on: c => c.anti_ddos_enabled,      sub: c => `${c.anti_ddos_threshold || 30} msg / ${c.anti_ddos_window_seconds || 10} s` },
  { key: 'antiddosvoice', kind: 'config', label: 'Anti-DDoS vocal', on: c => c.anti_ddos_voice_enabled, sub: c => `${c.anti_ddos_voice_threshold || 15} connexions / ${c.anti_ddos_voice_window_seconds || 10} s` },
  { key: 'captcha',    kind: 'config', label: 'Captcha',         on: c => c.captcha_enabled,        sub: () => 'vérification à l\'arrivée' },
  { key: 'minage',     kind: 'config', label: 'Âge minimum',     on: c => !!c.min_account_age_days, sub: c => c.min_account_age_days ? `compte de ${c.min_account_age_days} j minimum` : 'désactivé' },
  { key: 'anti_bot_enabled',   kind: 'toggle', label: 'Anti-bot',   on: c => c.anti_bot_enabled,   sub: () => 'bots non autorisés' },
  { key: 'anti_alt_enabled',   kind: 'toggle', label: 'Anti-alt',   on: c => c.anti_alt_enabled,   sub: () => 'comptes alternatifs' },
  { key: 'antispam',   kind: 'toggle', label: 'Anti-spam',       on: c => c.antispam,               sub: () => 'messages répétés' },
  { key: 'antieveryone', kind: 'toggle', label: 'Anti-@everyone', on: c => c.antieveryone,          sub: () => 'mentions de masse' },
  { key: 'anti_link_enabled',  kind: 'toggle', label: 'Anti-lien',  on: c => c.anti_link_enabled,  sub: () => 'liens non autorisés' },
  { key: 'anti_nuke_enabled',  kind: 'toggle', label: 'Anti-Nuke',  on: c => c.anti_nuke_enabled,  sub: () => 'actions destructrices' },
  { key: 'anti_perm_escalation_enabled', kind: 'toggle', label: 'Anti-escalade', on: c => c.anti_perm_escalation_enabled, sub: () => 'permissions dangereuses' },
  { key: 'anti_ghostping_enabled', kind: 'toggle', label: 'Anti-Ghostping', on: c => c.anti_ghostping_enabled, sub: () => 'mentions supprimées' },
  { key: 'anti_phishing', kind: 'toggle', label: 'Anti-phishing', on: c => c.anti_phishing,         sub: () => 'liens frauduleux' },
  { key: 'anti_scam_image', kind: 'toggle', label: 'Anti-arnaque (OCR)', on: c => c.anti_scam_image, sub: () => 'images suspectes' },
  { key: 'anti_scam_ai', kind: 'toggle', label: 'Anti-arnaque IA', on: c => c.anti_scam_ai, sub: () => 'analyse intelligente' },
  { key: 'dm_lock_enabled', kind: 'toggle', label: 'Fermeture des MP', on: c => c.dm_lock_enabled,   sub: () => 'MP des membres fermés' },
  { key: 'auth_double_detection_enabled', kind: 'toggle', label: 'Compte double', on: c => c.auth_double_detection_enabled, sub: () => 'détection des doublons' },
  { key: 'logs',       kind: 'config', label: 'Logs',            on: c => !!(c.protection_log_channel_id || c.protection_setup_channel_id || c.log_channel_id), sub: () => 'salon de journal' },
  { key: 'signalement', kind: 'config', label: 'Signalements',   on: c => c.signalement_enabled,    sub: () => 'commande /report' },
  { key: 'sanctions',  kind: 'config', label: 'Sanctions',       on: c => !!c.infraction_channel_id, sub: () => 'salon des sanctions' },
  { key: 'transparence', kind: 'config', label: 'Transparence',  on: c => c.transparence_enabled,   sub: () => 'sanctions publiques' },
  { key: 'tagrole',    kind: 'config', label: 'Rôle de Tag',     on: c => c.tag_role_enabled,       sub: () => 'rôle selon le tag' },
  { key: 'auth',       kind: 'config', label: 'Authentification', on: c => c.auth_enabled,          sub: () => 'validation par le staff' },
  { key: 'honeypot',   kind: 'config', label: 'HoneyPot',        on: c => c.honeypot_enabled,       sub: c => `${c.honeypot_sanctions_count || 0} sanction(s)` }
];

const TOGGLE_KEYS = MODULES.filter(m => m.kind === 'toggle').map(m => m.key);
const CONFIG_KEYS = MODULES.filter(m => m.kind === 'config').map(m => m.key);

// ── Dessin ──
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

function renderProtectCard(guildName, cfg, guildId = null) {
  const cc = require('./compactCard');
  if (cc.isCompact(guildId)) {
    const active = MODULES.filter(m => m.on(cfg)).length;
    const locked = !!cfg.lockdown_active;
    const ddosAlert = !!((cfg.anti_ddos_state && cfg.anti_ddos_state.until > Date.now()) || (cfg.anti_ddos_voice_state && cfg.anti_ddos_voice_state.until > Date.now()));
    const status = ddosAlert ? 'ALERTE DDOS' : (locked ? 'VERROUILLÉ' : 'NORMAL');
    return cc.renderCompactSync({
      guildId, theme: ddosAlert ? 'red' : (locked ? 'orange' : 'green'),
      title: '🛡️ Protection', sub: guildName,
      grid: 2, valueMax: 12,
      blocks: MODULES.map(m => ({ label: m.label, value: m.on(cfg) ? 'Actif' : 'Inactif', dot: m.on(cfg) ? '#3ddc84' : '#e0584f' })),
      pills: [{ text: status, tone: ddosAlert ? 'bad' : (locked ? 'accent' : 'ok') }],
      footerLeft: `${active}/${MODULES.length} modules actifs`
    });
  }
  // Carte compacte : peu de texte, grosse police, pour rester lisible une fois réduite par Discord.
  const COLS = 4, PAD = 26, GAP = 10, TILE_H = 58, W = 1240, HEAD = 112;
  const rows = Math.ceil(MODULES.length / COLS);
  const H = HEAD + rows * (TILE_H + GAP) - GAP + PAD;
  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), guildId);

  // Fond
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#12291c');
  bg.addColorStop(1, '#090e0b');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 24); ctx.fill();

  const active = MODULES.filter(m => m.on(cfg)).length;
  const locked = !!cfg.lockdown_active;
  const ddosAlert = !!((cfg.anti_ddos_state && cfg.anti_ddos_state.until > Date.now()) || (cfg.anti_ddos_voice_state && cfg.anti_ddos_voice_state.until > Date.now()));
  const okColor = '#3ddc84';

  // Pastille ronde + coche dessinée
  ctx.fillStyle = okColor;
  ctx.beginPath(); ctx.arc(PAD + 30, 56, 30, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#0a1a10'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(PAD + 17, 57); ctx.lineTo(PAD + 27, 68); ctx.lineTo(PAD + 45, 45); ctx.stroke();

  // Titre + sous-titre
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `40px ${FONT_BOLD}`;
  ctx.fillText(fit(ctx, guildName, 620), PAD + 78, 56);
  ctx.fillStyle = '#8fa398';
  ctx.font = `22px ${FONT}`;
  ctx.fillText(`${active}/${MODULES.length} modules actifs`, PAD + 78, 86);

  // Pastille de statut
  const status = ddosAlert ? 'ALERTE DDOS' : (locked ? 'VERROUILLÉ' : 'NORMAL');
  const sColor = ddosAlert ? '#e0584f' : (locked ? '#f0b429' : okColor);
  ctx.font = `20px ${FONT_BOLD}`;
  const pw = ctx.measureText(status).width + 58;
  ctx.fillStyle = sColor + '33';
  roundRect(ctx, W - PAD - pw, 34, pw, 44, 22); ctx.fill();
  ctx.fillStyle = sColor;
  ctx.beginPath(); ctx.arc(W - PAD - pw + 22, 56, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillText(status, W - PAD - pw + 38, 63);

  // Tuiles (label seul, gros)
  const tileW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  MODULES.forEach((m, i) => {
    const x = PAD + (i % COLS) * (tileW + GAP);
    const y = HEAD + Math.floor(i / COLS) * (TILE_H + GAP);
    const on = !!m.on(cfg);

    ctx.fillStyle = on ? '#14351f' : '#171c19';
    roundRect(ctx, x, y, tileW, TILE_H, 14); ctx.fill();
    ctx.strokeStyle = on ? '#2c7d4d' : '#2a312d';
    ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = on ? okColor : '#5a655e';
    ctx.beginPath(); ctx.arc(x + 26, y + TILE_H / 2, 9, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = on ? '#ffffff' : '#9aa6a0';
    // Police réduite automatiquement si le nom est trop long pour la tuile
    let size = 27;
    ctx.font = `${size}px ${FONT_BOLD}`;
    while (size > 18 && ctx.measureText(m.label).width > tileW - 62) {
      size -= 1;
      ctx.font = `${size}px ${FONT_BOLD}`;
    }
    ctx.fillText(fit(ctx, m.label, tileW - 62), x + 48, y + TILE_H / 2 + 9);
  });

  return canvas.toBuffer('image/png');
}


// ── Carte image du panneau Captcha (même style que la carte de protection) ──
// info = { roleName, channelName, verifiedRoleName, maxAttempts, timeoutMin, kickOnFail, enabled }
function renderCaptchaCard(guildName, info) {
  const cc = require('./compactCard');
  if (cc.isCompact(info.guildId || null)) {
    const on = !!info.enabled;
    return cc.renderCompactSync({
      guildId: info.guildId || null, theme: on ? 'green' : 'red',
      title: '🧩 Captcha', sub: `Vérification à l'arrivée — ${guildName}`,
      blocks: [
        { label: 'Rôle non vérifié', value: info.roleName || 'non défini' },
        { label: 'Salon de vérification', value: info.channelName || 'non défini' },
        { label: 'Rôle vérifié (optionnel)', value: info.verifiedRoleName || 'non défini' },
        { label: 'Tentatives max', value: String(info.maxAttempts) },
        { label: 'Timeout', value: `${info.timeoutMin} min` },
        { label: 'Kick si échec', value: info.kickOnFail ? 'Oui' : 'Non' }
      ],
      quotes: [{ label: 'Exemple de code à taper', text: 'K7 M2 X', maxLines: 1 }],
      pills: [{ text: on ? 'ACTIVÉ' : 'DÉSACTIVÉ', tone: on ? 'ok' : 'bad' }]
    });
  }
  const guildId = info.guildId || null;
  const W = 1240, H = 358, PAD = 26;
  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), guildId);
  const okColor = '#3ddc84';
  const offColor = '#e0584f';
  const on = !!info.enabled;
  const accent = on ? okColor : offColor;

  // Fond
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, on ? '#12291c' : '#2a1614');
  bg.addColorStop(1, on ? '#090e0b' : '#0e0908');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 24); ctx.fill();

  // Pastille + cadenas dessiné
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.arc(PAD + 30, 56, 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0a1a10';
  roundRect(ctx, PAD + 17, 53, 26, 20, 4); ctx.fill();
  ctx.strokeStyle = '#0a1a10'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(PAD + 30, 52, 8, Math.PI, 0); ctx.stroke();

  // Titre + sous-titre
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `40px ${FONT_BOLD}`;
  ctx.fillText('Captcha', PAD + 78, 56);
  ctx.fillStyle = '#8fa398';
  ctx.font = `22px ${FONT}`;
  ctx.fillText(fit(ctx, `Vérification à l'arrivée — ${guildName}`, 700), PAD + 78, 86);

  // Pastille de statut
  const status = on ? 'ACTIF' : 'DÉSACTIVÉ';
  ctx.font = `20px ${FONT_BOLD}`;
  const pw = ctx.measureText(status).width + 58;
  ctx.fillStyle = accent + '33';
  roundRect(ctx, W - PAD - pw, 34, pw, 44, 22); ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.arc(W - PAD - pw + 22, 56, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillText(status, W - PAD - pw + 38, 63);

  // 3 tuiles : rôle non vérifié / salon / rôle vérifié
  const GAP = 10, TILE_H = 82, COLS = 3, TOP = 112;
  const tileW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const tiles = [
    { title: 'Rôle non vérifié', value: info.roleName, optional: false },
    { title: 'Salon de vérification', value: info.channelName, optional: false },
    { title: 'Rôle vérifié (optionnel)', value: info.verifiedRoleName, optional: true }
  ];
  tiles.forEach((t, i) => {
    const x = PAD + i * (tileW + GAP);
    const set = !!t.value;
    const good = set || t.optional;
    ctx.fillStyle = set ? '#14351f' : '#171c19';
    roundRect(ctx, x, TOP, tileW, TILE_H, 14); ctx.fill();
    ctx.strokeStyle = set ? '#2c7d4d' : (good ? '#2a312d' : '#6b2f2b');
    ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = set ? okColor : (good ? '#5a655e' : offColor);
    ctx.beginPath(); ctx.arc(x + 26, TOP + 28, 9, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#8fa398';
    ctx.font = `20px ${FONT}`;
    ctx.fillText(fit(ctx, t.title, tileW - 62), x + 48, TOP + 35);
    ctx.fillStyle = set ? '#ffffff' : '#9aa6a0';
    ctx.font = `28px ${FONT_BOLD}`;
    ctx.fillText(fit(ctx, t.value || 'non défini', tileW - 40), x + 22, TOP + 68);
  });

  // Exemple de code à taper
  const CODE_Y = TOP + TILE_H + 18;
  const CODE_H = 120;
  ctx.fillStyle = '#0d1410';
  roundRect(ctx, PAD, CODE_Y, 560, CODE_H, 14); ctx.fill();
  ctx.strokeStyle = '#1f2a24'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#8fa398';
  ctx.font = `20px ${FONT}`;
  ctx.fillText('Exemple de code à taper', PAD + 22, CODE_Y + 34);
  ctx.fillStyle = okColor;
  ctx.font = `46px ${FONT_BOLD}`;
  const sample = 'K7 M2 X';
  const sw = ctx.measureText(sample).width;
  ctx.fillText(sample, PAD + 22, CODE_Y + 92);
  // petites lignes de "bruit" derrière le code
  ctx.strokeStyle = okColor + '55'; ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(PAD + 14, CODE_Y + 62 + i * 14);
    ctx.lineTo(PAD + 30 + sw, CODE_Y + 82 - i * 12);
    ctx.stroke();
  }

  // Paramètres (3 pastilles)
  const SX = PAD + 560 + GAP;
  const sW = W - PAD - SX;
  const stats = [
    { label: 'Tentatives max', value: String(info.maxAttempts) },
    { label: 'Timeout', value: `${info.timeoutMin} min` },
    { label: 'Kick si échec', value: info.kickOnFail ? 'Oui' : 'Non' }
  ];
  const cw = (sW - GAP * 2) / 3;
  stats.forEach((st, i) => {
    const x = SX + i * (cw + GAP);
    ctx.fillStyle = '#171c19';
    roundRect(ctx, x, CODE_Y, cw, CODE_H, 14); ctx.fill();
    ctx.strokeStyle = '#2a312d'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#8fa398';
    ctx.font = `20px ${FONT}`;
    ctx.fillText(fit(ctx, st.label, cw - 28), x + 18, CODE_Y + 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = `38px ${FONT_BOLD}`;
    ctx.fillText(fit(ctx, st.value, cw - 28), x + 18, CODE_Y + 90);
  });

  return canvas.toBuffer('image/png');
}

// Fichier + galerie prêts à être insérés dans un ContainerBuilder (nom : captcha.png)
// Le canvas ne sait pas dessiner les emojis : on les retire des noms (ex. « 🔐・vérification » → « vérification »)
function cleanName(name) {
  return String(name).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/^[\s・〢|•·\-_]+/u, '').trim() || String(name);
}
function buildCaptchaImage(guild, cfg) {
  const roleName = cfg.captcha_role_id ? (guild.roles.cache.get(String(cfg.captcha_role_id))?.name || 'rôle introuvable') : null;
  const channelName = cfg.captcha_channel_id ? (guild.channels.cache.get(String(cfg.captcha_channel_id))?.name || 'salon introuvable') : null;
  const verifiedRoleName = cfg.captcha_verified_role_id ? (guild.roles.cache.get(String(cfg.captcha_verified_role_id))?.name || 'rôle introuvable') : null;
  const buf = renderCaptchaCard(guild.name, {
    guildId: guild.id,
    roleName: roleName ? '@' + cleanName(roleName) : null,
    channelName: channelName ? '#' + cleanName(channelName) : null,
    verifiedRoleName: verifiedRoleName ? '@' + cleanName(verifiedRoleName) : null,
    maxAttempts: Number(cfg.captcha_max_attempts) || 3,
    timeoutMin: Number(cfg.captcha_timeout_minutes) || 5,
    kickOnFail: cfg.captcha_kick_on_fail !== false,
    enabled: !!cfg.captcha_enabled
  });
  return new AttachmentBuilder(buf, { name: 'captcha.png' });
}


// ── Carte générique pour les panneaux de réglage (RaidMode, Logs, Sanctions, Auth…) ──
// spec = { title, subtitle, icon, enabled, tiles:[{label,value,set,optional}] (1 à 4), stats:[{label,value}] (0 à 4) }
function drawIcon(ctx, name, cx, cy, color) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (name) {
    case 'lock':
      roundRect(ctx, cx - 13, cy - 3, 26, 20, 4); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy - 4, 8, Math.PI, 0); ctx.stroke(); break;
    case 'bolt':
      ctx.beginPath(); ctx.moveTo(cx + 4, cy - 18); ctx.lineTo(cx - 12, cy + 3); ctx.lineTo(cx - 1, cy + 3); ctx.lineTo(cx - 5, cy + 18); ctx.lineTo(cx + 12, cy - 4); ctx.lineTo(cx + 1, cy - 4); ctx.closePath(); ctx.fill(); break;
    case 'clock':
      ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy); ctx.lineTo(cx + 7, cy + 4); ctx.stroke(); break;
    case 'doc':
      roundRect(ctx, cx - 12, cy - 16, 24, 32, 4); ctx.stroke();
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(cx - 6, cy - 7 + i * 8); ctx.lineTo(cx + 6, cy - 7 + i * 8); ctx.stroke(); } break;
    case 'flag':
      ctx.beginPath(); ctx.moveTo(cx - 10, cy + 17); ctx.lineTo(cx - 10, cy - 16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 10, cy - 16); ctx.lineTo(cx + 14, cy - 8); ctx.lineTo(cx - 10, cy + 2); ctx.closePath(); ctx.fill(); break;
    case 'eye':
      ctx.beginPath(); ctx.ellipse(cx, cy, 17, 11, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill(); break;
    case 'tag':
      ctx.beginPath(); ctx.moveTo(cx - 14, cy - 3); ctx.lineTo(cx - 3, cy - 14); ctx.lineTo(cx + 14, cy - 14); ctx.lineTo(cx + 14, cy + 3); ctx.lineTo(cx + 3, cy + 14); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + 6, cy - 6, 3, 0, Math.PI * 2); ctx.fill(); break;
    case 'gavel':
      ctx.beginPath(); ctx.moveTo(cx - 14, cy + 15); ctx.lineTo(cx + 2, cy - 1); ctx.stroke();
      ctx.save(); ctx.translate(cx + 6, cy - 6); ctx.rotate(-Math.PI / 4); roundRect(ctx, -12, -7, 24, 14, 3); ctx.fill(); ctx.restore(); break;
    case 'hex':
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i - Math.PI / 6; const x = cx + 16 * Math.cos(a), y = cy + 16 * Math.sin(a); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath(); ctx.fill(); break;
    default: // check
      ctx.beginPath(); ctx.moveTo(cx - 13, cy + 1); ctx.lineTo(cx - 3, cy + 12); ctx.lineTo(cx + 15, cy - 11); ctx.stroke();
  }
}

function renderConfigCard(spec) {
  const cc = require('./compactCard');
  if (cc.isCompact(spec.guildId || null)) {
    const on = !!spec.enabled;
    const tiles = (spec.tiles || []).slice(0, 4).map(t => ({
      label: t.label, value: t.value || 'non défini', dot: (t.set || t.optional) ? '#3ddc84' : '#e0584f'
    }));
    const stats = (spec.stats || []).slice(0, 4).map(st => ({ label: st.label, value: String(st.value ?? '—') }));
    return cc.renderCompactSync({
      guildId: spec.guildId || null, theme: on ? 'green' : 'red',
      title: `⚙️ ${spec.title}`, sub: spec.subtitle || undefined,
      blocks: [...tiles, ...stats],
      pills: [{ text: on ? 'ACTIVÉ' : 'DÉSACTIVÉ', tone: on ? 'ok' : 'bad' }]
    });
  }
  const guildId = spec.guildId || null;
  const tiles = (spec.tiles || []).slice(0, 4);
  const stats = (spec.stats || []).slice(0, 4);
  const W = 1240, PAD = 26, GAP = 10, HEAD = 112, TILE_H = 82, STAT_H = 100;
  const H = HEAD + TILE_H + (stats.length ? GAP + STAT_H : 0) + PAD;
  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), guildId);
  const okColor = '#3ddc84', offColor = '#e0584f';
  const on = !!spec.enabled;
  const accent = on ? okColor : offColor;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, on ? '#12291c' : '#2a1614');
  bg.addColorStop(1, on ? '#090e0b' : '#0e0908');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 24); ctx.fill();

  // Pastille + icône
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.arc(PAD + 30, 56, 30, 0, Math.PI * 2); ctx.fill();
  drawIcon(ctx, spec.icon, PAD + 30, 56, '#0a1a10');

  // Titre + sous-titre
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `40px ${FONT_BOLD}`;
  ctx.fillText(fit(ctx, spec.title, 620), PAD + 78, 56);
  ctx.fillStyle = '#8fa398';
  ctx.font = `22px ${FONT}`;
  ctx.fillText(fit(ctx, spec.subtitle || '', 700), PAD + 78, 86);

  // Statut
  const status = on ? 'ACTIF' : 'DÉSACTIVÉ';
  ctx.font = `20px ${FONT_BOLD}`;
  const pw = ctx.measureText(status).width + 58;
  ctx.fillStyle = accent + '33';
  roundRect(ctx, W - PAD - pw, 34, pw, 44, 22); ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.arc(W - PAD - pw + 22, 56, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillText(status, W - PAD - pw + 38, 63);

  // Tuiles principales
  const n = Math.max(tiles.length, 1);
  const tileW = (W - PAD * 2 - GAP * (n - 1)) / n;
  tiles.forEach((t, i) => {
    const x = PAD + i * (tileW + GAP);
    const set = !!t.set;
    const good = set || t.optional;
    ctx.fillStyle = set ? '#14351f' : '#171c19';
    roundRect(ctx, x, HEAD, tileW, TILE_H, 14); ctx.fill();
    ctx.strokeStyle = set ? '#2c7d4d' : (good ? '#2a312d' : '#6b2f2b');
    ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = set ? okColor : (good ? '#5a655e' : offColor);
    ctx.beginPath(); ctx.arc(x + 26, HEAD + 28, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8fa398';
    ctx.font = `20px ${FONT}`;
    ctx.fillText(fit(ctx, t.label, tileW - 62), x + 48, HEAD + 35);
    ctx.fillStyle = set ? '#ffffff' : '#9aa6a0';
    ctx.font = `28px ${FONT_BOLD}`;
    ctx.fillText(fit(ctx, t.value || 'non défini', tileW - 40), x + 22, HEAD + 68);
  });

  // Ligne de réglages (optionnelle)
  if (stats.length) {
    const y = HEAD + TILE_H + GAP;
    const cw = (W - PAD * 2 - GAP * (stats.length - 1)) / stats.length;
    stats.forEach((st, i) => {
      const x = PAD + i * (cw + GAP);
      ctx.fillStyle = '#171c19';
      roundRect(ctx, x, y, cw, STAT_H, 14); ctx.fill();
      ctx.strokeStyle = '#2a312d'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#8fa398';
      ctx.font = `20px ${FONT}`;
      ctx.fillText(fit(ctx, st.label, cw - 28), x + 18, y + 36);
      ctx.fillStyle = '#ffffff';
      ctx.font = `34px ${FONT_BOLD}`;
      ctx.fillText(fit(ctx, st.value, cw - 28), x + 18, y + 80);
    });
  }
  return canvas.toBuffer('image/png');
}

function buildConfigImage(spec) {
  return new AttachmentBuilder(renderConfigCard(spec), { name: 'config.png' });
}

// Nom lisible (sans emoji) d'un rôle ou salon, préfixé @ ou #. null si id absent.
function nameOf(guild, kind, id) {
  if (!id) return null;
  const obj = kind === 'role' ? guild.roles.cache.get(String(id)) : guild.channels.cache.get(String(id));
  if (!obj) return kind === 'role' ? '@rôle introuvable' : '#salon introuvable';
  return (kind === 'role' ? '@' : '#') + cleanName(obj.name);
}

// ── Panneau /protect-settings, style « Configuration » (onglets + lignes + bouton) ──
// Components V2 : en-tête avec bouton Changelog, onglets de catégories, une ligne par module
// (nom + état à gauche, bouton Activer/Désactiver ou Modifier à droite), pagination, boutons globaux.
const PANEL_ACCENT = 0xE8510D;
const CHANGELOG_URL = 'https://corelab-4cn.pages.dev/docs#p-changelog';
const PAGE_SIZE = 5; // limite Discord : 40 composants par message

const TABS = [
  { key: 'arrivees',   label: 'Arrivées',   mods: ['raidmode', 'captcha', 'minage', 'anti_bot_enabled', 'anti_alt_enabled', 'auth', 'auth_double_detection_enabled'] },
  { key: 'protection', label: 'Protection', mods: ['antispam', 'antieveryone', 'anti_link_enabled', 'anti_ghostping_enabled', 'anti_phishing', 'anti_scam_image', 'anti_scam_ai', 'dm_lock_enabled'] },
  { key: 'attaques',   label: 'Attaques',   mods: ['anti_nuke_enabled', 'anti_perm_escalation_enabled', 'antiddos', 'antiddosvoice', 'honeypot'] },
  { key: 'moderation', label: 'Modération', mods: ['logs', 'sanctions', 'signalement', 'transparence', 'tagrole'] }
];

const MODULE_ICONS = {
  raidmode: '🚨', captcha: '🔐', minage: '⏳', anti_bot_enabled: '🤖', anti_alt_enabled: '👤', auth: '🪪',
  auth_double_detection_enabled: '👥', antispam: '🚫', antieveryone: '🔕', anti_link_enabled: '🔗',
  anti_ghostping_enabled: '👻', anti_phishing: '🎣', anti_scam_image: '🖼️', anti_scam_ai: '🧠',
  dm_lock_enabled: '📪', anti_nuke_enabled: '💣', anti_perm_escalation_enabled: '🔑', antiddos: '🌊',
  antiddosvoice: '🔊', honeypot: '🍯', logs: '📜', sanctions: '⚖️', signalement: '🚩', transparence: '📖', tagrole: '🏷️'
};

// Dernier onglet/page affiché par message (pour rester sur le même onglet après un clic).
const viewByMessage = new Map();
function rememberView(interaction, view) {
  const id = interaction?.message?.id;
  if (!id || !view) return;
  if (viewByMessage.size > 500) viewByMessage.delete(viewByMessage.keys().next().value);
  viewByMessage.set(id, { tab: view.tab, page: view.page });
}
function viewOf(interaction) {
  return viewByMessage.get(interaction?.message?.id) || null;
}

function moduleByKey(key) { return MODULES.find(m => m.key === key); }

function buildProtectPayload(guild, notice = null, view = null) {
  const cfg = getGuildConfig(guild.id);
  const tab = TABS.find(t => t.key === view?.tab) || TABS[0];
  const mods = tab.mods.map(moduleByKey).filter(Boolean);
  const totalPages = Math.max(1, Math.ceil(mods.length / PAGE_SIZE));
  const page = Math.min(Math.max(Number(view?.page) || 0, 0), totalPages - 1);

  const actifs = MODULES.filter(m => m.on(cfg)).length;
  const intro = 'Les réglages de protection de CoreLab pour ce serveur. Pour commencer, regarde **Arrivées** (captcha, anti-raid) et **Modération** (salon de logs, sanctions).\n' +
    'Tout changement s\'applique immédiatement.' + (notice ? `\n\n${String(notice).slice(0, 500)}` : '');

  const container = new ContainerBuilder().setAccentColor(PANEL_ACCENT);
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## 🛡️ Protection'),
        new TextDisplayBuilder().setContent(`-# CoreLab • ${guild.name} • ${actifs}/${MODULES.length} modules actifs`),
        new TextDisplayBuilder().setContent(intro)
      )
      .setButtonAccessory(
        new ButtonBuilder().setLabel('Changelog').setEmoji('📜').setStyle(ButtonStyle.Link).setURL(CHANGELOG_URL)
      )
  );

  // Onglets
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      TABS.map(t => new ButtonBuilder()
        .setCustomId(`protect_tab|${t.key}`)
        .setLabel(t.label)
        .setEmoji(t.key === tab.key ? '📂' : '📁')
        .setStyle(t.key === tab.key ? ButtonStyle.Primary : ButtonStyle.Secondary))
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  // Une ligne par module : nom + état / bouton à droite
  for (const m of mods.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const on = !!m.on(cfg);
    const etat = on ? '🟢 Actif' : '🔴 Inactif';
    let detail = '';
    try { detail = on || m.kind === 'config' ? String(m.sub(cfg) || '') : ''; } catch { /* sans détail */ }
    const value = detail && (on || m.kind === 'config') ? `${etat} • ${detail}` : etat;

    const btn = new ButtonBuilder();
    if (m.kind === 'toggle') {
      btn.setCustomId(`protect_tgl|${tab.key}|${page}|${m.key}`)
        .setLabel(on ? 'Désactiver' : 'Activer')
        .setStyle(on ? ButtonStyle.Danger : ButtonStyle.Success);
    } else {
      btn.setCustomId(`protect_cfg|${tab.key}|${page}|${m.key}`)
        .setLabel('Modifier')
        .setEmoji('⚙️')
        .setStyle(ButtonStyle.Primary);
    }
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${MODULE_ICONS[m.key] || '🛡️'} ${m.label}**\n> ${value}`))
        .setButtonAccessory(btn)
    );
  }

  // Pagination
  if (totalPages > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`protect_page|${tab.key}|${page - 1}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('protect_page_info').setLabel(`Page ${page + 1}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`protect_page|${tab.key}|${page + 1}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
      )
    );
  }

  // Boutons globaux
  const simpleActive = Boolean(cfg.antispam && cfg.antieveryone && (cfg.raidmode_enabled || cfg.captcha_enabled));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('protect_refresh_btn').setLabel('Actualiser').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('protect_simple_btn').setLabel('Mode Simple').setEmoji('🛡️').setStyle(simpleActive ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('protect_lockdown_btn').setLabel(cfg.lockdown_active ? 'Déverrouiller' : 'Verrouiller').setEmoji('🔒').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('protect_honeypot_reset_btn').setLabel('Reset HoneyPot').setEmoji('🍯').setStyle(ButtonStyle.Secondary)
    )
  );

  return {
    components: [container],
    files: [],
    attachments: [],
    flags: MessageFlags.IsComponentsV2
  };
}

module.exports = { buildProtectPayload, rememberView, viewOf, PROTECT_TABS: TABS, renderProtectCard, renderCaptchaCard, buildCaptchaImage, renderConfigCard, buildConfigImage, nameOf, TOGGLE_KEYS, CONFIG_KEYS, MODULES };