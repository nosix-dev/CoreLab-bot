// src/commands/agenda.js
// /agenda view | add | remove — calendrier visuel des événements du serveur.
// Les événements sont ceux de /event (même stockage) : en ajouter avec /event create
// ou /agenda add revient au même, ils apparaissent tous dans le calendrier.
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const {
  createEvent,
  cancelEventById,
  EVENT_TYPES,
  typeOf,
  activeEvents,
  eventsInRange,
  parisParts,
  parisTimestamp
} = require('../core/eventManager');
const {
  generateAgendaMonth,
  generateAgendaWeek,
  generateAgendaAll,
  MONTHS,
  DAYS_LOWER,
  addDays,
  dowMon
} = require('../handlers/agendaImage');

const ACCENT = 0x2ecc71;
const pad2 = n => String(n).padStart(2, '0');
const hhmm = p => `${pad2(p.hh)}h${pad2(p.mm)}`;
const dayLabel = (y, m, d) => `${DAYS_LOWER[dowMon(y, m, d)]} ${d}`;

// ── Données ──────────────────────────────────────────────────────────────
function flatten(ev) {
  const p = parisParts(ev.startAt);
  return {
    ...p,
    id: ev.id,
    name: ev.name,
    type: typeOf(ev),
    place: ev.voiceId ? 'Vocal' : (ev.location || ''),
    raw: ev
  };
}
function rangeEvents(gid, from, toExclusive) {
  const a = parisTimestamp(from.y, from.m, from.d);
  const b = parisTimestamp(toExclusive.y, toExclusive.m, toExclusive.d);
  return eventsInRange(gid, a, b).map(flatten);
}
function nextLabel(gid) {
  const now = Date.now();
  const ev = activeEvents(gid).find(e => e.startAt >= now || e.status === 'started');
  if (!ev) return 'Aucun';
  const p = parisParts(ev.startAt);
  return `${dayLabel(p.y, p.m, p.d)} · ${hhmm(p)}`;
}
function weekStartOf(y, m, d) {
  return addDays(y, m, d, -dowMon(y, m, d));
}
function shiftMonth(y, m, delta) {
  const t = y * 12 + (m - 1) + delta;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
}
const clampYear = y => Math.min(2100, Math.max(2000, y));

// ── Rendu (Components V2) ───────────────────────────────────────────────
function eventLine(e, withMonth) {
  const t = EVENT_TYPES[e.type];
  const lieu = e.raw.voiceId ? ` | <#${e.raw.voiceId}>` : (e.raw.location ? ` | ${e.raw.location}` : '');
  const flag = e.raw.status === 'started' ? ' 🔴' : (e.raw.status === 'ended' ? ' ✔️' : '');
  return `\`${dayLabel(e.y, e.m, e.d)}${withMonth ? `/${pad2(e.m)}` : ''}\` ${t.emoji} **${hhmm(e)}** ${e.name}${lieu}${flag}`;
}

