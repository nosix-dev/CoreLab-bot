// src/core/discipline.js : moteur de sanctions automatiques (page « Sanctions » du dashboard)
//
//   Strike          chaque avertissement du serveur (store.warns, guild_id) compte comme un strike.
//                   Il expire après « discipline_strike_expiry_days » jours (0 = jamais).
//   Palier          quand le nombre de strikes actifs atteint exactement « strikes » d'un palier,
//                   la sanction du palier est appliquée (timeout, kick, ban, quarantaine).
//   Validation      kick / ban attendent la décision d'un modérateur (boutons dans le salon choisi).
//   Contestation    le membre sanctionné reçoit un bouton « Contester » en MP ; la demande arrive
//                   dans le salon des contestations et dans « À traiter » (dashboard).
//   Quarantaine     le membre ne garde que le rôle de quarantaine (ses autres rôles sont rendus à la fin).
//   Récap           message quotidien « À traiter » à l'heure choisie (fuseau Europe/Paris).
//
// Point d'entrée des déclencheurs : apresStrike(guild, userId, { reason }) — à appeler après l'ajout d'un warn.
// Tout est protégé : une erreur ici ne doit jamais casser la commande ou le handler appelant.

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, MessageFlags, ChannelType, SnowflakeUtil
} = require('discord.js');
const { fichierPersistant } = require('./persistentPath');
const { obtenirConfigGuilde, persister } = require('./config');
const { store, persist } = require('./data');
const sanctionsLog = require('./sanctionsLog');

const FILE = fichierPersistant('discipline_state.json');
const TZ = 'Europe/Paris';
const MIN = 60 * 1000;
const COULEUR = 0xE8510D;
const P = PermissionFlagsBits;

const LIBELLE = { warn: 'Avertissement', timeout: 'Exclusion temporaire', kick: 'Expulsion', ban: 'Bannissement', quarantine: 'Quarantaine', strip_roles: 'Retrait des rôles' };
const POIDS = { ban: 4, kick: 3, quarantine: 2, strip_roles: 1.5, timeout: 1, warn: 0.5 };
// Sanctions sans durée (le champ « durée » n'a pas de sens)
const SANS_DUREE = a => a === 'kick' || a === 'warn' || a === 'strip_roles';
const PERM_BOT = {
  timeout: [P.ModerateMembers, 'Exclure temporairement des membres'],
  kick: [P.KickMembers, 'Expulser des membres'],
  ban: [P.BanMembers, 'Bannir des membres'],
  quarantine: [P.ManageRoles, 'Gérer les rôles'],
  strip_roles: [P.ManageRoles, 'Gérer les rôles'],
  warn: [P.ViewChannel, 'Voir les salons']
};
const SALONS_CONCERNES = [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildCategory, ChannelType.GuildMedia].filter(t => t !== undefined);
// Quarantaine = lecture seule : le membre voit les salons mais ne peut ni écrire, ni réagir, ni parler.
const REFUS_QUARANTAINE = { SendMessages: false, SendMessagesInThreads: false, AddReactions: false, CreatePublicThreads: false, CreatePrivateThreads: false, Speak: false, Connect: false };

const ko = (code, error, reason) => ({ code, body: { error, ...(reason ? { reason } : {}) } });

/* ------------------------------ Stockage ------------------------------ */
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
  } catch (e) { console.error('[Sanctions] sauvegarde :', e.message); }
}
function srv(gid) {
  const db = charger();
  const id = String(gid);
  if (!db.guilds[id]) db.guilds[id] = {};
  const g = db.guilds[id];
  if (!g.cases || typeof g.cases !== 'object') g.cases = {};
  if (!g.quarantines || typeof g.quarantines !== 'object') g.quarantines = {};
  if (!g.bans || typeof g.bans !== 'object') g.bans = {};
  return g;
}

/* ------------------------------ Outils ------------------------------ */
function dureeTexte(min) {
  min = Number(min) || 0;
  if (!min) return 'Définitive';
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  const j = Math.round(min / 1440);
  return `${j} jour${j > 1 ? 's' : ''}`;
}
function estModo(member, action) {
  const p = member?.permissions;
  if (!p) return false;
  if (p.has(P.Administrator) || p.has(P.ManageGuild)) return true;
  if (action === 'ban') return p.has(P.BanMembers);
  if (action === 'kick') return p.has(P.KickMembers);
  return p.has(P.ModerateMembers) || p.has(P.BanMembers) || p.has(P.KickMembers);
}
async function fetchMembre(guild, uid) {
  return guild.members.cache.get(String(uid)) || await guild.members.fetch(String(uid)).catch(() => null);
}
async function envoyerMp(client, uid, payload) {
  try {
    const user = await client.users.fetch(String(uid));
    await user.send(payload);
    return true;
  } catch { return false; }
}
async function logStaff(guild, titre, description, couleur = COULEUR) {
  try {
    const embed = new EmbedBuilder().setTitle(titre).setColor(couleur).setDescription(String(description).slice(0, 3900)).setTimestamp();
    await require('./protectionLog').sendProtectionEmbed(guild, embed, 'SANCTIONS');
  } catch (e) { console.error('[Sanctions] log :', e.message); }
}

