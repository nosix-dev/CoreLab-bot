// src/commands/rp.js
'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const { getGuildBucket, persist } = require('../core/config');
const { toCV2Payload } = require('../core/componentsV2');
const {
  CATEGORIES_PERMIS,
  generateCarteIdentite,
  generatePermis,
  generatePasseport,
} = require('../handlers/rpCards');

// ────────────────────────────────────────────────
// Accès aux données RP (store global via getGuildBucket)
// ────────────────────────────────────────────────

function getRpBucket(guildId) {
  const bucket = getGuildBucket(guildId, 'rpData', { profiles: {} });
  if (!bucket.profiles) bucket.profiles = {};
  return bucket;
}

function getProfile(guildId, userId) {
  const bucket = getRpBucket(guildId);
  return bucket.profiles[String(userId)] || null;
}

function saveProfile(guildId, userId, fields) {
  const bucket = getRpBucket(guildId);
  const uid = String(userId);
  bucket.profiles[uid] = { ...(bucket.profiles[uid] || {}), ...fields };
  persist('rpData');
  return bucket.profiles[uid];
}

function deleteProfile(guildId, userId) {
  const bucket = getRpBucket(guildId);
  delete bucket.profiles[String(userId)];
  persist('rpData');
}

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

function dateNow() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function dateInYears(years) {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear() + years}`;
}

function randomDigits(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 10);
  return out;
}

function errEmbed(text) {
  return new EmbedBuilder().setColor(0xed4245).setDescription(`❌ ${text}`);
}

function okEmbed(text) {
  return new EmbedBuilder().setColor(0x57f287).setDescription(`✅ ${text}`);
}

// ────────────────────────────────────────────────
// Définition de la commande
// ────────────────────────────────────────────────

const data = new SlashCommandBuilder()
  .setName('rp')
  .setDescription("🪪 Roleplay : profil, carte d'identité, permis, passeport")

  // /rp create
  .addSubcommand(sub => sub
    .setName('creer')
    .setDescription('Créer ton profil RP')
    .addStringOption(o => o.setName('nom').setDescription('Nom RP').setRequired(true).setMaxLength(40))
    .addStringOption(o => o.setName('prenom').setDescription('Prénom RP').setRequired(true).setMaxLength(40))
    .addStringOption(o => o.setName('date_naissance').setDescription('Format JJ/MM/AAAA').setRequired(true).setMaxLength(10))
    .addStringOption(o => o
      .setName('sexe')
      .setDescription('Sexe')
      .setRequired(true)
      .addChoices(
        { name: 'Masculin', value: 'M' },
        { name: 'Féminin', value: 'F' },
      ))
    .addIntegerOption(o => o.setName('taille').setDescription('Taille en cm').setRequired(false).setMinValue(50).setMaxValue(250)))

  // /rp profile
  .addSubcommand(sub => sub
    .setName('profil')
    .setDescription('Voir un profil RP')
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(false)))

  // /rp delete
  .addSubcommand(sub => sub
    .setName('supprimer')
    .setDescription('Supprimer ton profil RP'))

  // /rp id-card view
  .addSubcommandGroup(g => g
    .setName('ci')
    .setDescription("Carte nationale d'identité")
    .addSubcommand(sub => sub
      .setName('voir')
      .setDescription("Afficher la carte d'identité")
      .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(false))))

  // /rp license view / ajouter / retirer
  .addSubcommandGroup(g => g
    .setName('permis')
    .setDescription('Permis de conduire')
    .addSubcommand(sub => sub
      .setName('voir')
      .setDescription('Afficher le permis')
      .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('ajouter')
      .setDescription('Ajouter une catégorie à ton permis')
      .addStringOption(o => o
        .setName('categorie')
        .setDescription('Catégorie à ajouter')
        .setRequired(true)
        .addChoices(...CATEGORIES_PERMIS.map(c => ({ name: c, value: c })))))
    .addSubcommand(sub => sub
      .setName('retirer')
      .setDescription('Retirer une catégorie de ton permis')
      .addStringOption(o => o
        .setName('categorie')
        .setDescription('Catégorie à retirer')
        .setRequired(true)
        .addChoices(...CATEGORIES_PERMIS.map(c => ({ name: c, value: c }))))))

  // /rp passport view
  .addSubcommandGroup(g => g
    .setName('passeport')
    .setDescription('Passeport')
    .addSubcommand(sub => sub
      .setName('voir')
      .setDescription('Afficher le passeport')
      .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(false))));

// ────────────────────────────────────────────────
// Exécution
// ────────────────────────────────────────────────

async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      embeds: [errEmbed('Cette commande doit être utilisée sur un serveur.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId = interaction.guild.id;
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  // ══════════ /rp create ══════════
  if (!group && sub === 'creer') {
    if (getProfile(guildId, interaction.user.id)) {
      return interaction.reply({
        embeds: [errEmbed("Tu as déjà un profil RP. Utilise `/rp delete` pour le recréer.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    const nom = interaction.options.getString('nom').trim();
    const prenom = interaction.options.getString('prenom').trim();
    const dateNaissance = interaction.options.getString('date_naissance').trim();
    const sexe = interaction.options.getString('sexe');
    const taille = interaction.options.getInteger('taille') || 170;

    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateNaissance)) {
      return interaction.reply({
        embeds: [errEmbed('Date de naissance invalide. Format attendu : `JJ/MM/AAAA`.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const numeroCi = randomDigits(9);
    const numeroPermis = randomDigits(10);
    const delivrance = dateNow();
    const expCI = dateInYears(10);       // CNI et passeport : +10 ans
    const expPermis = dateInYears(15);   // Permis : +15 ans

    saveProfile(guildId, interaction.user.id, {
      nom,
      prenom,
      dateNaissance,
      sexe,
      taille,
      nationalite: 'Française',
      numeroCi,
      numeroPermis,
      dateDelivrance: delivrance,
      dateExpiration: expCI,
      dateExpirationPermis: expPermis,
      permisCategories: '',
      createdAt: Date.now(),
    });

    const embed = new EmbedBuilder()
      .setTitle('✅ Profil RP créé')
      .setColor(0x57f287)
      .setDescription(
        `**${prenom} ${nom.toUpperCase()}**\n\n` +
        `Utilise \`/rp id-card view\` pour afficher ta carte d'identité.\n` +
        `Utilise \`/rp license view\` pour afficher ton permis.\n` +
        `Utilise \`/rp passport view\` pour afficher ton passeport.`
      )
      .setFooter({ text: `N° CI : ${numeroCi} • N° Permis : ${numeroPermis}` });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ══════════ /rp profile ══════════
  if (!group && sub === 'profil') {
    const target = interaction.options.getUser('membre') || interaction.user;
    const profile = getProfile(guildId, target.id);
    if (!profile) {
      return interaction.reply({
        embeds: [errEmbed(`**${target.username}** n'a pas de profil RP.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`📋 Profil RP de ${target.username}`)
      .setColor(0xFFFFFF)
      .setThumbnail(target.displayAvatarURL({ extension: 'png', size: 256 }))
      .addFields(
        { name: '👤 Nom complet', value: `${profile.prenom} ${profile.nom.toUpperCase()}`, inline: true },
        { name: '⚧ Sexe', value: profile.sexe === 'F' ? 'Féminin' : 'Masculin', inline: true },
        { name: '🎂 Date de naissance', value: profile.dateNaissance || '—', inline: true },
        { name: '📏 Taille', value: `${profile.taille} cm`, inline: true },
        { name: '🪪 N° CI', value: `\`${profile.numeroCi}\``, inline: true },
        { name: '🚗 N° Permis', value: `\`${profile.numeroPermis}\``, inline: true },
        { name: '📅 Délivré le', value: profile.dateDelivrance || '—', inline: true },
        { name: '⏳ Expire le', value: profile.dateExpiration || '—', inline: true },
        { name: '🎫 Catégories permis', value: profile.permisCategories || '*Aucune*', inline: false },
      );

    return interaction.reply(toCV2Payload({ embeds: [embed] }));
  }

  // ══════════ /rp delete ══════════
  if (!group && sub === 'supprimer') {
    if (!getProfile(guildId, interaction.user.id)) {
      return interaction.reply({
        embeds: [errEmbed("Tu n'as pas de profil RP à supprimer.")],
        flags: MessageFlags.Ephemeral,
      });
    }
    deleteProfile(guildId, interaction.user.id);
    return interaction.reply({
      embeds: [okEmbed('Ton profil RP a été supprimé.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ══════════ /rp id-card view ══════════
  if (group === 'ci' && sub === 'voir') {
    const target = interaction.options.getUser('membre') || interaction.user;
    const profile = getProfile(guildId, target.id);
    if (!profile) {
      return interaction.reply({
        embeds: [errEmbed(`**${target.username}** n'a pas de profil RP.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();
    try {
      const avatarUrl = target.displayAvatarURL({ extension: 'png', size: 256 });
      const buffer = await generateCarteIdentite(profile, avatarUrl);
      const file = new AttachmentBuilder(buffer, { name: 'carte-identite.png' });

      return interaction.editReply({ files: [file] });
    } catch (e) {
      console.error('[RP] Erreur génération CI :', e);
      return interaction.editReply({
        embeds: [errEmbed("Erreur lors de la génération de la carte d'identité.")],
      });
    }
  }

  // ══════════ /rp license view ══════════
  if (group === 'permis' && sub === 'voir') {
    const target = interaction.options.getUser('membre') || interaction.user;
    const profile = getProfile(guildId, target.id);
    if (!profile) {
      return interaction.reply({
        embeds: [errEmbed(`**${target.username}** n'a pas de profil RP.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();
    try {
      const avatarUrl = target.displayAvatarURL({ extension: 'png', size: 256 });
      // Pour le permis, on utilise la date d'expiration spécifique du permis
      const profileForPermis = {
        ...profile,
        dateExpiration: profile.dateExpirationPermis || profile.dateExpiration,
      };
      const buffer = await generatePermis(profileForPermis, avatarUrl);
      const file = new AttachmentBuilder(buffer, { name: 'permis.png' });

      return interaction.editReply({ files: [file] });
    } catch (e) {
      console.error('[RP] Erreur génération permis :', e);
      return interaction.editReply({
        embeds: [errEmbed('Erreur lors de la génération du permis.')],
      });
    }
  }

  // ══════════ /rp license add ══════════
  if (group === 'permis' && sub === 'ajouter') {
    const categorie = interaction.options.getString('categorie');
    const profile = getProfile(guildId, interaction.user.id);
    if (!profile) {
      return interaction.reply({
        embeds: [errEmbed("Tu n'as pas de profil RP. Utilise `/rp create` d'abord.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    const current = new Set((profile.permisCategories || '').split(',').filter(Boolean));
    if (current.has(categorie)) {
      return interaction.reply({
        embeds: [errEmbed(`Tu as déjà la catégorie **${categorie}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    current.add(categorie);
    saveProfile(guildId, interaction.user.id, {
      permisCategories: [...current].sort().join(','),
    });

    return interaction.reply({
      embeds: [okEmbed(`Catégorie **${categorie}** ajoutée à ton permis !`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ══════════ /rp license remove ══════════
  if (group === 'permis' && sub === 'retirer') {
    const categorie = interaction.options.getString('categorie');
    const profile = getProfile(guildId, interaction.user.id);
    if (!profile) {
      return interaction.reply({
        embeds: [errEmbed("Tu n'as pas de profil RP.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    const current = new Set((profile.permisCategories || '').split(',').filter(Boolean));
    if (!current.has(categorie)) {
      return interaction.reply({
        embeds: [errEmbed(`Tu n'as pas la catégorie **${categorie}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    current.delete(categorie);
    saveProfile(guildId, interaction.user.id, {
      permisCategories: [...current].sort().join(','),
    });

    return interaction.reply({
      embeds: [okEmbed(`Catégorie **${categorie}** retirée de ton permis.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ══════════ /rp passport view ══════════
  if (group === 'passeport' && sub === 'voir') {
    const target = interaction.options.getUser('membre') || interaction.user;
    const profile = getProfile(guildId, target.id);
    if (!profile) {
      return interaction.reply({
        embeds: [errEmbed(`**${target.username}** n'a pas de profil RP.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();
    try {
      const avatarUrl = target.displayAvatarURL({ extension: 'png', size: 256 });
      const buffer = await generatePasseport(profile, avatarUrl);
      const file = new AttachmentBuilder(buffer, { name: 'passeport.png' });

      return interaction.editReply({ files: [file] });
    } catch (e) {
      console.error('[RP] Erreur génération passeport :', e);
      return interaction.editReply({
        embeds: [errEmbed('Erreur lors de la génération du passeport.')],
      });
    }
  }

  return interaction.reply({
    embeds: [errEmbed('Sous-commande inconnue.')],
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute };