// src/core/modApi.js : routes « Modération » du dashboard (/api/guilds/:id/mod/…)
//   queue        À traiter           GET + POST :id/(resolve|dismiss)
//   infractions  Infractions         GET + DELETE :id
//   sanctions    Sanctions           GET + POST :id/revoke
//   staff        Équipe de modération GET
//   watchlist    Surveillance        GET, POST, DELETE :id, PUT settings   (handlers/surveillance.js)
//   conflicts    Conflits            GET, PUT settings                      (handlers/surveillance.js)
// Chaque fonction retourne { code, body } ; l'authentification est faite par webDashboard.js.

const { PermissionFlagsBits } = require('discord.js');
const sanctionsLog = require('./sanctionsLog');
const reports = require('./reports');

const TYPES_SANCTION = ['ban', 'kick', 'timeout', 'mute'];
const LIBELLE = { ban: 'Bannissement', kick: 'Expulsion', timeout: 'Timeout', mute: 'Mute' };

const ok = (body = { ok: true }) => ({ code: 200, body });
const ko = (code, error, reason) => ({ code, body: { error, ...(reason ? { reason } : {}) } });

function pagination(items, query) {
  const limit = Math.min(100, Math.max(1, Number(query.get('limit')) || 50));
  const before = Number(query.get('before')) || 0;
  const q = String(query.get('q') || '').trim().toLowerCase().slice(0, 80);
  let liste = items;
  if (q) liste = liste.filter(e => `${e.member?.name || ''} ${e.member?.id || ''} ${e.reason || ''} ${e.moderator?.name || ''} ${e.description || ''}`.toLowerCase().includes(q));
  liste = [...liste].sort((a, b) => b.ts - a.ts);
  if (before) liste = liste.filter(e => e.ts < before);
  const page = liste.slice(0, limit);
  return { page, next: liste.length > limit ? String(page[page.length - 1].ts) : null };
}

const nomMembre = (guild, id, repli) => {
  const m = guild.members.cache.get(String(id));
  return { id: String(id), name: m ? m.displayName : (repli || 'Ancien membre'), avatar: m ? m.displayAvatarURL({ size: 64 }) : null };
};
const nomModo = (guild, id) => {
  const m = guild.members.cache.get(String(id));
  return { id: String(id), name: m ? m.displayName : (guild.client.users.cache.get(String(id))?.username || String(id)) };
};

/* ------------------------------ À traiter ------------------------------ */
function queue(guild, query) {
  const d = reports.dossiers(guild, { status: 'open', q: query.get('q') || '' });
  const items = [];
  for (const dos of d.dossiers) {
    for (const r of dos.reports) {
      if (r.status !== 'open') continue;
      items.push({
        id: r.id, type: 'Signalement', status: 'open', ts: r.ts,
        title: 'Signalement', member: dos.member, avatar: dos.member.avatar || null,
        reason: r.reason || 'Aucun motif',
        description: `Signalé par ${r.reporter.name || 'un membre'}${r.channel ? ` dans #${r.channel}` : ''}${dos.priority ? ' · priorité' : ''}`
      });
    }
  }
  const { page, next } = pagination(items, query);
  return ok({ items: page, next, stats: { pending: items.length, reports: items.length, conversations: 0 } });
}
function queueAction(guild, user, id, action) {
  if (!['resolve', 'dismiss'].includes(action)) return ko(400, 'invalid');
  const r = reports.decider(guild.id, [id], action, { id: user.id, name: user.username });
  if (r.error === 'not_found') return ko(404, 'not_found');
  return r.error ? ko(400, r.error) : ok(r);
}

