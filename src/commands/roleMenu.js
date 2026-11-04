'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Rôles par boutons (/role-react) : un message avec jusqu'à 25 boutons, un par rôle
//   /role-react create   titre [description] [mode] [salon]                 → ouvre un sélecteur : tu choisis tous les rôles (jusqu'à 25), le message est publié avec un bouton par rôle
//   /role-react add      menu role [label] [emoji] [description] [couleur]  → ajoute un bouton (rôle)
//   /role-react remove   menu role                                          → retire un bouton
//   /role-react delete   menu                                               → supprime le message
//   /role-react list                                                        → liste les messages du serveur
//
// Le membre clique sur un bouton : le rôle est ajouté s'il ne l'a pas, retiré sinon.
// Mode « single » : un seul rôle du menu à la fois (choisir un rôle retire les autres du menu).
// Sécurité : un rôle avec permissions dangereuses (Administrator, ManageGuild, ManageRoles,
// ManageChannels, ManageWebhooks, BanMembers, KickMembers), géré par une intégration, @everyone
// ou placé au-dessus du bot (ou de l'admin) ne peut pas être mis dans un menu.
// Données : role_menus.json  { [guildId]: { [menuId]: { id, title, description, mode, channelId, messageId, roles: [...] } } }
// ─────────────────────────────────────────────────────────────────────────

