'use strict';

const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');
const store = require('../core/reputationStore');
const { renderRankingCard, resolveNames } = require('../core/rankingCard');
const { containerAccent } = require('../core/cardTheme');

const V2 = MessageFlags.IsComponentsV2;
const MEDAILLES = ['🥇', '🥈', '🥉'];

const data = new SlashCommandBuilder()
  .setName('reputation')
  .setDescription('🌟 Réputation : remercie un membre (+1 rep) et consulte le classement')
  .addSubcommand(sub => sub
    .setName('donner')
    .setDescription('🌟 Donner +1 de réputation à un membre (1 fois par jour)')
    .addUserOption(o => o.setName('membre').setDescription('Le membre à remercier').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Pourquoi ? (facultatif)').setMaxLength(100)))
  .addSubcommand(sub => sub
    .setName('voir')
    .setDescription('👤 Voir la réputation d\'un membre')
    .addUserOption(o => o.setName('membre').setDescription('Le membre (toi par défaut)')))
  .addSubcommand(sub => sub
    .setName('classement')
    .setDescription('🏆 Classement de la réputation du serveur'));

function refuser(interaction, texte) {
  return interaction.reply({ content: texte, flags: MessageFlags.Ephemeral });
}

function container(guildId, titre, corps) {
  return new ContainerBuilder()
    .setAccentColor(containerAccent(guildId, 0xFFFFFF))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(titre))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(corps));
}

// ── /reputation donner ──────────────────────────────────────────────────
async function donner(interaction) {
  const cible = interaction.options.getUser('membre', true);
  const raison = (interaction.options.getString('raison') || '').trim();
  const guildId = interaction.guild.id;

  if (cible.bot) return refuser(interaction, '❌ Les bots n\'ont pas besoin de réputation 🤖');
  if (cible.id === interaction.user.id) return refuser(interaction, '❌ Tu ne peux pas te donner de la réputation toi-même.');

  const restant = store.cooldownRestant(guildId, interaction.user.id);
  if (restant > 0) {
    const ts = Math.floor((Date.now() + restant) / 1000);
    return refuser(interaction, `⏳ Tu as déjà donné ta réputation du jour. Prochaine possibilité <t:${ts}:R> (<t:${ts}:t>).`);
  }

  const total = store.donner(guildId, interaction.user.id, cible.id);
  const rang = store.classement(guildId).findIndex(([uid]) => uid === cible.id) + 1;

  const corps =
    `<@${interaction.user.id}> a donné **+1 rep** à <@${cible.id}> !\n` +
    (raison ? `> 💬 ${raison.replace(/\n/g, ' ')}\n` : '') +
    `\n🌟 **${total}** rep au total • 🏆 rang **#${rang}**`;

  return interaction.reply({
    components: [container(guildId, '## 🌟 Réputation', corps)],
    flags: V2,
    allowedMentions: { users: [cible.id] },
  });
}

// ── /reputation voir ────────────────────────────────────────────────────
async function voir(interaction) {
  const user = interaction.options.getUser('membre') || interaction.user;
  const guildId = interaction.guild.id;

  if (user.bot) return refuser(interaction, '❌ Les bots n\'ont pas de réputation.');

  const p = store.profil(guildId, user.id);
  const rang = store.classement(guildId).findIndex(([uid]) => uid === user.id) + 1;

  let corps =
    `**🌟 Réputation reçue :** ${p.rep}\n` +
    `**🎁 Réputation donnée :** ${p.donnees}\n` +
    `**🏆 Rang :** ${rang ? `#${rang}` : 'non classé'}`;

  if (user.id === interaction.user.id) {
    const restant = store.cooldownRestant(guildId, user.id);
    if (restant > 0) {
      corps += `\n**⏳ Prochain don :** <t:${Math.floor((Date.now() + restant) / 1000)}:R>`;
    } else {
      corps += '\n**✅ Tu peux donner de la rep maintenant** avec `/reputation donner`';
    }
  }

  return interaction.reply({
    components: [container(guildId, `## 🌟 Réputation de ${user.globalName || user.username}`, corps)],
    flags: V2,
    allowedMentions: { parse: [] },
  });
}

// ── /reputation classement ──────────────────────────────────────────────
async function classement(interaction) {
  const guild = interaction.guild;
  await interaction.deferReply();

  const top = store.classement(guild.id).slice(0, 10);
  const noms = await resolveNames(guild, top.map(([uid]) => uid));
  const rows = top.map(([uid, rep]) => ({
    name: noms.get(uid),
    value: `${rep.toLocaleString('fr-FR')} rep`,
  }));

  // Pas d'embed ni de conteneur : on envoie uniquement l'image du classement
  if (!rows.length) {
    return interaction.editReply({ content: 'Personne n\'a encore de réputation. Lance-toi avec `/reputation donner` !' });
  }
  const buffer = renderRankingCard({
    guildId: guild.id,
    title: 'Classement Réputation',
    subtitle: `${rows.length} membre${rows.length > 1 ? 's' : ''}`,
    badge: 'REP',
    rows,
  });
  return interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'classement-reputation.png' })] });
}

async function execute(interaction) {
  if (!interaction.guild) return refuser(interaction, '❌ Cette commande fonctionne uniquement sur un serveur.');
  const sub = interaction.options.getSubcommand();
  if (sub === 'donner') return donner(interaction);
  if (sub === 'voir') return voir(interaction);
  if (sub === 'classement') return classement(interaction);
  return refuser(interaction, '❌ Sous-commande inconnue.');
}

module.exports = { data, execute };