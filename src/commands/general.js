const fs = require('fs');
const path = require('path');
const { dossierPersistant, fichierPersistant } = require('../core/persistentPath');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
  ButtonStyle,
  ButtonBuilder,
  ActionRowBuilder,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder
} = require('discord.js');
const {
  store,
  persist
} = require('../core/data');
const {
  getGuildConfig
} = require('../core/config');
const {
  resolveYtChannelId,
  fetchLatestVideo
} = require('../tasks/youtube');
const {
  resolveMedalUserId,
  fetchLatestClip: fetchLatestMedalClip
} = require('../tasks/medal');
const {
  resolveTiktokUsername,
  fetchLatestVideo: fetchLatestTiktokVideo
} = require('../tasks/tiktok');
const {
  resolveTwitchUser
} = require('../tasks/twitch');
const {
  requirePremium,
  isPremium
} = require('../core/premium');
const {
  MAX_NOTIFICATIONS_GRATUIT,
  MAX_NOTIFICATIONS_PREMIUM,
  MAX_MESSAGES_IA_GRATUIT_PAR_JOUR,
  MAX_SAUVEGARDES_PREMIUM
} = require('../core/constants');
const {
  buildFormModal,
  pendingForms,
  pendingKey,
  buildFormManagerRows,
  normFormMeta,
  supprimerImageFormulaire
} = require('../handlers/ticket');
const {
  toCV2Payload
} = require("../core/componentsV2");
const {
  getLevelFromXp
} = require('../handlers/xpEngine');
const {
  generateXpLeaderboardImage
} = require('../handlers/xpLeaderboardImage');
const {
  generateGiveawayImage,
  generateGiveawayResultImage,
  generateGiveawayConfigImage
} = require('../handlers/giveawayImage');
function makeCommand(name, description, builder, execute, perms = null) {
  const data = new SlashCommandBuilder().setName(name).setDescription(description);
  if (builder) builder(data);
  if (perms) data.setDefaultMemberPermissions(perms);
  return {
    data,
    execute
  };
}
function getGuildBucket(guildId, bucket, defaultValue = []) {
  const id = String(guildId);
  if (!store[bucket]) store[bucket] = {};
  if (!store[bucket][id]) store[bucket][id] = defaultValue;
  return store[bucket][id];
}
function setGuildBucket(guildId, bucket, value) {
  const id = String(guildId);
  if (!store[bucket]) store[bucket] = {};
  store[bucket][id] = value;
  persist(bucket);
}
function parseDureeConcours(str) {
  const regex = /(\d+)\s*(j|d|h|m|s)/gi;
  let total = 0,
    found = false,
    match;
  const MULT = {
    j: 86400000,
    d: 86400000,
    h: 3600000,
    m: 60000,
    s: 1000
  };
  while ((match = regex.exec(str)) !== null) {
    found = true;
    total += parseInt(match[1], 10) * MULT[match[2].toLowerCase()];
  }
  return found ? total : null;
}
function ensureConfig(guildId) {
  const cfg = getGuildConfig(guildId);
  return cfg;
}

