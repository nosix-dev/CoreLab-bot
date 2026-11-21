// src/handlers/surveillance.js : page « Surveillance » du dashboard
//  1) Membres surveillés : liste, alertes en direct (message, pseudo, vocal), activité récente
//  2) Conflits entre membres : détection d'un échange tendu entre deux membres, alerte au staff
//     avec boutons « Calmé » / « Ignorer ». Le bot ne sanctionne personne.
// Données dans surveillance.json (persistant via DATA_DIR).

const fs = require('fs');
const crypto = require('crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { fichierPersistant } = require('../core/persistentPath');

const FILE = fichierPersistant('surveillance.json');
const TEXT_CHANNEL_TYPES = [0, 5];
const COOLDOWN_ALERTE_MS = 10 * 60 * 1000;   // une alerte par type et par membre toutes les 10 min
const COOLDOWN_CONFLIT_MS = 15 * 60 * 1000;  // une alerte par paire de membres et par salon
const FENETRE_CONFLIT_MS = 3 * 60 * 1000;
const MAX_ACTIVITE = 30;
const MAX_CONFLITS = 200;

const DEFAUTS = { alerts_enabled: false, alert_channel_id: null, conflicts_enabled: false, conflict_channel_id: null };

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
  } catch (e) { console.error('[surveillance] sauvegarde :', e.message); }
}
function serveur(gid) {
  const db = charger();
  const g = db.guilds[gid] || (db.guilds[gid] = {});
  if (!Array.isArray(g.watch)) g.watch = [];
  if (!g.settings) g.settings = {};
  if (!g.activity) g.activity = {};
  if (!Array.isArray(g.conflicts)) g.conflicts = [];
  return g;
}
const reglages = gid => ({ ...DEFAUTS, ...serveur(gid).settings });
const estSurveille = (gid, uid) => serveur(gid).watch.some(w => w.id === uid);

function validerReglages(guild, body, cles) {
  const g = serveur(guild.id);
  const next = reglages(guild.id);
  for (const [bool, chan] of cles) {
    if (bool in body) {
      if (typeof body[bool] !== 'boolean') return { error: 'invalid', reason: 'Valeur invalide.' };
      next[bool] = body[bool];
    }
    if (chan in body) {
      const v = body[chan] ? String(body[chan]) : null;
      if (v) {
        const c = guild.channels.cache.get(v);
        if (!c || !TEXT_CHANNEL_TYPES.includes(c.type)) return { error: 'invalid', reason: 'Salon introuvable.' };
      }
      next[chan] = v;
    }
    if (next[bool] && !next[chan]) return { error: 'invalid', reason: 'Choisissez le salon des alertes.' };
  }
  g.settings = next;
  sauver();
  return { ok: true, settings: next };
}

/* ============================= Membres surveillés ============================= */

async function resoudreMembre(guild, q) {
  q = String(q || '').trim().slice(0, 60);
  if (!q) return null;
  let mb = null;
  if (/^\d{17,20}$/.test(q)) mb = guild.members.cache.get(q) || await guild.members.fetch(q).catch(() => null);
  else {
    const low = q.toLowerCase().replace(/^@/, '');
    mb = guild.members.cache.find(x => x.displayName.toLowerCase() === low || x.user.username.toLowerCase() === low)
      || (await guild.members.search({ query: low, limit: 1 }).catch(() => null))?.first() || null;
  }
  return mb && !mb.user.bot ? mb : null;
}

function ajouterSurveillance(guild, mb, reason, by) {
  const g = serveur(guild.id);
  if (g.watch.some(w => w.id === mb.id)) return { error: 'exists', reason: 'Ce membre est déjà sous surveillance.' };
  g.watch.push({
    id: mb.id, name: mb.displayName, avatar: mb.displayAvatarURL({ size: 64 }),
    reason: String(reason || '').slice(0, 200), by: { id: by.id, name: by.name }, ts: Date.now()
  });
  sauver();
  return { ok: true };
}
function retirerSurveillance(gid, uid) {
  const g = serveur(gid);
  const n = g.watch.length;
  g.watch = g.watch.filter(w => w.id !== uid);
  if (g.watch.length === n) return { error: 'not_found' };
  delete g.activity[uid];
  sauver();
  return { ok: true };
}

