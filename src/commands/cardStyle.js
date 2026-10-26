'use strict';

// ─────────────────────────────────────────────────────────────────────────
// /card-style — personnalisation des cartes image du serveur.
//
// Un seul panneau (Components V2, éphémère) :
//   • aperçu en direct (niveau + classement + carte de log)
//   • menu « Couleur » (presets) + bouton « Couleur perso » (hex)
//   • menu « Fond » (noir pur / profond / normal / doux / ardoise / bleu nuit / aurore / crépuscule)
//   • menu « Style des cartes » (néon / sobre sombre / clair / compact) — s'applique à TOUTES les cartes
//   • bouton « Réinitialiser »
// Le thème s'applique à TOUTES les cartes du serveur (voir core/cardTheme.js).
// Fichier autonome : gère ses propres interactions avec un collecteur.
// ─────────────────────────────────────────────────────────────────────────

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  AttachmentBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const T = require('../core/cardTheme');
const { generateLevelUpCard } = require('../handlers/levelUpImage');
const { renderRankingCard } = require('../core/rankingCard');
const { generateLogCardAsync } = require('../handlers/logCardImage');

const IDS = {
  preset: 'cardstyle_preset',
  bg: 'cardstyle_bgmode',
  look: 'cardstyle_look',
  custom: 'cardstyle_custom',
  reset: 'cardstyle_reset',
  modal: 'cardstyle_modal'
};

async function previews(guild, user) {
  const lvl = generateLevelUpCard({
    guildId: guild.id,
    username: user.username,
    badge: '',
    level: 12,
    totalXp: 5400,
    gainedXp: 25,
    source: 'message',
    currentXp: 300,
    neededXp: 700
  });
  const rank = renderRankingCard({
    guildId: guild.id,
    title: 'Classement',
    subtitle: 'Aperçu',
    badge: 'APERÇU',
    rows: [
      { name: user.username, value: '1 250 pts' },
      { name: 'Membre 2', value: '980 pts' },
      { name: 'Membre 3', value: '410 pts' }
    ]
  });
  const log = await generateLogCardAsync({
    guildId: guild.id,
    theme: 'green',
    title: '✨ Rôle créé',
    time: '02:28',
    blocks: [
      { label: 'Rôle', value: 'Giveaway Boat', dot: '#000000' },
      { label: 'Par', value: user.username },
      { label: 'Couleur', value: '#000000' },
      { label: 'Affiché séparément', value: 'Non' }
    ],
    footerLeft: 'ID 1562623544418897923',
    footerRight: String(guild.name || '').slice(0, 30)
  });
  return [
    new AttachmentBuilder(lvl, { name: 'apercu-niveau.png' }),
    new AttachmentBuilder(rank, { name: 'apercu-classement.png' }),
    new AttachmentBuilder(log, { name: 'apercu-log.png' })
  ];
}

