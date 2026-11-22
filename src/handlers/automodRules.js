// src/handlers/automodRules.js : applique la page « Automodération » du dashboard aux messages.
// Gère : insultes, majuscules, invitations, règles personnalisées, filtre de liens, limite de publication
// et restriction des nouveaux membres. Spam, mentions de masse, phishing, arnaques en image et anti-alt
// restent gérés par leurs handlers historiques (leurs interrupteurs sont synchronisés avec le dashboard).
// Heat : chaque infraction ajoute des points ; HEAT_SEUIL points en HEAT_FENETRE_MS => exclusion automatique.

const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { obtenirConfigGuilde, persister } = require('../core/config');
const AM = require('../core/automodStore');

const HEAT_SEUIL = 6;
const HEAT_FENETRE_MS = 10 * 60 * 1000;
const HEAT_TIMEOUT_MS = 10 * 60 * 1000;
const heat = new Map();   // guildId:userId -> [{ t, p }]
const rate = new Map();   // guildId:userId -> [timestamps]
let saveTimer = null;

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; try { persister('configuration'); } catch (e) { console.error('[AutomodRules] sauvegarde :', e.message); } }, 30_000);
  if (saveTimer.unref) saveTimer.unref();
}
function addStat(cfg, id) {
  if (!cfg.automod_stats || typeof cfg.automod_stats !== 'object') cfg.automod_stats = {};
  const s = cfg.automod_stats[id] || (cfg.automod_stats[id] = { count: 0, last: null });
  s.count++; s.last = new Date().toISOString();
  saveSoon();
}
function addHeat(key, pts) {
  if (!pts) return 0;
  const now = Date.now();
  const list = (heat.get(key) || []).filter(x => now - x.t < HEAT_FENETRE_MS);
  list.push({ t: now, p: pts });
  heat.set(key, list);
  return list.reduce((a, x) => a + x.p, 0);
}
async function sendLog(message, cfg, title, rule, reason) {
  const id = cfg.protection_log_channel_id;
  if (!id) return;
  const ch = message.guild.channels.cache.get(String(id));
  if (!ch || !ch.send) return;
  const embed = new EmbedBuilder().setTitle(`🛡️ ${title}`).setColor(0xE8510D).setTimestamp()
    .setDescription(`${message.author} (\`${message.author.id}\`) dans ${message.channel}\n**Règle :** ${rule}\n**Action :** ${reason}`)
    .addFields({ name: 'Message', value: String(message.content || '—').slice(0, 1000) });
  await ch.send({ embeds: [embed] }).catch(() => {});
}
function addWarn(message, label) {
  try {
    const { store, persist } = require('../core/data');
    const uid = String(message.author.id);
    if (!store.warns[uid]) store.warns[uid] = [];
    store.warns[uid].push({ reason: `Automodération : ${label}`, moderator: message.client.user.id, date: new Date().toISOString(), guild_id: message.guild.id });
    persist('warns');
  } catch (e) { console.error('[AutomodRules] warn :', e.message); }
}

// Diagnostic : suppression impossible (une seule ligne console par serveur et par salon)
const diagVus = new Set();
function diagSuppression(message, err) {
  const cle = `${message.guild.id}:${message.channelId}`;
  if (diagVus.has(cle)) return;
  diagVus.add(cle);
  console.warn(`[AutomodRules] ${message.guild.name || message.guild.id} : impossible de supprimer un message dans #${message.channel?.name || message.channelId} (${err?.message || 'erreur'}). Le bot a-t-il la permission « Gérer les messages » dans ce salon ?`);
}

/* Applique l'action d'une règle ; retourne true si le message a été supprimé */
async function appliquer(message, cfg, { id, name, action, heat: pts, timeoutMin }) {
  const key = `${message.guild.id}:${message.author.id}`;
  let deleted = false, done = [];
  if (action !== 'alert') {
    try { await message.delete(); deleted = true; done.push('message supprimé'); } catch (e) { diagSuppression(message, e); }
  }
  if (action === 'warn') { addWarn(message, name); done.push('avertissement'); }
  let timeoutMs = action === 'timeout' ? (timeoutMin || 10) * 60 * 1000 : 0;
  const total = addHeat(key, pts);
  if (!timeoutMs && total >= HEAT_SEUIL) { timeoutMs = HEAT_TIMEOUT_MS; heat.delete(key); done.push(`heat ${total}/${HEAT_SEUIL}`); }
  if (timeoutMs && message.member?.moderatable) {
    await message.member.timeout(timeoutMs, `Automodération : ${name}`).then(() => done.push(`exclusion ${Math.round(timeoutMs / 60000)} min`)).catch(() => {});
  }
  if (deleted || action === 'warn' || timeoutMs) {
    const note = await message.channel.send({ content: `${message.author}, ton message a été retiré par l’automodération (${name}).` }).catch(() => null);
    if (note) setTimeout(() => note.delete().catch(() => {}), 6000);
  }
  addStat(cfg, id);
  await sendLog(message, cfg, 'Automodération', name, done.join(' · ') || 'alerte seule');
  return deleted;
}