const {
  SlashCommandBuilder,
  PermissionFlagsBits: P,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  RoleSelectMenuBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');
const crypto = require('crypto');
const { chargerDonnees, sauvegarderDonnees } = require('../core/data');

const FICHIER = 'role_menus.json';
const COULEUR = 0xFFFFFF; // barre d'accent blanche, comme les annonces de mise à jour
const MAX_ROLES = 25; // 5 lignes de 5 boutons
const STYLES = { Primary: ButtonStyle.Primary, Secondary: ButtonStyle.Secondary, Success: ButtonStyle.Success, Danger: ButtonStyle.Danger };
const MAX_MENUS_PAR_SERVEUR = 25;

const DANGEROUS_MASK = [
  P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels,
  P.ManageWebhooks, P.BanMembers, P.KickMembers
].reduce((a, p) => a | p, 0n);

const DRAFT_TTL = 15 * 60 * 1000;
const drafts = new Map(); // brouillons de /role-react create en attente du choix des rôles

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

// ── Rendu du message (carte moderne : titre, liste des rôles, boutons) ──
function buildMessage(guild, menu) {
  const lines = menu.roles.slice(0, MAX_ROLES).map(r => {
    const role = guild.roles.cache.get(r.roleId);
    const name = role ? `<@&${role.id}>` : '*(rôle supprimé)*';
    return `${r.emoji ? `${r.emoji} ` : '▸ '}${name}${r.description ? `  ·  ${r.description}` : ''}`;
  });
  const aide = menu.mode === 'single'
    ? '-# Un seul rôle à la fois • clique sur un bouton pour le prendre, clique à nouveau pour le retirer'
    : '-# Clique sur un bouton pour obtenir un rôle • clique à nouveau pour le retirer';

  const container = new ContainerBuilder().setAccentColor(COULEUR);
  const entete = [`## ${menu.title}`, menu.description].filter(Boolean).join('\n');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(entete.slice(0, 1500)));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n').slice(0, 2400) || '*Aucun rôle*'));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));

  const buttons = menu.roles.slice(0, MAX_ROLES).map(r => {
    const role = guild.roles.cache.get(r.roleId);
    const btn = new ButtonBuilder()
      .setCustomId(`rolereact:${menu.id}:${r.roleId}`)
      .setLabel((r.label || role?.name || 'Rôle').slice(0, 80))
      .setStyle(STYLES[r.style] || ButtonStyle.Secondary);
    if (r.emoji) btn.setEmoji(r.emoji);
    return btn;
  });
  for (let i = 0; i < buttons.length; i += 5) container.addActionRowComponents(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(aide));

  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function refreshMessage(guild, menu) {
  if (!menu.channelId || !menu.messageId) return false;
  const channel = guild.channels.cache.get(menu.channelId) || await guild.channels.fetch(menu.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  const msg = await channel.messages.fetch(menu.messageId).catch(() => null);
  if (!msg) return false;
  // Ancien message (embed ou menu déroulant) : Discord interdit de le convertir, on le remplace par le nouveau design
  if (!msg.flags?.has?.(MessageFlags.IsComponentsV2)) {
    const neuf = await channel.send(buildMessage(guild, menu)).catch(e => { console.error('[RoleReact] remplacement :', e.message); return null; });
    if (!neuf) return false;
    menu.messageId = neuf.id;
    sauver();
    await msg.delete().catch(() => {});
    return true;
  }
  await msg.edit(buildMessage(guild, menu)).catch(e => console.error('[RoleReact] édition :', e.message));
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
    .setName('role-react')
    .setDescription('🎭 Rôles par boutons : un message avec plusieurs boutons de rôles')
    .setDMPermission(false)
    .setDefaultMemberPermissions(P.ManageRoles)
    .addSubcommand(s => s.setName('create').setDescription('Créer et publier un message de rôles à boutons')
      .addStringOption(o => o.setName('titre').setDescription('Titre du menu').setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName('description').setDescription('Texte affiché au-dessus de la liste').setMaxLength(500))
      .addStringOption(o => o.setName('mode').setDescription('Plusieurs rôles ou un seul à la fois').addChoices(
        { name: 'Plusieurs rôles', value: 'multiple' }, { name: 'Un seul rôle à la fois', value: 'single' }))
      .addChannelOption(o => o.setName('salon').setDescription('Salon où publier (par défaut : ici)')))
    .addSubcommand(s => s.setName('add').setDescription('Ajouter un bouton de rôle à un message')
      .addStringOption(o => o.setName('menu').setDescription('Menu').setRequired(true).setAutocomplete(true))
      .addRoleOption(o => o.setName('role').setDescription('Rôle à ajouter').setRequired(true))
      .addStringOption(o => o.setName('label').setDescription('Texte affiché dans le menu (par défaut : nom du rôle)').setMaxLength(100))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji de l\'option'))
      .addStringOption(o => o.setName('description').setDescription('Courte description affichée dans le message').setMaxLength(100))
      .addStringOption(o => o.setName('couleur').setDescription('Couleur du bouton').addChoices(
        { name: 'Bleu', value: 'Primary' }, { name: 'Gris', value: 'Secondary' },
        { name: 'Vert', value: 'Success' }, { name: 'Rouge', value: 'Danger' })))
    .addSubcommand(s => s.setName('remove').setDescription('Retirer un bouton de rôle d\'un message')
      .addStringOption(o => o.setName('menu').setDescription('Menu').setRequired(true).setAutocomplete(true))
      .addRoleOption(o => o.setName('role').setDescription('Rôle à retirer').setRequired(true)))
    .addSubcommand(s => s.setName('delete').setDescription('Supprimer un message de rôles et ses boutons')
      .addStringOption(o => o.setName('menu').setDescription('Menu').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('list').setDescription('Lister les messages de rôles du serveur')),

  async autocomplete(interaction) {
    if (!interaction.guild) return interaction.respond([]);
    const focused = String(interaction.options.getFocused() || '').toLowerCase();
    const choices = Object.values(menusOf(interaction.guild.id))
      .filter(m => m && m.id && (String(m.title || '').toLowerCase().includes(focused) || String(m.id).includes(focused)))
      .slice(0, 25)
      .map(m => { const n = (m.roles || []).length; return { name: `${m.title || 'Menu'} (${n} rôle${n > 1 ? 's' : ''})`.slice(0, 100), value: String(m.id) }; });
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
      if (!all.length) return reply('Aucun message de rôles sur ce serveur. Crée-en un avec `/role-react create`.');
      return reply(all.map(m => `• **${m.title}** — ${m.roles.length} rôle(s) — ${m.mode === 'single' ? 'un seul rôle' : 'plusieurs rôles'} — ${m.channelId ? `<#${m.channelId}>` : 'non publié'}`).join('\n').slice(0, 1900));
    }

    if (sub === 'create') {
      if (Object.keys(menus).length >= MAX_MENUS_PAR_SERVEUR) return reply(`❌ Maximum ${MAX_MENUS_PAR_SERVEUR} messages de rôles par serveur.`);
      const channel = interaction.options.getChannel('salon') || interaction.channel;
      if (!channel?.isTextBased?.()) return reply('❌ Choisis un salon textuel.');
      const botPerms = channel.permissionsFor(guild.members.me);
      if (!botPerms?.has(P.ViewChannel) || !botPerms?.has(P.SendMessages) || !botPerms?.has(P.EmbedLinks)) {
        return reply(`❌ Je n'ai pas la permission d'envoyer des messages avec embed dans ${channel}.`);
      }
      // Brouillon gardé en mémoire le temps de choisir les rôles dans le sélecteur
      for (const [k, d] of drafts) if (Date.now() - d.at > DRAFT_TTL) drafts.delete(k);
      const draftId = crypto.randomBytes(4).toString('hex');
      drafts.set(draftId, {
        userId: interaction.user.id,
        guildId: guild.id,
        title: interaction.options.getString('titre').trim(),
        description: (interaction.options.getString('description') || '').trim(),
        mode: interaction.options.getString('mode') || 'multiple',
        channelId: channel.id,
        at: Date.now()
      });
      const select = new RoleSelectMenuBuilder()
        .setCustomId(`rolereact_pick:${draftId}`)
        .setPlaceholder(`Choisis les rôles (jusqu'à ${MAX_ROLES})…`)
        .setMinValues(1)
        .setMaxValues(MAX_ROLES);
      return interaction.reply({
        content: `🎭 Choisis **tous les rôles** à mettre en boutons dans ${channel} (jusqu'à ${MAX_ROLES}). Le message sera publié dès que tu valides.`,
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral
      });
    }

    // add / remove / delete : menu existant
    const menu = menus[interaction.options.getString('menu')];
    if (!menu) return reply('❌ Message introuvable (utilise l\'autocomplétion).');

    if (sub === 'add') {
      const role = interaction.options.getRole('role');
      if (menu.roles.some(r => r.roleId === role.id)) return reply('❌ Ce rôle est déjà dans ce message.');
      if (menu.roles.length >= MAX_ROLES) return reply(`❌ Un message contient au maximum ${MAX_ROLES} boutons.`);
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
        description: (interaction.options.getString('description') || '').trim() || null,
        style: interaction.options.getString('couleur') || 'Secondary'
      });
      sauver();
      const ok = await refreshMessage(guild, menu);
      return reply(ok ? `✅ ${role} ajouté au message **${menu.title}**.` : `⚠️ ${role} ajouté, mais le message est introuvable (supprimé ?). Recrée le menu avec \`/role-react create\`.`);
    }

    if (sub === 'remove') {
      const role = interaction.options.getRole('role');
      if (!menu.roles.some(r => r.roleId === role.id)) return reply('❌ Ce rôle n\'est pas dans ce message.');
      if (menu.roles.length <= 1) return reply('❌ Un message doit garder au moins un bouton. Utilise `/role-react delete` pour le supprimer.');
      menu.roles = menu.roles.filter(r => r.roleId !== role.id);
      sauver();
      await refreshMessage(guild, menu);
      return reply(`✅ ${role} retiré du message **${menu.title}**.`);
    }

    if (sub === 'delete') {
      delete menus[menu.id];
      sauver();
      const channel = guild.channels.cache.get(menu.channelId);
      const msg = channel?.isTextBased?.() ? await channel.messages.fetch(menu.messageId).catch(() => null) : null;
      if (msg) await msg.delete().catch(() => {});
      return reply(`🗑️ Message **${menu.title}** supprimé.`);
    }
  }
};