/* ------------------------------ Infractions ------------------------------ */
function toutesInfractions(guild) {
  const out = [];
  for (const e of sanctionsLog.lister(guild.id)) {
    out.push({
      id: `s_${e.ts}_${e.member.id}`, type: e.type, ts: e.ts, reason: e.reason,
      member: { id: e.member.id, name: e.member.name, avatar: e.member.avatar }, moderator: e.moderator
    });
  }
  try {
    const { store } = require('./data');
    for (const [uid, liste] of Object.entries(store.warns || {})) {
      for (const w of Array.isArray(liste) ? liste : []) {
        if (!w || String(w.guild_id) !== guild.id) continue;
        const ts = Date.parse(w.date) || 0;
        out.push({ id: `w_${uid}_${ts}`, type: 'warn', ts, reason: w.reason, member: nomMembre(guild, uid), moderator: nomModo(guild, w.moderator) });
      }
    }
    const inf = store.infractions || {};
    const pousser = (uid, w) => {
      const ts = Date.parse(w.date) || 0;
      out.push({
        id: `i_${uid}_${ts}`, type: 'infraction', ts, reason: w.reason || w.detail || w.type || '—',
        member: nomMembre(guild, uid), moderator: w.moderator ? nomModo(guild, w.moderator) : { id: guild.client.user.id, name: 'CoreLab' }
      });
    };
    for (const [k, v] of Object.entries(inf)) {
      if (Array.isArray(v)) { for (const w of v) if (w && String(w.guild_id) === guild.id) pousser(k, w); } // stockage plat : uid → [...]
      else if (k === guild.id && v && typeof v === 'object') { // stockage guilde → uid → [...]
        for (const [uid, liste] of Object.entries(v)) for (const w of Array.isArray(liste) ? liste : []) if (w) pousser(uid, w);
      }
    }
  } catch (e) { console.error('[modApi] infractions :', e.message); }
  return out;
}
function infractions(guild, query) {
  const type = String(query.get('status') || '');
  let items = toutesInfractions(guild);
  if (type) items = items.filter(e => e.type === type);
  const { page, next } = pagination(items, query);
  return ok({ items: page, next });
}
function retirerInfraction(guild, id) {
  const m = /^([swi])_(\d{5,20})_(\d+)$/.exec(String(id));
  if (!m) return ko(400, 'invalid');
  const [, kind, a, b] = m;
  const { store, persist } = require('./data');
  if (kind === 's') return sanctionsLog.retirer(guild.id, Number(a), b) ? ok() : ko(404, 'not_found'); // s_<ts>_<idMembre>
  const uid = a, ts = Number(b);
  const liste = kind === 'w' ? (store.warns || {})[uid] : null;
  if (kind === 'w' && Array.isArray(liste)) {
    const i = liste.findIndex(w => w && String(w.guild_id) === guild.id && (Date.parse(w.date) || 0) === ts);
    if (i < 0) return ko(404, 'not_found');
    liste.splice(i, 1);
    persist('warns');
    return ok();
  }
  if (kind === 'i') {
    const inf = store.infractions || {};
    const plat = inf[uid];
    const cible = Array.isArray(plat) ? plat : (inf[guild.id] || {})[uid];
    if (Array.isArray(cible)) {
      const i = cible.findIndex(w => w && (Date.parse(w.date) || 0) === ts);
      if (i >= 0) { cible.splice(i, 1); persist('infractions'); return ok(); }
    }
  }
  return ko(404, 'not_found');
}

/* ------------------------------ Sanctions ------------------------------ */
function statutSanction(guild, e, cfg) {
  if (e.revoked) return 'revoked';
  if (e.type === 'kick') return 'expired';
  if (e.type === 'ban') return 'active';
  const m = guild.members.cache.get(e.member.id);
  if (!m) return 'expired';
  if (e.type === 'timeout') return (m.communicationDisabledUntilTimestamp || 0) > Date.now() ? 'active' : 'expired';
  return cfg.mute_role && m.roles.cache.has(String(cfg.mute_role)) ? 'active' : 'expired';
}
function sanctions(guild, query) {
  const cfg = require('./config').obtenirConfigGuilde(guild.id);
  const status = String(query.get('status') || '');
  let items = sanctionsLog.lister(guild.id).filter(e => TYPES_SANCTION.includes(e.type)).map(e => ({
    id: `s_${e.ts}_${e.member.id}`, type: LIBELLE[e.type] || e.type, ts: e.ts, reason: e.reason,
    member: { id: e.member.id, name: e.member.name, avatar: e.member.avatar }, avatar: e.member.avatar || null,
    moderator: e.moderator, status: statutSanction(guild, e, cfg)
  }));
  if (status) items = items.filter(e => e.status === status);
  const { page, next } = pagination(items, query);
  return ok({ items: page, next });
}
async function leverSanction(guild, user, id) {
  const m = /^s_(\d{5,20})_(\d+)$/.exec(String(id));
  if (!m) return ko(400, 'invalid');
  const ts = Number(m[1]), uid = m[2];
  const e = sanctionsLog.lister(guild.id).find(x => x.ts === ts && x.member.id === uid);
  if (!e) return ko(404, 'not_found');
  if (e.revoked) return ko(400, 'invalid', 'Cette sanction est déjà levée.');
  const raison = `Levée depuis le dashboard par ${user.username}`;
  try {
    if (e.type === 'ban') await guild.bans.remove(uid, raison);
    else if (e.type === 'timeout') { const mb = guild.members.cache.get(uid) || await guild.members.fetch(uid).catch(() => null); if (mb) await mb.timeout(null, raison); }
    else if (e.type === 'mute') {
      const cfg = require('./config').obtenirConfigGuilde(guild.id);
      const mb = guild.members.cache.get(uid) || await guild.members.fetch(uid).catch(() => null);
      if (mb && cfg.mute_role) await mb.roles.remove(String(cfg.mute_role), raison);
    }
  } catch (err) {
    return ko(400, 'discord', `Discord a refusé : ${err.message}`);
  }
  sanctionsLog.marquerLevee(guild.id, ts, uid, user.username);
  return ok();
}

