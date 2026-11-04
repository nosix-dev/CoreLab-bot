'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Rôles par menu déroulant
//   /role-menu create   titre role [description] [mode] [salon]  → crée et publie un menu avec un 1er rôle
//   /role-menu add      menu role [label] [emoji] [description]  → ajoute un rôle au menu
//   /role-menu remove   menu role                                → retire un rôle du menu
//   /role-menu delete   menu                                     → supprime le menu (et son message)
//   /role-menu list                                              → liste les menus du serveur
//
// Le membre choisit dans le menu : chaque rôle choisi est ajouté s'il ne l'a pas, retiré sinon.
// Mode « single » : un seul rôle du menu à la fois (choisir un rôle retire les autres du menu).
// Sécurité : un rôle avec permissions dangereuses (Administrator, ManageGuild, ManageRoles,
// ManageChannels, ManageWebhooks, BanMembers, KickMembers), géré par une intégration, @everyone
// ou placé au-dessus du bot (ou de l'admin) ne peut pas être mis dans un menu.
// Données : role_menus.json  { [guildId]: { [menuId]: { id, title, description, mode, channelId, messageId, roles: [...] } } }
// ─────────────────────────────────────────────────────────────────────────

const {
  SlashCommandBuilder,
  PermissionFlagsBits: P,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags
} = require('discord.js');
const crypto = require('crypto');
const { chargerDonnees, sauvegarderDonnees } = require('../core/data');

const FICHIER = 'role_menus.json';
const COULEUR = 0x5865F2;
const MAX_ROLES = 25;
const MAX_MENUS_PAR_SERVEUR = 25;

const DANGEROUS_MASK = [
  P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels,
  P.ManageWebhooks, P.BanMembers, P.KickMembers
].reduce((a, p) => a | p, 0n);

const donnees = chargerDonnees(FICHIER, {});
const sauver = () => sauvegarderDonnees(FICHIER, donnees);

function menusOf(guildId, create = false) {
  const g = String(guildId);
  if (!donnees[g]) { if (!create) return {}; donnees[g] = {}; }
  return donnees[g];
}

// ── Vérification d'un rôle ──────────────────────────────────
// executor : membre qui configure (null au moment de l'attribution)
function roleProblem(guild, role, executor = null) {
  if (!role) return 'rôle introuvable';
  if (role.id === guild.id) return 'le rôle @everyone ne peut pas être utilisé';
  if (role.managed) return 'ce rôle est géré par une intégration ou un bot';
  if ((BigInt(role.permissions.bitfield) & DANGEROUS_MASK) !== 0n) return 'ce rôle a des permissions dangereuses (administration, gestion, bannissement…)';
  const me = guild.members.me;
  if (!me || role.position >= me.roles.highest.position) return 'ce rôle est au-dessus du rôle du bot : place le rôle du bot plus haut';
  if (executor && executor.id !== guild.ownerId && role.position >= executor.roles.highest.position) return 'ce rôle est au-dessus de ton propre rôle le plus haut';
  return null;
}

