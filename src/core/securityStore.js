// src/core/securityStore.js
// Données partagées des modules « Mode nuit », « Alertes réseau » et « Permissions sensibles ».
// Les réglages par serveur restent dans bot_config.json (clés night_*, net_*, perm_*) ;
// ce fichier garde ce qui est partagé entre serveurs (bans réseau) ou volatil (alertes en attente).

const fs = require('fs');
const { PermissionFlagsBits } = require('discord.js');
const { fichierPersistant } = require('./persistentPath');

const FILE = fichierPersistant('security_network.json');

/* ---------- Permissions surveillables (clés = celles du dashboard) ---------- */
const PERM_FLAGS = {
  administrator: PermissionFlagsBits.Administrator,
  manage_guild: PermissionFlagsBits.ManageGuild,
  manage_roles: PermissionFlagsBits.ManageRoles,
  manage_channels: PermissionFlagsBits.ManageChannels,
  manage_webhooks: PermissionFlagsBits.ManageWebhooks,
  ban_members: PermissionFlagsBits.BanMembers,
  kick_members: PermissionFlagsBits.KickMembers,
  moderate_members: PermissionFlagsBits.ModerateMembers,
  manage_messages: PermissionFlagsBits.ManageMessages,
  mention_everyone: PermissionFlagsBits.MentionEveryone
};
const PERM_LABELS = {
  administrator: 'Administrateur', manage_guild: 'Gérer le serveur', manage_roles: 'Gérer les rôles',
  manage_channels: 'Gérer les salons', manage_webhooks: 'Gérer les webhooks', ban_members: 'Bannir des membres',
  kick_members: 'Expulser des membres', moderate_members: 'Exclure temporairement',
  manage_messages: 'Gérer les messages', mention_everyone: 'Mentionner @everyone'
};
const PERM_KEYS = Object.keys(PERM_FLAGS);
const PERM_DEF = ['administrator', 'manage_guild', 'manage_roles', 'manage_channels', 'manage_webhooks', 'ban_members'];

/* ---------- Fuseaux horaires ---------- */
function validTz(tz) {
  try { new Intl.DateTimeFormat('fr-FR', { timeZone: String(tz) }); return true; } catch { return false; }
}

/* ---------- Fichier JSON ---------- */
let db = null;
let timer = null;
function load() {
  if (db) return db;
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = {}; }
  db.bans = db.bans || {};          // userId → { kinds:[…], guilds:{ guildId: { kind, ts } } }
  db.permAlerts = db.permAlerts || {}; // guildId → [alerte]
  return db;
}
function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try { fs.writeFileSync(FILE, JSON.stringify(db)); } catch (e) { console.error('[securityStore] écriture :', e.message); }
  }, 500);
}

/* ---------- Réseau : bans partagés ---------- */
const NET_KINDS = ['scam', 'raid'];
function classifyBanReason(reason) {
  const r = String(reason || '').toLowerCase();
  if (!r) return null;
  if (/scam|arnaque|phish|hame[cç]onn|fraud|crypto\s*giveaway|nitro\s*gratuit|compte\s*(pirat|compromis|hack)/.test(r)) return 'scam';
  if (/raid|nuke|mass\s*join|bot\s*raid|spam\s*bot|selfbot|self-bot/.test(r)) return 'raid';
  return null;
}
function addNetBan(userId, guildId, kind) {
  if (!NET_KINDS.includes(kind)) return;
  const d = load();
  const e = d.bans[userId] || (d.bans[userId] = { guilds: {} });
  e.guilds[guildId] = { kind, ts: Date.now() };
  save();
}
function removeNetBan(userId, guildId) {
  const d = load(), e = d.bans[userId];
  if (!e || !e.guilds[guildId]) return false;
  delete e.guilds[guildId];
  if (!Object.keys(e.guilds).length) delete d.bans[userId];
  save();
  return true;
}
// Signalements d'autres serveurs sur ce compte (jamais le nom ni l'ID des serveurs)
function networkReports(userId, exceptGuildId) {
  const e = load().bans[userId];
  if (!e) return null;
  const others = Object.entries(e.guilds).filter(([g]) => g !== exceptGuildId).map(([, v]) => v);
  if (!others.length) return null;
  const scam = others.filter(o => o.kind === 'scam').length;
  const raid = others.filter(o => o.kind === 'raid').length;
  // Score de confiance du signalement (0-100) : croît avec le nombre de serveurs indépendants
  const n = others.length;
  const score = Math.min(97, n === 1 ? 40 : n === 2 ? 65 : 80 + Math.min(17, (n - 3) * 5));
  return { servers: n, scam, raid, score, last: Math.max(...others.map(o => o.ts)) };
}
function networkStats(guildId) {
  const d = load();
  let shared = 0;
  for (const e of Object.values(d.bans)) if (e.guilds[guildId]) shared++;
  return { shared_bans: shared, reported_accounts: Object.keys(d.bans).length };
}

/* ---------- Alertes de permissions ---------- */
function addPermAlert(guildId, alert) {
  const d = load(), list = d.permAlerts[guildId] || (d.permAlerts[guildId] = []);
  list.unshift(alert);
  if (list.length > 100) list.length = 100;
  save();
  return alert;
}
function getPermAlert(guildId, id) {
  return (load().permAlerts[guildId] || []).find(a => a.id === id) || null;
}
function savePermAlerts() { save(); }
function recentPermAlerts(guildId, n = 10) {
  return (load().permAlerts[guildId] || []).slice(0, n).map(a => ({
    title: a.title, member: a.targetName || a.executorName || '', ts: a.ts, status: a.status
  }));
}
function pendingAutoRevert() {
  const out = [];
  for (const [guildId, list] of Object.entries(load().permAlerts)) {
    for (const a of list) if (a.status === 'pending' && a.revertAt && a.revertAt <= Date.now()) out.push({ guildId, alert: a });
  }
  return out;
}

module.exports = {
  PERM_FLAGS, PERM_LABELS, PERM_KEYS, PERM_DEF, validTz,
  classifyBanReason, addNetBan, removeNetBan, networkReports, networkStats,
  addPermAlert, getPermAlert, savePermAlerts, recentPermAlerts, pendingAutoRevert
};
