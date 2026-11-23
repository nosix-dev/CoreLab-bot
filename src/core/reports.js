// src/core/reports.js : stockage des signalements (/report) + dossiers par membre,
// regroupement des signalements et score de confiance des signaleurs.
// Données dans reports.json (persistant via DATA_DIR comme les autres fichiers).

const fs = require('fs');
const crypto = require('crypto');
const { fichierPersistant } = require('./persistentPath');

const FILE = fichierPersistant('reports.json');
const MAX_PAR_SERVEUR = 2000;
const DONE = ['resolved', 'dismissed'];

const DEFAUTS = {
  group_enabled: true,        // détecter les regroupements de signalements sur un même membre
  group_window_hours: 24,     // fenêtre de regroupement
  priority_threshold: 3,      // nombre de signaleurs distincts pour passer en priorité
  trust_enabled: true,        // pondérer par la confiance des signaleurs
  block_duplicates: true      // un signaleur ne peut pas re-signaler un membre tant que son signalement est ouvert
};
const LIMITES = {
  group_window_hours: [1, 168],
  priority_threshold: [2, 20]
};

let DB = null;
function charger() {
  if (DB) return DB;
  try { DB = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { DB = {}; }
  if (!DB || typeof DB !== 'object' || !DB.guilds) DB = { guilds: {} };
  return DB;
}
function sauver() {
  try {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(DB));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { console.error('[reports] sauvegarde :', e.message); }
}
function serveur(gid) {
  const db = charger();
  if (!db.guilds[gid]) db.guilds[gid] = { reports: [], settings: {} };
  const g = db.guilds[gid];
  if (!Array.isArray(g.reports)) g.reports = [];
  if (!g.settings) g.settings = {};
  return g;
}

function reglages(gid) {
  return { ...DEFAUTS, ...serveur(gid).settings };
}

function majReglages(gid, body) {
  const g = serveur(gid);
  const next = { ...reglages(gid) };
  for (const k of Object.keys(DEFAUTS)) {
    if (!(k in body)) continue;
    const v = body[k];
    if (typeof DEFAUTS[k] === 'boolean') {
      if (typeof v !== 'boolean') return { error: 'invalid', field: k, reason: 'Valeur invalide.' };
      next[k] = v;
    } else {
      const n = Number(v);
      const [min, max] = LIMITES[k];
      if (!Number.isInteger(n) || n < min || n > max) return { error: 'invalid', field: k, reason: `Valeur entre ${min} et ${max} attendue.` };
      next[k] = n;
    }
  }
  g.settings = next;
  sauver();
  return { ok: true, settings: next };
}

function ajouter(gid, { reporter, target, reason, channelId, channelName }) {
  const g = serveur(gid);
  const s = reglages(gid);
  if (s.block_duplicates && g.reports.some(r => r.status === 'open' && r.reporter.id === reporter.id && r.target.id === target.id)) {
    return { error: 'duplicate' };
  }
  const r = {
    id: crypto.randomBytes(6).toString('hex'),
    ts: Date.now(),
    status: 'open',
    reporter: { id: reporter.id, name: reporter.name, avatar: reporter.avatar || null },
    target: { id: target.id, name: target.name, avatar: target.avatar || null },
    reason: String(reason || '').slice(0, 1000),
    channelId: channelId || null,
    channelName: channelName || null
  };
  g.reports.push(r);
  if (g.reports.length > MAX_PAR_SERVEUR) {
    // on supprime d'abord les plus anciens déjà traités
    const surplus = g.reports.length - MAX_PAR_SERVEUR;
    let retire = 0;
    g.reports = g.reports.filter(x => !(retire < surplus && DONE.includes(x.status) && ++retire));
  }
  sauver();
  return { ok: true, report: r };
}

// Confiance d'un signaleur : (traités + 1) / (traités + ignorés + 2), lissée.
function confiance(gid, uid) {
  const mine = serveur(gid).reports.filter(r => r.reporter.id === uid);
  const ok = mine.filter(r => r.status === 'resolved').length;
  const ko = mine.filter(r => r.status === 'dismissed').length;
  const decided = ok + ko;
  const pct = Math.round(((ok + 1) / (decided + 2)) * 100);
  const level = decided < 3 ? 'new' : pct >= 70 ? 'high' : pct <= 35 ? 'low' : 'normal';
  return { pct, level, resolved: ok, dismissed: ko, total: mine.length };
}

// Plus grand nombre de signaleurs distincts dans une fenêtre glissante (signalements ouverts uniquement).
function regroupement(gid, ouverts, s) {
  if (!s.group_enabled || !ouverts.length) return { count: 0, priority: false };
  const win = s.group_window_hours * 3600 * 1000;
  const sorted = [...ouverts].sort((a, b) => a.ts - b.ts);
  const cache = new Map();
  const retenu = r => {
    if (!s.trust_enabled) return true;
    if (!cache.has(r.reporter.id)) cache.set(r.reporter.id, confiance(gid, r.reporter.id).level !== 'low');
    return cache.get(r.reporter.id);
  };
  let best = 0;
  for (let i = 0; i < sorted.length; i++) {
    const ids = new Set();
    for (let j = i; j < sorted.length && sorted[j].ts - sorted[i].ts <= win; j++) {
      if (retenu(sorted[j])) ids.add(sorted[j].reporter.id);
    }
    best = Math.max(best, ids.size);
  }
  return { count: best, priority: best >= s.priority_threshold };
}

function nomMembre(guild, base) {
  const m = guild.members.cache.get(base.id);
  if (m) return { id: base.id, name: m.displayName, avatar: m.displayAvatarURL({ size: 64 }) };
  return base;
}

// Liste des dossiers (un par membre signalé). status : '' (tous) | open | resolved | dismissed
function dossiers(guild, { status = '', q = '' } = {}) {
  const gid = guild.id;
  const g = serveur(gid);
  const s = reglages(gid);
  const needle = String(q || '').trim().toLowerCase();
  const byTarget = new Map();
  for (const r of g.reports) {
    if (!byTarget.has(r.target.id)) byTarget.set(r.target.id, []);
    byTarget.get(r.target.id).push(r);
  }
  const out = [];
  for (const [tid, list] of byTarget) {
    const open = list.filter(r => r.status === 'open');
    if (status === 'open' && !open.length) continue;
    if (status && status !== 'open' && !list.some(r => r.status === status)) continue;
    const last = list[list.length - 1];
    const member = nomMembre(guild, last.target);
    if (needle && !(member.name || '').toLowerCase().includes(needle) && tid !== needle
      && !list.some(r => (r.reason || '').toLowerCase().includes(needle) || (r.reporter.name || '').toLowerCase().includes(needle))) continue;
    const grp = regroupement(gid, open, s);
    const reporters = new Set(list.map(r => r.reporter.id));
    out.push({
      member,
      open: open.length,
      total: list.length,
      reporters: reporters.size,
      lastTs: Math.max(...list.map(r => r.ts)),
      cluster: grp.count,
      priority: grp.priority,
      reports: [...list].sort((a, b) => b.ts - a.ts)
        .filter(r => !status || r.status === status)
        .map(r => ({
          id: r.id,
          ts: r.ts,
          status: r.status,
          reason: r.reason,
          channel: r.channelName,
          decidedBy: r.decidedByName || null,
          decidedAt: r.decidedAt || null,
          reporter: { ...nomMembre(guild, r.reporter), trust: s.trust_enabled ? confiance(gid, r.reporter.id) : null }
        }))
    });
  }
  out.sort((a, b) => (b.priority - a.priority) || ((b.open > 0) - (a.open > 0)) || (b.lastTs - a.lastTs));
  const all = g.reports;
  return {
    dossiers: out,
    stats: {
      open: all.filter(r => r.status === 'open').length,
      resolved: all.filter(r => r.status === 'resolved').length,
      dismissed: all.filter(r => r.status === 'dismissed').length,
      dossiers: byTarget.size,
      priority: out.filter(d => d.priority).length
    }
  };
}

// Décision sur une liste d'identifiants de signalements.
function decider(gid, ids, action, by) {
  const status = action === 'resolve' ? 'resolved' : action === 'dismiss' ? 'dismissed' : null;
  if (!status) return { error: 'invalid' };
  const g = serveur(gid);
  const set = new Set(ids);
  let n = 0;
  const decided = [];
  for (const r of g.reports) {
    if (!set.has(r.id) || r.status !== 'open') continue;
    decided.push({ reporterId: r.reporter.id, targetId: r.target.id, targetName: r.target.name, reason: r.reason });
    r.status = status;
    r.decidedAt = Date.now();
    r.decidedBy = by.id;
    r.decidedByName = by.name;
    n++;
  }
  if (!n) return { error: 'not_found' };
  sauver();
  const res = { ok: true, count: n };
  // liste des signalements traités, pour prévenir les signaleurs (non énumérable : absente de la réponse JSON)
  Object.defineProperty(res, 'decided', { value: decided, enumerable: false });
  return res;
}

// Tous les signalements ouverts d'un membre.
function idsOuvertsDuMembre(gid, uid) {
  return serveur(gid).reports.filter(r => r.target.id === uid && r.status === 'open').map(r => r.id);
}

module.exports = { DEFAUTS, reglages, majReglages, ajouter, dossiers, decider, idsOuvertsDuMembre, confiance };