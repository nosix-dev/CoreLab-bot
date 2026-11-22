// src/core/radarLog.js : journal de décisions du Radar (page « Radar » du dashboard).
// Chaque log de protection (arnaque, spam, raid, captcha, sanction…) est enregistré ici avec une catégorie,
// puis résumé par GET /api/guilds/:id/radar?range=24h|7d. Données dans radar_log.json (persistant via DATA_DIR).

const fs = require('fs');
const { fichierPersistant } = require('./persistentPath');

const FILE = fichierPersistant('radar_log.json');
const MAX_PAR_SERVEUR = 1500;
const RETENTION_MS = 8 * 24 * 3600 * 1000;
const TZ = 'Europe/Paris';
const CATEGORIES = ['scam', 'spam', 'raid', 'threads', 'moderation', 'urgent', 'backup', 'diag'];

let DB = null;
let timer = null;
function charger() {
  if (DB) return DB;
  try { DB = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { DB = {}; }
  if (!DB || typeof DB !== 'object') DB = {};
  return DB;
}
function sauverPlusTard() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(DB)); fs.renameSync(FILE + '.tmp', FILE); }
    catch (e) { console.error('[radarLog]', e.message); }
  }, 2000);
  if (timer.unref) timer.unref();
}

// Devine la catégorie à partir du texte d'un log de protection.
function categoriser(texte) {
  const t = String(texte || '').toLowerCase();
  if (/(arnaque|scam|phishing|logger|faux nitro|casino)/.test(t)) return 'scam';
  if (/(sauvegarde|backup|restauration)/.test(t)) return 'backup';
  if (/(nuke|urgence|lockdown|verrouill|permission sensible|administrateur)/.test(t)) return 'urgent';
  if (/(raid|flood|ddos|captcha|anti-?bot|anti-?alt|arriv[ée]es massives|compte trop r[ée]cent)/.test(t)) return 'raid';
  if (/(spam|mention de masse|@everyone|majuscule|r[ée]p[ée]tition|lien)/.test(t)) return 'spam';
  if (/(fil |fils|thread|forum|post)/.test(t)) return 'threads';
  if (/(ban|bannis|kick|expuls|timeout|exclu|mute|avertissement|warn|sanction|honeypot)/.test(t)) return 'moderation';
  return 'diag';
}

function enregistrer(guildId, e) {
  try {
    const db = charger();
    const gid = String(guildId);
    const liste = db[gid] || (db[gid] = []);
    liste.push({
      ts: Date.now(),
      category: CATEGORIES.includes(e.category) ? e.category : categoriser(`${e.title} ${e.description}`),
      title: String(e.title || 'Évènement').slice(0, 120),
      description: String(e.description || '').slice(0, 400),
      member: e.member || null,
      action: e.action ? String(e.action).slice(0, 80) : null,
      status: e.status === 'review' ? 'review' : 'done'
    });
    const limite = Date.now() - RETENTION_MS;
    if (liste.length > MAX_PAR_SERVEUR || (liste[0] && liste[0].ts < limite)) {
      db[gid] = liste.filter(x => x.ts >= limite).slice(-MAX_PAR_SERVEUR);
    }
    sauverPlusTard();
  } catch (err) { console.error('[radarLog]', err.message); }
}

// Enregistre un embed de log de protection (titre + description). Les confirmations (✅) sont ignorées.
function depuisEmbed(guild, embed) {
  try {
    const d = embed?.data || embed || {};
    const title = String(d.title || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (!title || /^✅/.test(String(d.title || '').trim())) return;
    const description = String(d.description || '').replace(/\s+/g, ' ');
    enregistrer(guild.id, { title, description });
  } catch { /* ignoré */ }
}

const heure = ts => Number(new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(ts))) % 24;
const jour = ts => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'short' }).format(new Date(ts)).replace('.', '');

// Résumé pour le dashboard. range : '24h' (24 pas d'une heure) ou '7d' (7 pas d'un jour).
function resume(guildId, range) {
  const now = Date.now();
  const heures = range !== '7d';
  const pas = heures ? 3600e3 : 86400e3;
  const n = heures ? 24 : 7;
  const debut = now - n * pas;
  const liste = (charger()[String(guildId)] || []).filter(e => e.ts >= debut);
  const values = new Array(n).fill(0);
  const labels = [];
  for (let i = 0; i < n; i++) {
    const t = debut + (i + 1) * pas - 1;
    labels.push(heures ? `${heure(t)}h` : jour(t));
  }
  const categories = {};
  for (const e of liste) {
    const i = Math.min(n - 1, Math.max(0, Math.floor((e.ts - debut) / pas)));
    values[i]++;
    categories[e.category] = (categories[e.category] || 0) + 1;
  }
  return {
    range: heures ? '24h' : '7d',
    totals: {
      signals: liste.length,
      actions: liste.filter(e => e.status !== 'review').length,
      review: liste.filter(e => e.status === 'review').length,
      scams: liste.filter(e => e.category === 'scam').length
    },
    categories,
    series: { labels, values },
    events: [...liste].sort((a, b) => b.ts - a.ts).slice(0, 100)
  };
}

module.exports = { enregistrer, depuisEmbed, resume, categoriser, CATEGORIES };
