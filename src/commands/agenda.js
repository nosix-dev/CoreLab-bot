'use strict';
// src/commands/agenda.js
// /agenda voir [vue]   → calendrier (image) : mois / semaine / tout, avec boutons de navigation
// /agenda remove <id>  → annuler un événement (autocomplétion) — permission « Gérer les événements »
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');
const {
  activeEvents,
  eventsInRange,
  parisParts,
  parisTimestamp,
  cancelEventById
} = require('../core/eventManager');
const {
  generateAgendaMonth,
  generateAgendaWeek,
  generateAgendaAll,
  addDays,
  dowMon
} = require('../handlers/agendaImage');

const DAY_MS = 24 * 60 * 60 * 1000;
const pad2 = n => String(n).padStart(2, '0');

// ── Utilitaires ─────────────────────────────────────────────────────
function placeOf(guild, ev) {
  if (ev.voiceId) {
    const ch = guild.channels.cache.get(ev.voiceId);
    if (ch) return ch.name;
  }
  return ev.location || '';
}
function flatten(guild, list) {
  return list.map(ev => {
    const p = parisParts(ev.startAt);
    return {
      ...p,
      name: ev.name,
      type: ['convoi', 'reunion', 'event'].includes(ev.type) ? ev.type : 'event',
      place: placeOf(guild, ev)
    };
  });
}
function nextText(guild) {
  const ev = activeEvents(guild.id).find(e => e.startAt > Date.now());
  if (!ev) return 'Aucun';
  const p = parisParts(ev.startAt);
  return `${pad2(p.d)}/${pad2(p.m)} ${pad2(p.hh)}h${pad2(p.mm)}`;
}
function baseOpts(interaction) {
  const { y, m, d } = parisParts(Date.now());
  return {
    guildId: interaction.guild.id,
    botName: interaction.client.user.username,
    today: { y, m, d },
    next: nextText(interaction.guild)
  };
}
function mondayOf(y, m, d) {
  return addDays(y, m, d, -dowMon(y, m, d));
}

// ── Rendu des 3 vues ────────────────────────────────────────────────
function renderMonth(interaction, year, month) {
  const first = dowMon(year, month, 1);
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = Math.ceil((first + dim) / 7);
  const gs = addDays(year, month, 1, -first);
  const ge = addDays(gs.y, gs.m, gs.d, rows * 7);
  const list = flatten(interaction.guild, eventsInRange(
    interaction.guild.id,
    parisTimestamp(gs.y, gs.m, gs.d),
    parisTimestamp(ge.y, ge.m, ge.d)
  ));
  return generateAgendaMonth({
    ...baseOpts(interaction),
    year, month,
    events: list,
    monthCount: list.filter(e => e.y === year && e.m === month).length
  });
}
function renderWeek(interaction, y, m, d) {
  const end = addDays(y, m, d, 7);
  const list = flatten(interaction.guild, eventsInRange(
    interaction.guild.id,
    parisTimestamp(y, m, d),
    parisTimestamp(end.y, end.m, end.d)
  ));
  return generateAgendaWeek({
    ...baseOpts(interaction),
    start: { y, m, d },
    events: list,
    weekCount: list.length
  });
}
function renderAll(interaction) {
  const list = flatten(interaction.guild, activeEvents(interaction.guild.id));
  return generateAgendaAll({ ...baseOpts(interaction), events: list });
}