async function buildAgenda(guild, { view, y, m, d }) {
  const gid = guild.id;
  const today = parisParts(Date.now());
  const botName = guild.client?.user?.username || 'CoreLab';
  const next = nextLabel(gid);
  let png, name, title, listEvents, selectDays;

  if (view === 'all') {
    const events = eventsInRange(gid, parisTimestamp(today.y, today.m, today.d), Number.MAX_SAFE_INTEGER).map(flatten);
    png = generateAgendaAll({ guildId: gid, botName, today, events, next });
    name = `agenda-all-${Date.now()}.png`;
    title = '### Agenda — tous les événements à venir';
    listEvents = events;
    selectDays = events;
  } else if (view === 'week') {
    const start = weekStartOf(y, m, d);
    const end = addDays(start.y, start.m, start.d, 7);
    const events = rangeEvents(gid, start, end);
    png = generateAgendaWeek({ guildId: gid, botName, start, today, events, weekCount: events.length, next });
    name = `agenda-w-${start.y}${pad2(start.m)}${pad2(start.d)}.png`;
    title = '### Agenda de la semaine';
    listEvents = events;
    selectDays = events;
  } else {
    const first = dowMon(y, m, 1);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const rows = Math.ceil((first + dim) / 7);
    const gridStart = addDays(y, m, 1, -first);
    const gridEnd = addDays(gridStart.y, gridStart.m, gridStart.d, rows * 7);
    const events = rangeEvents(gid, gridStart, gridEnd);
    const inMonth = events.filter(e => e.y === y && e.m === m);
    png = generateAgendaMonth({ guildId: gid, botName, year: y, month: m, today, events, monthCount: inMonth.length, next });
    name = `agenda-m-${y}${pad2(m)}.png`;
    title = '### Agenda du mois';
    listEvents = inMonth;
    selectDays = inMonth;
  }

  const container = new ContainerBuilder().setAccentColor(ACCENT);
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`))
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  const shown = listEvents.slice(0, 12);
  let text = `${title}\n`;
  text += shown.length
    ? shown.map(e => eventLine(e, view === 'all')).join('\n') + (listEvents.length > shown.length ? `\n… +${listEvents.length - shown.length} autre(s)` : '')
    : '*Aucun événement prévu.*';
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text.slice(0, 3500)));

  // Navigation (customId : agenda_<vue>_<y>_<m>_<d>_<tag>)
  const btn = (id, label, style, emoji) => {
    const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
    if (emoji) b.setEmoji(emoji);
    return b;
  };
  const anchorMonth = (today.y === y && today.m === m) ? today.d : 1;
  const navRow = new ActionRowBuilder();
  if (view === 'week') {
    const start = weekStartOf(y, m, d);
    const p = addDays(start.y, start.m, start.d, -7);
    const n = addDays(start.y, start.m, start.d, 7);
    navRow.addComponents(
      btn(`agenda_week_${p.y}_${p.m}_${p.d}_p`, '◀ Semaine préc.', ButtonStyle.Secondary),
      btn(`agenda_week_${today.y}_${today.m}_${today.d}_t`, "Aujourd'hui", ButtonStyle.Success),
      btn(`agenda_week_${n.y}_${n.m}_${n.d}_n`, 'Semaine suiv. ▶', ButtonStyle.Secondary),
      btn(`agenda_month_${start.y}_${start.m}_1_v`, 'Vue mois', ButtonStyle.Primary, '🗓️'),
      btn(`agenda_all_${today.y}_${today.m}_${today.d}_a`, 'Tout', ButtonStyle.Primary, '📋')
    );
  } else if (view === 'month') {
    const p = shiftMonth(y, m, -1);
    const n = shiftMonth(y, m, 1);
    navRow.addComponents(
      btn(`agenda_month_${p.y}_${p.m}_1_p`, `◀ ${MONTHS[p.m - 1]}`, ButtonStyle.Secondary),
      btn(`agenda_month_${today.y}_${today.m}_${today.d}_t`, "Aujourd'hui", ButtonStyle.Success),
      btn(`agenda_month_${n.y}_${n.m}_1_n`, `${MONTHS[n.m - 1]} ▶`, ButtonStyle.Secondary),
      btn(`agenda_week_${y}_${m}_${anchorMonth}_v`, 'Vue semaine', ButtonStyle.Primary, '🗓️'),
      btn(`agenda_all_${today.y}_${today.m}_${today.d}_a`, 'Tout', ButtonStyle.Primary, '📋')
    );
  } else {
    navRow.addComponents(
      btn(`agenda_all_${today.y}_${today.m}_${today.d}_t`, 'Actualiser', ButtonStyle.Success, '🔄'),
      btn(`agenda_month_${today.y}_${today.m}_${today.d}_v`, 'Vue mois', ButtonStyle.Primary, '🗓️'),
      btn(`agenda_week_${today.y}_${today.m}_${today.d}_w`, 'Vue semaine', ButtonStyle.Primary, '🗓️')
    );
  }
  container.addActionRowComponents(navRow);

  // Sélecteur « détail d'un jour »
  const dayKeys = [...new Map(selectDays.map(e => [`${e.y}-${e.m}-${e.d}`, e])).values()].slice(0, 25);
  const daySelect = new StringSelectMenuBuilder().setCustomId(`agenda_dsel_${view}_${y}_${m}_${d}`);
  if (dayKeys.length) {
    daySelect.setPlaceholder("Voir le détail d'un jour...").addOptions(dayKeys.map(e => {
      const n = selectDays.filter(x => x.y === e.y && x.m === e.m && x.d === e.d).length;
      return {
        label: `${dayLabel(e.y, e.m, e.d)} ${MONTHS[e.m - 1].toLowerCase()}`,
        description: `${n} événement${n > 1 ? 's' : ''}`,
        value: `${e.y}-${e.m}-${e.d}`,
        emoji: '📌'
      };
    }));
  } else {
    daySelect.setPlaceholder('Aucun jour avec événement').setDisabled(true)
      .addOptions([{ label: 'Aucun événement', value: 'none' }]);
  }
  container.addActionRowComponents(new ActionRowBuilder().addComponents(daySelect));

  // Sélecteur de mois (vue mois uniquement)
  if (view !== 'week') {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`agenda_msel_${y}`)
        .setPlaceholder('Changer de mois')
        .addOptions(MONTHS.map((label, i) => ({ label, value: String(i + 1), default: view === 'month' && i + 1 === m })))
    ));
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# ${botName} • /agenda add et /event create alimentent ce calendrier`
  ));

  return {
    components: [container],
    files: [new AttachmentBuilder(png, { name })],
    attachments: [],
    flags: MessageFlags.IsComponentsV2
  };
}