// ── Rendu du message du menu ────────────────────────────────
function buildMessage(guild, menu) {
  const lines = menu.roles.map(r => {
    const role = guild.roles.cache.get(r.roleId);
    const name = role ? `<@&${role.id}>` : '*(rôle supprimé)*';
    return `${r.emoji ? `${r.emoji} ` : ''}${name}${r.description ? ` — ${r.description}` : ''}`;
  });
  const embed = new EmbedBuilder()
    .setColor(COULEUR)
    .setTitle(menu.title)
    .setDescription([menu.description, lines.join('\n')].filter(Boolean).join('\n\n').slice(0, 4000))
    .setFooter({ text: menu.mode === 'single' ? 'Un seul rôle à la fois • choisis à nouveau pour le retirer' : 'Choisis un rôle pour l\'obtenir • choisis à nouveau pour le retirer' });

  const options = menu.roles.map(r => {
    const role = guild.roles.cache.get(r.roleId);
    const opt = {
      label: (r.label || role?.name || 'Rôle').slice(0, 100),
      value: r.roleId
    };
    if (r.description) opt.description = r.description.slice(0, 100);
    if (r.emoji) opt.emoji = r.emoji;
    return opt;
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(`rolemenu:${menu.id}`)
    .setPlaceholder('Choisis tes rôles…')
    .setMinValues(0)
    .setMaxValues(menu.mode === 'single' ? 1 : Math.max(1, options.length))
    .addOptions(options);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

async function refreshMessage(guild, menu) {
  if (!menu.channelId || !menu.messageId) return false;
  const channel = guild.channels.cache.get(menu.channelId) || await guild.channels.fetch(menu.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  const msg = await channel.messages.fetch(menu.messageId).catch(() => null);
  if (!msg) return false;
  await msg.edit(buildMessage(guild, menu)).catch(e => console.error('[RoleMenu] édition :', e.message));
  return true;
}

function parseEmoji(input) {
  const e = (input || '').trim();
  if (!e) return null;
  const custom = e.match(/^<(a?):(\w+):(\d+)>$/);
  if (custom) return { id: custom[3], name: custom[2], animated: !!custom[1] };
  if (/^[\p{Extended_Pictographic}\u200d\ufe0f\u20e3#*0-9]{1,16}$/u.test(e) && /\p{Extended_Pictographic}|\u20e3/u.test(e)) return e;
  return undefined; // invalide
}

// ── Commande ────────────────────────────────────────────────
const roleMenu = {
  data: new SlashCommandBuilder()
    .setName('role-menu')
    .setDescription('🎭 Menus déroulants pour choisir ses rôles')
    .setDMPermission(false)
    .setDefaultMemberPermissions(P.ManageRoles)
    .addSubcommand(s => s.setName('create').setDescription('Créer et publier un menu de rôles')
      .addStringOption(o => o.setName('titre').setDescription('Titre du menu').setRequired(true).setMaxLength(100))
      .addRoleOption(o => o.setName('role').setDescription('Premier rôle du menu').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Texte affiché au-dessus de la liste').setMaxLength(500))
      .addStringOption(o => o.setName('mode').setDescription('Plusieurs rôles ou un seul à la fois').addChoices(
        { name: 'Plusieurs rôles', value: 'multiple' }, { name: 'Un seul rôle à la fois', value: 'single' }))
      .addChannelOption(o => o.setName('salon').setDescription('Salon où publier (par défaut : ici)')))
    .addSubcommand(s => s.setName('add').setDescription('Ajouter un rôle à un menu')
      .addStringOption(o => o.setName('menu').setDescription('Menu').setRequired(true).setAutocomplete(true))
      .addRoleOption(o => o.setName('role').setDescription('Rôle à ajouter').setRequired(true))
      .addStringOption(o => o.setName('label').setDescription('Texte affiché dans le menu (par défaut : nom du rôle)').setMaxLength(100))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji de l\'option'))
      .addStringOption(o => o.setName('description').setDescription('Courte description sous le nom').setMaxLength(100)))
    .addSubcommand(s => s.setName('remove').setDescription('Retirer un rôle d\'un menu')
      .addStringOption(o => o.setName('menu').setDescription('Menu').setRequired(true).setAutocomplete(true))
      .addRoleOption(o => o.setName('role').setDescription('Rôle à retirer').setRequired(true)))
    .addSubcommand(s => s.setName('delete').setDescription('Supprimer un menu et son message')
      .addStringOption(o => o.setName('menu').setDescription('Menu').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('list').setDescription('Lister les menus de rôles du serveur')),

  async autocomplete(interaction) {
    if (!interaction.guild) return interaction.respond([]);
    const focused = String(interaction.options.getFocused() || '').toLowerCase();
    const choices = Object.values(menusOf(interaction.guild.id))
      .filter(m => m.title.toLowerCase().includes(focused) || m.id.includes(focused))
      .slice(0, 25)
      .map(m => ({ name: `${m.title} (${m.roles.length} rôle${m.roles.length > 1 ? 's' : ''})`.slice(0, 100), value: m.id }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    if (!guild) return reply('❌ Cette commande fonctionne uniquement dans un serveur.');
    const perms = interaction.memberPermissions;
    if (!perms?.has(P.ManageRoles) && !perms?.has(P.Administrator)) return reply('❌ Réservé aux personnes ayant la permission « Gérer les rôles ».');

    const sub = interaction.options.getSubcommand();
    const executor = interaction.member;
    const menus = menusOf(guild.id, true);

    if (sub === 'list') {
      const all = Object.values(menus);
      if (!all.length) return reply('Aucun menu de rôles sur ce serveur. Crée-en un avec `/role-menu create`.');
      return reply(all.map(m => `• **${m.title}** — ${m.roles.length} rôle(s) — ${m.mode === 'single' ? 'un seul rôle' : 'plusieurs rôles'} — ${m.channelId ? `<#${m.channelId}>` : 'non publié'}`).join('\n').slice(0, 1900));
    }

    if (sub === 'create') {
      if (Object.keys(menus).length >= MAX_MENUS_PAR_SERVEUR) return reply(`❌ Maximum ${MAX_MENUS_PAR_SERVEUR} menus par serveur.`);
      const role = interaction.options.getRole('role');
      const problem = roleProblem(guild, role, executor);
      if (problem) return reply(`❌ Impossible d'utiliser ${role} : ${problem}.`);
      const channel = interaction.options.getChannel('salon') || interaction.channel;
      if (!channel?.isTextBased?.()) return reply('❌ Choisis un salon textuel.');
      const botPerms = channel.permissionsFor(guild.members.me);
      if (!botPerms?.has(P.ViewChannel) || !botPerms?.has(P.SendMessages) || !botPerms?.has(P.EmbedLinks)) {
        return reply(`❌ Je n'ai pas la permission d'envoyer des messages avec embed dans ${channel}.`);
      }
      const menu = {
        id: crypto.randomBytes(4).toString('hex'),
        title: interaction.options.getString('titre').trim(),
        description: (interaction.options.getString('description') || '').trim(),
        mode: interaction.options.getString('mode') || 'multiple',
        channelId: channel.id,
        messageId: null,
        roles: [{ roleId: role.id, label: role.name.slice(0, 100), emoji: null, description: null }]
      };
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const msg = await channel.send(buildMessage(guild, menu)).catch(e => { console.error('[RoleMenu] envoi :', e.message); return null; });
      if (!msg) return interaction.editReply('❌ Impossible de publier le menu dans ce salon.');
      menu.messageId = msg.id;
      menus[menu.id] = menu;
      sauver();
      return interaction.editReply(`✅ Menu **${menu.title}** publié dans ${channel}. Ajoute d'autres rôles avec \`/role-menu add\`.`);
    }

    // add / remove / delete : menu existant
    const menu = menus[interaction.options.getString('menu')];
    if (!menu) return reply('❌ Menu introuvable (utilise l\'autocomplétion).');

    if (sub === 'add') {
      const role = interaction.options.getRole('role');
      if (menu.roles.some(r => r.roleId === role.id)) return reply('❌ Ce rôle est déjà dans le menu.');
      if (menu.roles.length >= MAX_ROLES) return reply(`❌ Un menu contient au maximum ${MAX_ROLES} rôles.`);
      const problem = roleProblem(guild, role, executor);
      if (problem) return reply(`❌ Impossible d'ajouter ${role} : ${problem}.`);
      let emoji = null;
      const rawEmoji = interaction.options.getString('emoji');
      if (rawEmoji) {
        emoji = parseEmoji(rawEmoji);
        if (emoji === undefined) return reply('❌ Emoji invalide. Utilise un emoji classique ou un emoji personnalisé du type `<:nom:123456789>`.');
      }
      menu.roles.push({
        roleId: role.id,
        label: (interaction.options.getString('label') || role.name).trim().slice(0, 100),
        emoji,
        description: (interaction.options.getString('description') || '').trim() || null
      });
      sauver();
      const ok = await refreshMessage(guild, menu);
      return reply(ok ? `✅ ${role} ajouté au menu **${menu.title}**.` : `⚠️ ${role} ajouté, mais le message du menu est introuvable (supprimé ?). Recrée le menu avec \`/role-menu create\`.`);
    }

    if (sub === 'remove') {
      const role = interaction.options.getRole('role');
      if (!menu.roles.some(r => r.roleId === role.id)) return reply('❌ Ce rôle n\'est pas dans ce menu.');
      if (menu.roles.length <= 1) return reply('❌ Un menu doit garder au moins un rôle. Utilise `/role-menu delete` pour le supprimer.');
      menu.roles = menu.roles.filter(r => r.roleId !== role.id);
      sauver();
      await refreshMessage(guild, menu);
      return reply(`✅ ${role} retiré du menu **${menu.title}**.`);
    }

    if (sub === 'delete') {
      delete menus[menu.id];
      sauver();
      const channel = guild.channels.cache.get(menu.channelId);
      const msg = channel?.isTextBased?.() ? await channel.messages.fetch(menu.messageId).catch(() => null) : null;
      if (msg) await msg.delete().catch(() => {});
      return reply(`🗑️ Menu **${menu.title}** supprimé.`);
    }
  }
};

// ── Sélection d'un membre ───────────────────────────────────
async function handleSelect(interaction) {
  const menuId = interaction.customId.split(':')[1];
  const guild = interaction.guild;
  if (!guild) return;
  const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  const menu = menusOf(guild.id)[menuId];
  if (!menu) return reply('❌ Ce menu n\'existe plus.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = interaction.member?.roles?.cache ? interaction.member : await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return interaction.editReply('❌ Impossible de te retrouver sur le serveur.');

  const menuRoleIds = new Set(menu.roles.map(r => r.roleId));
  const selected = interaction.values.filter(v => menuRoleIds.has(v));
  if (!selected.length) return interaction.editReply('Aucun rôle sélectionné.');

  const toAdd = [];
  const toRemove = [];
  for (const id of selected) {
    if (member.roles.cache.has(id)) toRemove.push(id); else toAdd.push(id);
  }
  if (menu.mode === 'single' && toAdd.length) {
    for (const id of menuRoleIds) {
      if (!toAdd.includes(id) && member.roles.cache.has(id) && !toRemove.includes(id)) toRemove.push(id);
    }
  }

  const errors = [];
  const added = [];
  const removed = [];
  for (const id of toAdd) {
    const role = guild.roles.cache.get(id);
    const problem = roleProblem(guild, role); // re-vérifié à chaque attribution (les permissions du rôle ont pu changer)
    if (problem) { errors.push(`${role ? role.name : id} : ${problem}`); continue; }
    try { await member.roles.add(role, `Menu de rôles « ${menu.title} »`); added.push(role); }
    catch (e) { errors.push(`${role.name} : ${e.message}`); }
  }
  for (const id of toRemove) {
    const role = guild.roles.cache.get(id);
    if (!role) continue;
    try { await member.roles.remove(role, `Menu de rôles « ${menu.title} »`); removed.push(role); }
    catch (e) { errors.push(`${role.name} : ${e.message}`); }
  }

  const lines = [];
  if (added.length) lines.push(`✅ Ajouté : ${added.map(r => `<@&${r.id}>`).join(', ')}`);
  if (removed.length) lines.push(`🗑️ Retiré : ${removed.map(r => `<@&${r.id}>`).join(', ')}`);
  if (errors.length) lines.push(`⚠️ Impossible : ${errors.join(' • ')}`.slice(0, 900));
  return interaction.editReply({ content: lines.join('\n') || 'Rien n\'a changé.', allowedMentions: { parse: [] } });
}

function registerRoleMenus(client) {
  client.on('interactionCreate', interaction => {
    try {
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('rolemenu:')) {
        handleSelect(interaction).catch(e => {
          if (e?.code !== 10062) console.error('[RoleMenu] sélection :', e.message);
        });
      }
    } catch (e) { console.error('[RoleMenu] interaction :', e.message); }
  });

  // Menu dont le message a été supprimé : on nettoie les données
  client.on('messageDelete', message => {
    try {
      const gid = message.guildId;
      if (!gid || !donnees[gid]) return;
      const found = Object.values(donnees[gid]).find(m => m.messageId === message.id);
      if (found) { delete donnees[gid][found.id]; sauver(); }
    } catch (e) { console.error('[RoleMenu] nettoyage :', e.message); }
  });
  console.log('✅ Menus de rôles initialisés.');
}

module.exports = { commands: [roleMenu], registerRoleMenus, _test: { parseEmoji } };
