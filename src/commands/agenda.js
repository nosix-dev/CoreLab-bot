'use strict';
// src/commands/agenda.js
// /agenda view [vue] [prive]       → calendrier interactif (image + boutons + menus)
//      vue semaine (style Google Agenda) ou vue mois, détail d'un jour, changement de mois
// /agenda remove <id>             → annuler un événement (autocomplétion) — permission « Gérer les événements »
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
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
  generateAgendaWeek,
  generateAgendaMonth,
  TYPES,
  MOIS_NOMS,
  JOURS_COURTS,
  JOUR_MS,
  dateDepuisTs,
  debutSemaine
} = require('../handlers/agendaImage');

const V2 = MessageFlags.IsComponentsV2;
const ACCENT_COLOR = 0xE8510D;
const EMOJI_TYPE = { reunion: '🟣', evenement: '🟡' };
const JOURS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const maj = s => s.charAt(0).toUpperCase() + s.slice(1);
const deux = n => String(n).padStart(2, '0');
const txt = c => new TextDisplayBuilder().setContent(c);
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const coupe = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// ── Données ─────────────────────────────────────────────────────────
// Événement du bot (eventManager) → format du calendrier
function aplatir(guild, ev) {
  const p = parisParts(ev.startAt);
  const type = ev.type === 'reunion' ? 'reunion' : 'evenement';
  const duree = ev.endAt && ev.endAt > ev.startAt
    ? Math.min(360, Math.max(30, Math.round((ev.endAt - ev.startAt) / 60000)))
    : 60;

  let lieu = ev.location || '';
  if (ev.voiceId) {
    const ch = guild.channels.cache.get(ev.voiceId);
    if (ch) lieu = ch.name;
  }

  const inscrits = (ev.yes || []).length;
  const details = [];
  if (lieu) details.push(`📍 ${lieu}`);
  details.push(`👥 ${ev.maxPlaces ? `${inscrits}/${ev.maxPlaces}` : `${inscrits} inscrit(s)`}`);
  const lignes = String(ev.description || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  for (const l of lignes.slice(0, 2)) details.push(`• ${l}`);

  return {
    type,
    annee: p.y, mois: p.m, jour: p.d,
    ts: Date.UTC(p.y, p.m - 1, p.d),
    minutes: p.hh * 60 + p.mm,
    heure: `${p.hh}h${deux(p.mm)}`,
    titre: String(ev.name || 'Sans titre'),
    duree,
    details
  };
}

function maintenant() {
  const p = parisParts(Date.now());
  return { y: p.y, m: p.m, d: p.d, minutes: p.hh * 60 + p.mm };
}

function prochainTexte(guild) {
  const ev = activeEvents(guild.id).find(e => e.startAt > Date.now());
  if (!ev) return 'Aucun';
  const p = parisParts(ev.startAt);
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${JOURS_COURTS[dow]} ${p.d} · ${p.hh}h${deux(p.mm)}`;
}

// Plage affichée selon la vue : { debut, fin } en timestamps de jours (fin incluse)
function plageDeLaVue(etat) {
  if (etat.vue === 'm') {
    return { debut: Date.UTC(etat.annee, etat.mois - 1, 1), fin: Date.UTC(etat.annee, etat.mois, 0) };
  }
  const debut = debutSemaine(Date.UTC(etat.annee, etat.mois - 1, etat.jour));
  return { debut, fin: debut + 6 * JOUR_MS };
}

function evenementsDeLaVue(guild, etat) {
  const { debut, fin } = plageDeLaVue(etat);
  // Marge de 2 jours de chaque côté (fuseau), puis filtre exact sur le jour de Paris
  return eventsInRange(guild.id, debut - 2 * JOUR_MS, fin + 3 * JOUR_MS)
    .map(ev => aplatir(guild, ev))
    .filter(e => e.ts >= debut && e.ts <= fin)
    .sort((a, b) => a.ts - b.ts || a.minutes - b.minutes);
}

// ── Navigation ──────────────────────────────────────────────────────
function ancreSuivante(etat, delta) {
  if (etat.vue === 'm') {
    const total = etat.annee * 12 + (etat.mois - 1) + delta;
    const annee = Math.floor(total / 12), mois = (total % 12) + 1;
    const now = maintenant();
    return { annee, mois, jour: now.y === annee && now.m === mois ? now.d : 1 };
  }
  const d = dateDepuisTs(Date.UTC(etat.annee, etat.mois - 1, etat.jour) + delta * 7 * JOUR_MS);
  return { annee: d.annee, mois: d.mois, jour: d.jour };
}

// customId : agenda_go_<vue>_<a>_<m>_<j>_<role>_<uid>
const idGo = (vue, a, role, uid) => `agenda_go_${vue}_${a.annee}_${a.mois}_${a.jour}_${role}_${uid}`;

// ── Message complet (image + détail + boutons + menus) ──────────────
function construireMessage(interaction, etat, selTs, uid) {
  const guild = interaction.guild;
  const evs = evenementsDeLaVue(guild, etat);
  if (selTs && !evs.some(e => e.ts === selTs)) selTs = null;

  const today = maintenant();
  const base = {
    botName: interaction.client.user.username,
    today,
    events: evs,
    selTs,
    next: prochainTexte(guild)
  };
  const buffer = etat.vue === 'm'
    ? generateAgendaMonth({ ...base, year: etat.annee, month: etat.mois })
    : generateAgendaWeek({ ...base, start: { y: etat.annee, m: etat.mois, d: etat.jour } });

  const nomFichier = `agenda-${Date.now()}.png`;
  const fichier = new AttachmentBuilder(buffer, { name: nomFichier });

  const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${nomFichier}`))
  );

  // ── Détail d'un jour ou agenda ──
  let contenu = '';
  if (selTs) {
    const d = dateDepuisTs(selTs);
    contenu = `### ${maj(JOURS_LONGS[d.dow])} ${d.jour} ${MOIS_NOMS[d.mois - 1]}\n`;
    for (const e of evs.filter(x => x.ts === selTs)) {
      const bloc =
        `${EMOJI_TYPE[e.type]} **${e.heure} — ${e.titre}** *(${TYPES[e.type].nom})*\n` +
        e.details.map(x => `> ${coupe(x, 160)}`).join('\n') + '\n';
      if ((contenu + bloc).length > 2600) { contenu += '…\n'; break; }
      contenu += bloc;
    }
  } else if (evs.length) {
    const MAX = 10;
    contenu = `### Agenda ${etat.vue === 'm' ? 'du mois' : 'de la semaine'}\n`;
    for (const e of evs.slice(0, MAX)) {
      const d = dateDepuisTs(e.ts);
      contenu += `\`${JOURS_COURTS[d.dow]} ${deux(d.jour)}\` ${EMOJI_TYPE[e.type]} **${e.heure}** ${coupe(e.titre, 60)}\n`;
    }
    if (evs.length > MAX) contenu += `-# … et ${evs.length - MAX} autre(s). Choisis un jour dans le menu pour le détail.`;
  } else {
    contenu = `Rien de prévu ${etat.vue === 'm' ? 'ce mois-ci' : 'cette semaine'}.`;
  }
  container.addSeparatorComponents(sep());
  container.addTextDisplayComponents(txt(contenu.trimEnd()));
  container.addSeparatorComponents(sep());

  // ── Boutons ──
  const prec = ancreSuivante(etat, -1);
  const suiv = ancreSuivante(etat, 1);
  const ancreActuelle = { annee: etat.annee, mois: etat.mois, jour: etat.jour };
  const autreVue = etat.vue === 'm' ? 's' : 'm';
  const lblPrec = etat.vue === 'm' ? `◀ ${maj(MOIS_NOMS[prec.mois - 1])}` : '◀ Semaine préc.';
  const lblSuiv = etat.vue === 'm' ? `${maj(MOIS_NOMS[suiv.mois - 1])} ▶` : 'Semaine suiv. ▶';

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(idGo(etat.vue, prec, 'p', uid)).setLabel(lblPrec).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(idGo(etat.vue, { annee: today.y, mois: today.m, jour: today.d }, 't', uid)).setLabel("Aujourd'hui").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(idGo(etat.vue, suiv, 'n', uid)).setLabel(lblSuiv).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(idGo(autreVue, ancreActuelle, 'v', uid)).setLabel(etat.vue === 'm' ? '📅 Vue semaine' : '🗓️ Vue mois').setStyle(ButtonStyle.Primary)
    )
  );

  // ── Menu : détail d'un jour ──
  const joursAvecEv = [...new Set(evs.map(e => e.ts))].sort((a, b) => a - b).slice(0, 25);
  if (joursAvecEv.length) {
    const options = joursAvecEv.map(ts => {
      const d = dateDepuisTs(ts);
      const duJour = evs.filter(e => e.ts === ts);
      return {
        label: `${maj(JOURS_COURTS[d.dow])} ${d.jour} ${MOIS_NOMS[d.mois - 1]} — ${duJour.length} événement${duJour.length > 1 ? 's' : ''}`,
        description: coupe(duJour.map(e => e.titre).join(', '), 100),
        value: `${d.annee}-${d.mois}-${d.jour}`,
        default: ts === selTs
      };
    });
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`agenda_pick_${etat.vue}_${uid}`)
          .setPlaceholder('📌 Voir le détail d\'un jour…')
          .addOptions(options)
      )
    );
  }

  // ── Menu : choisir le mois ──
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`agenda_mois_${etat.vue}_${etat.annee}_${uid}`)
        .setPlaceholder(`🗓️ Changer de mois (${etat.annee})`)
        .addOptions(
          MOIS_NOMS.map((nom, i) => ({
            label: maj(nom),
            value: String(i + 1),
            default: i + 1 === etat.mois
          }))
        )
    )
  );

  container.addTextDisplayComponents(txt(`-# ${interaction.client.user.username} • /event create alimente ce calendrier`));
  return { components: [container], files: [fichier], flags: V2 };
}