/* ------------------------------ Strikes ------------------------------ */
function strikesActifs(guildId, userId, cfg) {
  const liste = ((store.warns || {})[String(userId)] || []).filter(w => w && String(w.guild_id) === String(guildId));
  const jours = Number(cfg.discipline_strike_expiry_days) || 0;
  if (!jours) return liste;
  const limite = Date.now() - jours * 86400000;
  return liste.filter(w => (Date.parse(w.date) || 0) >= limite);
}
// Palier à appliquer : celui dont le seuil est exactement le nombre de strikes actifs (le plus lourd en cas d'égalité).
function choisirPalier(tiers, n) {
  const egaux = (Array.isArray(tiers) ? tiers : []).filter(t => t && Number(t.strikes) === n && POIDS[t.action]);
  if (!egaux.length) return null;
  return egaux.sort((a, b) => POIDS[b.action] - POIDS[a.action])[0];
}

/* ------------------------------ Point d'entrée ------------------------------ */
async function apresStrike(guild, userId, { reason = 'Aucune raison', warnDate = null } = {}) {
  try {
    if (!guild || !userId) return null;
    const uid = String(userId);
    if (uid === String(guild.client.user.id) || uid === String(guild.ownerId)) return null;
    const cfg = obtenirConfigGuilde(guild.id);
    const membre = await fetchMembre(guild, uid);
    if (!membre || membre.user.bot) return null;

    const liste = strikesActifs(guild.id, uid, cfg);
    const n = liste.length;
    const palier = choisirPalier(cfg.discipline_tiers, n);

    let cas = null;
    if (palier) {
      const dernier = liste[liste.length - 1];
      cas = creerCas(guild.id, {
        uid, action: palier.action, duration: SANS_DUREE(palier.action) ? 0 : Number(palier.duration) || 0,
        strikes: n, reason: String(reason).slice(0, 500), warnDate: warnDate || dernier?.date || null
      });
    }

    const validation = !!(cas && attendValidation(cfg, cas));
    if (cfg.discipline_strike_dm !== false) await mpStrike(guild, membre, { n, reason, cas: validation ? null : cas, cfg });

    if (!cas) return null;
    if (validation) await demanderValidation(guild, cas, membre);
    else await appliquerCas(guild, cas, { par: null });
    return cas;
  } catch (e) {
    console.error('[Sanctions] apresStrike :', e.message);
    return null;
  }
}

function creerCas(gid, data) {
  const s = srv(gid);
  const id = crypto.randomBytes(4).toString('hex');
  const cas = { id, ts: Date.now(), status: 'new', ...data };
  s.cases[id] = cas;
  const ids = Object.keys(s.cases);
  if (ids.length > 500) { for (const k of ids.sort((a, b) => s.cases[a].ts - s.cases[b].ts).slice(0, ids.length - 500)) delete s.cases[k]; }
  sauver();
  return cas;
}
function attendValidation(cfg, cas) {
  return cfg.discipline_validation_enabled === true && !!cfg.discipline_validation_channel && ['ban', 'kick'].includes(cas.action);
}