function enregistrerActivite(gid, uid, type, text) {
  const g = serveur(gid);
  if (!g.watch.some(w => w.id === uid)) return;
  const l = g.activity[uid] || (g.activity[uid] = []);
  l.push({ type, text: String(text || '').slice(0, 200), ts: Date.now() });
  if (l.length > MAX_ACTIVITE) l.splice(0, l.length - MAX_ACTIVITE);
  sauver();
}

// Activité récente d'un membre : sanctions, avertissements, infractions + événements suivis par le bot.
function activiteRecente(guild, uid) {
  const g = serveur(guild.id);
  const out = (g.activity[uid] || []).map(a => ({ ...a }));
  try {
    const { store } = require('../core/data');
    const LBL = { kick: 'Expulsion', ban: 'Bannissement', timeout: 'Timeout', mute: 'Mute' };
    for (const e of require('../core/sanctionsLog').lister(guild.id)) {
      if (e.member.id === uid) out.push({ type: 'sanction', text: `${LBL[e.type] || e.type} : ${e.reason}`, ts: e.ts });
    }
    for (const w of (store.warns || {})[uid] || []) {
      if (w && w.guild_id === guild.id) out.push({ type: 'sanction', text: `Avertissement : ${w.reason}`, ts: Date.parse(w.date) || 0 });
    }
    for (const w of ((store.infractions || {})[guild.id] || {})[uid] || []) {
      if (w) out.push({ type: 'sanction', text: `Infraction : ${w.reason}`, ts: Date.parse(w.date) || 0 });
    }
  } catch { /* données indisponibles : on garde ce qu'on a */ }
  return out.sort((a, b) => b.ts - a.ts).slice(0, 8);
}

function listeSurveillance(guild) {
  const g = serveur(guild.id);
  const items = [...g.watch].sort((a, b) => b.ts - a.ts).map(w => {
    const m = guild.members.cache.get(w.id);
    return {
      id: w.id,
      member: { id: w.id, name: m ? m.displayName : w.name, avatar: m ? m.displayAvatarURL({ size: 64 }) : w.avatar },
      reason: w.reason, moderator: w.by, ts: w.ts,
      activity: activiteRecente(guild, w.id)
    };
  });
  return { items, settings: { alerts_enabled: reglages(guild.id).alerts_enabled, alert_channel_id: reglages(guild.id).alert_channel_id } };
}

function reglagesSurveillance(guild, body) {
  return validerReglages(guild, body, [['alerts_enabled', 'alert_channel_id']]);
}

const cooldowns = new Map();
function libre(cle, ms) {
  const now = Date.now();
  if (now - (cooldowns.get(cle) || 0) < ms) return false;
  cooldowns.set(cle, now);
  if (cooldowns.size > 5000) for (const [k, t] of cooldowns) if (now - t > 3600e3) cooldowns.delete(k);
  return true;
}

async function alerter(guild, member, type, texte, lien) {
  const s = reglages(guild.id);
  if (!s.alerts_enabled || !s.alert_channel_id) return;
  if (!libre(`${guild.id}:${member.id}:${type}`, COOLDOWN_ALERTE_MS)) return;
  const chan = guild.channels.cache.get(s.alert_channel_id);
  if (!chan?.isTextBased?.()) return;
  const w = serveur(guild.id).watch.find(x => x.id === member.id);
  const embed = new EmbedBuilder().setTitle('👁️ Membre sous surveillance')
    .setDescription(`${member} ${texte}${lien ? `\n[Voir le message](${lien})` : ''}`)
    .setThumbnail(member.displayAvatarURL?.({ size: 128 }) || null).setTimestamp();
  if (w?.reason) embed.addFields({ name: 'Raison de la surveillance', value: w.reason.slice(0, 300) });
  await chan.send({ embeds: [embed] }).catch(() => {});
}

/* ============================= Conflits entre membres ============================= */

const INSULTES = /(?<![\p{L}])(con|conne|connard|connasse|salope|pute|merde|ferme[- ]la|ta gueule|tg|abruti|abrutie|d[ée]bile|idiot|idiote|imb[ée]cile|cr[ée]tin|fdp|ntm|fuck|shit|stupid|dumb|shut up|idiot)(?![\p{L}])/iu;
function chaud(t) {
  const txt = String(t || '');
  if (INSULTES.test(txt)) return true;
  if (/!{2,}|\?!|!\?/.test(txt)) return true;
  const lettres = txt.replace(/[^\p{L}]/gu, '');
  return lettres.length >= 6 && (lettres.replace(/[^\p{Lu}]/gu, '').length / lettres.length) > 0.6;
}

