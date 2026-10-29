'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Style « Compact » commun à TOUTES les cartes image (choisi dans /cartes-style).
// Même rendu que les logs : tuile d'icône à gauche, titre, infos sur une ligne
// qui se replie, pied de carte discret. Chaque carte décrit son contenu avec un
// « spec » (title, sub, blocks, quotes, progress, footerLeft/Right…) et ce module
// le dessine avec le moteur de logs (handlers/logCardImage.js).
// ─────────────────────────────────────────────────────────────────────────

const { getTheme } = require('./cardTheme');

let _lc = null;
const lc = () => _lc || (_lc = require('../handlers/logCardImage'));

/** Le serveur utilise-t-il le style Compact ? */
// Style unifié : TOUTES les cartes utilisent la mise en page des logs « Message envoyé »
// (tuile d'icône + bandeau coloré). Mettre à false pour revenir au choix /cartes-style.
const UNIFIED_LOOK = true;

function isCompact(guildId) {
  if (UNIFIED_LOOK) return true;
  try { return getTheme(guildId).look === 'compact'; } catch { return false; }
}

const base = spec => ({ theme: 'green', ...spec, logStyle: 'tuile' });

/** Rendu synchrone (les emojis déjà en cache sont dessinés). */
function renderCompactSync(spec) {
  return lc().generateLogCard(base(spec));
}

/** Rendu recommandé : télécharge d'abord les emojis de la carte. */
async function renderCompact(spec) {
  return lc().generateLogCardAsync(base(spec));
}

// Pré-charge les emojis d'icône au démarrage (cartes synchrones : niveau, config, classement…)
function warmEmojis(extra = []) {
  try {
    require('./cardEmoji').preloadEmojis(['⬆️', '⭐', '⚙️', '🏆', ...extra]).catch(() => { });
  } catch { /* les icônes apparaîtront dès qu'elles seront en cache */ }
}
warmEmojis();

const fmt = n => Math.floor(Number(n) || 0).toLocaleString('fr-FR');
const cap = s => { const t = String(s ?? '').trim().toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

// ── Specs prêts à l'emploi ──

function levelUpSpec(o) {
  const ratio = o.neededXp > 0 ? Math.max(0, Math.min(1, o.currentXp / o.neededXp)) : 0;
  return {
    guildId: o.guildId,
    title: '⬆️ Level up',
    sub: o.badge ? `${o.username}  ·  ${o.badge}` : o.username,
    blocks: [
      { label: 'Niveau', value: String(o.level) },
      { label: 'XP gagné', value: `+${fmt(o.gainedXp)} XP` },
      { label: 'Via', value: o.source === 'voice' ? 'Vocal' : 'Message' },
      { label: 'XP total', value: `${fmt(o.totalXp)} XP` }
    ],
    progress: ratio,
    footerLeft: `${fmt(o.currentXp)} / ${fmt(o.neededXp)} XP`,
    footerRight: `Prochain niveau : ${(o.level || 0) + 1}`
  };
}

function starboardSpec(o) {
  const score = Math.max(0, o.score | 0);
  const th = Math.max(score, o.threshold | 0, 1);
  return {
    guildId: o.guildId,
    title: '⭐ StarBoard',
    sub: String(o.author || 'Inconnu'),
    blocks: [{ label: 'Score', value: `${score} / ${th} étoiles` }],
    quotes: o.content ? [{ label: 'Message', text: String(o.content), maxLines: 3 }] : [],
    progress: score / th,
    photo: o.photo || null,
    footerLeft: o.footer || 'ScaraBot · StarBoard'
  };
}

function voiceSpec(o) {
  const titles = { join: '🟢 Connecté en vocal', leave: '🔴 Déconnecté du vocal', move: '🔀 Changement de salon' };
  const blocks = [];
  if (o.type === 'move') {
    blocks.push({ label: 'De', value: o.fromChannel || '—' }, { label: 'Vers', value: o.toChannel || '—' });
  } else {
    blocks.push({ label: o.type === 'leave' ? 'Salon quitté' : 'Salon rejoint', value: o.channelName || '—' });
    if (o.type === 'join') {
      blocks.push(
        { label: 'Micro', value: o.micMuted ? 'coupé' : 'actif', dot: o.micMuted ? '#ff4d5e' : '#2ecc71' },
        { label: 'Casque', value: o.deafened ? 'coupé' : 'actif', dot: o.deafened ? '#ff4d5e' : '#2ecc71' }
      );
    } else if (o.durationMs !== undefined) {
      const total = Math.max(0, Math.floor((o.durationMs || 0) / 1000));
      const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
      blocks.push({ label: 'Durée', value: h > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : m > 0 ? `${m}min ${String(s).padStart(2, '0')}s` : `${s}s` });
    }
  }
  blocks.push({ label: o.type === 'leave' ? 'Membres restants' : 'Membres présents', value: String(Number.isFinite(o.members) ? o.members : 0) });
  return {
    guildId: o.guildId,
    theme: { join: 'green', leave: 'red', move: 'orange' }[o.type] || 'green',
    title: titles[o.type] || titles.join,
    time: o.time,
    sub: o.tag && o.tag !== o.username ? `${o.username}  ·  ${o.tag}` : o.username,
    blocks,
    footerLeft: o.guildName,
    footerRight: o.memberId ? `ID ${o.memberId}` : undefined
  };
}

/** Panneaux de config : chaque tuile devient « Libellé valeur » (point vert/rouge pour les états). */
function settingsSpec(data, guildId) {
  return {
    guildId,
    title: `⚙️ ${data.title}`,
    sub: data.subtitle || undefined,
    grid: data.tiles.length >= 5 ? 2 : 1,
    valueMax: 48,
    blocks: data.tiles.map(t => ({
      label: cap(t.label),
      value: String(t.value ?? '—').split('\n').join(', '),
      dot: t.state === true ? '#2ecc71' : t.state === false ? '#ff4d5e' : undefined
    })),
    footerLeft: data.footer || undefined
  };
}

/** Classements : « 1. Pseudo » + valeur, sur des lignes qui se replient. */
function rankingSpec({ title, subtitle, badge, rows, guildId }) {
  const list = rows && rows.length ? rows : null;
  return {
    guildId,
    title: `🏆 ${title}`,
    sub: subtitle || undefined,
    grid: 1,
    valueMax: 40,
    blocks: list
      ? list.map((r, i) => ({ label: `${i + 1}. ${r.name}`, value: String(r.value ?? '') }))
      : [{ label: '', value: 'Aucun score pour le moment' }],
    footerRight: badge || undefined
  };
}

module.exports = {
  isCompact,
  renderCompact,
  renderCompactSync,
  warmEmojis,
  levelUpSpec,
  starboardSpec,
  voiceSpec,
  settingsSpec,
  rankingSpec
};