// ── Sélection d'un membre ───────────────────────────────────
async function handleSelect(interaction) {
  const parts = interaction.customId.split(':');
  const menuId = parts[1];
  const guild = interaction.guild;
  if (!guild) return;
  const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  const menu = menusOf(guild.id)[menuId];
  if (!menu) return reply('❌ Ce menu n\'existe plus.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = interaction.member?.roles?.cache ? interaction.member : await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return interaction.editReply('❌ Impossible de te retrouver sur le serveur.');

  const menuRoleIds = new Set(menu.roles.map(r => r.roleId));
  const picked = interaction.isButton() ? [parts[2]] : (interaction.values || []); // bouton, ou ancien menu déroulant déjà publié
  const selected = picked.filter(v => menuRoleIds.has(v));
  if (!selected.length) return interaction.editReply('Ce bouton n\'est plus valide.');

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


// ── Choix des rôles (sélecteur de /role-react create) ───────
async function handlePick(interaction) {
  const draftId = interaction.customId.split(':')[1];
  const d = drafts.get(draftId);
  if (!d || Date.now() - d.at > DRAFT_TTL) {
    drafts.delete(draftId);
    return interaction.update({ content: '❌ Cette sélection a expiré. Relance `/role-react create`.', components: [] });
  }
  if (interaction.user.id !== d.userId) {
    return interaction.reply({ content: '❌ Ce sélecteur n\'est pas le tien.', flags: MessageFlags.Ephemeral });
  }
  const guild = interaction.guild;
  if (!guild || guild.id !== d.guildId) return;

  const executor = interaction.member;
  const good = [];
  const bad = [];
  for (const id of interaction.values) {
    const role = guild.roles.cache.get(id) || await guild.roles.fetch(id).catch(() => null);
    const problem = roleProblem(guild, role, executor);
    if (problem) bad.push(`${role ? `<@&${role.id}>` : id} : ${problem}`); else good.push(role);
  }
  if (!good.length) {
    // On laisse le sélecteur affiché pour réessayer
    return interaction.update({ content: `❌ Aucun de ces rôles n'est utilisable :\n${bad.join('\n')}\n\nChoisis d'autres rôles.`.slice(0, 1900) });
  }

  await interaction.deferUpdate();
  const menus = menusOf(guild.id, true);
  if (Object.keys(menus).length >= MAX_MENUS_PAR_SERVEUR) {
    return interaction.editReply({ content: `❌ Maximum ${MAX_MENUS_PAR_SERVEUR} messages de rôles par serveur.`, components: [] });
  }
  const channel = guild.channels.cache.get(d.channelId) || await guild.channels.fetch(d.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return interaction.editReply({ content: '❌ Salon introuvable.', components: [] });

  const menu = {
    id: crypto.randomBytes(4).toString('hex'),
    title: d.title,
    description: d.description,
    mode: d.mode,
    channelId: channel.id,
    messageId: null,
    roles: good.map(role => ({ roleId: role.id, label: role.name.slice(0, 80), emoji: role.unicodeEmoji || null, description: null, style: 'Secondary' }))
  };
  const msg = await channel.send(buildMessage(guild, menu)).catch(e => { console.error('[RoleReact] envoi :', e.message); return null; });
  if (!msg) return interaction.editReply({ content: '❌ Impossible de publier le message dans ce salon (permissions ?).', components: [] });

  menu.messageId = msg.id;
  menus[menu.id] = menu;
  sauver();
  drafts.delete(draftId);
  const lignes = [`✅ Message **${menu.title}** publié dans ${channel} avec **${good.length}** bouton${good.length > 1 ? 's' : ''}.`];
  if (bad.length) lignes.push(`⚠️ Ignorés :\n${bad.join('\n')}`);
  lignes.push('Tu peux changer l\'emoji, le texte ou la couleur d\'un bouton : `/role-react remove` puis `/role-react add`.');
  return interaction.editReply({ content: lignes.join('\n').slice(0, 1900), components: [] });
}

function registerRoleMenus(client) {
  client.on('interactionCreate', interaction => {
    try {
      const ok = (interaction.isButton() && interaction.customId.startsWith('rolereact:'))
        || (interaction.isStringSelectMenu() && interaction.customId.startsWith('rolemenu:'));
      if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('rolereact_pick:')) {
        handlePick(interaction).catch(e => {
          if (e?.code !== 10062) console.error('[RoleReact] sélection des rôles :', e.message);
        });
        return;
      }
      if (ok) {
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

module.exports = { commands: [roleMenu], registerRoleMenus, _test: { parseEmoji, buildMessage, handlePick } };