async function panel(guild, user, notice = null) {
  const theme = T.getTheme(guild.id);
  const files = await previews(guild, user);
  const presetLabel = T.PRESETS[theme.preset]?.label || 'Personnalisée';

  const container = new ContainerBuilder().setAccentColor(T.containerAccent(guild.id, 0xFFFFFF));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 🎨 Style des cartes\n` +
      `La couleur s'applique à **toutes** les cartes du serveur (niveau, classements, giveaway, économie, starboard, panneaux de config…). Le style (néon / sobre / clair / compact / verre fumé) change aussi le look de toutes ces cartes, logs inclus.\n` +
      `**Couleur :** ${presetLabel} (\`${theme.accent.toUpperCase()}\`)` +
      `${theme.bg ? ` • **Fond :** \`${theme.bg.toUpperCase()}\`` : ''}` +
      ` • **Fond :** ${T.BG_MODES[theme.bgMode].label}` +
      `\n**Style des cartes :** ${T.LOOKS[theme.look].label}` +
      `${notice ? `\n\n${notice}` : ''}`
    )
  );
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('attachment://apercu-niveau.png'),
      new MediaGalleryItemBuilder().setURL('attachment://apercu-classement.png'),
      new MediaGalleryItemBuilder().setURL('attachment://apercu-log.png')
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(IDS.preset)
        .setPlaceholder('Choisir une couleur…')
        .addOptions(Object.entries(T.PRESETS).map(([key, p]) =>
          new StringSelectMenuOptionBuilder().setValue(key).setLabel(p.label).setEmoji(p.emoji).setDefault(key === theme.preset)
        ))
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(IDS.bg)
        .setPlaceholder('Fond des cartes…')
        .addOptions(Object.entries(T.BG_MODES).map(([key, m]) =>
          new StringSelectMenuOptionBuilder().setValue(key).setLabel(m.label).setDescription(m.desc).setDefault(key === theme.bgMode)
        ))
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(IDS.look)
        .setPlaceholder('Style des cartes (logs, niveau, classements…)')
        .addOptions(Object.entries(T.LOOKS).map(([key, m]) =>
          new StringSelectMenuOptionBuilder().setValue(key).setLabel(m.label).setDescription(m.desc).setEmoji(m.emoji).setDefault(key === theme.look)
        ))
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(IDS.custom).setLabel('Couleur perso (hex)').setEmoji('🖌️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(IDS.reset).setLabel('Réinitialiser').setEmoji('♻️').setStyle(ButtonStyle.Danger)
    )
  );

  return {
    components: [container],
    files,
    attachments: [],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  };
}

function customModal(theme) {
  const accent = new TextInputBuilder()
    .setCustomId('accent')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(7)
    .setPlaceholder('Ex : 3B82F6')
    .setValue(theme.accent.slice(1).toUpperCase());
  const bg = new TextInputBuilder()
    .setCustomId('bg')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(7)
    .setPlaceholder('Ex : 0B1020 — vide = fond assorti à la couleur');
  if (theme.bg) bg.setValue(theme.bg.slice(1).toUpperCase());

  return new ModalBuilder()
    .setCustomId(IDS.modal)
    .setTitle('Couleurs des cartes')
    .addLabelComponents(
      new LabelBuilder().setLabel('Couleur principale (hex)').setDescription('Bordures, barres, boutons, accents').setTextInputComponent(accent),
      new LabelBuilder().setLabel('Teinte du fond (hex, optionnel)').setDescription('Laisse vide pour un fond assorti').setTextInputComponent(bg)
    );
}

const cmd = {
  data: new SlashCommandBuilder()
    .setName('cartes-style')
    .setDescription('🎨 Personnaliser la couleur et le style des cartes du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    await interaction.editReply(await panel(guild, interaction.user));
    const message = await interaction.fetchReply();

    const collector = message.createMessageComponentCollector({
      time: 10 * 60 * 1000,
      filter: i => i.user.id === interaction.user.id
    });

    collector.on('collect', async i => {
      try {
        if (i.customId === IDS.preset) {
          T.applyPreset(guild.id, i.values[0]);
          // un preset remplace aussi une teinte de fond perso (sinon l'aperçu ne changerait pas comme attendu)
          T.setTheme(guild.id, { bg: null });
          await i.deferUpdate();
          return void await i.editReply(await panel(guild, interaction.user));
        }

        if (i.customId === IDS.bg) {
          T.setTheme(guild.id, { bgMode: i.values[0] });
          await i.deferUpdate();
          return void await i.editReply(await panel(guild, interaction.user));
        }

        if (i.customId === IDS.look) {
          T.setTheme(guild.id, { look: i.values[0] });
          await i.deferUpdate();
          return void await i.editReply(await panel(guild, interaction.user, `✅ Style des cartes : **${T.LOOKS[i.values[0]].label}**.`));
        }

        if (i.customId === IDS.reset) {
          T.resetTheme(guild.id);
          await i.deferUpdate();
          return void await i.editReply(await panel(guild, interaction.user, '♻️ Style réinitialisé (vert par défaut, style néon).'));
        }

        if (i.customId === IDS.custom) {
          await i.showModal(customModal(T.getTheme(guild.id)));
          const sub = await i.awaitModalSubmit({
            time: 5 * 60 * 1000,
            filter: m => m.customId === IDS.modal && m.user.id === i.user.id
          }).catch(() => null);
          if (!sub) return;

          const rawAccent = sub.fields.getTextInputValue('accent').trim();
          const rawBg = sub.fields.getTextInputValue('bg').trim();
          const accent = rawAccent ? T.normHex(rawAccent) : null;
          const bg = rawBg ? T.normHex(rawBg) : null;

          const problems = [];
          if (rawAccent && !accent) problems.push('couleur principale invalide');
          if (rawBg && !bg) problems.push('teinte du fond invalide');

          const patch = {};
          if (accent) { patch.accent = accent; patch.preset = 'perso'; }
          if (rawBg === '') patch.bg = null;
          else if (bg) patch.bg = bg;
          if (Object.keys(patch).length) T.setTheme(guild.id, patch);

          const notice = problems.length
            ? `⚠️ ${problems.join(' et ')} — format attendu : \`RRGGBB\` (ex. \`3B82F6\`).`
            : '✅ Couleurs enregistrées.';
          await sub.deferUpdate();
          return void await sub.editReply(await panel(guild, interaction.user, notice));
        }
      } catch (e) {
        console.error('[cartes-style]', e);
        if (!i.replied && !i.deferred) i.reply({ content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    });
  }
};

module.exports = { commands: [cmd] };