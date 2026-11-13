'use strict';

const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const { containerAccent } = require('../core/cardTheme');
const { summarize, TZ } = require('../core/activityStats');
const { lineChart, barChart, hbarChart, propre } = require('../handlers/activityCharts');

// ─────────────────────────────────────────────────────────────────────────
// /server-stats : statistiques de messages du serveur (vue d'ensemble, messages,
//                 top membres, salons, activité par heure) + boutons de navigation.
// /user-stats   : mêmes stats pour un membre (messages, rang, salons, heures, vocal).
// Les données viennent de core/activityStats.js (suivi lancé au démarrage du bot).
// Boutons : customId « astats|<s|u>|<vue>|<jours>|<ownerId>|<cibleId> »
//           menu période : « astatsp|… » (routés depuis index.js → routeActivityInteraction)
// ─────────────────────────────────────────────────────────────────────────

const V2 = MessageFlags.IsComponentsV2;
const PERIODES = [7, 14, 30];
const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

const VIEWS_SERVER = [
  { id: 'overview', label: 'Vue d\'ensemble', emoji: '📊' },
  { id: 'messages', label: 'Messages', emoji: '📈' },
  { id: 'users', label: 'Top Users', emoji: '👑' },
  { id: 'channels', label: 'Canaux', emoji: '💬' },
  { id: 'hours', label: 'Activité Horaire', emoji: '🕐' },
];
const VIEWS_USER = VIEWS_SERVER.filter(v => v.id !== 'users');

const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const text = content => new TextDisplayBuilder().setContent(content);

const fmt = n => Math.round(n).toLocaleString('fr-FR');
const fmt1 = n => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct1 = n => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const dateLabel = key => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
const plural = (n, mot) => `${fmt(n)} ${mot}${n > 1 ? 's' : ''}`;

function dureeVocal(min) {
  if (!(min >= 1)) return '0 min';
  if (min < 60) return `${Math.round(min)} min`;
  return `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`;
}

function clampDays(n) {
  return PERIODES.includes(Number(n)) ? Number(n) : 7;
}

async function nomsMembres(guild, ids) {
  const out = new Map();
  await Promise.all(ids.map(async id => {
    let member = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
    let name = member?.displayName;
    if (!name) {
      const user = await guild.client.users.fetch(id).catch(() => null);
      name = user?.globalName || user?.username;
    }
    out.set(id, name || 'Ancien membre');
  }));
  return out;
}