function exclu(r, message) {
  if (r.ex_channels?.includes(message.channelId)) return true;
  return !!r.ex_roles?.length && message.member.roles.cache.some(x => r.ex_roles.includes(x.id));
}
function domainsOf(t) { const out = []; const re = /https?:\/\/([^\s\/?#]+)/gi; let m; while ((m = re.exec(t))) out.push(m[1].toLowerCase().replace(/^www\./, '')); return out; }
const inList = (d, list) => list.some(x => d === x || d.endsWith('.' + x));

async function traiter(message) {
  if (!message.guild || !message.member || message.author.bot || message.webhookId) return;
  const cfg = obtenirConfigGuilde(message.guild.id);
  // Les administrateurs et modérateurs sont ignorés, sauf si l'option « Appliquer aussi aux administrateurs » est activée (dashboard)
  const staff = message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.permissions.has(PermissionFlagsBits.ManageMessages);
  if (staff && cfg.automod_apply_staff !== true) return;
  const text = String(message.content || '');
  const now = Date.now();

  // 1) Règles du dashboard gérées ici (les autres le sont par leurs handlers historiques)
  if (text) {
    for (const r of AM.readRules(cfg)) {
      if (!r.enabled || AM.FLAG[r.id] || exclu(r, message)) continue;
      if (AM.matchRule(r, text)) { await appliquer(message, cfg, { id: r.id, name: r.name, action: r.action, heat: r.heat }); return; }
    }
  }

  // 2) Filtre de liens
  const L = AM.readLinks(cfg);
  if (L.enabled && /https?:\/\/|discord\.gg\//i.test(text)) {
    const list = L.domains.split(/[\s,;]+/).map(x => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')).filter(Boolean);
    const ds = domainsOf(text);
    let why = null;
    if (L.block_invites && AM.matchRule({ id: 'invites' }, text)) why = 'invitation Discord';
    else if (L.block_shorteners && ds.some(d => inList(d, AM.SHORTENERS))) why = 'lien raccourci';
    else if (L.mode === 'all' && ds.length) why = 'lien interdit';
    else if (L.mode === 'blacklist' && ds.some(d => inList(d, list))) why = 'domaine bloqué';
    else if (L.mode === 'whitelist' && ds.some(d => !inList(d, list))) why = 'domaine non autorisé';
    if (why) { await appliquer(message, cfg, { id: 'links', name: `Filtre de liens (${why})`, action: L.action, heat: 1 }); return; }
  }

  // 3) Nouveaux membres : restriction temporaire après l'arrivée
  const N = AM.readNewm(cfg);
  if (N.enabled && N.restrict_hours > 0 && message.member.joinedTimestamp && now - message.member.joinedTimestamp < N.restrict_hours * 3600_000) {
    const hasLink = /https?:\/\/|discord\.gg\//i.test(text), hasMedia = message.attachments.size > 0 || message.embeds.length > 0;
    if ((N.restrict === 'links' && hasLink) || (N.restrict === 'media' && (hasLink || hasMedia)) || N.restrict === 'all') {
      await appliquer(message, cfg, { id: 'newmembers', name: 'Nouveau membre restreint', action: 'delete', heat: 1 }); return;
    }
  }

  // 4) Limite de publication
  const R = AM.readRate(cfg);
  if (R.enabled) {
    const key = `${message.guild.id}:${message.author.id}`;
    const list = (rate.get(key) || []).filter(t => now - t < R.window * 1000);
    list.push(now); rate.set(key, list);
    if (list.length > R.max) { rate.set(key, []); await appliquer(message, cfg, { id: 'ratelimit', name: 'Limite de publication', action: R.action, heat: 2, timeoutMin: R.timeout_min }); }
  }
}

function registerAutomodRules(client) {
  client.on('messageCreate', message => {
    traiter(message).catch(e => console.error('[AutomodRules] :', e.message));
  });
  setInterval(() => { const now = Date.now(); for (const [k, v] of rate) if (!v.length || now - v[v.length - 1] > 120_000) rate.delete(k); for (const [k, v] of heat) if (!v.some(x => now - x.t < HEAT_FENETRE_MS)) heat.delete(k); }, 5 * 60_000).unref();
  console.log('✅ Automodération (règles du dashboard) initialisée.');
}

module.exports = { registerAutomodRules };