const tampons = new Map(); // salon → derniers messages
function detecterConflit(message) {
  const s = reglages(message.guild.id);
  if (!s.conflicts_enabled || !s.conflict_channel_id) return;
  const now = Date.now();
  const buf = (tampons.get(message.channelId) || []).filter(m => now - m.ts <= FENETRE_CONFLIT_MS);
  buf.push({ uid: message.author.id, name: message.member?.displayName || message.author.username, ts: now, text: message.content || '', url: message.url });
  while (buf.length > 14) buf.shift();
  tampons.set(message.channelId, buf);
  if (tampons.size > 2000) tampons.delete(tampons.keys().next().value);

  const A = message.author.id;
  const autre = [...buf].reverse().find(m => m.uid !== A);
  if (!autre) return;
  const B = autre.uid;
  const M = buf.filter(m => m.uid === A || m.uid === B);
  if (M.length < 6) return;
  if (M.filter(m => m.uid === A).length < 3 || M.filter(m => m.uid === B).length < 3) return;
  let alternances = 0;
  for (let i = 1; i < M.length; i++) if (M[i].uid !== M[i - 1].uid) alternances++;
  if (alternances < 4) return;
  if (M.filter(m => chaud(m.text)).length < 3) return;
  const paire = [A, B].sort().join('-');
  if (!libre(`c:${message.channelId}:${paire}`, COOLDOWN_CONFLIT_MS)) return;
  publierConflit(message, M, A, B).catch(e => console.error('[surveillance] conflit :', e.message));
}

async function publierConflit(message, M, A, B) {
  const guild = message.guild;
  const s = reglages(guild.id);
  const chan = guild.channels.cache.get(s.conflict_channel_id);
  if (!chan?.isTextBased?.()) return;
  const nom = uid => M.find(m => m.uid === uid)?.name || uid;
  const extrait = M.slice(-6).map(m => `**${m.name}** : ${String(m.text).replace(/\s+/g, ' ').slice(0, 110) || '…'}`);
  const id = crypto.randomBytes(5).toString('hex');
  const embed = new EmbedBuilder().setTitle('⚔️ Conflit possible entre deux membres').setColor(0xE8510D)
    .setDescription(`<@${A}> et <@${B}> se répondent sans arrêt dans ${message.channel} et le ton monte.\n[Aller à la conversation](${message.url})`)
    .addFields({ name: 'Derniers échanges', value: extrait.join('\n').slice(0, 1000) })
    .setFooter({ text: 'CoreLab ne sanctionne personne : au staff de choisir la suite.' }).setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`surv_c_ok_${id}`).setLabel('Calmé').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`surv_c_ig_${id}`).setLabel('Ignorer').setStyle(ButtonStyle.Secondary)
  );
  const sent = await chan.send({ embeds: [embed], components: [row] }).catch(() => null);
  if (!sent) return;
  const g = serveur(guild.id);
  g.conflicts.push({
    id, ts: Date.now(), status: 'open', channelId: message.channelId, channelName: message.channel.name,
    users: [{ id: A, name: nom(A) }, { id: B, name: nom(B) }], excerpt: extrait.map(x => x.replace(/\*\*/g, '')), messageId: sent.id
  });
  if (g.conflicts.length > MAX_CONFLITS) g.conflicts = g.conflicts.slice(-MAX_CONFLITS);
  sauver();
}

function listeConflits(guild) {
  const g = serveur(guild.id);
  const sem = Date.now() - 7 * 86400e3;
  const recents = g.conflicts.filter(c => c.ts >= sem);
  const s = reglages(guild.id);
  return {
    settings: { enabled: s.conflicts_enabled, channel_id: s.conflict_channel_id },
    stats: {
      week: recents.length,
      calmed: recents.filter(c => c.status === 'calmed').length,
      ignored: recents.filter(c => c.status === 'ignored').length
    },
    items: [...g.conflicts].sort((a, b) => b.ts - a.ts).slice(0, 30)
  };
}