/* ------------------------------ Messages au membre ------------------------------ */
function boutonContester(gid, cas) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sanct:a:${gid}:${cas.id}`).setLabel('Contester').setEmoji('⚖️').setStyle(ButtonStyle.Secondary)
  );
}
async function mpStrike(guild, membre, { n, reason, cas, cfg }) {
  const embed = new EmbedBuilder()
    .setTitle(`⚠️ Avertissement sur ${guild.name}`)
    .setColor(0xFFA500)
    .addFields({ name: 'Motif', value: String(reason).slice(0, 1000) || '—' }, { name: 'Strikes actifs', value: String(n), inline: true })
    .setTimestamp();
  const jours = Number(cfg.discipline_strike_expiry_days) || 0;
  if (jours) embed.setFooter({ text: `Un strike expire au bout de ${jours} jour${jours > 1 ? 's' : ''}.` });
  const components = [];
  if (cas) {
    embed.addFields({ name: 'Sanction', value: `${LIBELLE[cas.action]}${SANS_DUREE(cas.action) ? '' : ` · ${dureeTexte(cas.duration)}`}`, inline: true });
    if (cfg.discipline_appeals_enabled === true && cfg.discipline_appeals_channel) {
      const j = Math.max(1, Number(cfg.discipline_appeals_days) || 7);
      embed.setDescription(`Tu peux contester cette sanction avec le bouton ci-dessous, pendant ${j} jour${j > 1 ? 's' : ''}.`);
      components.push(boutonContester(guild.id, cas));
    }
  }
  return envoyerMp(guild.client, membre.id, { embeds: [embed], components });
}

/* ------------------------------ Application d'une sanction ------------------------------ */
function verifierPermsBot(guild, action) {
  const me = guild.members.me;
  const [perm, nom] = PERM_BOT[action];
  if (!me || !me.permissions.has(perm)) return `le bot n’a pas la permission « ${nom} »`;
  return null;
}

async function appliquerCas(guild, cas, { par }) {
  const cfg = obtenirConfigGuilde(guild.id);
  const raison = `Palier ${cas.strikes} strike${cas.strikes > 1 ? 's' : ''} : ${cas.reason}`.slice(0, 500);
  const echec = async (msg) => {
    cas.status = 'failed'; cas.error = msg; sauver();
    await logStaff(guild, '⚠️ Sanction automatique non appliquée', `<@${cas.uid}> — **${LIBELLE[cas.action]}** (${cas.strikes} strikes)\n**Raison :** ${msg}`);
    return false;
  };

  const manque = verifierPermsBot(guild, cas.action);
  if (manque) return echec(`${manque}.`);
  const membre = await fetchMembre(guild, cas.uid);
  if (!membre) return echec('le membre n’est plus sur le serveur.');

  // MP avant l'action (impossible d'écrire à un membre banni / expulsé ensuite)
  if (par && cfg.discipline_strike_dm !== false) {
    await mpStrike(guild, membre, { n: cas.strikes, reason: cas.reason, cas, cfg });
  }

  try {
    if (cas.action === 'timeout') {
      if (!membre.moderatable) return echec('le rôle du membre est au-dessus de celui du bot (ou membre administrateur).');
      const minutes = Math.min(40320, Math.max(1, cas.duration || 1));
      await membre.timeout(minutes * MIN, raison);
    } else if (cas.action === 'kick') {
      if (!membre.kickable) return echec('le rôle du membre est au-dessus de celui du bot (ou membre administrateur).');
      await membre.kick(raison);
    } else if (cas.action === 'ban') {
      if (!membre.bannable) return echec('le rôle du membre est au-dessus de celui du bot (ou membre administrateur).');
      await guild.members.ban(membre.id, { reason: raison });
      if (cas.duration > 0) {
        srv(guild.id).bans[cas.uid] = { until: Date.now() + cas.duration * MIN, caseId: cas.id };
        sauver();
      }
    } else if (cas.action === 'quarantine') {
      const r = await mettreEnQuarantaine(guild, membre, cas, cfg, raison);
      if (r) return echec(r);
    } else if (cas.action === 'strip_roles') {
      const haut = guild.members.me.roles.highest.position;
      const retirables = membre.roles.cache.filter(r => r.id !== guild.id && !r.managed && r.position < haut);
      if (!retirables.size) return echec('aucun rôle ne peut être retiré (rôles au-dessus de celui du bot ou gérés par une intégration).');
      cas.removedRoles = [...retirables.keys()];
      await membre.roles.remove(cas.removedRoles, raison);
    }
  } catch (e) {
    return echec(`Discord a refusé : ${e.message}`);
  }

  cas.status = 'applied';
  cas.appliedAt = Date.now();
  cas.by = par ? String(par).slice(0, 80) : null;
  sauver();

  // Avertissement / retrait des rôles : pas de ligne dans l'historique des sanctions, seulement le log du staff
  if (cas.action === 'warn' || cas.action === 'strip_roles') {
    await logStaff(guild, `⚖️ ${LIBELLE[cas.action]} automatique`, `<@${cas.uid}> — **${LIBELLE[cas.action]}** (${cas.strikes} strikes)\n**Raison :** ${cas.reason}${cas.removedRoles?.length ? `\n**Rôles retirés :** ${cas.removedRoles.map(id => `<@&${id}>`).join(' ')}` : ''}`);
    return true;
  }

  // Historique (page Sanctions du dashboard) + carte dans le salon des infractions
  try {
    const bot = guild.client.user;
    sanctionsLog.enregistrer(guild.id, { type: cas.action, member: membre, moderator: bot, reason: raison });
    const dernier = sanctionsLog.lister(guild.id).filter(e => e.member.id === cas.uid && e.type === cas.action).pop();
    if (dernier) { cas.logTs = dernier.ts; sauver(); }
  } catch (e) { console.error('[Sanctions] historique :', e.message); }
  try {
    await require('./infractionLogger').journaliserInfraction(guild, {
      type: cas.action, target: membre.user, moderator: guild.client.user, reason: raison,
      duration: SANS_DUREE(cas.action) ? undefined : dureeTexte(cas.duration)
    });
  } catch (e) { console.error('[Sanctions] carte :', e.message); }
  return true;
}

/* ------------------------------ Quarantaine ------------------------------ */
// Retourne un message d'erreur (string) si impossible, sinon null.
async function mettreEnQuarantaine(guild, membre, cas, cfg, raison) {
  if (cfg.discipline_quarantine_enabled !== true) return 'la quarantaine est désactivée (onglet Quarantaine du dashboard).';
  const role = cfg.discipline_quarantine_role ? guild.roles.cache.get(String(cfg.discipline_quarantine_role)) : null;
  if (!role) return 'aucun rôle de quarantaine n’est choisi (onglet Quarantaine du dashboard).';
  const me = guild.members.me;
  if (role.position >= me.roles.highest.position) return `le rôle « ${role.name} » est au-dessus du rôle du bot : place le rôle du bot plus haut.`;
  if (!membre.manageable) return 'le rôle du membre est au-dessus de celui du bot.';

  const s = srv(guild.id);
  const fin = cas.duration > 0 ? Date.now() + cas.duration * MIN : 0;
  const deja = s.quarantines[cas.uid];
  if (deja && membre.roles.cache.has(role.id)) {   // déjà en quarantaine : on prolonge sans écraser les rôles sauvegardés
    deja.until = fin === 0 || deja.until === 0 ? 0 : Math.max(deja.until, fin);
    sauver();
    return null;
  }
  const gardes = [], sauves = [];
  for (const r of membre.roles.cache.values()) {
    if (r.id === guild.id) continue;
    if (r.managed || r.position >= me.roles.highest.position) gardes.push(r.id); else sauves.push(r.id);
  }
  await membre.roles.set([...gardes, role.id], raison);
  s.quarantines[cas.uid] = { roles: sauves, roleId: role.id, since: Date.now(), until: fin, caseId: cas.id };
  sauver();
  return null;
}

function estEnQuarantaine(guildId, uid) {
  return !!srv(guildId).quarantines[String(uid)];
}

async function libererQuarantaine(guild, uid, raison = 'Quarantaine levée') {
  uid = String(uid);
  const s = srv(guild.id);
  const q = s.quarantines[uid];
  if (!q) return false;
  delete s.quarantines[uid];
  sauver();
  const membre = await fetchMembre(guild, uid);
  if (!membre) return true;
  try {
    const me = guild.members.me;
    const actuels = membre.roles.cache.filter(r => r.id !== guild.id && r.id !== q.roleId).map(r => r.id);
    const rendus = (q.roles || []).filter(id => { const r = guild.roles.cache.get(id); return r && !r.managed && r.position < me.roles.highest.position; });
    await membre.roles.set([...new Set([...actuels, ...rendus])], raison);
  } catch (e) {
    await logStaff(guild, '⚠️ Quarantaine : rôles non rendus', `<@${uid}> — ${e.message}`);
  }
  return true;
}

/* Action du dashboard : crée le rôle de quarantaine (lecture seule sur tous les salons) */
async function preparerQuarantaine(guild, user) {
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me || !me.permissions.has(P.ManageRoles) || !me.permissions.has(P.ManageChannels)) {
    return ko(400, 'permissions', 'Le bot a besoin des permissions « Gérer les rôles » et « Gérer les salons ».');
  }
  const cfg = obtenirConfigGuilde(guild.id);
  const raison = `Configuration de la quarantaine par ${user.username} (dashboard)`;
  let role = cfg.discipline_quarantine_role ? guild.roles.cache.get(String(cfg.discipline_quarantine_role)) : null;
  if (!role) role = guild.roles.cache.find(r => r.name === 'Quarantaine' && !r.managed);
  try {
    if (!role) role = await guild.roles.create({ name: 'Quarantaine', color: 0x6b6878, permissions: [], mentionable: false, reason: raison });
  } catch (e) { return ko(400, 'discord', `Création du rôle impossible : ${e.message}`); }
  if (role.position >= me.roles.highest.position) return ko(400, 'permissions', `Le rôle « ${role.name} » est au-dessus du rôle du bot : place le rôle du bot plus haut.`);

  let regles = 0, echecs = 0;
  for (const c of guild.channels.cache.values()) {
    if (!SALONS_CONCERNES.includes(c.type)) continue;
    if (!c.manageable) { echecs++; continue; }
    try { await c.permissionOverwrites.edit(role, REFUS_QUARANTAINE, { reason: raison }); regles++; } catch { echecs++; }
  }
  cfg.discipline_quarantine_role = role.id;
  cfg.discipline_quarantine_enabled = true;
  persister('configuration');
  return { code: 200, body: { ok: true, roleId: role.id, channelsUpdated: regles, channelsFailed: echecs, roles: [{ id: role.id, name: role.name, ok: true }] } };
}

/* ------------------------------ Validation (kick / ban) ------------------------------ */
async function demanderValidation(guild, cas, membre) {
  const cfg = obtenirConfigGuilde(guild.id);
  const salon = guild.channels.cache.get(String(cfg.discipline_validation_channel));
  if (!salon?.isTextBased?.()) {   // salon introuvable : on n'attend pas indéfiniment, on applique
    await logStaff(guild, '⚠️ Salon de validation introuvable', 'La sanction est appliquée sans validation.');
    return appliquerCas(guild, cas, { par: null });
  }
  cas.status = 'pending';
  sauver();
  const embed = new EmbedBuilder()
    .setTitle(`🛡️ Sanction à valider : ${LIBELLE[cas.action]}`)
    .setColor(COULEUR)
    .setThumbnail(membre.user.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: 'Membre', value: `${membre} (\`${membre.id}\`)`, inline: true },
      { name: 'Strikes actifs', value: String(cas.strikes), inline: true },
      { name: 'Durée', value: SANS_DUREE(cas.action) ? '—' : dureeTexte(cas.duration), inline: true },
      { name: 'Dernier motif', value: String(cas.reason).slice(0, 1000) || '—' }
    )
    .setFooter({ text: `Dossier ${cas.id}` })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sanct:v:ok:${guild.id}:${cas.id}`).setLabel('Valider').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`sanct:v:no:${guild.id}:${cas.id}`).setLabel('Refuser').setEmoji('✖️').setStyle(ButtonStyle.Danger)
  );
  try {
    const msg = await salon.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
    cas.msg = { channelId: salon.id, messageId: msg.id };
    sauver();
  } catch (e) {
    await logStaff(guild, '⚠️ Validation impossible', `Message non envoyé dans <#${salon.id}> : ${e.message}\nLa sanction est appliquée sans validation.`);
    await appliquerCas(guild, cas, { par: null });
  }
}

