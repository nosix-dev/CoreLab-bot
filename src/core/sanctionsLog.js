// src/core/sanctionsLog.js : historique des sanctions (kick, ban, timeout, mute) pour la page Infractions du dashboard.
// Les avertissements (warns.json) et infractions ajoutées (infractions.json) sont déjà stockés ailleurs.

const fs = require('fs');
const { fichierPersistant } = require('./persistentPath');

const FILE = fichierPersistant('sanctions_log.json');
const MAX_PAR_SERVEUR = 2000;
let DB = null;

function charger() {
  if (DB) return DB;
  try { DB = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { DB = {}; }
  if (!DB || typeof DB !== 'object') DB = {};
  return DB;
}

function enregistrer(guildId, { type, member, moderator, reason }) {
  try {
    const db = charger();
    const gid = String(guildId);
    if (!Array.isArray(db[gid])) db[gid] = [];
    db[gid].push({
      type,
      member: { id: String(member.id), name: member.displayName || member.user?.username || member.username || null, avatar: member.displayAvatarURL?.({ size: 64 }) || member.user?.displayAvatarURL?.({ size: 64 }) || null },
      moderator: { id: String(moderator.id), name: moderator.username || null },
      reason: String(reason || 'Aucune').slice(0, 1000),
      ts: Date.now()
    });
    if (db[gid].length > MAX_PAR_SERVEUR) db[gid] = db[gid].slice(-MAX_PAR_SERVEUR);
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { console.error('[sanctionsLog]', e.message); }
}

function lister(guildId) {
  const db = charger();
  return Array.isArray(db[String(guildId)]) ? db[String(guildId)] : [];
}

module.exports = { enregistrer, lister };