// ── Commande ────────────────────────────────────────────────────────
const data = new SlashCommandBuilder()
  .setName('agenda')
  .setDescription('📅 Calendrier des réunions et événements')
  .setDMPermission(false)
  .addSubcommand(sub => sub
    .setName('view')
    .setDescription('Afficher le calendrier')
    .addStringOption(o => o.setName('vue').setDescription('Type d\'affichage (semaine par défaut)').setRequired(false)
      .addChoices(
        { name: 'Semaine (style Google Agenda)', value: 's' },
        { name: 'Mois', value: 'm' }
      ))
    .addBooleanOption(o => o.setName('prive').setDescription('Visible seulement par toi').setRequired(false)))
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

  const prive = interaction.options.getBoolean('prive') || false;
  await interaction.deferReply({ flags: prive ? V2 | MessageFlags.Ephemeral : V2 });
  try {
    const now = maintenant();
    const ancre = { annee: now.y, mois: now.m, jour: now.d };
    const vue = interaction.options.getString('vue') || 's';
    return await interaction.editReply(construireMessage(interaction, { vue, ...ancre }, null, interaction.user.id));
  } catch (err) {
    console.error('[Agenda] /agenda view :', err);
    return interaction.editReply({
      components: [new ContainerBuilder().setAccentColor(0xEA3C45).addTextDisplayComponents(txt(`## ⚠️ Erreur agenda\n\`${String(err.message).slice(0, 300)}\``))],
      flags: V2
    }).catch(() => { });
  }
}