// Compte humains / bots (fetch des membres si le cache est incomplet, sinon cache seul)
async function compterMembres(guild, noFetch = false) {
  try {
    if (!noFetch && guild.members.cache.size < guild.memberCount) {
      await Promise.race([
        guild.members.fetch(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);
    }
  } catch { /* on garde le cache */ }
  const bots = guild.members.cache.filter(m => m.user.bot).size;
  const total = guild.memberCount;
  const complet = guild.members.cache.size >= total;
  const humains = complet ? total - bots : guild.members.cache.size - bots;
  return { total, bots, humains: Math.max(0, humains) };
}

function nomSalon(guild, id) {
  const name = guild.channels.cache.get(id)?.name;
  return name ? `#${name}` : '#salon-supprimé';
}

// ── Construction d'une vue (texte + image + boutons) ────────────────────
async function buildView({ guild, client, scope, view, days, ownerId, targetId }) {
  const isUser = scope === 'u';
  const isRemote = scope === 'b'; // vue d'un serveur depuis la notification d'ajout du bot
  const stats = summarize(guild.id, days, isUser ? targetId : null);
  const labels = stats.keys.map(dateLabel);
  const nowUnix = Math.floor(Date.now() / 1000);
  const fileName = `stats-${scope}-${view}.png`;
  const guildId = guild.id;
  const sousTitre = `${days} jours`;

  let header = '';
  let png;
  let thumb = null;

  if (isUser) {
    const member = await guild.members.fetch(targetId).catch(() => null);
    const user = member?.user || await client.users.fetch(targetId).catch(() => null);
    const nom = member?.displayName || user?.globalName || user?.username || 'Membre inconnu';
    thumb = (member || user)?.displayAvatarURL?.({ size: 256 }) || null;

    if (view === 'overview') {
      const fav = stats.topChannels[0];
      header =
        `## 👤 Statistiques de ${nom}\n` +
        `📨 **Messages (${days}j)** : ${fmt(stats.total)}  •  🏅 **Rang** : ${stats.rank ? `#${stats.rank} sur ${fmt(stats.rankedCount)}` : '—'}\n` +
        `📊 **Moyenne/jour** : ${fmt1(stats.avg)}  •  📅 **Jours actifs** : ${stats.activeDays}/${days}\n` +
        `🎙️ **Vocal** : ${dureeVocal(stats.voiceMinutes)}` +
        (member?.joinedTimestamp ? `  •  📥 **Arrivé** : <t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : '') + '\n' +
        `💬 **Salon favori** : ${fav ? `<#${fav[0]}> (${fmt(fav[1])})` : '—'}`;
      png = lineChart({ guildId, caption: `Messages de ${propre(nom, 'ce membre')} — ${days} derniers jours`, sub: sousTitre, labels, values: stats.perDay });
    } else if (view === 'messages') {
      header =
        `## 📈 Messages de ${nom}\n` +
        `📨 **Total (${days}j)** : ${fmt(stats.total)}  •  📊 **Moyenne/jour** : ${fmt1(stats.avg)}\n` +
        `🏆 **Meilleur jour** : ${stats.total ? `${labels[stats.bestDayIndex]} (${fmt(stats.perDay[stats.bestDayIndex])})` : '—'}  •  📅 **Aujourd'hui** : ${fmt(stats.perDay[stats.perDay.length - 1])}`;
      png = barChart({ guildId, caption: 'Messages par jour', sub: sousTitre, labels, values: stats.perDay, highlight: stats.total ? stats.bestDayIndex : -1 });
    } else if (view === 'channels') {
      header = `## 💬 Salons de ${nom}\nSalons où ${nom} écrit le plus (${days} derniers jours)\n\n` + listeSalons(guild, stats);
      png = hbarChart({
        guildId, caption: 'Messages par salon', sub: sousTitre,
        items: stats.topChannels.slice(0, 8).map(([id, n]) => ({ label: nomSalon(guild, id), value: n }))
      });
    } else {
      header = enteteHeures(stats, `🕐 Activité de ${nom} par heure`, 'Répartition de ses messages selon l\'heure de la journée');
      png = graphHeures(guildId, stats);
    }
  } else if (view === 'overview') {
    const m = await compterMembres(guild);
    header =
      `## 📈 Statistiques des Messages${isRemote ? ` — ${guild.name}` : ''}\n` +
      `📨 **Total (${days}j)** : ${fmt(stats.total)}  •  📊 **Moyenne/jour** : ${fmt1(stats.avg)}  •  👥 **Utilisateurs actifs** : ${fmt(stats.activeUsers)}\n` +
      `📥 **Arrivées** : ${fmt(stats.joins)}  •  📤 **Départs** : ${fmt(stats.leaves)}  •  🎙️ **Vocal** : ${dureeVocal(stats.voiceMinutes)}\n` +
      `🧑 **Humains** : ${fmt(m.humains)}  •  🤖 **Bots** : ${fmt(m.bots)}  •  👥 **Membres** : ${fmt(m.total)}`;
    if (isRemote) thumb = guild.iconURL({ size: 256 }) || null;
    png = lineChart({ guildId, caption: `Messages des ${days} derniers jours`, sub: sousTitre, labels, values: stats.perDay });
  } else if (view === 'messages') {
    header =
      '## 💬 Messages\n' +
      `📨 **Total (${days}j)** : ${fmt(stats.total)}  •  📊 **Moyenne/jour** : ${fmt1(stats.avg)}\n` +
      `🏆 **Meilleur jour** : ${stats.total ? `${labels[stats.bestDayIndex]} (${fmt(stats.perDay[stats.bestDayIndex])})` : '—'}  •  📅 **Aujourd'hui** : ${fmt(stats.perDay[stats.perDay.length - 1])}`;
    png = barChart({ guildId, caption: 'Messages par jour', sub: sousTitre, labels, values: stats.perDay, highlight: stats.total ? stats.bestDayIndex : -1 });
  } else if (view === 'users') {
    const top = stats.topUsers.slice(0, 8);
    const noms = await nomsMembres(guild, top.map(([id]) => id));
    const lignes = top.slice(0, 5).map(([id, n], i) => `${MEDALS[i]} <@${id}> - ${plural(n, 'message')}`);
    header =
      '## 👑 Utilisateurs les Plus Actifs\n' +
      `Classement des membres les plus actifs (${days} derniers jours)\n\n` +
      `🏆 **Top 5**\n${lignes.length ? lignes.join('\n') : 'Aucun message enregistré pour le moment.'}`;
    png = hbarChart({
      guildId, caption: `Top ${Math.max(top.length, 1)} utilisateurs (${days}j)`, sub: sousTitre,
      items: top.map(([id, n]) => ({ label: noms.get(id), value: n }))
    });
  } else if (view === 'channels') {
    header = `## 💬 Salons les Plus Actifs\nClassement des salons (${days} derniers jours)\n\n` + listeSalons(guild, stats);
    png = hbarChart({
      guildId, caption: 'Messages par salon', sub: sousTitre,
      items: stats.topChannels.slice(0, 8).map(([id, n]) => ({ label: nomSalon(guild, id), value: n }))
    });
  } else {
    header = enteteHeures(stats, '🕐 Activité par Heure', 'Répartition des messages selon l\'heure de la journée');
    png = graphHeures(guildId, stats);
  }

  // Conteneur
  const container = new ContainerBuilder().setAccentColor(containerAccent(guildId, 0xE8510D));
  if (thumb && view === 'overview') {
    container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(text(header)).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb))
    );
  } else {
    container.addTextDisplayComponents(text(header));
  }
  container
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${fileName}`)))
    .addTextDisplayComponents(text(`-# Aujourd'hui à <t:${nowUnix}:t>`))
    .addSeparatorComponents(sep());

  const target = isUser ? targetId : (isRemote ? guildId : '0');
  const rowBoutons = new ActionRowBuilder();
  for (const v of (isUser ? VIEWS_USER : VIEWS_SERVER)) {
    rowBoutons.addComponents(
      new ButtonBuilder()
        .setCustomId(`astats|${scope}|${v.id}|${days}|${ownerId}|${target}`)
        .setLabel(v.label)
        .setEmoji(v.emoji)
        .setStyle(v.id === view ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  }
  container.addActionRowComponents(rowBoutons);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`astatsp|${scope}|${view}|${days}|${ownerId}|${target}`)
        .setPlaceholder('Période')
        .addOptions(PERIODES.map(d => ({ label: `${d} derniers jours`, value: String(d), emoji: '🗓️', default: d === days })))
    )
  );

  return {
    components: [container],
    files: [new AttachmentBuilder(png, { name: fileName })],
    flags: V2,
    allowedMentions: { parse: [] },
  };
}