// ── Détail d'un jour (réponse privée) ───────────────────────────────────
function dayDetail(guild, y, m, d) {
  const evs = rangeEvents(guild.id, { y, m, d }, addDays(y, m, d, 1));
  if (!evs.length) return '❌ Aucun événement ce jour-là.';
  const blocks = evs.map(e => {
    const r = e.raw;
    const t = EVENT_TYPES[e.type];
    const ts = Math.floor(r.startAt / 1000);
    const lieu = r.voiceId ? `<#${r.voiceId}>` : (r.location || 'À définir');
    const link = r.messageId ? `\n🔗 https://discord.com/channels/${guild.id}/${r.channelId}/${r.messageId}` : '';
    const status = { cancelled: ' (annulé)', ended: ' (terminé)', started: ' 🔴 (en cours)' }[r.status] || '';
    return `${t.emoji} **${e.name}**${status} — ${t.label}\n🕒 <t:${ts}:F> (<t:${ts}:R>)\n📍 ${lieu}`
      + `${r.description ? `\n📝 ${r.description}` : ''}`
      + `\n👥 ${r.yes.length}${r.maxPlaces ? `/${r.maxPlaces}` : ''} inscrit(s) · organisé par ${r.hostTag || '—'}${link}`;
  });
  return `📌 **${dayLabel(y, m, d)} ${MONTHS[m - 1].toLowerCase()} ${y}**\n\n${blocks.join('\n\n')}`.slice(0, 1900);
}

// ── Routage des boutons / menus ─────────────────────────────────────────
async function routeAgendaInteraction(i) {
  if (!i.guild) return;
  const parts = i.customId.split('_'); // agenda_<action>_...
  const action = parts[1];

  // Détail d'un jour : réponse privée, le message du calendrier ne change pas
  if (action === 'dsel' && i.isStringSelectMenu()) {
    const [y, m, d] = i.values[0].split('-').map(Number);
    if (!y) return i.deferUpdate().catch(() => { });
    return i.reply({ content: dayDetail(i.guild, y, m, d), flags: MessageFlags.Ephemeral });
  }

  let target = null;
  if (action === 'month' || action === 'week' || action === 'all') {
    const [y, m, d] = parts.slice(2, 5).map(Number);
    target = { view: action, y: clampYear(y), m: Math.min(12, Math.max(1, m)), d: d || 1 };
  } else if (action === 'msel' && i.isStringSelectMenu()) {
    target = { view: 'month', y: clampYear(Number(parts[2])), m: Number(i.values[0]), d: 1 };
  }
  if (!target) return;

  await i.deferUpdate();
  const payload = await buildAgenda(i.guild, target);
  return i.editReply(payload);
}