// ────────────────────────────────────────────────
// Stockage local de l'image des messages planifiés
// (une URL d'attachment Discord peut expirer, donc on
// télécharge le fichier sur le disque comme pour les tickets)
// Le dossier n'est créé qu'à la volée (pas au chargement du fichier)
// pour éviter tout blocage au démarrage du bot.
// ────────────────────────────────────────────────
const {
  generateStatsCard
} = require('../handlers/statsImage');
const DOSSIER_IMAGES_PLANIFICATION = dossierPersistant('src/data/scheduled_images', 'scheduled_images');
async function sauvegarderImagePlanificationLocalement(guildId, scheduleId, attachment) {
  if (!fs.existsSync(DOSSIER_IMAGES_PLANIFICATION)) fs.mkdirSync(DOSSIER_IMAGES_PLANIFICATION, {
    recursive: true
  });

  // On se base sur le contentType réel détecté par Discord plutôt que sur l'extension
  // du nom de fichier, qui peut être trompeuse (ex. un .bmp renommé en .png).
  const MIME_TO_EXT = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp'
  };
  const ext = MIME_TO_EXT[attachment.contentType?.toLowerCase()] || (path.extname(attachment.name || '') || '.png').toLowerCase();
  const nomFichier = `${guildId}_${scheduleId}${ext}`;
  const cheminFichier = path.join(DOSSIER_IMAGES_PLANIFICATION, nomFichier);
  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error(`Téléchargement image échoué (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(cheminFichier, buffer);
  return cheminFichier; // chemin complet, attendu par src/tasks/index.js (entry.imagePath)
}
function resolveTwitchChannelName(url) {
  const match = url.trim().match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
  return match ? match[1] : null;
}
function hexToColorInt(hex) {
  if (!hex) return null;
  const clean = String(hex).replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return parseInt(clean, 16);
}
const allDefinedCommands = [makeCommand('premium', 'Découvrez les avantages de CoreLab Premium 💎', null, async interaction => {
  const embed = new EmbedBuilder().setTitle('⭐ CoreLab Premium').setDescription('Débloquez des fonctionnalités avancées et des limites étendues :').setColor(0xFFFFFF).addFields({
    name: '🤖 Assistant IA',
    value: `Messages illimités par jour (au lieu de ${MAX_MESSAGES_IA_GRATUIT_PAR_JOUR}/jour)`,
    inline: false
  }, {
    name: '🔔 Notifications',
    value: `Suivi illimité de chaînes YouTube, Blog et Medal (au lieu de ${MAX_NOTIFICATIONS_GRATUIT})`,
    inline: false
  }, {
    name: '⭐ Badge Premium',
    value: 'Badge visible sur ta carte de niveau et ton profil économie',
    inline: false
  }, {
    name: '💾 Sauvegardes de serveur',
    value: `Fonctionnalité 100% Premium`,
    inline: false
  });
  await interaction.reply(toCV2Payload({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  }));
}), makeCommand('invite', '🚀 Invite CoreLab sur ton serveur', null, async interaction => {
  // Bannière gif réutilisée depuis assets/standard.gif (même visuel que le panneau !panel).
  // Remplace ce fichier par un gif dédié si tu veux un visuel différent pour /invite.
  const bannerPath = path.join(__dirname, '..', '..', 'assets', 'standard.gif');
  const bannerDisponible = fs.existsSync(bannerPath);
  const banner = bannerDisponible ? new AttachmentBuilder(bannerPath, {
    name: 'invite.gif'
  }) : null;
  const embed = new EmbedBuilder().setTitle('🚀 Invite CoreLab').setDescription('**CoreLab** débarque sur ton serveur : modération, tickets, XP, notifications, sondages et bien plus.\n\n' + '> Clique sur **Inviter le bot** ci-dessous pour l\'ajouter en quelques secondes.').setThumbnail(interaction.client.user.displayAvatarURL()).addFields({
    name: '🛠️ Fonctionnalités',
    value: 'Modération • Tickets • XP • Notifications • Sondages',
    inline: false
  }, {
    name: '🌐 Serveurs actifs',
    value: String(interaction.client.guilds.cache.size),
    inline: true
  }).setColor(0xFFFFFF).setFooter({
    text: 'CoreLab • Merci de nous faire confiance !',
    iconURL: interaction.client.user.displayAvatarURL()
  });
  if (bannerDisponible) embed.setImage('attachment://invite.gif');
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Inviter le bot').setEmoji('🔗').setStyle(ButtonStyle.Link).setURL(`https://discord.com/api/oauth2/authorize?client_id=${interaction.client.user.id}&permissions=8&scope=bot%20applications.commands`), new ButtonBuilder().setLabel('Serveur support').setEmoji('🛟').setStyle(ButtonStyle.Link).setURL('https://discord.gg/WecpyxrSBT'));
  await interaction.reply(toCV2Payload({
    embeds: [embed],
    components: [row],
    files: bannerDisponible ? [banner] : []
  }));
}), makeCommand('formulaire', '📋 Créer et gérer un formulaire réutilisable', data => data.addSubcommand(sub => sub.setName('creer').setDescription('🔒 Admin • Créer un nouveau formulaire').addStringOption(o => o.setName('nom').setDescription('Nom du formulaire').setRequired(true))).addSubcommand(sub => sub.setName('liste').setDescription('🔒 Admin • Voir les formulaires créés')).addSubcommand(sub => sub.setName('supprimer').setDescription('🔒 Admin • Supprimer un formulaire').addStringOption(o => o.setName('nom').setDescription('Nom du formulaire').setRequired(true))).addSubcommand(sub => sub.setName('repondre').setDescription('Remplir un formulaire').addStringOption(o => o.setName('nom').setDescription('Nom du formulaire').setRequired(true))), async interaction => {
  const sub = interaction.options.getSubcommand();
  const gid = String(interaction.guild.id);
  const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
  const slugify = nom => nom.trim().toLowerCase().replace(/\s+/g, '_');
  if (!store.formulaires) store.formulaires = {};
  if (!store.formulaires[gid]) store.formulaires[gid] = {};
  const registre = store.formulaires[gid];

  // ── Créer ────────────────────────────────────────
  if (sub === 'creer') {
    if (!isAdmin) return interaction.reply({
      content: '❌ Réservé aux admins (permission "Gérer le serveur").',
      flags: MessageFlags.Ephemeral
    });
    const nom = interaction.options.getString('nom').trim();
    const slug = slugify(nom);
    const formKey = `standalone_${slug}`;
    if (!store.ticketForms[gid]) store.ticketForms[gid] = {};
    if (store.ticketForms[gid][formKey]) {
      const existant = normFormMeta(registre[slug]);
      return interaction.reply({
        content: `⚠️ Un formulaire nommé **${existant?.nom || nom}** existe déjà.`,
        flags: MessageFlags.Ephemeral
      });
    }
    store.ticketForms[gid][formKey] = [];
    registre[slug] = {
      nom,
      image: null
    };
    persist('ticketForms');
    persist('formulaires');

    // Panneau de gestion — questions + image + publication (comme le système de tickets)
    const embed = new EmbedBuilder().setTitle('📋 Gestion du formulaire').setDescription(`Formulaire **${nom}**\n\n**Questions actuelles :** 0/50\n\n` + 'Ajoute des questions, puis publie le formulaire pour laisser les membres le remplir en cliquant sur un bouton (comme pour les tickets).').setColor(0xFFFFFF);
    return interaction.reply(toCV2Payload({
      embeds: [embed],
      components: buildFormManagerRows(formKey),
      flags: MessageFlags.Ephemeral
    }));
  }

  // ── Liste ────────────────────────────────────────
  if (sub === 'liste') {
    if (!isAdmin) return interaction.reply({
      content: '❌ Réservé aux admins (permission "Gérer le serveur").',
      flags: MessageFlags.Ephemeral
    });
    const slugs = Object.keys(registre);
    const lines = slugs.length ? slugs.map(slug => {
      const meta = normFormMeta(registre[slug]);
      const nbQuestions = (store.ticketForms[gid]?.[`standalone_${slug}`] || []).length;
      return `**${meta.nom}** — ${nbQuestions} question(s)${meta.image ? ' 🖼️' : ''}`;
    }).join('\n') : 'Aucun formulaire créé';
    return interaction.reply({
      content: `📋 Formulaires :\n${lines}`,
      flags: MessageFlags.Ephemeral
    });
  }

  // ── Supprimer ────────────────────────────────────
  if (sub === 'supprimer') {
    if (!isAdmin) return interaction.reply({
      content: '❌ Réservé aux admins (permission "Gérer le serveur").',
      flags: MessageFlags.Ephemeral
    });
    const nom = interaction.options.getString('nom').trim();
    const slug = slugify(nom);
    if (!registre[slug]) return interaction.reply({
      content: '❌ Formulaire introuvable.',
      flags: MessageFlags.Ephemeral
    });
    const meta = normFormMeta(registre[slug]);
    supprimerImageFormulaire(meta.image);
    delete store.ticketForms[gid]?.[`standalone_${slug}`];
    delete registre[slug];
    persist('ticketForms');
    persist('formulaires');
    return interaction.reply({
      content: `🗑️ Formulaire **${meta.nom}** supprimé.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // ── Répondre ─────────────────────────────────────
  if (sub === 'repondre') {
    const nom = interaction.options.getString('nom').trim();
    const slug = slugify(nom);
    const formKey = `standalone_${slug}`;
    const fields = store.ticketForms[gid]?.[formKey] || [];
    const meta = normFormMeta(registre[slug]);
    if (!meta) return interaction.reply({
      content: '❌ Formulaire introuvable.',
      flags: MessageFlags.Ephemeral
    });
    if (!fields.length) return interaction.reply({
      content: '❌ Ce formulaire ne contient encore aucune question.',
      flags: MessageFlags.Ephemeral
    });
    const key = pendingKey(interaction.user.id, 'standalone', slug);
    pendingForms.set(key, {
      reasonLabel: meta.nom,
      reasonValue: slug,
      panelChannelId: 'standalone',
      allFields: fields,
      answers: {},
      page: 1,
      standalone: true,
      targetChannelId: interaction.channel.id
    });
    return interaction.showModal(buildFormModal(meta.nom, fields, 1));
  }
}), makeCommand('formulaire-modifier', '📋 Rouvrir le panneau de gestion d\'un formulaire existant', data => data.addStringOption(o => o.setName('nom').setDescription('Nom du formulaire').setRequired(true)), async interaction => {
  const gid = String(interaction.guild.id);
  const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
  if (!isAdmin) return interaction.reply({
    content: '❌ Réservé aux admins (permission "Gérer le serveur").',
    flags: MessageFlags.Ephemeral
  });
  const nom = interaction.options.getString('nom').trim();
  const slug = nom.trim().toLowerCase().replace(/\s+/g, '_');
  const formKey = `standalone_${slug}`;
  if (!store.formulaires?.[gid]?.[slug]) {
    return interaction.reply({
      content: '❌ Formulaire introuvable. Utilise `/form list` pour voir les formulaires existants.',
      flags: MessageFlags.Ephemeral
    });
  }
  const meta = normFormMeta(store.formulaires[gid][slug]);
  const fields = store.ticketForms?.[gid]?.[formKey] || [];
  const embed = new EmbedBuilder().setTitle('📋 Gestion du formulaire').setDescription(`Formulaire **${meta.nom}**\n\n**Questions actuelles :** ${fields.length}/50\n` + `**Image :** ${meta.image ? '✅ Définie' : '❌ Aucune'}\n` + `**Apparence personnalisée :** ${meta.title || meta.description || meta.color !== undefined ? '✅ Configurée' : '❌ Par défaut'}\n\n` + 'Utilise les boutons pour gérer les questions, l\'image et la publication.').setColor(meta.color ?? 0xFFFFFF);
  return interaction.reply(toCV2Payload({
    embeds: [embed],
    components: buildFormManagerRows(formKey),
    flags: MessageFlags.Ephemeral
  }));
}, PermissionFlagsBits.ManageGuild), makeCommand('niveau', 'Voir votre niveau et votre XP', null, async interaction => {
  const embed = new EmbedBuilder().setTitle('📊 Niveau').setDescription('Système d\'XP prêt à l\'emploi.').setColor(0xFFFFFF);
  await interaction.reply(toCV2Payload({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  }));
}), makeCommand('classement', 'Classement XP du serveur', null, async interaction => {
  await interaction.deferReply();
  const xpData = store.xpData?.[String(interaction.guild.id)] || {};
  const ranking = Object.entries(xpData).map(([id, xp]) => [id, Number(xp) || 0]).filter(([, xp]) => xp > 0).sort((a, b) => b[1] - a[1]);
  const embed = new EmbedBuilder().setTitle('🏆 Classement XP').setColor(0xFFFFFF);
  const payload = { allowedMentions: { parse: [] } };
  let imageOnly = false;
  if (!ranking.length) {
    embed.setDescription('Aucune donnée disponible pour le moment.');
  } else {
    const top = ranking.slice(0, 10);
    // Récupère les pseudos du top 10 (cache puis fetch, repli sur l'ID)
    let members = new Map();
    try {
      members = await interaction.guild.members.fetch({ user: top.map(([id]) => id) });
    } catch { /* on utilisera le cache */ }
    const entries = top.map(([id, xp]) => {
      const m = members.get?.(id) || interaction.guild.members.cache.get(id);
      return {
        name: m?.displayName || m?.user?.username || `Membre ${id.slice(-4)}`,
        xp,
        level: getLevelFromXp(xp).level
      };
    });
    try {
      const buffer = await generateXpLeaderboardImage({
        guildId: interaction.guild.id,
        guildName: interaction.guild.name,
        entries,
        totalMembers: ranking.length
      });
      payload.files = [new AttachmentBuilder(buffer, { name: 'classement-xp.png' })];
      imageOnly = true;
    } catch (e) {
      // Repli : ancien affichage texte si la génération d'image échoue
      console.error('Erreur image classement XP :', e.message);
      const medals = ['🥇', '🥈', '🥉'];
      embed.setDescription(top.map(([id, xp], i) => `${medals[i] || `**${i + 1}.**`} <@${id}> — Niveau **${getLevelFromXp(xp).level}** · ${xp.toLocaleString('fr-FR')} XP`).join('\n'));
    }
    const myIndex = ranking.findIndex(([id]) => id === interaction.user.id);
    const posText = myIndex === -1 ? 'Tu n\'as pas encore d\'XP sur ce serveur.' : `Ta position : n°${myIndex + 1} sur ${ranking.length}`;
    embed.setFooter({ text: posText });
    if (imageOnly) payload.content = `-# ${posText}`;
  }
  if (imageOnly) {
    // Carte seule : pas d'embed
    await interaction.editReply(payload);
    return;
  }
  await interaction.editReply({
    ...toCV2Payload({ embeds: [embed] }),
    ...payload
  });
}), makeCommand('rappel', 'éfinir un rappel', data => data.addStringOption(o => o.setName('texte').setDescription('Texte du rappel').setRequired(true)).addStringOption(o => o.setName('temps').setDescription('Temps ex. : 10m').setRequired(true)), async interaction => {
  const text = interaction.options.getString('texte');
  const time = interaction.options.getString('temps');
  const bucket = getGuildBucket(interaction.guild.id, 'reminders', []);
  bucket.push({
    id: `${Date.now()}`,
    text: text,
    time: time,
    userId: interaction.user.id
  });
  setGuildBucket(interaction.guild.id, 'reminders', bucket);
  await interaction.reply({
    content: `⏰ Rappel enregistré : ${text}`,
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('rappels', 'Voir les rappels', null, async interaction => {
  const bucket = getGuildBucket(interaction.guild.id, 'reminders', []);
  const lines = bucket.length ? bucket.map((r, i) => `\`${i + 1}\` ${r.text} (${r.time})`).join('\n') : 'Aucun rappel';
  await interaction.reply({
    content: `⏰ Rappels :\n${lines}`,
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('rappel-retirer', 'Retirer un rappel', data => data.addIntegerOption(o => o.setName('numero').setDescription('Numéro du rappel').setRequired(true)), async interaction => {
  const num = interaction.options.getInteger('numero');
  const bucket = getGuildBucket(interaction.guild.id, 'reminders', []);
  if (!bucket[num - 1]) return interaction.reply({
    content: '❌ Numéro invalide.',
    flags: MessageFlags.Ephemeral
  });
  bucket.splice(num - 1, 1);
  setGuildBucket(interaction.guild.id, 'reminders', bucket);
  await interaction.reply({
    content: '🗑️ Rappel retiré.',
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator),
// (anciennes commandes evenement-creer / evenements / evenement-retirer supprimées :
//  remplacées par /event — voir src/commands/event.js et src/core/eventManager.js)
makeCommand('planifier', 'Planifier un message automatique et récurrent à heure fixe', data => data.addChannelOption(o => o.setName('salon').setDescription('Salon').addChannelTypes(ChannelType.GuildText).setRequired(true)).addIntegerOption(o => o.setName('intervalle').setDescription('Tous les combien (ex. : 1)').setRequired(true).setMinValue(1)).addStringOption(o => o.setName('unite').setDescription('Unité de récurrence').setRequired(true).addChoices({
  name: 'Secondes',
  value: 'second'
}, {
  name: 'Jours',
  value: 'day'
}, {
  name: 'Semaines',
  value: 'week'
}, {
  name: 'Mois',
  value: 'month'
})).addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)).addStringOption(o => o.setName('heure').setDescription('Heure de départ (format HH:MM) — ignorée si unité = Secondes').setRequired(false)).addAttachmentOption(o => o.setName('image').setDescription('Image à joindre au message (optionnel)').setRequired(false)), async interaction => {
  const channel = interaction.options.getChannel('salon');
  const interval = interaction.options.getInteger('intervalle');
  const unit = interaction.options.getString('unite');
  const message = interaction.options.getString('message');
  const timeInputRaw = interaction.options.getString('heure');
  const image = interaction.options.getAttachment('image');
  let hour = null;
  let minute = null;
  if (unit === 'second') {
    // Pas d'heure fixe nécessaire pour une récurrence en secondes : on ignore "heure" si fourni.
  } else if (!timeInputRaw) {
    return interaction.reply({
      content: '❌ Le champ `heure` est requis pour cette unité (uniquement facultatif avec `Secondes`).',
      flags: MessageFlags.Ephemeral
    });
  } else {
    const match = timeInputRaw.trim().match(/^(\d{1,2})[h:](\d{2})$/i);
    if (!match) {
      return interaction.reply({
        content: '❌ Format d\'heure invalide. Utilisez le format `HH:MM` (ex. : `08:00` ou `20:30`).',
        flags: MessageFlags.Ephemeral
      });
    }
    hour = parseInt(match[1], 10);
    minute = parseInt(match[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return interaction.reply({
        content: '❌ Heure invalide. Les heures vont de 00 à 23 et les minutes de 00 à 59.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
  if (image && !image.contentType?.startsWith('image/')) {
    return interaction.reply({
      content: '❌ Le fichier fourni n\'est pas une image valide.',
      flags: MessageFlags.Ephemeral
    });
  }
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });
  const UNIT_MS = {
    second: 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000 // approximation : 30 jours
  };
  const intervalMs = interval * UNIT_MS[unit];
  let nextRun;
  if (hour != null) {
    const now = new Date();
    nextRun = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0).getTime();
    if (nextRun <= Date.now()) nextRun += 24 * 60 * 60 * 1000; // si l'heure est déjà passée aujourd'hui, programmer pour demain
  } else {
    nextRun = Date.now() + intervalMs; // pas d'heure fixe : premier envoi après un intervalle
  }
  const scheduleId = `${Date.now()}`;
  let imagePath = null;
  if (image) {
    try {
      imagePath = await sauvegarderImagePlanificationLocalement(interaction.guild.id, scheduleId, image);
    } catch (e) {
      console.error('[Planifier] Erreur téléchargement image:', e.message);
      return interaction.editReply('❌ Échec du téléchargement de l\'image. Réessayez.');
    }
  }
  const scheduled = getGuildBucket(interaction.guild.id, 'scheduled', []);
  scheduled.push({
    id: scheduleId,
    message,
    channelId: channel.id,
    intervalMs,
    intervalValue: interval,
    intervalUnit: unit,
    hour,
    minute,
    imagePath,
    nextRun
  });
  setGuildBucket(interaction.guild.id, 'scheduled', scheduled);
  const UNIT_LABEL = {
    second: 'seconde(s)',
    day: 'jour(s)',
    week: 'semaine(s)',
    month: 'mois'
  };
  const heureTexte = hour != null ? ` à **${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}**` : '';
  await interaction.editReply({
    content: `✅ Planifié : le message sera envoyé tous les **${interval} ${UNIT_LABEL[unit]}**${heureTexte} dans ${channel}${imagePath ? ' (avec image jointe)' : ''}.`
  });
}, PermissionFlagsBits.Administrator), makeCommand('planification-liste', 'Voir les messages planifiés', null, async interaction => {
  const scheduled = getGuildBucket(interaction.guild.id, 'scheduled', []);
  const UNIT_LABEL = {
    second: 'seconde(s)',
    day: 'jour(s)',
    week: 'semaine(s)',
    month: 'mois'
  };
  const lines = scheduled.length ? scheduled.map((s, i) => {
    const heureTexte = s.hour != null ? ` à **${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}**` : '';
    return `\`${i + 1}\` ${s.message} → <#${s.channelId}> (tous les **${s.intervalValue} ${UNIT_LABEL[s.intervalUnit]}**${heureTexte})${s.imagePath ? ' 📎' : ''}`;
  }).join('\n') : 'Aucun message planifié';
  await interaction.reply({
    content: `📆 Messages planifiés :\n${lines}`,
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('planification-retirer', 'Retirer un message planifié', data => data.addIntegerOption(o => o.setName('numero').setDescription('Numéro').setRequired(true)), async interaction => {
  const idx = interaction.options.getInteger('numero') - 1;
  const scheduled = getGuildBucket(interaction.guild.id, 'scheduled', []);
  if (!scheduled[idx]) return interaction.reply({
    content: '❌ Message introuvable.',
    flags: MessageFlags.Ephemeral
  });
  const [removed] = scheduled.splice(idx, 1);
  setGuildBucket(interaction.guild.id, 'scheduled', scheduled);
  if (removed?.imagePath && fs.existsSync(removed.imagePath)) {
    try {
      fs.unlinkSync(removed.imagePath);
    } catch (e) {
      console.error('[Planifier] Erreur suppression image:', e.message);
    }
  }
  await interaction.reply({
    content: '🗑️ Message planifié retiré.',
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('purge-temp', 'Supprimer automatiquement les messages après un délai', data => data.addIntegerOption(o => o.setName('duree').setDescription('Durée (dans l\'unité choisie)').setRequired(true).setMinValue(1)).addStringOption(o => o.setName('unite').setDescription('Unité de la durée').setRequired(true).addChoices({
  name: 'Secondes',
  value: 'second'
}, {
  name: 'Minutes',
  value: 'minute'
}, {
  name: 'Jours',
  value: 'day'
}, {
  name: 'Mois',
  value: 'month'
})).addChannelOption(o => o.setName('salon').setDescription('Salon').addChannelTypes(ChannelType.GuildText).setRequired(true)), async interaction => {
  const cfg = ensureConfig(interaction.guild.id);
  const duree = interaction.options.getInteger('duree');
  const unite = interaction.options.getString('unite');
  const UNIT_MS = {
    second: 1000,
    minute: 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000
  }; // mois = approximation 30 jours
  cfg.temp_purge = {
    duration: duree,
    unit: unite,
    durationMs: duree * UNIT_MS[unite],
    channelId: interaction.options.getChannel('salon').id
  };
  persist('config');
  await interaction.reply({
    content: '✅ Purge automatique configurée.',
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('purge-temp-liste', 'Voir les salons avec purge automatique', null, async interaction => {
  const cfg = ensureConfig(interaction.guild.id);
  const UNIT_LABELS = {
    second: 'sec',
    minute: 'min',
    day: 'j',
    month: 'mois'
  };
  const info = cfg.temp_purge ? `<#${cfg.temp_purge.channelId}> (${cfg.temp_purge.duration} ${UNIT_LABELS[cfg.temp_purge.unit] || 'min'})` : 'Aucun';
  await interaction.reply({
    content: `🧹 Purge automatique : ${info}`,
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('purge-temp-retirer', 'Désactiver la purge automatique d\'un salon', null, async interaction => {
  const cfg = ensureConfig(interaction.guild.id);
  delete cfg.temp_purge;
  persist('config');
  await interaction.reply({
    content: '✅ Purge automatique retirée.',
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('roles-reaction', 'Gérer les rôles par bouton sur un message', data => data.addSubcommand(sub => sub.setName('ajouter').setDescription('Ajouter un bouton de rôle à un message').addStringOption(o => o.setName('id-message').setDescription('ID du message cible').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Rôle à attribuer').setRequired(true)).addStringOption(o => o.setName('nom-bouton').setDescription('Texte affiché sur le bouton').setRequired(false)).addStringOption(o => o.setName('emoji').setDescription('Emoji du bouton').setRequired(false)).addStringOption(o => o.setName('couleur').setDescription('Couleur du bouton').setRequired(false).addChoices({
  name: 'Bleu (Primary)',
  value: 'Primary'
}, {
  name: 'Gris (Secondary)',
  value: 'Secondary'
}, {
  name: 'Vert (Success)',
  value: 'Success'
}, {
  name: 'Rouge (Danger)',
  value: 'Danger'
}))).addSubcommand(sub => sub.setName('retirer').setDescription('Retirer un bouton de rôle').addIntegerOption(o => o.setName('numero').setDescription('Numéro (voir /reaction-roles list)').setRequired(true))).addSubcommand(sub => sub.setName('liste').setDescription('Voir les boutons de rôle configurés')), async interaction => {
  const sub = interaction.options.getSubcommand();
  const bucket = getGuildBucket(interaction.guild.id, 'buttonRoles', []);

  // ---------------------------
  // AJOUTER UN BOUTON
  // ---------------------------
  if (sub === 'ajouter') {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });
    const messageId = interaction.options.getString('id-message').trim();
    const role = interaction.options.getRole('role');
    const label = interaction.options.getString('nom-bouton') || role.name;
    const emoji = interaction.options.getString('emoji');
    const styleKey = interaction.options.getString('couleur') || 'Primary';
    let targetMessage;
    try {
      targetMessage = await interaction.channel.messages.fetch(messageId);
    } catch (e) {
      return interaction.editReply('❌ Message introuvable dans ce salon. Vérifiez l\'ID et le salon.');
    }

    // Vérification stricte : le bot doit être l'auteur
    if (targetMessage.author.id !== interaction.client.user.id) {
      return interaction.editReply('❌ Ce message n\'a pas été envoyé par CoreLab. Je ne peux ajouter des boutons qu\'à mes propres messages.');
    }

    // Vérification des permissions
    const perms = interaction.channel.permissionsFor(interaction.client.user);
    if (!perms.has('ManageMessages')) {
      return interaction.editReply('❌ J\'ai besoin de la permission **Gérer les messages** dans ce salon.');
    }
    const entry = {
      id: `${Date.now()}`,
      messageId: targetMessage.id,
      channelId: interaction.channel.id,
      roleId: role.id,
      label,
      emoji: emoji || null,
      style: styleKey
    };
    bucket.push(entry);
    setGuildBucket(interaction.guild.id, 'buttonRoles', bucket);
    const button = new ButtonBuilder().setCustomId(`rolebtn_${entry.id}`).setLabel(label).setStyle(ButtonStyle[styleKey] || ButtonStyle.Primary);
    if (emoji) button.setEmoji(emoji);
    const existingRows = targetMessage.components.map(row => ActionRowBuilder.from(row));
    let lastRow = existingRows[existingRows.length - 1];
    if (!lastRow || lastRow.components.length >= 5) {
      lastRow = new ActionRowBuilder();
      existingRows.push(lastRow);
    }
    lastRow.addComponents(button);
    if (existingRows.length > 5) {
      return interaction.editReply('❌ Ce message a déjà trop de boutons (5 lignes max).');
    }
    try {
      await targetMessage.edit({
        components: existingRows
      });
    } catch (e) {
      console.error('Erreur lors de la modification du message roles-react :', e.message);
      bucket.pop();
      setGuildBucket(interaction.guild.id, 'buttonRoles', bucket);
      return interaction.editReply('❌ Impossible de modifier ce message (permissions ou message non envoyé par le bot ?).');
    }
    await interaction.editReply(`✅ Bouton **${label}** → ${role} ajouté au message.`);
  }

  // ---------------------------
  // RETIRER UN BOUTON
  // ---------------------------
  else if (sub === 'retirer') {
    const idx = interaction.options.getInteger('numero') - 1;
    if (!bucket[idx]) return interaction.reply({
      content: '❌ Entrée introuvable.',
      flags: MessageFlags.Ephemeral
    });
    const entry = bucket[idx];
    try {
      const channel = await interaction.guild.channels.fetch(entry.channelId);
      const msg = await channel.messages.fetch(entry.messageId);
      const rows = msg.components.map(row => ActionRowBuilder.from(row)).map(row => {
        row.components = row.components.filter(c => c.data.custom_id !== `rolebtn_${entry.id}`);
        return row;
      }).filter(row => row.components.length > 0);
      await msg.edit({
        components: rows
      });
    } catch (e) {
      console.error('Erreur lors du retrait du bouton roles-react :', e.message);
    }
    bucket.splice(idx, 1);
    setGuildBucket(interaction.guild.id, 'buttonRoles', bucket);
    await interaction.reply({
      content: '🗑️ Bouton de rôle retiré.',
      flags: MessageFlags.Ephemeral
    });
  }

  // ---------------------------
  // LISTE
  // ---------------------------
  else {
    const lines = bucket.length ? bucket.map((e, i) => `\`${i + 1}\` ${e.label} → <@&${e.roleId}> (message \`${e.messageId}\`)`).join('\n') : 'Aucun bouton configuré';
    await interaction.reply({
      content: `🎭 Boutons de rôle :\n${lines}`,
      flags: MessageFlags.Ephemeral
    });
  }
}, PermissionFlagsBits.Administrator), makeCommand('notification', '⭐ Premium • Gérer les notifications YouTube, Twitch, Blog et Medal', data => data.addSubcommand(sub => sub.setName('ajouter').setDescription('⭐ Premium • Suivre une chaîne YouTube, Twitch, un blog ou un profil Medal').addStringOption(o => o.setName('plateforme').setDescription('Plateforme à suivre').setRequired(true).addChoices({
  name: 'YouTube Live',
  value: 'youtube-live'
}, {
  name: 'YouTube Vidéo',
  value: 'youtube-video'
}, {
  name: 'Twitch',
  value: 'twitch'
}, {
  name: 'Blog',
  value: 'blog'
}, {
  name: 'Medal',
  value: 'medal'
}, {
  name: 'TikTok',
  value: 'tiktok'
})).addStringOption(o => o.setName('url').setDescription('URL de la chaîne / du blog / du profil').setRequired(true)).addChannelOption(o => o.setName('salon').setDescription('Salon où poster les notifications').addChannelTypes(ChannelType.GuildText).setRequired(true))).addSubcommand(sub => sub.setName('liste').setDescription('⭐ Premium • Voir les notifications suivies').addStringOption(o => o.setName('plateforme').setDescription('Plateforme à afficher').setRequired(true).addChoices({
  name: 'YouTube Live',
  value: 'youtube-live'
}, {
  name: 'YouTube Vidéo',
  value: 'youtube-video'
}, {
  name: 'Twitch',
  value: 'twitch'
}, {
  name: 'Blog',
  value: 'blog'
}, {
  name: 'Medal',
  value: 'medal'
}, {
  name: 'TikTok',
  value: 'tiktok'
}))).addSubcommand(sub => sub.setName('retirer').setDescription('⭐ Premium • Retirer une notification suivie').addStringOption(o => o.setName('plateforme').setDescription('Plateforme concernée').setRequired(true).addChoices({
  name: 'YouTube Live',
  value: 'youtube-live'
}, {
  name: 'YouTube Vidéo',
  value: 'youtube-video'
}, {
  name: 'Twitch',
  value: 'twitch'
}, {
  name: 'Blog',
  value: 'blog'
}, {
  name: 'Medal',
  value: 'medal'
}, {
  name: 'TikTok',
  value: 'tiktok'
})).addIntegerOption(o => o.setName('numero').setDescription('Numéro (voir /settings notifications list)').setRequired(true))), async interaction => {
  const sub = interaction.options.getSubcommand();
  const platform = interaction.options.getString('plateforme');
  const bucketKeys = {
    'youtube-live': 'ytNotifs',
    'youtube-video': 'ytNotifs',
    twitch: 'twitchNotifs',
    blog: 'blogNotifs',
    medal: 'medalNotifs',
    tiktok: 'tiktokNotifs'
  };
  const bucketKey = bucketKeys[platform];

  // ---------------------------
  // AJOUTER
  // ---------------------------
  if (sub === 'ajouter') {
    // ── Quota Premium : nombre total de notifications suivies sur le serveur ──
    const premium = isPremium(interaction.user.id);
    const max = premium ? MAX_NOTIFICATIONS_PREMIUM : MAX_NOTIFICATIONS_GRATUIT;
    const totalSuivies = ['ytNotifs', 'twitchNotifs', 'blogNotifs', 'medalNotifs', 'tiktokNotifs']
      .reduce((sum, key) => sum + getGuildBucket(interaction.guild.id, key, []).length, 0);
    if (totalSuivies >= max) {
      return interaction.reply({
        content: `❌ Tu as atteint la limite de **${max}** notification(s) suivie(s)${premium ? '' : ' (passe en **Premium** pour en suivre en illimité)'}.\nRetire une notification existante avec \`/notification retirer\` pour en ajouter une nouvelle.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const url = interaction.options.getString('url').trim();
    const channel = interaction.options.getChannel('salon');
    if (platform === 'youtube-live' || platform === 'youtube-video') {
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });
      if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
        return interaction.editReply('❌ URL YouTube invalide.');
      }
      const ytChannelId = await resolveYtChannelId(url);
      if (!ytChannelId) {
        return interaction.editReply('❌ **URL YouTube invalide ou chaîne introuvable.**\n' + 'Formats acceptés : `https://www.youtube.com/channel/...`, `https://www.youtube.com/@...`, `https://www.youtube.com/c/...`, `https://www.youtube.com/user/...`, `https://www.youtube.com/watch?v=...`, `https://youtu.be/...`, ou `https://www.youtube.com/shorts/...`');
      }
      const bucket = getGuildBucket(interaction.guild.id, bucketKey, []);
      const notifType = platform === 'youtube-live' ? 'live' : 'video';
      if (bucket.some(n => n.ytChannelId === ytChannelId && n.channelId === channel.id && n.type === notifType)) {
        return interaction.editReply('⚠️ Déjà suivie dans ce salon.');
      }
      const latest = await fetchLatestVideo(ytChannelId);
      const channelName = latest ? latest.author : url;
      bucket.push({
        url,
        channelId: channel.id,
        ytChannelId,
        channelName,
        type: notifType,
        lastVideoId: latest ? latest.id : '',
        lastLiveId: ''
      });
      setGuildBucket(interaction.guild.id, bucketKey, bucket);
      const typeLabel = notifType === 'live' ? 'YouTube Live' : 'YouTube Vidéo';
      return interaction.editReply(`✅ Notifications ${typeLabel} activées pour **${channelName}** dans ${channel} !`);
    }
    if (platform === 'twitch') {
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });
      const twitchName = resolveTwitchChannelName(url) || url.replace(/^@/, '').trim();
      if (!twitchName) return interaction.editReply('❌ URL Twitch invalide.');
      const user = await resolveTwitchUser(twitchName);
      if (!user) {
        return interaction.editReply('❌ **Chaîne Twitch introuvable.**\n' + 'Vérifie l\'URL/le pseudo, ou que la variable `RAPIDAPI_KEY` est bien configurée.');
      }
      const bucket = getGuildBucket(interaction.guild.id, bucketKey, []);
      if (bucket.some(n => n.twitchName?.toLowerCase() === user.login.toLowerCase() && n.channelId === channel.id)) {
        return interaction.editReply('⚠️ Déjà suivie dans ce salon.');
      }
      bucket.push({
        twitchName: user.login,
        displayName: user.display_name,
        channelId: channel.id,
        wasLive: false
      });
      setGuildBucket(interaction.guild.id, bucketKey, bucket);
      return interaction.editReply(`✅ Notifications Twitch activées pour **${user.display_name}** dans ${channel} !`);
    }
    if (platform === 'blog') {
      const bucket = getGuildBucket(interaction.guild.id, bucketKey, []);
      bucket.push({
        url,
        channelId: channel.id
      });
      setGuildBucket(interaction.guild.id, bucketKey, bucket);
      return interaction.reply({
        content: `✅ Blog enregistré, les notifications seront postées dans ${channel}.`,
        flags: MessageFlags.Ephemeral
      });
    }
    if (platform === 'medal') {
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });
      const medalUserId = resolveMedalUserId(url);
      if (!medalUserId) {
        return interaction.editReply('❌ **URL Medal invalide.**\n' + 'Seul le format `https://medal.tv/users/ID` (ou l\'ID numérique seul) est accepté pour le moment. ' + 'Va sur ton profil Medal, clique dessus depuis un clip pour obtenir cette URL avec ton ID numérique.');
      }
      const bucket = getGuildBucket(interaction.guild.id, bucketKey, []);
      if (bucket.some(n => n.medalUserId === medalUserId && n.channelId === channel.id)) {
        return interaction.editReply('⚠️ Déjà suivi dans ce salon.');
      }
      const latest = await fetchLatestMedalClip(medalUserId);
      bucket.push({
        url,
        channelId: channel.id,
        medalUserId,
        lastClipId: latest ? latest.id : ''
      });
      setGuildBucket(interaction.guild.id, bucketKey, bucket);
      return interaction.editReply(`✅ Profil Medal enregistré, les notifications seront postées dans ${channel}.`);
    }
    if (platform === 'tiktok') {
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });
      const username = await resolveTiktokUsername(url);
      if (!username) {
        return interaction.editReply('❌ **URL TikTok invalide ou compte introuvable.**\n' + 'Formats acceptés : `https://www.tiktok.com/@pseudo`, un lien court `vm.tiktok.com/...`, ou directement `@pseudo`.');
      }
      const bucket = getGuildBucket(interaction.guild.id, bucketKey, []);
      if (bucket.some(n => n.username === username && n.channelId === channel.id)) {
        return interaction.editReply('⚠️ Déjà suivi dans ce salon.');
      }
      const latest = await fetchLatestTiktokVideo(username);
      bucket.push({
        url,
        channelId: channel.id,
        username,
        lastVideoId: latest ? latest.id : ''
      });
      setGuildBucket(interaction.guild.id, bucketKey, bucket);
      return interaction.editReply(`✅ Notifications TikTok activées pour **@${username}** dans ${channel} !`);
    }
  }

  // ---------------------------
  // LISTE
  // ---------------------------
  else if (sub === 'liste') {
    let bucket = getGuildBucket(interaction.guild.id, bucketKey, []);
    const labels = {
      'youtube-live': '📺 YouTube Live',
      'youtube-video': '📺 YouTube Vidéo',
      youtube: '📺 YouTube',
      twitch: '🟣 Twitch',
      blog: '📰 Blog',
      medal: '🎮 Medal',
      tiktok: '🎵 TikTok'
    };
    const nameKeys = {
      'youtube-live': 'channelName',
      'youtube-video': 'channelName',
      youtube: 'channelName',
      twitch: 'displayName',
      blog: 'url',
      medal: 'url',
      tiktok: 'username'
    };

    // Filtrer par type pour YouTube
    if (platform === 'youtube-live' || platform === 'youtube-video') {
      const filterType = platform === 'youtube-live' ? 'live' : 'video';
      bucket = bucket.filter(e => e.type === filterType);
    }

    const nameKey = nameKeys[platform];
    const lines = bucket.length ? bucket.map((e, i) => `\`${i + 1}\` ${e[nameKey] || e.url} → ${e.channelId ? `<#${e.channelId}>` : '⚠️ aucun salon (entrée héritée)'}`).join('\n') : 'Aucune notification suivie';
    return interaction.reply({
      content: `${labels[platform]} :\n${lines}`,
      flags: MessageFlags.Ephemeral
    });
  }

  // ---------------------------
  // RETIRER
  // ---------------------------
  else if (sub === 'retirer') {
    const numero = interaction.options.getInteger('numero') - 1;
    let bucket = getGuildBucket(interaction.guild.id, bucketKey, []);

    // Filtrer par type pour YouTube avant de traiter
    if (platform === 'youtube-live' || platform === 'youtube-video') {
      const filterType = platform === 'youtube-live' ? 'live' : 'video';
      const filteredBucket = bucket.filter(e => e.type === filterType);
      const targetEntry = filteredBucket[numero];
      if (!targetEntry) return interaction.reply({
        content: '❌ Entrée introuvable.',
        flags: MessageFlags.Ephemeral
      });
      // Supprimer l'entrée de l'original bucket
      const originalIdx = bucket.indexOf(targetEntry);
      bucket.splice(originalIdx, 1);
    } else {
      if (!bucket[numero]) return interaction.reply({
        content: '❌ Entrée introuvable.',
        flags: MessageFlags.Ephemeral
      });
      bucket.splice(numero, 1);
    }

    setGuildBucket(interaction.guild.id, bucketKey, bucket);
    return interaction.reply({
      content: '🗑️ Notification retirée.',
      flags: MessageFlags.Ephemeral
    });
  }
}, PermissionFlagsBits.Administrator),
// ────────────────────────────────────────────────
// PARTENARIAT — configuration (admin) + inscription (membres)
// /partenariat-config : titre, description, image, rôle
// ────────────────────────────────────────────────
makeCommand('partenariat-config', 'Configurer le partenariat (titre, description, image, rôle)', data => data.addStringOption(o => o.setName('titre').setDescription('Titre du partenariat').setRequired(true)).addStringOption(o => o.setName('description').setDescription('Description du partenariat').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Rôle attribué aux partenaires').setRequired(true)).addAttachmentOption(o => o.setName('image').setDescription('Image / bannière du partenariat (optionnel)').setRequired(false)), async interaction => {
  const titre = interaction.options.getString('titre').trim().slice(0, 256);
  const description = interaction.options.getString('description').trim().slice(0, 1024);
  const role = interaction.options.getRole('role');
  const image = interaction.options.getAttachment('image');
  if (image && !image.contentType?.startsWith('image/')) {
    return interaction.reply({
      content: '❌ Le fichier fourni n\'est pas une image valide.',
      flags: MessageFlags.Ephemeral
    });
  }
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });
  let imagePath = null;
  if (image) {
    try {
      imagePath = await sauvegarderImagePlanificationLocalement(interaction.guild.id, 'partenariat', image);
    } catch (e) {
      console.error('[Partenariat] Erreur téléchargement image :', e.message);
      return interaction.editReply('❌ Échec du téléchargement de l\'image. Réessayez.');
    }
  }
  const cfg = ensureConfig(interaction.guild.id);
  // Supprime l'ancienne image si elle est remplacée
  if (cfg.partnership?.imagePath && cfg.partnership.imagePath !== imagePath && fs.existsSync(cfg.partnership.imagePath)) {
    try {
      fs.unlinkSync(cfg.partnership.imagePath);
    } catch (e) {
      console.error('[Partenariat] Erreur suppression ancienne image :', e.message);
    }
  }
  cfg.partnership = {
    titre,
    description,
    roleId: role.id,
    imagePath,
    updatedAt: Date.now(),
    updatedBy: interaction.user.id
  };
  persist('config');
  await interaction.editReply({
    content: `✅ **Partenariat configuré !**\n` + `**Titre :** ${titre}\n` + `**Description :** ${description}\n` + `**Rôle :** ${role}\n` + `**Image :** ${image ? '✅ jointe' : '❌ aucune'}`
  });
}, PermissionFlagsBits.Administrator), makeCommand('partenariat-liste', 'Voir les partenaires enregistrés', null, async interaction => {
  const bucket = getGuildBucket(interaction.guild.id, 'partnerships', []);
  const cfg = ensureConfig(interaction.guild.id);
  const lines = bucket.length ? bucket.map((p, i) => `\`${i + 1}\` **${p.name}** — ${p.link ? `[Lien](${p.link})` : '❌ aucun lien'} — <@${p.userId}>`).join('\n') : 'Aucun partenaire enregistré';
  await interaction.reply({
    content: `🤝 **${cfg.partnership?.titre || 'Partenariat'}**\n${lines}`,
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('partenariat-statistiques', 'Voir les statistiques du partenariat', null, async interaction => {
  const bucket = getGuildBucket(interaction.guild.id, 'partnerships', []);
  const cfg = ensureConfig(interaction.guild.id);
  const roleInfo = cfg.partnership?.roleId ? `Rôle : <@&${cfg.partnership.roleId}>` : 'Rôle : ❌ non configuré';
  await interaction.reply({
    content: `📊 **${bucket.length}** partenaire(s) enregistré(s)\n${roleInfo}`,
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('partenariat-retirer', 'Retirer un partenaire', data => data.addIntegerOption(o => o.setName('numero').setDescription('Numéro (voir /settings partnership liste)').setRequired(true)), async interaction => {
  const idx = interaction.options.getInteger('numero') - 1;
  const bucket = getGuildBucket(interaction.guild.id, 'partnerships', []);
  const partner = bucket[idx];
  if (!partner) return interaction.reply({
    content: '❌ Partenaire introuvable.',
    flags: MessageFlags.Ephemeral
  });

  // Retire aussi le rôle partenaire au membre si possible
  const cfg = ensureConfig(interaction.guild.id);
  if (cfg.partnership?.roleId) {
    try {
      const membre = await interaction.guild.members.fetch(partner.userId).catch(() => null);
      if (membre) await membre.roles.remove(cfg.partnership.roleId);
    } catch (e) {/* rôle déjà absent ou membre parti */ }
  }
  bucket.splice(idx, 1);
  setGuildBucket(interaction.guild.id, 'partnerships', bucket);
  await interaction.reply({
    content: `🗑️ Partenaire **${partner.name}** retiré.`,
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('partenariat-reinitialiser', 'Réinitialiser les statistiques à zéro', null, async interaction => {
  setGuildBucket(interaction.guild.id, 'partnerships', []);
  await interaction.reply({
    content: '✅ Partenariats réinitialisés.',
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator),
// ────────────────────────────────────────────────
// PARTENARIAT AUTOMATIQUE — /partenariat configurer
// Dès qu'un lien d'invitation Discord est posté dans le salon
// configuré, l'annonce est publiée automatiquement (voir
// src/handlers/partnershipAuto.js pour la détection).
// ────────────────────────────────────────────────
makeCommand('partenariat', '🤝 Système de partenariat automatique (détection de lien d\'invitation)', data => data.addSubcommand(sub => sub.setName('configurer').setDescription('🔒 Admin • Configurer le salon de partenariat').addChannelOption(o => o.setName('salon').setDescription('Salon surveillé : un lien d\'invitation posté ici déclenche l\'annonce').addChannelTypes(ChannelType.GuildText).setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Rôle attribué automatiquement au partenaire').setRequired(false)).addStringOption(o => o.setName('titre').setDescription('Titre personnalisé de l\'annonce').setRequired(false)).addStringOption(o => o.setName('description').setDescription('Description personnalisée de l\'annonce').setRequired(false)).addAttachmentOption(o => o.setName('image').setDescription('Image / bannière de l\'annonce').setRequired(false))), async interaction => {
  const sub = interaction.options.getSubcommand();
  if (sub === 'configurer') {
    const salon = interaction.options.getChannel('salon');
    const role = interaction.options.getRole('role');
    const titre = interaction.options.getString('titre');
    const description = interaction.options.getString('description');
    const image = interaction.options.getAttachment('image');
    if (image && !image.contentType?.startsWith('image/')) {
      return interaction.reply({
        content: '❌ Le fichier fourni n\'est pas une image valide.',
        flags: MessageFlags.Ephemeral
      });
    }
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });
    const cfg = ensureConfig(interaction.guild.id);
    let imagePath = cfg.partenariatAuto?.imagePath || null;
    if (image) {
      try {
        imagePath = await sauvegarderImagePlanificationLocalement(interaction.guild.id, 'partenariat-auto', image);
      } catch (e) {
        console.error('[PartenariatAuto] Erreur téléchargement image :', e.message);
        return interaction.editReply('❌ Échec du téléchargement de l\'image. Réessayez.');
      }
    }
    cfg.partenariatAuto = {
      salonId: salon.id,
      roleId: role ? role.id : cfg.partenariatAuto?.roleId || null,
      titre: titre ?? cfg.partenariatAuto?.titre ?? null,
      description: description ?? cfg.partenariatAuto?.description ?? null,
      imagePath,
      updatedAt: Date.now(),
      updatedBy: interaction.user.id
    };
    persist('config');
    return interaction.editReply(`✅ **Partenariat automatique configuré !**\n` + `**Salon surveillé :** ${salon}\n` + `**Rôle attribué :** ${cfg.partenariatAuto.roleId ? `<@&${cfg.partenariatAuto.roleId}>` : '❌ aucun'}\n` + `**Titre :** ${cfg.partenariatAuto.titre || '*(par défaut)*'}\n` + `**Description :** ${cfg.partenariatAuto.description || '*(aucune)*'}\n` + `**Image :** ${cfg.partenariatAuto.imagePath ? '✅ définie' : '❌ aucune'}\n\n` + `Dès qu'un lien d'invitation Discord (\`discord.gg/...\`) sera posté dans ${salon}, l'annonce sera publiée automatiquement.`);
  }
}, PermissionFlagsBits.Administrator), makeCommand('sondage', 'Créer un sondage interactif', data => data.addStringOption(o => o.setName('question').setDescription('Question').setRequired(true)), async interaction => {
  const bucket = getGuildBucket(interaction.guild.id, 'polls', []);
  bucket.push({
    question: interaction.options.getString('question'),
    active: true
  });
  setGuildBucket(interaction.guild.id, 'polls', bucket);
  await interaction.reply({
    content: '✅ Sondage enregistré.',
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('sondage-fermer', 'Clore un sondage', data => data.addIntegerOption(o => o.setName('numero').setDescription('Numéro').setRequired(true)), async interaction => {
  const idx = interaction.options.getInteger('numero') - 1;
  const bucket = getGuildBucket(interaction.guild.id, 'polls', []);
  if (!bucket[idx]) return interaction.reply({
    content: '❌ Sondage introuvable.',
    flags: MessageFlags.Ephemeral
  });
  bucket[idx].active = false;
  setGuildBucket(interaction.guild.id, 'polls', bucket);
  await interaction.reply({
    content: '✅ Sondage clos.',
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('sondage-liste', 'Voir les sondages actifs', null, async interaction => {
  const bucket = getGuildBucket(interaction.guild.id, 'polls', []);
  const lines = bucket.length ? bucket.map((p, i) => `\`${i + 1}\` ${p.question} (${p.active ? 'actif' : 'clos'})`).join('\n') : 'Aucun sondage';
  await interaction.reply({
    content: `📊 Sondages :\n${lines}`,
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('concours', 'Lancer un giveaway', null, async interaction => {
  const state = {
    prize: null,
    durationMs: null,
    durationLabel: null,
    winnersCount: null,
    roleId: null,
    winMessage: null
  };
  const buildEmbed = () => new EmbedBuilder().setTitle('🎉 Configuration du giveaway').setDescription('Clique sur un bouton pour définir chaque information, puis confirme.').addFields({
    name: '🎁 Lot',
    value: state.prize || '*Non défini*'
  }, {
    name: '⏳ Durée',
    value: state.durationLabel || '*Non définie*',
    inline: true
  }, {
    name: '🏆 Gagnants',
    value: state.winnersCount ? String(state.winnersCount) : '*Non défini*',
    inline: true
  }, {
    name: '🔒 Rôle requis',
    value: state.roleId ? `<@&${state.roleId}>` : '*Aucun (facultatif)*',
    inline: true
  }, {
    name: '💬 Message gagnant',
    value: state.winMessage || '*Par défaut (facultatif)*'
  }).setColor(0xFFFFFF);
  const buildRows = () => [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cc_lot').setLabel('Lot').setEmoji('🎁').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('cc_duree').setLabel('Durée').setEmoji('⏳').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('cc_gagnants').setLabel('Gagnants').setEmoji('🏆').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('cc_role').setLabel('Rôle').setEmoji('🔒').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('cc_message').setLabel('Message').setEmoji('💬').setStyle(ButtonStyle.Secondary)), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cc_confirmer').setLabel('Confirmer').setEmoji('✅').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('cc_annuler').setLabel('Annuler').setEmoji('❌').setStyle(ButtonStyle.Danger))];
  // Panneau = carte image (comme /protect-settings) + boutons. Repli sur l'ancien embed si le rendu échoue.
  const buildPayload = () => {
    try {
      const roleName = state.roleId ? (interaction.guild.roles.cache.get(state.roleId)?.name || 'Rôle inconnu') : null;
      const card = generateGiveawayConfigImage({
        guildId: interaction.guild.id,
        prize: state.prize,
        durationLabel: state.durationLabel,
        winnersCount: state.winnersCount,
        roleName,
        winMessage: state.winMessage
      });
      const container = new ContainerBuilder().setAccentColor(0xFFFFFF);
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://concours-config.png')));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Clique sur un bouton pour définir chaque information, puis confirme.'));
      container.addActionRowComponents(...buildRows());
      return {
        components: [container],
        files: [new AttachmentBuilder(card, { name: 'concours-config.png' })],
        attachments: [],
        flags: MessageFlags.IsComponentsV2
      };
    } catch (e) {
      console.error('[Concours] Erreur image panneau :', e.message);
      return { ...toCV2Payload({ embeds: [buildEmbed()], components: buildRows() }), attachments: [] };
    }
  };
  const _p = buildPayload();
  await interaction.reply({
    ..._p,
    flags: _p.flags | MessageFlags.Ephemeral
  });
  const panelMsg = await interaction.fetchReply();
  const collector = panelMsg.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 10 * 60 * 1000
  });
  const demanderTexte = async (i, customId, titre, label, style = TextInputStyle.Short, valeurActuelle = '') => {
    const modal = new ModalBuilder().setCustomId(customId).setTitle(titre);
    const input = new TextInputBuilder().setCustomId('valeur').setLabel(label).setStyle(style).setRequired(true);
    if (valeurActuelle) input.setValue(String(valeurActuelle));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await i.showModal(modal);
    try {
      return await i.awaitModalSubmit({
        time: 5 * 60 * 1000,
        filter: m => m.user.id === interaction.user.id
      });
    } catch {
      return null;
    }
  };
  collector.on('collect', async i => {
    if (i.customId === 'cc_lot') {
      const s = await demanderTexte(i, 'cc_modal_lot', '🎁 Lot du giveaway', 'Quel est le lot à gagner ?', TextInputStyle.Short, state.prize);
      if (!s) return;
      state.prize = s.fields.getTextInputValue('valeur').trim().slice(0, 256);
      return s.update(buildPayload());
    }
    if (i.customId === 'cc_duree') {
      const s = await demanderTexte(i, 'cc_modal_duree', '⏳ Durée du giveaway', 'Ex. : 1j, 12h, 30m');
      if (!s) return;
      const brut = s.fields.getTextInputValue('valeur').trim();
      const ms = parseDureeConcours(brut);
      if (!ms || ms < 10000) return s.reply({
        content: '❌ Durée invalide. Ex. : `1j`, `12h`, `30m`, `1j12h`.',
        flags: MessageFlags.Ephemeral
      });
      state.durationMs = ms;
      state.durationLabel = brut;
      return s.update(buildPayload());
    }
    if (i.customId === 'cc_gagnants') {
      const s = await demanderTexte(i, 'cc_modal_gagnants', '🏆 Nombre de gagnants', 'Combien de gagnants ?', TextInputStyle.Short, state.winnersCount);
      if (!s) return;
      const nb = parseInt(s.fields.getTextInputValue('valeur').trim(), 10);
      if (!nb || nb < 1) return s.reply({
        content: '❌ Nombre invalide.',
        flags: MessageFlags.Ephemeral
      });
      state.winnersCount = nb;
      return s.update(buildPayload());
    }
    if (i.customId === 'cc_role') {
      const s = await demanderTexte(i, 'cc_modal_role', '🔒 Rôle requis (facultatif)', 'Mentionne le rôle ou son ID (vide = aucun)', TextInputStyle.Short, state.roleId ? `<@&${state.roleId}>` : '');
      if (!s) return;
      const brut = s.fields.getTextInputValue('valeur').trim();
      if (!brut) {
        state.roleId = null;
      } else {
        const idMatch = brut.match(/\d{15,25}/);
        const role = idMatch ? interaction.guild.roles.cache.get(idMatch[0]) : null;
        if (!role) return s.reply({
          content: '❌ Rôle introuvable.',
          flags: MessageFlags.Ephemeral
        });
        state.roleId = role.id;
      }
      return s.update(buildPayload());
    }
    if (i.customId === 'cc_message') {
      const s = await demanderTexte(i, 'cc_modal_message', '💬 Message gagnant (facultatif)', 'Message envoyé au(x) gagnant(s)', TextInputStyle.Paragraph, state.winMessage);
      if (!s) return;
      state.winMessage = s.fields.getTextInputValue('valeur').trim().slice(0, 500);
      return s.update(buildPayload());
    }
    if (i.customId === 'cc_annuler') {
      collector.stop('annule');
      return i.update(toCV2Payload({
        content: '❌ Création du giveaway annulée.',
        embeds: [],
        components: [],
        attachments: []
      }));
    }
    if (i.customId === 'cc_confirmer') {
      if (!state.prize || !state.durationMs || !state.winnersCount) {
        return i.reply({
          content: '❌ Renseigne au moins le **Lot**, la **Durée** et les **Gagnants** avant de confirmer.',
          flags: MessageFlags.Ephemeral
        });
      }
      collector.stop('confirme');
      const finTimestamp = Math.floor((Date.now() + state.durationMs) / 1000);
      const roleName = state.roleId ? (interaction.guild.roles.cache.get(state.roleId)?.name || null) : null;
      const giveawayEmbed = new EmbedBuilder().setTitle('🎉 CONCOURS 🎉').setDescription(`**Fin :** <t:${finTimestamp}:R>\n` + (state.roleId ? `**Rôle requis :** <@&${state.roleId}>\n` : '') + `\nClique sur 🎉 pour participer !`).setColor(0xFFFFFF).setFooter({
        text: `Organisé par ${interaction.user.tag}`
      }).setTimestamp();
      const giveawayFiles = [];
      try {
        const cardBuffer = await generateGiveawayImage({
          guildId: interaction.guild.id,
          prize: state.prize,
          winnersCount: state.winnersCount,
          endsAt: Date.now() + state.durationMs,
          roleName,
          hostName: interaction.user.globalName || interaction.user.username
        });
        giveawayFiles.push(new AttachmentBuilder(cardBuffer, { name: 'concours.png' }));
        giveawayEmbed.setImage('attachment://concours.png');
      } catch (e) {
        // Repli : ancien affichage texte si la génération d'image échoue
        console.error('[Concours] Erreur image :', e.message);
        giveawayEmbed.setDescription(`**Lot :** ${state.prize}\n**Gagnants :** ${state.winnersCount}\n` + `**Fin :** <t:${finTimestamp}:R>\n` + (state.roleId ? `**Rôle requis :** <@&${state.roleId}>\n` : '') + `\nClique sur 🎉 pour participer !`);
      }
      const giveawayId = `${Date.now()}`;
      const joinRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`concours_join_${giveawayId}`).setLabel('Participer').setEmoji('🎉').setStyle(ButtonStyle.Primary));
      // Carte seule (sans embed) ; embed uniquement en repli si l'image n'a pas pu être générée
      const giveawayMessage = await interaction.channel.send(giveawayFiles.length
        ? { files: giveawayFiles, components: [joinRow] }
        : toCV2Payload({ embeds: [giveawayEmbed], components: [joinRow] }));
      const bucket = getGuildBucket(interaction.guild.id, 'giveaways', []);
      bucket.push({
        id: giveawayId,
        prize: state.prize,
        winnersCount: state.winnersCount,
        roleId: state.roleId || null,
        winMessage: state.winMessage || null,
        channelId: interaction.channel.id,
        messageId: giveawayMessage.id,
        hostId: interaction.user.id,
        participants: [],
        endsAt: Date.now() + state.durationMs,
        active: true
      });
      setGuildBucket(interaction.guild.id, 'giveaways', bucket);
      setTimeout(() => terminerConcours(interaction.client, interaction.guild.id, giveawayId).catch(e => console.error('[Concours] Erreur:', e.message)), state.durationMs);
      await i.update(toCV2Payload({
        content: `✅ Giveaway lancé dans ${interaction.channel} !`,
        embeds: [],
        components: [],
        attachments: []
      }));
    }
  });
  collector.on('end', async (_c, reason) => {
    if (reason === 'time') {
      try {
        await interaction.editReply(toCV2Payload({
          content: '⌛ Temps écoulé.',
          embeds: [],
          components: [],
          attachments: []
        }));
      } catch { }
    }
  });
}, PermissionFlagsBits.Administrator), makeCommand('concours-liste', 'Voir les giveaways actifs', null, async interaction => {
  const bucket = getGuildBucket(interaction.guild.id, 'giveaways', []).filter(g => g.active);
  const lines = bucket.length ? bucket.map((g, i) => `\`${i + 1}\` ${g.prize} — ${g.winnersCount} gagnant(s), ${g.participants.length} participant(s) → <t:${Math.floor(g.endsAt / 1000)}:R>`).join('\n') : 'Aucun giveaway actif';
  await interaction.reply({
    content: `🎁 Giveaways :\n${lines}`,
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('concours-retirage', 'Retirer au sort un nouveau gagnant', data => data.addIntegerOption(o => o.setName('numero').setDescription('Numéro (parmi les giveaways terminés)').setRequired(true)), async interaction => {
  const idx = interaction.options.getInteger('numero') - 1;
  const bucket = getGuildBucket(interaction.guild.id, 'giveaways', []).filter(g => !g.active);
  const g = bucket[idx];
  if (!g) return interaction.reply({
    content: '❌ Giveaway introuvable ou encore en cours.',
    flags: MessageFlags.Ephemeral
  });
  const pool = g.participants || [];
  if (!pool.length) return interaction.reply({
    content: '❌ Aucun participant pour ce giveaway.',
    flags: MessageFlags.Ephemeral
  });
  const gagnant = pool[Math.floor(Math.random() * pool.length)];
  await interaction.reply({
    content: `🎉 Nouveau gagnant pour **${g.prize}** : <@${gagnant}> !`,
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('serveur-statistiques', 'Voir les statistiques du serveur', null, async interaction => {
  const embed = new EmbedBuilder().setTitle(`📊 Statistiques de ${interaction.guild.name}`).addFields({
    name: 'Membres',
    value: String(interaction.guild.memberCount),
    inline: true
  }, {
    name: 'Salons',
    value: String(interaction.guild.channels.cache.size),
    inline: true
  }, {
    name: 'Rôles',
    value: String(interaction.guild.roles.cache.size),
    inline: true
  }).setColor(0xFFFFFF);
  await interaction.reply(toCV2Payload({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  }));
}), makeCommand('membre-statistiques', 'Voir les statistiques d\'un membre', data => data.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)), async interaction => {
  const member = interaction.options.getMember('membre');
  const embed = new EmbedBuilder().setTitle(`📈 Statistiques de ${member.user.username}`).addFields({
    name: 'ID',
    value: String(member.id),
    inline: true
  }, {
    name: 'Rôles',
    value: String(member.roles.cache.size),
    inline: true
  }, {
    name: 'Arrivé le',
    value: `<t:${Math.floor(member.joinedAt / 1000)}:R>`,
    inline: true
  }).setColor(0xFFFFFF);
  await interaction.reply(toCV2Payload({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  }));
}), makeCommand('verrouiller', '🔒 Verrouiller un salon', data => data.addChannelOption(o => o.setName('salon').setDescription('Salon').addChannelTypes(ChannelType.GuildText).setRequired(true)), async interaction => {
  const channel = interaction.options.getChannel('salon');
  await channel.permissionOverwrites.edit(interaction.guild.id, {
    SendMessages: false
  });
  await interaction.reply({
    content: `🔒 Salon verrouillé : ${channel}.`,
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('deverrouiller', '🔓 Déverrouiller un salon', data => data.addChannelOption(o => o.setName('salon').setDescription('Salon').addChannelTypes(ChannelType.GuildText).setRequired(true)), async interaction => {
  const channel = interaction.options.getChannel('salon');
  await channel.permissionOverwrites.delete(interaction.guild.id);
  await interaction.reply({
    content: `🔓 Salon déverrouillé : ${channel}.`,
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('verrouillage-total', '🚨 Verrouiller TOUS les salons du serveur', null, async interaction => {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });
  const me = interaction.guild.members.me;
  let ok = 0;
  const echecs = [];
  for (const channel of interaction.guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) continue;
    if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageRoles)) {
      echecs.push(channel.id);
      continue;
    }
    try {
      await channel.permissionOverwrites.edit(interaction.guild.id, {
        SendMessages: false
      });
      ok++;
    } catch {
      echecs.push(channel.id);
    }
  }
  await interaction.editReply({
    content: `🚨 Lockdown activé sur ${ok} salon(s).` + (echecs.length ? `\n⚠️ Impossible de verrouiller : ${echecs.map(id => `<#${id}>`).join(', ')}` : '')
  });
}, PermissionFlagsBits.Administrator), makeCommand('deverrouillage-total', '✅ Déverrouiller TOUS les salons', null, async interaction => {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });
  const me = interaction.guild.members.me;
  let ok = 0;
  const echecs = [];
  for (const channel of interaction.guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) continue;
    if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageRoles)) {
      echecs.push(channel.id);
      continue;
    }
    try {
      await channel.permissionOverwrites.delete(interaction.guild.id);
      ok++;
    } catch {
      echecs.push(channel.id);
    }
  }
  await interaction.editReply({
    content: `✅ Lockdown désactivé sur ${ok} salon(s).` + (echecs.length ? `\n⚠️ Impossible de déverrouiller : ${echecs.map(id => `<#${id}>`).join(', ')}` : '')
  });
}, PermissionFlagsBits.Administrator), makeCommand('role-temporaire', 'Attribuer un rôle temporaire à un membre', data => data.addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)).addIntegerOption(o => o.setName('minutes').setDescription('Durée').setRequired(true)), async interaction => {
  const member = interaction.options.getMember('membre');
  const role = interaction.options.getRole('role');
  const minutes = interaction.options.getInteger('minutes');
  try {
    await member.roles.add(role);
    const bucket = getGuildBucket(interaction.guild.id, 'tempRoles', []);
    bucket.push({
      memberId: member.id,
      roleId: role.id,
      expiresAt: Date.now() + minutes * 60000
    });
    setGuildBucket(interaction.guild.id, 'tempRoles', bucket);
    setTimeout(async () => {
      try {
        await member.roles.remove(role);
      } catch { }
    }, minutes * 60000);
    await interaction.reply({
      content: `✅ Rôle temporaire attribué à ${member}.`,
      flags: MessageFlags.Ephemeral
    });
  } catch (e) {
    await interaction.reply({
      content: `❌ Impossible d'attribuer le rôle temporaire. Vérifiez les permissions du bot.`,
      flags: MessageFlags.Ephemeral
    });
  }
}, PermissionFlagsBits.Administrator), makeCommand('role-temporaire-liste', '📋 Voir les rôles temporaires actifs', null, async interaction => {
  const bucket = getGuildBucket(interaction.guild.id, 'tempRoles', []);
  const lines = bucket.length ? bucket.map((r, i) => `\`${i + 1}\` <@${r.memberId}> → <@&${r.roleId}>`).join('\n') : 'Aucun rôle temporaire';
  await interaction.reply({
    content: `📋 Rôles temporaires :\n${lines}`,
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('role-temporaire-retirer', '🗑️ Retirer manuellement un rôle temporaire', data => data.addIntegerOption(o => o.setName('numero').setDescription('Numéro').setRequired(true)), async interaction => {
  const idx = interaction.options.getInteger('numero') - 1;
  const bucket = getGuildBucket(interaction.guild.id, 'tempRoles', []);
  if (!bucket[idx]) return interaction.reply({
    content: '❌ Entrée introuvable.',
    flags: MessageFlags.Ephemeral
  });
  bucket.splice(idx, 1);
  setGuildBucket(interaction.guild.id, 'tempRoles', bucket);
  await interaction.reply({
    content: '🗑️ Rôle temporaire retiré.',
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('reglement', 'Publier le règlement avec sélection de rôle(s)', data => data.addAttachmentOption(o => o.setName('image').setDescription('Image à afficher en bas du règlement').setRequired(false)), async interaction => { }, PermissionFlagsBits.Administrator), makeCommand('config-annonce', 'Définir le salon pour les annonces globales', data => data.addChannelOption(o => o.setName('salon').setDescription('Salon').addChannelTypes(ChannelType.GuildText).setRequired(true)), async interaction => {
  const cfg = ensureConfig(interaction.guild.id);
  cfg.announce_channel_id = interaction.options.getChannel('salon').id;
  persist('config');
  await interaction.reply({
    content: '✅ Salon d\'annonces défini.',
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('suggestion', 'Soumettre une suggestion au staff 💡', data => data.addStringOption(o => o.setName('suggestion').setDescription('Suggestion').setRequired(true)).addAttachmentOption(o => o.setName('image1').setDescription('Image 1 (optionnel)').setRequired(false)).addAttachmentOption(o => o.setName('image2').setDescription('Image 2 (optionnel)').setRequired(false)).addAttachmentOption(o => o.setName('image3').setDescription('Image 3 (optionnel)').setRequired(false)).addAttachmentOption(o => o.setName('image4').setDescription('Image 4 (optionnel)').setRequired(false)), async interaction => {
  const suggestion = interaction.options.getString('suggestion');
  const cfg = ensureConfig(interaction.guild.id);
  const channelId = cfg.suggestion_channel_id;
  if (!channelId) return interaction.reply({
    content: '❌ Aucun salon de suggestions configuré.',
    flags: MessageFlags.Ephemeral
  });
  const channel = interaction.guild.channels.cache.get(String(channelId));
  if (!channel?.send) return interaction.reply({
    content: '❌ Salon introuvable.',
    flags: MessageFlags.Ephemeral
  });
  const images = [];
  for (let i = 1; i <= 4; i++) {
    const img = interaction.options.getAttachment(`image${i}`);
    if (img) images.push(img);
  }
  for (const img of images) {
    if (!img.contentType?.startsWith('image/')) {
      return interaction.reply({
        content: `❌ Le fichier « ${img.name} » n'est pas une image valide.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
  // Carte « verre fumé » : suggestion + avatar de l'auteur (1re image en bannière, les suivantes en pièces jointes)
  const suggestionEmbed = new EmbedBuilder().setTitle('💡 Suggestion').setDescription(suggestion).setColor(0xFFFFFF)
    .setFooter({ text: `Proposée par ${interaction.member?.displayName || interaction.user.username}` }).setTimestamp();
  if (images[0]) suggestionEmbed.setImage(images[0].url);
  await channel.send(await require('../core/glassEmbed').glassPayload({ embeds: [suggestionEmbed] }, {
    guild: interaction.guild, client: interaction.client, badge: 'SUGGESTION',
    avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 256 })
  }));
  if (images.length > 1) {
    await channel.send({ files: images.slice(1).map(img => ({ attachment: img.url, name: img.name })) }).catch(() => { });
  }
  await interaction.reply({
    content: '✅ Suggestion envoyée.',
    flags: MessageFlags.Ephemeral
  });
}, PermissionFlagsBits.Administrator), makeCommand('texte-vocal', 'Convertir du texte en message vocal', data => data.addStringOption(o => o.setName('texte').setDescription('Texte').setRequired(true)), async interaction => {
  await interaction.reply({
    content: interaction.options.getString('texte'),
    tts: true
  });
})];
const prefixCommands = {
  fix_role: async message => {
    await message.reply('🔧 Réparation des rôles disponible depuis la nouvelle version JS.');
  },
  hug: async message => {
    await message.reply('💛 Câlin envoyé !');
  },
  hugs: async message => {
    await message.reply('💛 Câlin envoyé !');
  },
  comfort: async message => {
    await message.reply('🫶 Réconfort disponible.');
  },
  emojis: async (message, client) => {
    if (message.guild) return; // MP uniquement
    if (message.author.id !== '1252736157285093397') return;
    try {
      const emojis = await client.application.emojis.fetch();
      if (!emojis.size) {
        return message.channel.send('Aucun emoji d\'application trouvé pour le moment.');
      }
      const lignes = emojis.map(e => `\`${e.name}\` — id: \`${e.id}\`${e.animated ? ' (animé)' : ''}`);
      // Découpage par blocs de 30 lignes pour rester sous la limite de 2000 caractères
      const blocs = [];
      for (let i = 0; i < lignes.length; i += 30) blocs.push(lignes.slice(i, i + 30).join('\n'));
      await message.channel.send(`🖼️ **${emojis.size} emoji(s) d'application :**`);
      for (const bloc of blocs) {
        await message.channel.send(bloc);
      }
    } catch (e) {
      console.error('[!emojis] Erreur:', e.message);
      await message.channel.send(`❌ Erreur lors de la récupération : ${e.message}`);
    }
  },
  stats: async (message, client) => {
    if (message.guild) return; // MP uniquement
    if (message.author.id !== '1252736157285093397') return;
    const totalServers = client.guilds.cache.size;
    const totalMembers = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
    const embed = new EmbedBuilder().setColor(0xFFFFFF);
    let files = [];
    try {
      const buffer = generateStatsCard({
        botName: client.user.username,
        servers: totalServers,
        members: totalMembers
      });
      files = [new AttachmentBuilder(buffer, {
        name: 'stats.png'
      })];
    } catch (imgError) {
      console.error('Erreur de génération de la carte !stats :', imgError.message);
      // Repli sans image : les deux chiffres en champs d'embed
      embed.setTitle('📊 Statistiques CoreLab').addFields({
        name: '🌍 Serveurs',
        value: totalServers.toLocaleString('fr-FR'),
        inline: true
      }, {
        name: '👥 Membres',
        value: totalMembers.toLocaleString('fr-FR'),
        inline: true
      });
    }
    // Carte seule (sans embed) ; embed uniquement en repli si la carte n'a pas pu être générée
    await message.channel.send(files.length ? { files } : { embeds: [embed] });
  },
  premium: async message => {
    if (message.guild) return; // MP uniquement
    if (message.author.id !== '1252736157285093397') return;
    const users = store.premium.users || {};
    const lines = Object.entries(users).map(([id, entry]) => `<@${id}> — ${entry.active ? '✅ actif' : '❌ inactif'}${entry.expires_at ? ` (expire <t:${Math.floor(new Date(entry.expires_at).getTime() / 1000)}:R>)` : ''}`);
    const embed = new EmbedBuilder().setTitle('⭐ Membres Premium').setDescription(lines.length ? lines.join('\n') : 'Aucun membre premium.').setColor(0xFFFFFF);
    await message.channel.send(toCV2Payload({
      embeds: [embed]
    }));
  },
  delete: async (message, client) => {
    if (message.guild) return; // MP uniquement
    if (message.author.id !== '1252736157285093397') return;
    const args = message.content.slice('!delete'.length).trim().split(/\s+/).filter(Boolean);
    const guilds = [...client.guilds.cache.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!args.length) {
      const lines = guilds.map((g, index) => `\`${index + 1}.\` **${g.name}** — ${g.memberCount} membres | ID : \`${g.id}\``);
      const embed = new EmbedBuilder().setTitle('🗑️ Quitter un serveur').setDescription(lines.length ? lines.slice(0, 50).join('\n') : 'Aucun serveur.').setFooter({
        text: 'Utilisez !delete <numéro> pour faire quitter CoreLab du serveur correspondant.'
      }).setColor(0xFFFFFF);
      return message.channel.send(toCV2Payload({
        embeds: [embed]
      }));
    }
    const index = parseInt(args[0], 10);
    if (!Number.isInteger(index) || index < 1 || index > guilds.length) {
      return message.channel.send('❌ Numéro invalide. Utilisez `!delete` pour voir la liste des serveurs.');
    }
    const targetGuild = guilds[index - 1];
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`botleave_confirm_${targetGuild.id}`).setLabel('Confirmer').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('botleave_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary));
    const embed = new EmbedBuilder().setTitle('⚠️ Confirmation requise').setDescription(`CoreLab va quitter **${targetGuild.name}** (\`${targetGuild.id}\`, ${targetGuild.memberCount} membres).\nConfirmez-vous ?`).setColor(0xE74C3C);
    return message.channel.send(toCV2Payload({
      embeds: [embed],
      components: [row]
    }));
  },
  // ==================== COMMANDE !message CORRIGÉE ====================
  message: async message => {
    if (!message.guild) return; // serveur uniquement
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Vous n\'avez pas la permission.');
    }
    const text = message.content.slice('!message'.length).trim();
    const attachments = [...message.attachments.values()];
    if (!text && !attachments.length) {
      return message.reply('❌ Utilisez `!message votre texte` (vous pouvez aussi joindre un fichier : image, vidéo, audio…, avec ou sans texte).');
    }
    const payload = {};
    if (text) payload.content = text;
    if (attachments.length) payload.files = attachments.map(a => new AttachmentBuilder(a.url, {
      name: a.name
    }));
    await message.channel.send(payload);
    try {
      await message.delete();
    } catch (e) {
      console.error('Impossible de supprimer le message !message :', e.message);
    }
  },
  // ==================== COMMANDE !message-edit ====================
  // Usage : répondre à un message du bot avec `!message-edit nouveau texte`
  //     ou : `!message-edit <ID ou lien du message> nouveau texte`
  // Joindre un fichier remplace les pièces jointes du message ; sans fichier, elles sont conservées.
  'message-edit': async message => {
    if (!message.guild) return; // serveur uniquement
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Vous n\'avez pas la permission.');
    }
    const usage = '❌ Utilisez `!message-edit <ID ou lien du message> nouveau texte`, ou répondez au message du bot avec `!message-edit nouveau texte` (vous pouvez aussi joindre un fichier pour remplacer les pièces jointes).';
    let rest = message.content.replace(/^\S+\s*/, '');
    let target = null;
    try {
      if (message.reference?.messageId) {
        // Mode réponse : le message ciblé est celui auquel on répond
        const refChannel = message.reference.channelId && message.reference.channelId !== message.channel.id ? await message.guild.channels.fetch(message.reference.channelId).catch(() => null) : message.channel;
        target = refChannel?.messages ? await refChannel.messages.fetch(message.reference.messageId).catch(() => null) : null;
      } else {
        // Mode ID / lien : premier mot = ID ou lien du message
        const m = rest.match(/^(\S+)\s*([\s\S]*)$/);
        if (m) {
          const ref = m[1];
          const link = ref.match(/^https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)$/);
          let channel = null;
          let msgId = null;
          if (link) {
            if (link[1] !== message.guild.id) return message.reply('❌ Ce message n\'est pas sur ce serveur.');
            channel = await message.guild.channels.fetch(link[2]).catch(() => null);
            msgId = link[3];
          } else if (/^\d{15,25}$/.test(ref)) {
            channel = message.channel;
            msgId = ref;
          }
          if (msgId) {
            rest = m[2];
            target = channel?.messages ? await channel.messages.fetch(msgId).catch(() => null) : null;
          }
        }
      }
    } catch (e) {
      console.error('[!message-edit] Récupération du message impossible :', e.message);
    }
    const text = rest.trim();
    const attachments = [...message.attachments.values()];
    if (!target && !message.reference?.messageId && !text && !attachments.length) {
      return message.reply(usage);
    }
    if (!target) {
      return message.reply('❌ Message introuvable. Répondez au message du bot ou donnez son ID / son lien.\n' + usage);
    }
    if (target.author.id !== message.client.user.id) {
      return message.reply('❌ Je ne peux modifier que mes propres messages.');
    }
    if (target.flags?.has(MessageFlags.IsComponentsV2)) {
      return message.reply('❌ Ce message est un panneau (Components V2) : il ne peut pas être modifié avec cette commande.');
    }
    if (!text && !attachments.length) {
      return message.reply('❌ Indiquez le nouveau texte (et/ou joignez un fichier).\n' + usage);
    }
    if (text.length > 2000) {
      return message.reply('❌ Le texte dépasse 2000 caractères.');
    }
    const payload = {};
    if (text) payload.content = text;
    if (attachments.length) {
      payload.files = attachments.map(a => new AttachmentBuilder(a.url, {
        name: a.name
      }));
      payload.attachments = []; // remplace les anciennes pièces jointes
    }
    try {
      await target.edit(payload);
    } catch (e) {
      console.error('[!message-edit] Modification impossible :', e.message);
      return message.reply('❌ Impossible de modifier ce message (permissions manquantes ou fichier trop lourd ?).');
    }
    try {
      await message.delete();
    } catch (e) {
      console.error('Impossible de supprimer le message !message-edit :', e.message);
      await message.react('✅').catch(() => { });
    }
  }
};
async function terminerConcours(client, guildId, giveawayId) {
  const bucket = getGuildBucket(guildId, 'giveaways', []);
  const entry = bucket.find(g => g.id === giveawayId);
  if (!entry || !entry.active) return;
  entry.active = false;
  const channel = await client.channels.fetch(entry.channelId).catch(() => null);
  const message = channel ? await channel.messages.fetch(entry.messageId).catch(() => null) : null;
  const pool = [...(entry.participants || [])];
  const gagnants = [];
  const nb = Math.min(entry.winnersCount, pool.length);
  for (let i = 0; i < nb; i++) gagnants.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  const texte = gagnants.length ? gagnants.map(id => `<@${id}>`).join(', ') : 'Aucun participant valide 😢';
  if (message) {
    const endEmbed = new EmbedBuilder().setTitle('🎉 GIVEAWAY TERMINÉ 🎉').setDescription(`**Lot :** ${entry.prize}\n**Gagnant(s) :** ${texte}`).setColor(0xFFFFFF).setTimestamp();
    const endFiles = [];
    try {
      const users = await Promise.all(gagnants.map(id => client.users.fetch(id).catch(() => null)));
      const cardBuffer = await generateGiveawayResultImage({
        guildId,
        prize: entry.prize,
        participantsCount: (entry.participants || []).length,
        winners: gagnants.map((id, i) => ({
          name: users[i]?.globalName || users[i]?.username || 'Membre inconnu',
          avatarURL: users[i]?.displayAvatarURL({ extension: 'png', size: 128 }) || null
        }))
      });
      endFiles.push(new AttachmentBuilder(cardBuffer, { name: 'concours-fin.png' }));
      endEmbed.setImage('attachment://concours-fin.png');
    } catch (e) {
      console.error('[Concours] Erreur image de fin :', e.message);
    }
    const endPayloadV2 = toCV2Payload({
      embeds: [endEmbed],
      files: endFiles,
      attachments: [],
      components: []
    });
    // Carte seule (sans embed) ; anciens giveaways (message en Components V2) : repli sur l'ancien format
    const endPayload = endFiles.length
      ? { content: null, embeds: [], files: endFiles, attachments: [], components: [] }
      : endPayloadV2;
    await message.edit(endPayload).catch(() => message.edit(endPayloadV2).catch(() => { }));
  }
  if (gagnants.length && channel?.send) {
    await channel.send({
      content: `🎉 Félicitations ${texte} ! Vous remportez **${entry.prize}** !${entry.winMessage ? `\n${entry.winMessage}` : ''}`
    }).catch(() => { });
  }
  setGuildBucket(guildId, 'giveaways', bucket);
}
// Ces commandes ne sont plus enregistrées en top-level : absorbées dans /settings
// (voir src/commands/extended.js), qui les réutilise telles quelles via ces exports.
const ABSORBEES_PAR_CONFIG = new Set(['notification', 'partenariat-config', 'partenariat-liste', 'partenariat-statistiques', 'partenariat-retirer', 'partenariat-reinitialiser', 'partenariat', 'config-annonce', 'reglement']);
const commands = allDefinedCommands.filter(c => !ABSORBEES_PAR_CONFIG.has(c.data.name));
function trouverCommande(nom) {
  return allDefinedCommands.find(c => c.data.name === nom);
}
module.exports = {
  commands,
  prefixCommands,
  getGuildBucket,
  setGuildBucket,
  terminerConcours,
  notificationCmd: trouverCommande('notification'),
  partenariatConfigCmd: trouverCommande('partenariat-config'),
  partenariatListeCmd: trouverCommande('partenariat-liste'),
  partenariatStatistiquesCmd: trouverCommande('partenariat-statistiques'),
  partenariatRetirerCmd: trouverCommande('partenariat-retirer'),
  partenariatReinitialiserCmd: trouverCommande('partenariat-reinitialiser'),
  partenariatAutoCmd: trouverCommande('partenariat'),
  configAnnonceCmd: trouverCommande('config-annonce')
};