// ── Boutons (customId : agenda_<vue>_<params…>_<userId>) ────────────
//   agenda_m_<y>_<m>_<uid>   agenda_w_<y>_<m>_<d>_<uid>   agenda_a_<uid>
function buildPayload(interaction, view, p, uid) {
  let buf, prev, next, cur;
  if (view === 'w') {
    buf = renderWeek(interaction, p.y, p.m, p.d);
    const a = addDays(p.y, p.m, p.d, -7), b = addDays(p.y, p.m, p.d, 7);
    prev = `agenda_w_${a.y}_${a.m}_${a.d}_${uid}`;
    next = `agenda_w_${b.y}_${b.m}_${b.d}_${uid}`;
    const t = parisParts(Date.now()); const mon = mondayOf(t.y, t.m, t.d);
    cur = `agenda_w_${mon.y}_${mon.m}_${mon.d}_${uid}`;
  } else if (view === 'a') {
    buf = renderAll(interaction);
  } else {
    buf = renderMonth(interaction, p.y, p.m);
    const pm = p.m === 1 ? { y: p.y - 1, m: 12 } : { y: p.y, m: p.m - 1 };
    const nm = p.m === 12 ? { y: p.y + 1, m: 1 } : { y: p.y, m: p.m + 1 };
    prev = `agenda_m_${pm.y}_${pm.m}_${uid}`;
    next = `agenda_m_${nm.y}_${nm.m}_${uid}`;
    const t = parisParts(Date.now());
    cur = `agenda_m_${t.y}_${t.m}_${uid}`;
  }
  const t = parisParts(Date.now());
  const mon = mondayOf(t.y, t.m, t.d);
  const nav = new ActionRowBuilder();
  if (view !== 'a') {
    nav.addComponents(
      new ButtonBuilder().setCustomId(prev).setEmoji('◀️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(cur).setLabel('Aujourd\'hui').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(next).setEmoji('▶️').setStyle(ButtonStyle.Secondary)
    );
  }
  const views = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`agenda_m_${t.y}_${t.m}_${uid}`).setLabel('Mois').setEmoji('🗓️')
      .setStyle(view === 'm' ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(view === 'm'),
    new ButtonBuilder().setCustomId(`agenda_w_${mon.y}_${mon.m}_${mon.d}_${uid}`).setLabel('Semaine').setEmoji('📆')
      .setStyle(view === 'w' ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(view === 'w'),
    new ButtonBuilder().setCustomId(`agenda_a_${uid}`).setLabel('Tout').setEmoji('📋')
      .setStyle(view === 'a' ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(view === 'a')
  );
  return {
    files: [new AttachmentBuilder(buf, { name: 'agenda.png' })],
    components: view === 'a' ? [views] : [nav, views]
  };
}

// ── Commande ────────────────────────────────────────────────────────
const data = new SlashCommandBuilder()
  .setName('agenda')
  .setDescription('📅 Calendrier des convois, réunions et événements')
  .setDMPermission(false)
  .addSubcommand(sub => sub
    .setName('voir')
    .setDescription('Afficher le calendrier')
    .addStringOption(o => o.setName('vue').setDescription('Vue (défaut : mois)').setRequired(false)
      .addChoices(
        { name: 'Mois', value: 'm' },
        { name: 'Semaine', value: 'w' },
        { name: 'Tout (à venir)', value: 'a' }
      )))
  .addSubcommand(sub => sub
    .setName('remove')
    .setDescription('Annuler un événement')
    .addStringOption(o => o.setName('id').setDescription('Événement à annuler').setAutocomplete(true).setRequired(true)));

async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: '❌ Commande utilisable uniquement sur un serveur.', flags: MessageFlags.Ephemeral });
  }
  const sub = interaction.options.getSubcommand();

  if (sub === 'remove') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageEvents)) {
      return interaction.reply({ content: '❌ Il faut la permission **Gérer les événements**.', flags: MessageFlags.Ephemeral });
    }
    return cancelEventById(interaction, interaction.options.getString('id'));
  }

  const view = interaction.options.getString('vue') || 'm';
  const t = parisParts(Date.now());
  await interaction.deferReply();
  const mon = mondayOf(t.y, t.m, t.d);
  const p = view === 'w' ? { y: mon.y, m: mon.m, d: mon.d } : { y: t.y, m: t.m };
  return interaction.editReply(buildPayload(interaction, view, p, interaction.user.id));
}

async function autocomplete(interaction) {
  if (!interaction.guild) return interaction.respond([]);
  const q = String(interaction.options.getFocused() || '').toLowerCase();
  const choices = activeEvents(interaction.guild.id)
    .map(ev => {
      const p = parisParts(ev.startAt);
      return {
        name: `${pad2(p.d)}/${pad2(p.m)} ${pad2(p.hh)}h${pad2(p.mm)} · ${ev.name}`.slice(0, 100),
        value: String(ev.id)
      };
    })
    .filter(c => c.name.toLowerCase().includes(q))
    .slice(0, 25);
  return interaction.respond(choices);
}

// ── Boutons de navigation ───────────────────────────────────────────
async function routeAgendaInteraction(interaction) {
  if (!interaction.isButton() || !interaction.guild) return;
  const parts = interaction.customId.split('_'); // agenda, vue, …, uid
  const uid = parts[parts.length - 1];
  if (uid !== interaction.user.id) {
    return interaction.reply({ content: '❌ Ce calendrier est celui d\'un autre membre : utilise `/agenda voir`.', flags: MessageFlags.Ephemeral });
  }
  const view = parts[1];
  let p = {};
  if (view === 'm') p = { y: Number(parts[2]), m: Number(parts[3]) };
  else if (view === 'w') p = { y: Number(parts[2]), m: Number(parts[3]), d: Number(parts[4]) };
  else if (view !== 'a') return;
  await interaction.deferUpdate();
  return interaction.editReply({ ...buildPayload(interaction, view, p, uid), attachments: [] });
}

module.exports = {
  commands: [{ data, execute, autocomplete }],
  routeAgendaInteraction
};