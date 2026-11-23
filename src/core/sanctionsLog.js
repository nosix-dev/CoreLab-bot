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
    try {
      const LBL = { kick: 'Expulsion', ban: 'Bannissement', timeout: 'Timeout', mute: 'Mute', quarantine: 'Quarantaine' };
      require('./radarLog').enregistrer(gid, {
        category: 'moderation', title: LBL[type] || 'Sanction',
        description: `${member.displayName || member.user?.username || member.username || member.id} — ${String(reason || 'Aucune').slice(0, 160)}`,
        member: { id: String(member.id), name: member.displayName || member.user?.username || member.username || null },
        action: LBL[type] || type
      });
    } catch { /* le Radar est facultatif */ }
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { console.error('[sanctionsLog]', e.message); }
}

function lister(guildId) {
  const db = charger();
  return Array.isArray(db[String(guildId)]) ? db[String(guildId)] : [];
}

// Vrai si une sanction de ce type a déjà été enregistrée pour ce membre dans les `ms` dernières millisecondes.
function recente(guildId, memberId, type, ms = 20000) {
  const depuis = Date.now() - ms;
  return lister(guildId).some(e => e.type === type && e.member?.id === String(memberId) && e.ts >= depuis);
}

// Retire une entrée (identifiée par sa date et le membre concerné). Retourne true si elle existait.
function retirer(guildId, ts, memberId) {
  try {
    const db = charger();
    const gid = String(guildId);
    const liste = Array.isArray(db[gid]) ? db[gid] : [];
    const i = liste.findIndex(e => e.ts === ts && e.member?.id === String(memberId));
    if (i < 0) return false;
    liste.splice(i, 1);
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db));
    fs.renameSync(FILE + '.tmp', FILE);
    return true;
  } catch (e) { console.error('[sanctionsLog]', e.message); return false; }
}

// Marque une sanction comme levée (depuis le dashboard). Retourne true si elle existait.
function marquerLevee(guildId, ts, memberId, par) {
  try {
    const db = charger();
    const liste = Array.isArray(db[String(guildId)]) ? db[String(guildId)] : [];
    const e = liste.find(x => x.ts === ts && x.member?.id === String(memberId));
    if (!e) return false;
    e.revoked = true;
    e.revokedAt = Date.now();
    e.revokedBy = par ? String(par).slice(0, 80) : null;
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db));
    fs.renameSync(FILE + '.tmp', FILE);
    return true;
  } catch (e) { console.error('[sanctionsLog]', e.message); return false; }
}

module.exports = { enregistrer, lister, recente, retirer, marquerLevee };