function listeSalons(guild, stats) {
  const top = stats.topChannels.slice(0, 5);
  if (!top.length) return 'Aucun message enregistré pour le moment.';
  const total = stats.total || 1;
  return top.map(([id, n], i) => `${MEDALS[i]} <#${id}> - ${plural(n, 'message')} (${pct1((n / total) * 100)})`).join('\n');
}

function enteteHeures(stats, titre, sousTitre) {
  const total = stats.total || 0;
  const somme = (a, b) => stats.hours.slice(a, b).reduce((x, y) => x + y, 0);
  const part = n => (total ? (n / total) * 100 : 0);
  const peakH = String(stats.peakHour).padStart(2, '0');
  return (
    `## ${titre}\n${sousTitre}\n\n` +
    `🔥 **Heure de pointe** : ${total ? `${peakH}:00` : '—'}  •  📨 **Messages (pointe)** : ${fmt(stats.hours[stats.peakHour])}\n\n` +
    '📊 **Répartition**\n' +
    `🌅 Matin : ${pct1(part(somme(6, 12)))}\n` +
    `☀️ Après-midi : ${pct1(part(somme(12, 18)))}\n` +
    `🌆 Soirée : ${pct1(part(somme(18, 24)))}\n` +
    `🌙 Nuit : ${pct1(part(somme(0, 6)))}`
  );
}