/* ------------------------------ Équipe ------------------------------ */
async function staff(guild, query) {
  if (guild.memberCount <= 1500 && guild.members.cache.size < guild.memberCount) await guild.members.fetch().catch(() => { });
  const F = PermissionFlagsBits;
  const parModo = new Map();
  for (const e of sanctionsLog.lister(guild.id)) parModo.set(e.moderator.id, (parModo.get(e.moderator.id) || 0) + 1);
  const items = [];
  for (const m of guild.members.cache.values()) {
    if (m.user.bot) continue;
    const admin = m.permissions.has(F.Administrator);
    if (!admin && !m.permissions.has(F.ModerateMembers) && !m.permissions.has(F.BanMembers) && !m.permissions.has(F.KickMembers) && !m.permissions.has(F.ManageMessages)) continue;
    items.push({
      id: m.id, type: guild.ownerId === m.id ? 'Propriétaire' : admin ? 'Administrateur' : 'Modérateur',
      member: { id: m.id, name: m.displayName, avatar: m.displayAvatarURL({ size: 64 }) }, avatar: m.displayAvatarURL({ size: 64 }),
      count: parModo.get(m.id) || 0, ts: m.joinedTimestamp || 0,
      description: m.presence?.status && m.presence.status !== 'offline' ? 'En ligne' : undefined
    });
  }
  const { page, next } = pagination(items.map(e => ({ ...e, reason: e.type })), query);
  return ok({ items: page.map(({ reason, ...e }) => e), next });
}

/* ------------------------------ Surveillance ------------------------------ */
async function surveillance(guild, user, method, sub, body) {
  const S = require('../handlers/surveillance').api;
  if (method === 'GET' && !sub) return ok(S.listeSurveillance(guild));
  if (method === 'PUT' && sub === 'settings') { const r = S.reglagesSurveillance(guild, body || {}); return r.error ? ko(400, r.error, r.reason) : ok(r); }
  if (method === 'POST' && !sub) {
    const mb = await S.resoudreMembre(guild, body?.member);
    if (!mb) return ko(404, 'member_not_found', 'Membre introuvable sur ce serveur.');
    const r = S.ajouterSurveillance(guild, mb, body?.reason, { id: user.id, name: user.username });
    return r.error ? ko(400, r.error, r.reason) : ok();
  }
  if (method === 'DELETE' && sub) { const r = S.retirerSurveillance(guild.id, String(sub)); return r.error ? ko(404, r.error) : ok(); }
  return ko(405, 'method');
}
function conflits(guild, method, sub, body) {
  const S = require('../handlers/surveillance').api;
  if (method === 'GET' && !sub) return ok(S.listeConflits(guild));
  if (method === 'PUT' && sub === 'settings') { const r = S.reglagesConflits(guild, body || {}); return r.error ? ko(400, r.error, r.reason) : ok(r); }
  return ko(405, 'method');
}

async function handle({ guild, user, method, section, sub, action, query, body }) {
  switch (section) {
    case 'queue':
      if (method === 'GET' && !sub) return queue(guild, query);
      if (method === 'POST' && sub && action) return queueAction(guild, user, sub, action);
      return ko(405, 'method');
    case 'infractions':
      if (method === 'GET' && !sub) return infractions(guild, query);
      if (method === 'DELETE' && sub) return retirerInfraction(guild, decodeURIComponent(sub));
      return ko(405, 'method');
    case 'sanctions':
      if (method === 'GET' && !sub) return sanctions(guild, query);
      if (method === 'POST' && sub && action === 'revoke') return leverSanction(guild, user, decodeURIComponent(sub));
      return ko(405, 'method');
    case 'staff':
      return method === 'GET' && !sub ? staff(guild, query) : ko(405, 'method');
    case 'watchlist': return surveillance(guild, user, method, sub, body);
    case 'conflicts': return conflits(guild, method, sub, body);
    default: return ko(404, 'not_found');
  }
}

module.exports = { handle };
