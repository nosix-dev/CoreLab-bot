'use strict';

// ─────────────────────────────────────────────────────────────────────────
// /discon : panneau DISCON (niveau de danger du serveur, de 5 à 1)
//  • choix du salon où poster le panneau public (ou création auto)
//  • salon vocal de statut dont le nom reflète le niveau (premium)
//  • boutons 5 → 1 pour changer le niveau (vérification, blocage des MP, verrouillage)
// customId : « discon:<action>[:<n>] » (routés depuis index.js → routeDisconInteraction)
// ─────────────────────────────────────────────────────────────────────────

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const discon = require('../core/discon');
const premium = require('../core/premium');

const SUPPORT_URL = process.env.SUPPORT_URL || 'https://discord.gg/WecpyxrSBT';
const DOCS_URL = process.env.DOCS_URL || 'https://corelab-4cn.pages.dev/docs';
const { NIVEAUX } = discon;

const txt = (c) => new TextDisplayBuilder().setContent(c);
const sep = (divider = true) => new SeparatorBuilder().setDivider(divider).setSpacing(SeparatorSpacingSize.Small);

function bareme() {
  return [5, 4, 3, 2, 1].map(n => `${NIVEAUX[n].pastille} **DISCON ${n}** ${NIVEAUX[n].nom} : ${NIVEAUX[n].effet}`).join('\n');
}

function blocNiveau(guildId, avecBoutons) {
  const niveau = discon.niveauActuel(guildId);
  const n = NIVEAUX[niveau];
  const c = new ContainerBuilder().setAccentColor(n.couleur);
  c.addTextDisplayComponents(txt(`### ${n.pastille} Niveau actuel\n> **DISCON ${niveau}** (${n.nom})`));
  if (avecBoutons) {
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
      [5, 4, 3, 2, 1].map(i => new ButtonBuilder()
        .setCustomId(`discon:level:${i}`)
        .setLabel(String(i))
        .setEmoji(NIVEAUX[i].pastille)
        .setStyle(i === niveau ? ButtonStyle.Primary : ButtonStyle.Secondary)),
    ));
  }
  c.addSeparatorComponents(sep());
  c.addTextDisplayComponents(txt(`### 🛡️ Barème des niveaux\n${bareme()}`));
  return c;
}

function construireConfig(guild) {
  const s = discon.etat(guild.id);
  const c = new ContainerBuilder().setAccentColor(0x5865F2);
  c.addTextDisplayComponents(txt('## 📡 Configuration DISCON\nChoisissez le salon où poster le panneau DISCON et, en option, un salon vocal dont le nom reflète le niveau courant.'));
  c.addSeparatorComponents(sep(false));

  c.addSectionComponents(new SectionBuilder()
    .addTextDisplayComponents(txt('### # Salon du panneau'))
    .setButtonAccessory(new ButtonBuilder().setCustomId('discon:mkpanel').setLabel('Créer le salon du panneau').setEmoji('➕').setStyle(ButtonStyle.Secondary)));
  const selPanel = new ChannelSelectMenuBuilder()
    .setCustomId('discon:panelch')
    .setPlaceholder('Salon du panneau')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (s.panelChannelId) selPanel.setDefaultChannels(s.panelChannelId);
  c.addActionRowComponents(new ActionRowBuilder().addComponents(selPanel));

  c.addSectionComponents(new SectionBuilder()
    .addTextDisplayComponents(txt('### ❗ Salon vocal de statut'))
    .setButtonAccessory(new ButtonBuilder().setCustomId('discon:mkstatus').setLabel('Créer le salon de statut').setEmoji('✨').setStyle(ButtonStyle.Primary)));
  c.addTextDisplayComponents(txt('-# ✨ Le salon vocal de statut du DISCON nécessite le premium.'));
  const selStatus = new ChannelSelectMenuBuilder()
    .setCustomId('discon:statusch')
    .setPlaceholder('Salon vocal de statut (optionnel)')
    .setChannelTypes(ChannelType.GuildVoice)
    .setMinValues(0).setMaxValues(1);
  if (s.statusChannelId) selStatus.setDefaultChannels(s.statusChannelId);
  c.addActionRowComponents(new ActionRowBuilder().addComponents(selStatus));

  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Serveur Support').setEmoji('💬').setStyle(ButtonStyle.Link).setURL(SUPPORT_URL),
    new ButtonBuilder().setLabel('Documentation').setEmoji('📖').setStyle(ButtonStyle.Link).setURL(DOCS_URL),
  ));

  return { components: [c, blocNiveau(guild.id, true)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

function construirePanneauPublic(guild) {
  return { components: [blocNiveau(guild.id, false).addTextDisplayComponents(txt('-# Niveau de danger du serveur, géré par le staff.'))], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function publierPanneau(guild) {
  const s = discon.etat(guild.id);
  if (!s.panelChannelId) return;
  const ch = guild.channels.cache.get(s.panelChannelId) || await guild.channels.fetch(s.panelChannelId).catch(() => null);
  if (!ch) return;
  const payload = construirePanneauPublic(guild);
  if (s.panelMessageId) {
    const m = await ch.messages.fetch(s.panelMessageId).catch(() => null);
    if (m) { await m.edit(payload).catch(() => {}); return; }
  }
  const m = await ch.send(payload);
  s.panelMessageId = m.id;
  discon.planifierSauvegarde();
}

async function verifierDroits(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: '❌ Il faut la permission **Gérer le serveur**.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return false;
  }
  return true;
}

async function routeDisconInteraction(interaction) {
  const [, action, arg] = interaction.customId.split(':');
  const guild = interaction.guild;
  if (!guild) return;
  if (!(await verifierDroits(interaction))) return;
  const s = discon.etat(guild.id);

  if (action === 'level') {
    await interaction.deferUpdate();
    await discon.appliquerNiveau(guild, Number(arg), `DISCON par ${interaction.user.tag}`);
    await publierPanneau(guild).catch(() => {});
    return interaction.editReply(construireConfig(guild));
  }

  if (action === 'panelch' || action === 'mkpanel') {
    await interaction.deferUpdate();
    try {
      if (action === 'mkpanel') {
        const c = await guild.channels.create({
          name: 'discon', type: ChannelType.GuildText,
          permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages] }],
          reason: 'DISCON — salon du panneau',
        });
        s.panelChannelId = c.id;
      } else {
        s.panelChannelId = interaction.values[0];
      }
      s.panelMessageId = null;
      discon.planifierSauvegarde();
      await publierPanneau(guild);
    } catch (e) {
      await interaction.followUp({ content: `❌ Impossible de poster le panneau : ${e.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return interaction.editReply(construireConfig(guild));
  }

  if (action === 'statusch' || action === 'mkstatus') {
    if (!(await premium.requierePremium(interaction))) return;
    await interaction.deferUpdate();
    try {
      if (action === 'mkstatus') await discon.creerSalonStatut(guild);
      else { s.statusChannelId = interaction.values[0] || null; discon.planifierSauvegarde(); await discon.majSalonStatut(guild); }
    } catch (e) {
      await interaction.followUp({ content: `❌ Salon de statut : ${e.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return interaction.editReply(construireConfig(guild));
  }
}

const cmd = {
  data: new SlashCommandBuilder()
    .setName('discon')
    .setDescription('Mettre en place le panneau DISCON de niveau de danger du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ content: '❌ Commande réservée aux serveurs.', flags: MessageFlags.Ephemeral });
    if (!(await verifierDroits(interaction))) return;
    return interaction.reply(construireConfig(interaction.guild));
  },
};

module.exports = [cmd];
module.exports.routeDisconInteraction = routeDisconInteraction;