// ── Commande ────────────────────────────────────────────────────────────
const agenda = {
  data: new SlashCommandBuilder()
    .setName('agenda')
    .setDescription('Calendrier des événements du serveur')
    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('Voir le calendrier du mois (ou d\'un mois précis)')
      .addIntegerOption(o => o.setName('mois').setDescription('Mois (1-12) : affiche la grille de ce mois').setMinValue(1).setMaxValue(12).setRequired(false))
      .addIntegerOption(o => o.setName('annee').setDescription('Année : affiche la grille du mois choisi').setMinValue(2000).setMaxValue(2100).setRequired(false)))
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Ajouter un événement au calendrier (annonce + inscriptions + rappels)')
      .addStringOption(o => o.setName('nom').setDescription('Nom de l\'événement').setRequired(true))
      .addStringOption(o => o.setName('date').setDescription('JJ/MM/AAAA HH:MM (heure de Paris)').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Type (couleur dans le calendrier, défaut : événement)').setRequired(false)
        .addChoices(
          { name: 'Convoi', value: 'convoi' },
          { name: 'Réunion', value: 'reunion' },
          { name: 'Événement', value: 'event' }
        ))
      .addStringOption(o => o.setName('description').setDescription('Description').setRequired(false))
      .addChannelOption(o => o.setName('vocal').setDescription('Salon vocal de l\'événement').addChannelTypes(ChannelType.GuildVoice).setRequired(false))
      .addStringOption(o => o.setName('lieu').setDescription('Lieu (si pas de salon vocal)').setRequired(false))
      .addRoleOption(o => o.setName('role').setDescription('Rôle à mentionner').setRequired(false))
      .addIntegerOption(o => o.setName('places').setDescription('Nombre de places max').setMinValue(1).setRequired(false))
      .addIntegerOption(o => o.setName('duree').setDescription('Durée en minutes (défaut : 120)').setMinValue(15).setMaxValue(1440).setRequired(false))
      .addChannelOption(o => o.setName('salon').setDescription('Salon d\'annonce (défaut : salon d\'annonces configuré)').addChannelTypes(ChannelType.GuildText).setRequired(false)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Retirer un événement du calendrier')
      .addStringOption(o => o.setName('evenement').setDescription('Événement à retirer').setAutocomplete(true).setRequired(true))),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Commande utilisable uniquement dans un serveur.', flags: MessageFlags.Ephemeral });
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      await interaction.deferReply();
      const today = parisParts(Date.now());
      const mois = interaction.options.getInteger('mois');
      const annee = interaction.options.getInteger('annee');
      // Sans option : grille du mois en cours (le bouton « Tout » donne la liste complète)
      const y = clampYear(annee || today.y);
      const m = mois || today.m;
      const d = (y === today.y && m === today.m) ? today.d : 1;
      return interaction.editReply(await buildAgenda(interaction.guild, { view: 'month', y, m, d }));
    }

    // add / remove : réservé à ceux qui peuvent gérer les événements (comme /event)
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageEvents)) {
      return interaction.reply({ content: '❌ Il faut la permission **Gérer les événements** pour modifier le calendrier.', flags: MessageFlags.Ephemeral });
    }
    if (sub === 'add') return createEvent(interaction);
    if (sub === 'remove') return cancelEventById(interaction, interaction.options.getString('evenement'));
  },

  async autocomplete(interaction) {
    if (!interaction.guild) return interaction.respond([]);
    const q = String(interaction.options.getFocused() || '').toLowerCase();
    const choices = activeEvents(interaction.guild.id)
      .map(e => {
        const p = parisParts(e.startAt);
        return { name: `${pad2(p.d)}/${pad2(p.m)} ${hhmm(p)} — ${e.name}`.slice(0, 100), value: e.id };
      })
      .filter(c => c.name.toLowerCase().includes(q))
      .slice(0, 25);
    return interaction.respond(choices).catch(() => { });
  }
};

module.exports = [agenda];
module.exports.routeAgendaInteraction = routeAgendaInteraction;