async function autocomplete(interaction) {
  if (!interaction.guild) return interaction.respond([]);
  const q = String(interaction.options.getFocused() || '').toLowerCase();
  const choices = activeEvents(interaction.guild.id)
    .map(ev => {
      const p = parisParts(ev.startAt);
      return {
        name: `${deux(p.d)}/${deux(p.m)} ${deux(p.hh)}h${deux(p.mm)} · ${ev.name}`.slice(0, 100),
        value: String(ev.id)
      };
    })
    .filter(c => c.name.toLowerCase().includes(q))
    .slice(0, 25);
  return interaction.respond(choices);
}

// ── Boutons et menus de navigation ──────────────────────────────────
async function routeAgendaInteraction(interaction) {
  if (!interaction.guild) return;
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  const parts = interaction.customId.split('_'); // agenda, type, …, uid
  const uid = parts[parts.length - 1];
  if (uid !== interaction.user.id) {
    return interaction.reply({ content: '❌ Ce calendrier est celui d\'un autre membre : utilise `/agenda view`.', flags: MessageFlags.Ephemeral });
  }

  let etat = null;
  let selTs = null;

  if (interaction.isButton() && parts[1] === 'go') {
    // agenda_go_<vue>_<a>_<m>_<j>_<role>_<uid>
    etat = { vue: parts[2], annee: +parts[3], mois: +parts[4], jour: +parts[5] };
  } else if (interaction.isStringSelectMenu() && parts[1] === 'pick') {
    // agenda_pick_<vue>_<uid>
    const [a, mo, j] = interaction.values[0].split('-').map(Number);
    etat = { vue: parts[2], annee: a, mois: mo, jour: j };
    selTs = Date.UTC(a, mo - 1, j);
  } else if (interaction.isStringSelectMenu() && parts[1] === 'mois') {
    // agenda_mois_<vue>_<annee>_<uid>
    const annee = +parts[3];
    const mois = +interaction.values[0];
    const now = maintenant();
    etat = { vue: parts[2], annee, mois, jour: now.y === annee && now.m === mois ? now.d : 1 };
  } else {
    return;
  }
  if (!['s', 'm'].includes(etat.vue)) return;

  await interaction.deferUpdate();
  const message = construireMessage(interaction, etat, selTs, uid);
  return interaction.editReply({ ...message, attachments: [] });
}

module.exports = {
  commands: [{ data, execute, autocomplete }],
  routeAgendaInteraction
};