function reglagesConflits(guild, body) {
  const b = {};
  if ('enabled' in body) b.conflicts_enabled = body.enabled;
  if ('channel_id' in body) b.conflict_channel_id = body.channel_id;
  const r = validerReglages(guild, b, [['conflicts_enabled', 'conflict_channel_id']]);
  return r.error ? r : { ok: true, settings: { enabled: r.settings.conflicts_enabled, channel_id: r.settings.conflict_channel_id } };
}

async function routeSurvInteraction(interaction) {
  const m = /^surv_c_(ok|ig)_([a-f0-9]{10})$/.exec(interaction.customId || '');
  if (!m || !interaction.guild) return;
  const perms = interaction.memberPermissions;
  if (!perms?.has(PermissionFlagsBits.ManageMessages) && !perms?.has(PermissionFlagsBits.ModerateMembers) && !perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Réservé à l’équipe de modération.', flags: MessageFlags.Ephemeral });
  }
  const g = serveur(interaction.guild.id);
  const c = g.conflicts.find(x => x.id === m[2]);
  if (!c) return interaction.reply({ content: '❌ Alerte introuvable.', flags: MessageFlags.Ephemeral });
  if (c.status === 'open') {
    c.status = m[1] === 'ok' ? 'calmed' : 'ignored';
    c.decidedBy = interaction.member?.displayName || interaction.user.username;
    c.decidedAt = Date.now();
    sauver();
  }
  const embed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(c.status === 'calmed' ? 0x3BA55D : 0x6B6878)
    .setFooter({ text: `${c.status === 'calmed' ? 'Calmé' : 'Ignoré'} par ${c.decidedBy}` });
  return interaction.update({ embeds: [embed], components: [] });
}

/* ============================= Enregistrement des événements ============================= */

function registerSurveillanceHandler(client) {
  client.on('messageCreate', message => {
    try {
      if (!message.guild || message.author.bot) return;
      detecterConflit(message);
      if (estSurveille(message.guild.id, message.author.id)) {
        const extrait = String(message.content || '').replace(/\s+/g, ' ').slice(0, 200) || '(pièce jointe)';
        alerter(message.guild, message.member || message.author, 'msg', `a écrit dans ${message.channel} :\n> ${extrait}`, message.url);
      }
    } catch (e) { console.error('[surveillance] messageCreate :', e.message); }
  });

  client.on('messageDelete', message => {
    try {
      if (!message.guild || !message.author || message.author.bot) return;
      if (!estSurveille(message.guild.id, message.author.id)) return;
      const t = String(message.content || '').replace(/\s+/g, ' ').slice(0, 150);
      enregistrerActivite(message.guild.id, message.author.id, 'delete', `Message supprimé dans #${message.channel?.name || '?'}${t ? ' : ' + t : ''}`);
    } catch (e) { console.error('[surveillance] messageDelete :', e.message); }
  });

  client.on('guildMemberUpdate', (avant, apres) => {
    try {
      if (avant.nickname === apres.nickname) return;
      if (!estSurveille(apres.guild.id, apres.id)) return;
      enregistrerActivite(apres.guild.id, apres.id, 'nick', `Pseudo : ${avant.nickname || avant.user.username} → ${apres.nickname || apres.user.username}`);
      alerter(apres.guild, apres, 'nick', `a changé de pseudo : **${avant.nickname || avant.user.username}** → **${apres.nickname || apres.user.username}**`);
    } catch (e) { console.error('[surveillance] guildMemberUpdate :', e.message); }
  });

  client.on('voiceStateUpdate', (avant, apres) => {
    try {
      if (!apres.guild || !apres.channelId || avant.channelId === apres.channelId) return;
      if (!estSurveille(apres.guild.id, apres.id) || !apres.member) return;
      alerter(apres.guild, apres.member, 'voice', `a rejoint le salon vocal **${apres.channel?.name || '?'}**`);
    } catch (e) { console.error('[surveillance] voiceStateUpdate :', e.message); }
  });

  console.log('✅ Surveillance (membres surveillés + conflits) initialisée.');
}

module.exports = {
  registerSurveillanceHandler, routeSurvInteraction,
  api: { resoudreMembre, ajouterSurveillance, retirerSurveillance, listeSurveillance, reglagesSurveillance, listeConflits, reglagesConflits }
};