function graphHeures(guildId, stats) {
  return barChart({
    guildId,
    caption: 'Activité par heure de la journée',
    sub: `Heure locale (${TZ})`,
    labels: Array.from({ length: 24 }, (_, h) => String(h)),
    values: stats.hours,
    highlight: stats.total ? stats.peakHour : -1,
    labelEvery: 1,
    valueLabels: false,
    labelSize: 14
  });
}

// ── /server-stats ───────────────────────────────────────────────────────
const periodeOption = o => o
  .setName('periode')
  .setDescription('Période analysée (7 jours par défaut)')
  .addChoices(...PERIODES.map(d => ({ name: `${d} derniers jours`, value: d })));

const serverData = new SlashCommandBuilder()
  .setName('server-stats')
  .setDescription('📊 Statistiques d\'activité du serveur (messages, top membres, salons, heures)')
  .setDMPermission(false)
  .addIntegerOption(periodeOption);

async function serverExecute(interaction, client) {
  if (!interaction.guild) {
    return interaction.reply({ content: '❌ Cette commande fonctionne uniquement sur un serveur.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: V2 });
  const days = clampDays(interaction.options.getInteger('periode'));
  const payload = await buildView({
    guild: interaction.guild, client: client || interaction.client, scope: 's', view: 'overview',
    days, ownerId: interaction.user.id, targetId: '0'
  });
  return interaction.editReply(payload);
}

// ── /user-stats ─────────────────────────────────────────────────────────
const userData = new SlashCommandBuilder()
  .setName('user-stats')
  .setDescription('📈 Statistiques d\'activité d\'un membre (messages, rang, salons, heures, vocal)')
  .setDMPermission(false)
  .addUserOption(o => o.setName('membre').setDescription('Le membre (toi par défaut)'))
  .addIntegerOption(periodeOption);

async function userExecute(interaction, client) {
  if (!interaction.guild) {
    return interaction.reply({ content: '❌ Cette commande fonctionne uniquement sur un serveur.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: V2 });
  const cible = interaction.options.getUser('membre') || interaction.user;
  const days = clampDays(interaction.options.getInteger('periode'));
  const payload = await buildView({
    guild: interaction.guild, client: client || interaction.client, scope: 'u', view: 'overview',
    days, ownerId: interaction.user.id, targetId: cible.id
  });
  return interaction.editReply(payload);
}

// ── Boutons + menu période (appelé depuis index.js) ─────────────────────
async function routeActivityInteraction(interaction) {
  const [, scope, view, daysStr, ownerId, targetId] = String(interaction.customId).split('|');
  if (!interaction.guild || !['s', 'u', 'b'].includes(scope)) return;

  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      content: `❌ Seul <@${ownerId}> peut utiliser ces boutons. Lance ${scope === 'u' ? '`/user-stats`' : '`/server-stats`'} pour avoir les tiens.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  const days = interaction.isStringSelectMenu() ? clampDays(interaction.values?.[0]) : clampDays(daysStr);
  const vues = scope === 'u' ? VIEWS_USER : VIEWS_SERVER;
  const vue = vues.some(v => v.id === view) ? view : 'overview';

  const guildCible = scope === 'b' ? interaction.client.guilds.cache.get(targetId) : interaction.guild;
  if (!guildCible) {
    return interaction.reply({ content: '❌ Serveur introuvable (le bot l\'a peut-être déjà quitté).', flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferUpdate();
    const payload = await buildView({
      guild: guildCible, client: interaction.client, scope, view: vue,
      days, ownerId, targetId: scope === 'u' ? targetId : (scope === 'b' ? targetId : '0')
    });
    await interaction.editReply({ ...payload, attachments: [] });
  } catch (e) {
    console.error('[ActivityStats] interaction :', e);
    await interaction.followUp({ content: '❌ Impossible d\'afficher ces statistiques pour le moment.', flags: MessageFlags.Ephemeral }).catch(() => { });
  }
}

// Notification d'ajout / de retrait du bot, au même style que le panneau de stats
async function buildBotNotif({ guild, client, kind, inviter, owner, row }) {
  const ajout = kind === 'add';
  const stats = summarize(guild.id, 7, null);
  const labels = stats.keys.map(dateLabel);
  const m = await compterMembres(guild, !ajout);
  const fileName = `botnotif-${guild.id}.png`;
  const png = lineChart({
    guildId: guild.id, caption: 'Messages des 7 derniers jours', sub: '7 jours',
    labels, values: stats.perDay
  });

  const header =
    `## ${ajout ? '➕ Bot ajouté à un serveur' : '➖ Bot retiré d\'un serveur'} — ${guild.name}\n` +
    `🧑 **Humains** : ${fmt(m.humains)}  •  🤖 **Bots** : ${fmt(m.bots)}  •  👥 **Membres** : ${fmt(m.total)}\n` +
    `👑 **Propriétaire** : ${owner ? owner.user.tag : 'Inconnu'}` +
    (ajout ? `  •  👤 **Ajouté par** : ${inviter ? inviter.tag : 'Inconnu'}` : '') + '\n' +
    `📅 **Serveur créé il y a** : ${formatAgeFr(Date.now() - guild.createdTimestamp)}  •  🌐 **Serveurs du bot** : ${fmt(client.guilds.cache.size)}\n` +
    `📨 **Messages (7j)** : ${fmt(stats.total)}  •  📥 **Arrivées** : ${fmt(stats.joins)}  •  📤 **Départs** : ${fmt(stats.leaves)}  •  🎙️ **Vocal** : ${dureeVocal(stats.voiceMinutes)}`;

  const container = new ContainerBuilder().setAccentColor(ajout ? 0x57F287 : 0xED4245);
  const icon = guild.iconURL({ size: 256 });
  if (icon) {
    container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(text(header)).setThumbnailAccessory(new ThumbnailBuilder().setURL(icon))
    );
  } else {
    container.addTextDisplayComponents(text(header));
  }
  container
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${fileName}`)))
    .addTextDisplayComponents(text(`-# ID ${guild.id}  •  <t:${Math.floor(Date.now() / 1000)}:t>`))
    .addSeparatorComponents(sep());
  if (row) container.addActionRowComponents(row);

  return {
    components: [container],
    files: [new AttachmentBuilder(png, { name: fileName })],
    flags: V2,
    allowedMentions: { parse: [] },
  };
}

function formatAgeFr(ms) {
  const j = Math.floor(ms / 86400000);
  if (j < 1) return 'moins d\'un jour';
  if (j < 31) return `${j} jour${j > 1 ? 's' : ''}`;
  if (j < 365) return `${Math.floor(j / 30)} mois`;
  const a = Math.floor(j / 365), mo = Math.floor((j % 365) / 30);
  return `${a} an${a > 1 ? 's' : ''}${mo ? ` ${mo} mois` : ''}`;
}

// Ouvre le panneau de stats d'un serveur (bouton « Statistique » de la notification d'ajout du bot)
async function openGuildStats(interaction, guild, days = 7) {
  await interaction.deferReply({ flags: V2 | MessageFlags.Ephemeral });
  const payload = await buildView({
    guild, client: interaction.client, scope: 'b', view: 'overview',
    days: clampDays(days), ownerId: interaction.user.id, targetId: guild.id
  });
  return interaction.editReply(payload);
}

module.exports = {
  openGuildStats,
  buildBotNotif,
  commands: [
    { data: serverData, execute: serverExecute },
    { data: userData, execute: userExecute },
  ],
  routeActivityInteraction,
};