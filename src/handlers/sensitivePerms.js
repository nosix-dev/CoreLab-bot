// src/handlers/sensitivePerms.js
// Permissions sensibles : alerte quand une permission dangereuse est accordée à un rôle, à un membre
// (via un rôle) ou à un bot ajouté. Réglages : clés perm_* de bot_config.json (page du dashboard).

const crypto = require('crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const { getGuildConfig } = require('../core/config');
const { getProtectionLogChannelId } = require('../core/protectionLog');
const store = require('../core/securityStore');

const AUTOREVERT_TICK_MS = 30 * 1000;
const AUDIT_DELAY_MS = 1500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function watchedKeys(cfg) {
  const list = Array.isArray(cfg.perm_watched) ? cfg.perm_watched : store.PERM_DEF;
  return list.filter(k => store.PERM_KEYS.includes(k));
}
// has(flag, false) : on ignore l'implication « Administrateur = toutes les permissions »
const hasRaw = (perms, key) => perms.has(store.PERM_FLAGS[key], false);
const labels = keys => keys.map(k => store.PERM_LABELS[k]).join(', ');

async function findExecutor(guild, type, targetId) {
  await sleep(AUDIT_DELAY_MS);
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 6 });
    const e = logs.entries.find(x => x.target?.id === targetId && Date.now() - x.createdTimestamp < 20000);
    return e?.executor || null;
  } catch {
    return null; // pas la permission « Voir les logs du serveur » : auteur inconnu
  }
}

function ignored(cfg, guild, executor, selfId) {
  if (!executor) return false;
  if (executor.id === selfId) return true;
  if (cfg.perm_ignore_owner !== false && executor.id === guild.ownerId) return true;
  return (Array.isArray(cfg.perm_trusted) ? cfg.perm_trusted : []).includes(executor.id);
}