/* ------------------------------ Contestations ------------------------------ */
async function ouvrirContestation(guild, cas, texte) {
  const cfg = obtenirConfigGuilde(guild.id);
  const salon = cfg.discipline_appeals_channel ? guild.channels.cache.get(String(cfg.discipline_appeals_channel)) : null;
  cas.appeal = { text: String(texte).slice(0, 1000), ts: Date.now(), status: 'open' };
  sauver();
  if (!salon?.isTextBased?.()) return;
  const membre = await fetchMembre(guild, cas.uid);
  const embed = new EmbedBuilder()
    .setTitle(`⚖️ Contestation : ${LIBELLE[cas.action]}`)
    .setColor(COULEUR)
    .addFields(
      { name: 'Membre', value: `<@${cas.uid}> (\`${cas.uid}\`)`, inline: true },
      { name: 'Strikes', value: String(cas.strikes), inline: true },
      { name: 'Motif de la sanction', value: String(cas.reason).slice(0, 1000) || '—' },
      { name: 'Message du membre', value: cas.appeal.text || '—' }
    )
    .setFooter({ text: `Dossier ${cas.id}` })
    .setTimestamp();
  if (membre) embed.setThumbnail(membre.user.displayAvatarURL({ size: 128 }));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sanct:r:ok:${guild.id}:${cas.id}`).setLabel('Accepter').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`sanct:r:no:${guild.id}:${cas.id}`).setLabel('Refuser').setEmoji('✖️').setStyle(ButtonStyle.Danger)
  );
  try {
    const msg = await salon.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
    cas.appeal.msg = { channelId: salon.id, messageId: msg.id };
    sauver();
  } catch (e) { console.error('[Sanctions] contestation :', e.message); }
}

// Lève la sanction d'un dossier (contestation acceptée). Retourne un message d'erreur ou null.
async function leverCas(guild, cas, par) {
  const raison = `Contestation acceptée par ${par}`;
  try {
    if (cas.action === 'ban') await guild.bans.remove(cas.uid, raison).catch(() => {});
    else if (cas.action === 'timeout') { const m = await fetchMembre(guild, cas.uid); if (m) await m.timeout(null, raison); }
    else if (cas.action === 'quarantine') await libererQuarantaine(guild, cas.uid, raison);
    else if (cas.action === 'strip_roles' && cas.removedRoles?.length) { const m = await fetchMembre(guild, cas.uid); if (m) await m.roles.add(cas.removedRoles.filter(id => guild.roles.cache.has(id)), raison); }
    delete srv(guild.id).bans[cas.uid];
  } catch (e) { return `Discord a refusé : ${e.message}`; }
  if (cas.logTs) sanctionsLog.marquerLevee(guild.id, cas.logTs, cas.uid, par);
  // Le strike qui avait déclenché la sanction est annulé avec elle
  if (cas.warnDate) {
    const liste = (store.warns || {})[cas.uid];
    if (Array.isArray(liste)) {
      const i = liste.findIndex(w => w && String(w.guild_id) === String(guild.id) && w.date === cas.warnDate);
      if (i >= 0) { liste.splice(i, 1); persist('warns'); }
    }
  }
  cas.status = 'revoked';
  sauver();
  return null;
}

async function majMessage(guild, ref, champ, couleur) {
  try {
    if (!ref) return;
    const ch = guild.channels.cache.get(ref.channelId);
    const msg = ch ? await ch.messages.fetch(ref.messageId).catch(() => null) : null;
    if (!msg) return;
    const emb = EmbedBuilder.from(msg.embeds[0]).setColor(couleur).addFields(champ);
    await msg.edit({ embeds: [emb], components: [] });
  } catch { /* message supprimé */ }
}

/* Décision commune (boutons Discord et dashboard) : kind = 'valid' | 'appeal', ok = true/false */
async function decider(guild, cas, kind, ok, par) {
  if (kind === 'valid') {
    if (cas.status !== 'pending') return { error: 'done', reason: 'Cette sanction a déjà été traitée.' };
    if (!ok) {
      cas.status = 'rejected'; cas.by = par; sauver();
      await majMessage(guild, cas.msg, { name: 'Décision', value: `✖️ Refusée par ${par}` }, 0x6b6878);
      return { ok: true };
    }
    await majMessage(guild, cas.msg, { name: 'Décision', value: `✅ Validée par ${par}` }, 0x3ba55d);
    await appliquerCas(guild, cas, { par });
    return cas.status === 'applied' ? { ok: true } : { error: 'failed', reason: cas.error || 'La sanction n’a pas pu être appliquée.' };
  }
  // appeal
  if (!cas.appeal || cas.appeal.status !== 'open') return { error: 'done', reason: 'Cette contestation a déjà été traitée.' };
  if (ok) {
    const err = await leverCas(guild, cas, par);
    if (err) return { error: 'discord', reason: err };
  }
  cas.appeal.status = ok ? 'accepted' : 'refused'; cas.appeal.by = par; cas.appeal.at = Date.now(); sauver();
  await majMessage(guild, cas.appeal.msg, { name: 'Décision', value: ok ? `✅ Acceptée par ${par}` : `✖️ Refusée par ${par}` }, ok ? 0x3ba55d : 0x6b6878);
  const embed = new EmbedBuilder()
    .setTitle(ok ? '✅ Contestation acceptée' : '✖️ Contestation refusée')
    .setColor(ok ? 0x3ba55d : 0xff4444)
    .setDescription(ok ? `Ta sanction sur **${guild.name}** a été levée.` : `Ta contestation sur **${guild.name}** a été examinée et refusée.`)
    .setTimestamp();
  await envoyerMp(guild.client, cas.uid, { embeds: [embed] });
  return { ok: true };
}

/* ------------------------------ Interactions (boutons / modal) ------------------------------ */
async function routeSanctionInteraction(interaction) {
  const [, type, a, b, c] = String(interaction.customId).split(':');
  const rep = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => { });

  // Membre : bouton « Contester » (en MP) puis modal
  if (type === 'a' || type === 'am') {
    const gid = a, id = b;
    const guild = interaction.client.guilds.cache.get(gid);
    const cas = guild ? srv(gid).cases[id] : null;
    if (!guild || !cas) return rep('❌ Cette sanction est introuvable.');
    if (cas.uid !== interaction.user.id) return rep('❌ Cette sanction ne te concerne pas.');
    const cfg = obtenirConfigGuilde(gid);
    if (cfg.discipline_appeals_enabled !== true) return rep('❌ Les contestations sont désactivées sur ce serveur.');
    const delai = Math.max(1, Number(cfg.discipline_appeals_days) || 7) * 86400000;
    if (Date.now() - (cas.appliedAt || cas.ts) > delai) return rep('❌ Le délai pour contester cette sanction est dépassé.');
    if (cas.appeal) return rep('ℹ️ Tu as déjà contesté cette sanction : le staff va l’examiner.');
    if (type === 'a') {
      const modal = new ModalBuilder().setCustomId(`sanct:am:${gid}:${id}`).setTitle('Contester la sanction')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('texte').setLabel('Pourquoi contestes-tu ?').setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(1000).setRequired(true)
        ));
      return interaction.showModal(modal);
    }
    await ouvrirContestation(guild, cas, interaction.fields.getTextInputValue('texte'));
    return rep('✅ Ta contestation a été transmise au staff.');
  }

  // Staff : validation (v) ou contestation (r)
  if (type === 'v' || type === 'r') {
    const ok = a === 'ok', gid = b, id = c;
    const guild = interaction.guild || interaction.client.guilds.cache.get(gid);
    const cas = guild ? srv(gid).cases[id] : null;
    if (!guild || !cas || guild.id !== interaction.guildId) return rep('❌ Dossier introuvable.');
    if (!estModo(interaction.member, cas.action)) return rep('❌ Tu n’as pas la permission de décider ici.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => { });
    const r = await decider(guild, cas, type === 'v' ? 'valid' : 'appeal', ok, interaction.user.username);
    return interaction.editReply(r.ok ? '✅ Décision enregistrée.' : `❌ ${r.reason || 'Action impossible.'}`).catch(() => { });
  }
}

/* ------------------------------ Dashboard : file « À traiter » ------------------------------ */
const cacheConv = new Map();   // guildId -> { ts, n } (évite 25 appels Discord à chaque rafraîchissement du dashboard)
async function conversationsSansReponse(guild, cfg) {
  const heures = Math.max(1, Number(cfg.pending_unanswered_hours) || 4);
  const c = cacheConv.get(guild.id);
  if (c && Date.now() - c.ts < 30000 && c.heures === heures) return c.n;
  let n = 0;
  try {
    const mm = require('../handlers/modmail');
    const threads = Object.values(mm.data?.[guild.id]?.threads || {}).slice(0, 25);
    for (const chId of threads) {
      const ch = guild.channels.cache.get(String(chId));
      if (!ch?.isTextBased?.()) continue;
      const last = (await ch.messages.fetch({ limit: 1 }).catch(() => null))?.first();
      // Les messages du membre sont relayés par le bot : dernier message du bot = personne du staff n'a répondu
      const ts = last ? last.createdTimestamp : SnowflakeUtil.timestampFrom(ch.id);
      if ((!last || last.author.bot) && Date.now() - ts >= heures * 3600000) n++;
    }
  } catch { /* modmail absent */ }
  cacheConv.set(guild.id, { ts: Date.now(), n, heures });
  return n;
}

async function elementsFile(guild) {
  const cfg = obtenirConfigGuilde(guild.id);
  const s = srv(guild.id);
  const items = [];
  for (const cas of Object.values(s.cases)) {
    const m = guild.members.cache.get(cas.uid);
    const membre = { id: cas.uid, name: m ? m.displayName : 'Ancien membre', avatar: m ? m.displayAvatarURL({ size: 64 }) : null };
    if (cas.status === 'pending') {
      items.push({
        id: `valid_${cas.id}`, type: 'Validation', status: 'open', ts: cas.ts, title: `${LIBELLE[cas.action]} à valider`,
        member: membre, avatar: membre.avatar, reason: cas.reason,
        description: `${cas.strikes} strike${cas.strikes > 1 ? 's' : ''} · ${cas.action === 'kick' ? 'expulsion' : cas.action === 'warn' ? 'avertissement' : cas.action === 'strip_roles' ? 'retrait des rôles' : dureeTexte(cas.duration)}`
      });
    }
    if (cas.appeal && cas.appeal.status === 'open') {
      items.push({
        id: `appeal_${cas.id}`, type: 'Contestation', status: 'open', ts: cas.appeal.ts, title: `Contestation : ${LIBELLE[cas.action]}`,
        member: membre, avatar: membre.avatar, reason: cas.appeal.text,
        description: `Motif de la sanction : ${String(cas.reason).slice(0, 120)}`
      });
    }
  }
  return { items, conversations: await conversationsSansReponse(guild, cfg) };
}

// Décision prise depuis la page « À traiter » : id = valid_<dossier> | appeal_<dossier>, action = resolve (accepter) | dismiss (refuser)
async function deciderDepuisDashboard(guild, user, id, action) {
  const m = /^(valid|appeal)_([0-9a-f]{8})$/.exec(String(id));
  if (!m) return { error: 'invalid', reason: 'Élément inconnu.' };
  const cas = srv(guild.id).cases[m[2]];
  if (!cas) return { error: 'not_found', reason: 'Dossier introuvable.' };
  return decider(guild, cas, m[1], action === 'resolve', user.username);
}

/* ------------------------------ Tâches périodiques ------------------------------ */
function maintenantParis() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { jour: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

async function envoyerRecap(guild, cfg) {
  const salon = guild.channels.cache.get(String(cfg.pending_recap_channel));
  if (!salon?.isTextBased?.()) return false;
  const reports = require('./reports');
  let signalements = 0;
  try {
    for (const dos of reports.dossiers(guild, { status: 'open', q: '' }).dossiers) for (const r of dos.reports) if (r.status === 'open') signalements++;
  } catch { /* module signalements indisponible */ }
  const f = await elementsFile(guild);
  const contestations = f.items.filter(i => i.type === 'Contestation').length;
  const validations = f.items.filter(i => i.type === 'Validation').length;
  const total = signalements + contestations + validations + f.conversations;
  const heures = Math.max(1, Number(cfg.pending_unanswered_hours) || 4);
  const embed = new EmbedBuilder()
    .setTitle('📋 Récap « À traiter »')
    .setColor(total ? COULEUR : 0x3ba55d)
    .setDescription(total ? 'Voici ce qui attend le staff :' : 'Rien à traiter pour le moment 🎉')
    .setTimestamp();
  if (total) {
    embed.addFields(
      { name: 'Signalements ouverts', value: String(signalements), inline: true },
      { name: 'Contestations', value: String(contestations), inline: true },
      { name: 'Sanctions à valider', value: String(validations), inline: true },
      { name: `Conversations sans réponse (+${heures} h)`, value: String(f.conversations), inline: true }
    );
  }
  await salon.send({ embeds: [embed], allowedMentions: { parse: [] } });
  return true;
}

let enCours = false;
async function balayer(client) {
  if (enCours) return;
  enCours = true;
  try {
    const now = Date.now();
    const db = charger();

    // 1) Fins de quarantaine / de bannissement temporaire
    for (const [gid, g] of Object.entries(db.guilds)) {
      const guild = client.guilds.cache.get(gid);
      if (!guild) continue;
      for (const [uid, q] of Object.entries(g.quarantines || {})) {
        if (q.until && q.until <= now) {
          await libererQuarantaine(guild, uid, 'Fin de la quarantaine');
          await logStaff(guild, '🔓 Quarantaine terminée', `<@${uid}> a retrouvé ses rôles.`, 0x3ba55d);
        }
      }
      for (const [uid, b] of Object.entries(g.bans || {})) {
        if (b.until && b.until <= now) {
          await guild.bans.remove(uid, 'Fin du bannissement temporaire').catch(() => { });
          delete g.bans[uid];
          sauver();
          await logStaff(guild, '🔓 Bannissement terminé', `<@${uid}> a été débanni automatiquement.`, 0x3ba55d);
        }
      }
    }

    // 2) Récap quotidien « À traiter »
    const { jour, hhmm } = maintenantParis();
    for (const guild of client.guilds.cache.values()) {
      const cfg = obtenirConfigGuilde(guild.id);
      if (cfg.pending_recap_enabled !== true || !cfg.pending_recap_channel) continue;
      const s = srv(guild.id);
      if (s.lastRecap === jour || hhmm < String(cfg.pending_recap_time || '09:00')) continue;
      s.lastRecap = jour;   // marqué avant l'envoi : pas de doublon même si l'envoi échoue
      sauver();
      await envoyerRecap(guild, cfg).catch(e => console.error('[Sanctions] récap :', e.message));
    }
  } catch (e) {
    console.error('[Sanctions] balayage :', e.message);
  } finally {
    enCours = false;
  }
}

function demarrer(client) {
  charger();
  const t = setInterval(() => balayer(client), 60 * 1000);
  if (t.unref) t.unref();
  setTimeout(() => balayer(client), 15 * 1000).unref?.();
  // Un nouveau salon reçoit lui aussi la restriction de quarantaine
  client.on('channelCreate', async ch => {
    try {
      if (!ch.guild || !ch.permissionOverwrites || !SALONS_CONCERNES.includes(ch.type)) return;
      const cfg = obtenirConfigGuilde(ch.guild.id);
      if (cfg.discipline_quarantine_enabled !== true || !cfg.discipline_quarantine_role) return;
      const role = ch.guild.roles.cache.get(String(cfg.discipline_quarantine_role));
      if (role && ch.manageable) await ch.permissionOverwrites.edit(role, REFUS_QUARANTAINE, { reason: 'Quarantaine : nouveau salon' });
    } catch { /* permissions insuffisantes */ }
  });
  console.log('[Sanctions] moteur de sanctions démarré.');
}

module.exports = {
  apresStrike, routeSanctionInteraction, demarrer, balayer,
  elementsFile, deciderDepuisDashboard, preparerQuarantaine,
  libererQuarantaine, estEnQuarantaine,
  // exposés pour les tests
  _strikesActifs: strikesActifs, _choisirPalier: choisirPalier
};