function buildMessage(a, status) {
  const color = a.status === 'pending' ? 0xe0a526 : a.status === 'ok' ? 0x3ba55d : 0x6b6878;
  const embed = new EmbedBuilder()
    .setTitle(`🔑 ${a.title}`)
    .setColor(color)
    .addFields(
      { name: 'Permissions', value: labels(a.perms) || '—' },
      { name: 'Auteur du changement', value: a.executorId ? `<@${a.executorId}>` : 'Inconnu (logs du serveur indisponibles)', inline: true },
      { name: a.kind === 'role' ? 'Rôle' : a.kind === 'bot' ? 'Bot' : 'Membre', value: a.kind === 'role' ? `<@&${a.roleId}>` : `<@${a.memberId}>`, inline: true }
    )
    .setTimestamp(a.ts);
  if (a.kind === 'member') embed.addFields({ name: 'Rôle ajouté', value: `<@&${a.roleId}>`, inline: true });
  if (a.status === 'pending' && a.revertAt) embed.setFooter({ text: `Annulation automatique dans ${Math.max(1, Math.round((a.revertAt - Date.now()) / 60000))} min si personne ne clique « C’est normal ».` });
  if (status) embed.setFooter({ text: status });
  const components = a.status === 'pending' ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sp:undo:${a.id}`).setLabel('Annuler le changement').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`sp:ok:${a.id}`).setLabel('C’est normal').setStyle(ButtonStyle.Success)
  )] : [];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

async function raise(client, guild, cfg, data, executor) {
  const mins = Number(cfg.perm_autorevert) || 0;
  const a = {
    id: crypto.randomBytes(4).toString('hex'), guildId: guild.id, status: 'pending', ts: Date.now(),
    executorId: executor?.id || null, executorName: executor?.username || '', revertAt: mins ? Date.now() + mins * 60000 : 0, ...data
  };
  const chId = getProtectionLogChannelId(cfg) || cfg.log_channel_id;
  const ch = chId ? guild.channels.cache.get(String(chId)) : null;
  if (ch?.isTextBased?.()) {
    const msg = await ch.send(buildMessage(a)).catch(() => null);
    if (msg) { a.channelId = msg.channelId; a.messageId = msg.id; }
  }
  store.addPermAlert(guild.id, a);
  return a;
}

/* ---------- Détection ---------- */
async function onRoleChange(client, oldRole, newRole) {
  const guild = newRole.guild, cfg = getGuildConfig(guild.id);
  if (!cfg.perm_alerts_enabled) return;
  const added = watchedKeys(cfg).filter(k => (!oldRole || !hasRaw(oldRole.permissions, k)) && hasRaw(newRole.permissions, k));
  if (!added.length || newRole.id === guild.id || newRole.managed) return;
  const executor = await findExecutor(guild, oldRole ? AuditLogEvent.RoleUpdate : AuditLogEvent.RoleCreate, newRole.id);
  if (ignored(cfg, guild, executor, client.user.id)) return;
  await raise(client, guild, cfg, { kind: 'role', title: oldRole ? 'Permissions dangereuses ajoutées à un rôle' : 'Rôle créé avec des permissions dangereuses', roleId: newRole.id, targetName: newRole.name, perms: added }, executor);
}

async function onMemberUpdate(client, oldM, newM) {
  if (oldM.partial) return;
  const guild = newM.guild, cfg = getGuildConfig(guild.id);
  if (!cfg.perm_alerts_enabled) return;
  const keys = watchedKeys(cfg);
  const gained = newM.roles.cache.filter(r => !oldM.roles.cache.has(r.id) && r.id !== guild.id && !r.managed);
  for (const role of gained.values()) {
    const perms = keys.filter(k => hasRaw(role.permissions, k));
    if (!perms.length) continue;
    const executor = await findExecutor(guild, AuditLogEvent.MemberRoleUpdate, newM.id);
    if (ignored(cfg, guild, executor, client.user.id)) continue;
    await raise(client, guild, cfg, { kind: 'member', title: 'Rôle à permissions dangereuses donné à un membre', roleId: role.id, memberId: newM.id, targetName: newM.user.username, perms }, executor);
  }
}

async function onBotJoin(client, member) {
  if (!member.user.bot || member.id === client.user.id) return;
  const guild = member.guild, cfg = getGuildConfig(guild.id);
  if (!cfg.perm_alerts_enabled || cfg.perm_bots === false) return;
  await sleep(2000); // laisse Discord créer et attribuer le rôle du bot
  const fresh = await guild.members.fetch(member.id).catch(() => null);
  if (!fresh) return;
  const perms = watchedKeys(cfg).filter(k => hasRaw(fresh.permissions, k));
  if (!perms.length) return;
  const executor = await findExecutor(guild, AuditLogEvent.BotAdd, member.id);
  if (ignored(cfg, guild, executor, client.user.id)) return;
  await raise(client, guild, cfg, { kind: 'bot', title: 'Bot ajouté avec des permissions dangereuses', memberId: member.id, targetName: member.user.username, perms }, executor);
}

/* ---------- Annulation ---------- */
async function revert(client, a) {
  const guild = client.guilds.cache.get(a.guildId);
  if (!guild) throw new Error('serveur introuvable');
  if (a.kind === 'role') {
    const role = guild.roles.cache.get(a.roleId);
    if (!role) return; // rôle supprimé : rien à annuler
    let perms = role.permissions;
    for (const k of a.perms) perms = perms.remove(store.PERM_FLAGS[k]);
    await role.setPermissions(perms, 'Permissions sensibles : changement annulé');
  } else if (a.kind === 'member') {
    const m = await guild.members.fetch(a.memberId).catch(() => null);
    if (m) await m.roles.remove(a.roleId, 'Permissions sensibles : changement annulé');
  } else if (a.kind === 'bot') {
    const m = await guild.members.fetch(a.memberId).catch(() => null);
    if (m) await m.kick('Permissions sensibles : bot ajouté annulé');
  }
}

async function refreshMessage(client, a, status) {
  if (!a.channelId || !a.messageId) return;
  const ch = client.channels.cache.get(a.channelId) || await client.channels.fetch(a.channelId).catch(() => null);
  const msg = ch?.messages ? await ch.messages.fetch(a.messageId).catch(() => null) : null;
  if (msg) await msg.edit(buildMessage(a, status)).catch(() => { });
}

async function autoRevertTick(client) {
  for (const { alert: a } of store.pendingAutoRevert()) {
    a.status = 'autoreverted';
    try {
      await revert(client, a);
      await refreshMessage(client, a, 'Annulé automatiquement : personne n’a validé le changement à temps.');
    } catch (e) {
      a.status = 'failed';
      await refreshMessage(client, a, `Annulation automatique impossible : ${e.message}`);
    }
    store.savePermAlerts();
  }
}

async function onButton(client, interaction) {
  const [, action, id] = interaction.customId.split(':');
  const a = store.getPermAlert(interaction.guildId, id);
  if (!a) return interaction.reply({ content: 'Cette alerte est introuvable ou trop ancienne.', ephemeral: true });
  const allowed = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  if (!allowed) return interaction.reply({ content: 'Il faut la permission « Gérer le serveur » pour répondre à cette alerte.', ephemeral: true });
  if (a.status !== 'pending') return interaction.reply({ content: 'Cette alerte a déjà été traitée.', ephemeral: true });
  if (action === 'ok') {
    a.status = 'ok';
    store.savePermAlerts();
    return interaction.update(buildMessage(a, `Validé par ${interaction.user.username} : changement voulu.`));
  }
  try {
    await revert(client, a);
    a.status = 'reverted';
    store.savePermAlerts();
    return interaction.update(buildMessage(a, `Annulé par ${interaction.user.username}.`));
  } catch (e) {
    return interaction.reply({ content: `Impossible d’annuler : ${e.message}. Vérifie que mon rôle est au-dessus du rôle concerné.`, ephemeral: true });
  }
}

function registerSensitivePermsHandler(client) {
  const safe = (name, fn) => (...args) => fn(...args).catch(e => console.error(`[SensPerms] ${name} :`, e.message));
  client.on('roleUpdate', safe('roleUpdate', (o, n) => onRoleChange(client, o, n)));
  client.on('roleCreate', safe('roleCreate', r => onRoleChange(client, null, r)));
  client.on('guildMemberUpdate', safe('memberUpdate', (o, n) => onMemberUpdate(client, o, n)));
  client.on('guildMemberAdd', safe('botJoin', m => onBotJoin(client, m)));
  client.on('interactionCreate', i => {
    if (i.isButton?.() && i.customId.startsWith('sp:')) onButton(client, i).catch(e => console.error('[SensPerms] bouton :', e.message));
  });
  let started = false;
  const start = () => { if (started) return; started = true; setInterval(() => autoRevertTick(client).catch(() => { }), AUTOREVERT_TICK_MS); };
  if (client.isReady?.()) start();
  client.once('clientReady', start);
  client.once('ready', start);
}

module.exports = { registerSensitivePermsHandler };
