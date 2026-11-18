// ────────────────────────────────────────────────────────────────────
// /absence — gestion des absences du staff
//   /absence déclarer       → ouvre le formulaire (début, fin, motif, infos)
//   /absence annuler        → annule une demande en attente ou une absence approuvée pas encore commencée
//   /absence équipe         → qui est absent aujourd'hui et bientôt (14 jours)
//   /absence mes-absences   → tes absences en attente, en cours et à venir
//   /absence prolonger      → demande de prolonger ton absence en cours
//   /absence retour         → signale ton retour avant la date prévue
//   /absence configurer     → (admin) salon des demandes + rôle du staff
//
// Fonctionnement : une demande est postée dans le salon configuré avec les boutons
// « Approuver / Refuser ». Seuls les membres qui ont « Gérer le serveur » ou « Administrateur »
// peuvent trancher. Les dates sont saisies en heure de Paris (JJ/MM/AAAA HH:MM).
// Données : absences.json (suit DATA_DIR comme les autres fichiers du bot).
// ────────────────────────────────────────────────────────────────────
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  TextDisplayBuilder,
  ChannelType,
  MessageFlags
} = require('discord.js');
const { chargerDonnees, sauvegarderDonnees } = require('../core/data');

const FICHIER = 'absences.json';
const TZ = 'Europe/Paris';
const COULEUR = 0xE8510D;
const VERT = 0x3BA55D;
const ROUGE = 0xED4245;
const GRIS = 0x6B6878;
const MAX_EN_ATTENTE = 3;
const MAX_DUREE_MS = 365 * 24 * 3600 * 1000;
const FENETRE_EQUIPE_MS = 14 * 24 * 3600 * 1000;
const TOLERANCE_DEBUT_MS = 3600 * 1000; // on accepte un début jusqu'à 1 h dans le passé

// Structure : { [guildId]: { config: { channelId, roleId }, items: [absence] } }
// absence : { id, userId, start, end, reason, info, status, createdAt, channelId, messageId,
//             decidedBy, returnedAt, extension: null | { end, reason, messageId, channelId } }
// status : 'pending' | 'approved' | 'refused' | 'cancelled'
const donnees = chargerDonnees(FICHIER, {});
const sauver = () => sauvegarderDonnees(FICHIER, donnees);

function serveur(guildId) {
  const k = String(guildId);
  if (!donnees[k] || typeof donnees[k] !== 'object') donnees[k] = {};
  if (!donnees[k].config || typeof donnees[k].config !== 'object') donnees[k].config = {};
  if (!Array.isArray(donnees[k].items)) donnees[k].items = [];
  return donnees[k];
}

const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const unix = ms => Math.floor(ms / 1000);
const tsF = ms => `<t:${unix(ms)}:f>`;
const tsR = ms => `<t:${unix(ms)}:R>`;
const tsD = ms => `<t:${unix(ms)}:D>`;
const tronquer = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// ── Dates en heure de Paris ─────────────────────────────────────────
function decalageParis(ms) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

// « 25/12/2026 18:30 » (ou « 25/12/2026 », avec « · heure de Paris » toléré) → timestamp ms, ou null
function lireDateParis(texte, heureDefaut = [0, 0]) {
  const brut = String(texte || '').replace(/[·•]/g, ' ').replace(/heure\s+de\s+paris/i, '').trim();
  const m = brut.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:\s+(?:à\s*)?(\d{1,2})\s*[:hH]\s*(\d{2})?)?$/i);
  if (!m) return null;
  const [j, mo, a] = [+m[1], +m[2], +m[3]];
  const h = m[4] !== undefined ? +m[4] : heureDefaut[0];
  const mi = m[5] !== undefined ? +m[5] : (m[4] !== undefined ? 0 : heureDefaut[1]);
  if (mo < 1 || mo > 12 || j < 1 || j > 31 || h > 23 || mi > 59 || a < 2000 || a > 2100) return null;
  const devine = Date.UTC(a, mo - 1, j, h, mi);
  const verif = new Date(devine);
  if (verif.getUTCDate() !== j || verif.getUTCMonth() !== mo - 1) return null; // ex. 31/02
  const d1 = decalageParis(devine);
  let t = devine - d1;
  const d2 = decalageParis(t);
  if (d2 !== d1) t = devine - d2;
  return t;
}

function courtParis(ms) {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(new Date(ms)).replace(',', '');
  } catch { return ''; }
}

function dureeHumaine(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  const j = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (j) return `${j} j${h ? ` ${h} h` : ''}`;
  if (h) return `${h} h${m ? ` ${m} min` : ''}`;
  return `${m} min`;
}

// ── États ───────────────────────────────────────────────────────────
function phase(a, now = Date.now()) {
  if (a.status === 'pending') return 'pending';
  if (a.status !== 'approved') return a.status; // refused | cancelled
  if (a.returnedAt) return 'returned';
  if (now < a.start) return 'upcoming';
  if (now <= a.end) return 'active';
  return 'past';
}
const ETIQUETTES = {
  pending: '⏳ En attente',
  upcoming: '📅 À venir',
  active: '🟠 En cours',
  past: '✔️ Terminée',
  returned: '↩️ Retour signalé',
  refused: '❌ Refusée',
  cancelled: '🚫 Annulée'
};
const annulable = (a, now = Date.now()) => a.status === 'pending' || (a.status === 'approved' && !a.returnedAt && now < a.start);

// ── Droits ──────────────────────────────────────────────────────────
function estResponsable(interaction) {
  const p = interaction.memberPermissions;
  return !!p && (p.has(PermissionFlagsBits.Administrator) || p.has(PermissionFlagsBits.ManageGuild));
}
function estStaff(interaction, cfg) {
  if (estResponsable(interaction)) return true;
  if (cfg.roleId) return !!interaction.member?.roles?.cache?.has(cfg.roleId);
  return !!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers);
}

const repondre = (interaction, contenu) => interaction.reply({ content: contenu, flags: MessageFlags.Ephemeral });

// ── Commande ────────────────────────────────────────────────────────
const data = new SlashCommandBuilder()
  .setName('absence')
  .setDescription('🗓️ Absences du staff : déclarer, prolonger, annuler, équipe')
  .addSubcommand(s => s.setName('déclarer').setDescription('Déclare une absence (ouvre le formulaire).'))
  .addSubcommand(s => s.setName('annuler').setDescription('Annule une demande en attente ou une absence approuvée pas encore commencée.')
    .addStringOption(o => o.setName('absence').setDescription('Absence à annuler (si tu en as plusieurs)').setAutocomplete(true)))
  .addSubcommand(s => s.setName('équipe').setDescription('Qui est absent aujourd’hui et bientôt (14 jours).'))
  .addSubcommand(s => s.setName('mes-absences').setDescription('Tes absences en attente, en cours et à venir.'))
  .addSubcommand(s => s.setName('prolonger').setDescription('Demande de prolonger ton absence en cours.'))
  .addSubcommand(s => s.setName('retour').setDescription('Signale ton retour avant la date prévue.'))
  .addSubcommand(s => s.setName('configurer').setDescription('Admin • Salon des demandes et rôle du staff')
    .addChannelOption(o => o.setName('salon').setDescription('Salon où les demandes sont envoyées')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption(o => o.setName('role-staff').setDescription('Rôle des membres qui peuvent déclarer une absence')));

// ── Formulaires ─────────────────────────────────────────────────────
function champ(id, label, { style = TextInputStyle.Short, placeholder, required = true, max = 100, min } = {}) {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(max);
  if (min) input.setMinLength(min);
  if (placeholder) input.setPlaceholder(placeholder);
  return new LabelBuilder().setLabel(label).setTextInputComponent(input);
}

function avertissement(client) {
  return `⚠️ Ce formulaire sera transmis à **${client.user?.username || 'CoreLab'}**. Ne donne pas de mot de passe ni toute autre information sensible.`;
}

function modaleDeclarer(interaction) {
  const nom = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  const modal = new ModalBuilder().setCustomId('absence:declare').setTitle(tronquer(`Absence de ${nom}`, 45));
  // Le bloc de texte dans une modale demande une version récente de discord.js : sinon on l'ignore.
  if (typeof modal.addTextDisplayComponents === 'function') {
    modal.addTextDisplayComponents(new TextDisplayBuilder().setContent(avertissement(interaction.client)));
  }
  modal.addLabelComponents(
    champ('debut', 'Début', { placeholder: 'JJ/MM/AAAA HH:MM · heure de Paris', min: 8, max: 40 }),
    champ('fin', 'Fin prévue', { placeholder: 'JJ/MM/AAAA HH:MM · heure de Paris', min: 8, max: 40 }),
    champ('motif', 'Motif', { placeholder: 'vacances, examens, raison personnelle, déplacement…', max: 100 }),
    champ('infos', 'Informations complémentaires', { style: TextInputStyle.Paragraph, placeholder: 'facultatif', required: false, max: 500 })
  );
  return modal;
}

function modaleProlonger(interaction, absence) {
  const nom = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  const modal = new ModalBuilder().setCustomId(`absence:extend:${absence.id}`).setTitle(tronquer(`Prolonger l’absence de ${nom}`, 45));
  if (typeof modal.addTextDisplayComponents === 'function') {
    modal.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `Fin actuelle : ${tsF(absence.end)}\n${avertissement(interaction.client)}`));
  }
  modal.addLabelComponents(
    champ('fin', 'Nouvelle fin prévue', { placeholder: 'JJ/MM/AAAA HH:MM · heure de Paris', min: 8, max: 40 }),
    champ('motif', 'Motif de la prolongation', { placeholder: 'ce qui justifie la prolongation', max: 100 })
  );
  return modal;
}

// ── Messages de demande (salon des responsables) ───────────────────
function embedDemande(a, user, { extension = false } = {}) {
  const e = new EmbedBuilder().setTimestamp(a.createdAt);
  if (user) e.setThumbnail(user.displayAvatarURL({ size: 128 }));
  e.setFooter({ text: `ID ${a.id}` });
  if (extension) {
    const x = a.extension;
    e.setColor(COULEUR).setTitle('⏩ Demande de prolongation')
      .setDescription(`<@${a.userId}> demande à prolonger son absence en cours.`)
      .addFields(
        { name: 'Fin actuelle', value: `${tsF(a.end)}`, inline: true },
        { name: 'Nouvelle fin demandée', value: `${tsF(x.end)}\n${tsR(x.end)}`, inline: true },
        { name: 'Motif', value: tronquer(x.reason || '—', 1000) }
      );
    return e;
  }
  const couleur = { pending: COULEUR, upcoming: VERT, active: VERT, past: VERT, returned: VERT, refused: ROUGE, cancelled: GRIS }[phase(a)] || COULEUR;
  e.setColor(couleur).setTitle('🗓️ Demande d’absence')
    .setDescription(`<@${a.userId}> ${a.status === 'pending' ? 'demande à s’absenter' : 'a déclaré une absence'}.`)
    .addFields(
      { name: 'Début', value: `${tsF(a.start)}\n${tsR(a.start)}`, inline: true },
      { name: 'Fin prévue', value: `${tsF(a.end)}\n${tsR(a.end)}`, inline: true },
      { name: 'Durée', value: dureeHumaine(a.end - a.start), inline: true },
      { name: 'Motif', value: tronquer(a.reason || '—', 1000) }
    );
  if (a.info) e.addFields({ name: 'Informations complémentaires', value: tronquer(a.info, 1000) });
  let statut = ETIQUETTES[phase(a)] || '—';
  if (a.decidedBy && (a.status === 'approved' || a.status === 'refused')) statut += ` · par <@${a.decidedBy}>`;
  if (a.returnedAt) statut += ` · ${tsF(a.returnedAt)}`;
  e.addFields({ name: 'Statut', value: statut });
  return e;
}

function boutonsDemande(a, extension = false) {
  const p = extension ? 'x' : '';
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`absence:${p}ok:${a.id}`).setLabel('Approuver').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`absence:${p}no:${a.id}`).setLabel('Refuser').setEmoji('❌').setStyle(ButtonStyle.Danger)
  )];
}

async function salonDemandes(client, cfg) {
  if (!cfg.channelId) return null;
  const salon = await client.channels.fetch(cfg.channelId).catch(() => null);
  return salon && salon.isTextBased() ? salon : null;
}

async function majMessage(client, guildId, a) {
  try {
    const cfg = serveur(guildId).config;
    const salon = await client.channels.fetch(a.channelId || cfg.channelId).catch(() => null);
    const msg = salon && a.messageId ? await salon.messages.fetch(a.messageId).catch(() => null) : null;
    if (!msg) return;
    const user = await client.users.fetch(a.userId).catch(() => null);
    await msg.edit({ embeds: [embedDemande(a, user)], components: a.status === 'pending' ? boutonsDemande(a) : [] });
  } catch { /* message supprimé ou salon inaccessible : on ignore */ }
}

const mp = (client, userId, contenu) => client.users.fetch(userId).then(u => u.send(contenu)).catch(() => { });

// ── Exécution des sous-commandes ────────────────────────────────────
async function execute(interaction) {
  if (!interaction.guild) return repondre(interaction, '❌ Cette commande fonctionne uniquement dans un serveur.');
  const sub = interaction.options.getSubcommand();
  const srv = serveur(interaction.guild.id);
  const cfg = srv.config;
  const now = Date.now();

  if (sub === 'configurer') {
    if (!estResponsable(interaction)) return repondre(interaction, '❌ Réservé aux membres qui ont « Gérer le serveur ».');
    const salon = interaction.options.getChannel('salon');
    const role = interaction.options.getRole('role-staff');
    if (salon) {
      const me = interaction.guild.members.me;
      const droits = salon.permissionsFor(me);
      if (!droits?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        return repondre(interaction, `❌ Je ne peux pas écrire (avec des embeds) dans <#${salon.id}>. Donne-moi les permissions puis réessaie.`);
      }
      cfg.channelId = salon.id;
    }
    if (role) {
      if (role.id === interaction.guild.id) return repondre(interaction, '❌ @everyone ne peut pas être le rôle du staff.');
      cfg.roleId = role.id;
    }
    if (salon || role) sauver();
    const e = new EmbedBuilder().setColor(COULEUR).setTitle('🗓️ Absences — configuration')
      .addFields(
        { name: 'Salon des demandes', value: cfg.channelId ? `<#${cfg.channelId}>` : '⚠️ non défini (obligatoire)', inline: true },
        { name: 'Rôle du staff', value: cfg.roleId ? `<@&${cfg.roleId}>` : 'non défini (modérateurs, « Gérer le serveur »)', inline: true }
      )
      .setFooter({ text: 'Les demandes sont approuvées par les membres qui ont « Gérer le serveur ».' });
    return interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  if (!estStaff(interaction, cfg)) {
    return repondre(interaction, cfg.roleId
      ? `❌ Cette commande est réservée au rôle <@&${cfg.roleId}>.`
      : '❌ Cette commande est réservée au staff.');
  }

  if (sub === 'déclarer') {
    if (!cfg.channelId) return repondre(interaction, '⚠️ Les absences ne sont pas encore configurées. Un responsable doit lancer `/absence configurer` (salon des demandes).');
    const enAttente = srv.items.filter(a => a.userId === interaction.user.id && a.status === 'pending').length;
    if (enAttente >= MAX_EN_ATTENTE) return repondre(interaction, `❌ Tu as déjà ${MAX_EN_ATTENTE} demandes en attente. Attends leur traitement ou annule-en une avec \`/absence annuler\`.`);
    return interaction.showModal(modaleDeclarer(interaction));
  }

  if (sub === 'annuler') {
    const miennes = srv.items.filter(a => a.userId === interaction.user.id && annulable(a, now));
    if (!miennes.length) return repondre(interaction, 'ℹ️ Tu n’as aucune demande en attente ni absence à venir à annuler. (Une absence déjà commencée se termine avec `/absence retour`.)');
    const choix = interaction.options.getString('absence');
    let cible = choix ? miennes.find(a => a.id === choix) : null;
    if (choix && !cible) return repondre(interaction, '❌ Absence introuvable ou qui ne peut plus être annulée.');
    if (!cible) {
      if (miennes.length > 1) {
        return repondre(interaction, `ℹ️ Tu as ${miennes.length} absences annulables : relance la commande et choisis l’absence dans le champ **absence**.\n` +
          miennes.map(a => `• ${courtParis(a.start)} → ${courtParis(a.end)} · ${ETIQUETTES[phase(a)]}`).join('\n'));
      }
      cible = miennes[0];
    }
    cible.status = 'cancelled';
    cible.extension = null;
    sauver();
    majMessage(interaction.client, interaction.guild.id, cible);
    return repondre(interaction, `🚫 Absence annulée (${tsD(cible.start)} → ${tsD(cible.end)}).`);
  }

  if (sub === 'équipe') {
    const approuvees = srv.items.filter(a => a.status === 'approved' && !a.returnedAt && a.end >= now);
    const actives = approuvees.filter(a => a.start <= now).sort((x, y) => x.end - y.end);
    const bientot = approuvees.filter(a => a.start > now && a.start <= now + FENETRE_EQUIPE_MS).sort((x, y) => x.start - y.start);
    const liste = (tab, fmt) => {
      if (!tab.length) return null;
      const lignes = tab.slice(0, 20).map(fmt);
      if (tab.length > 20) lignes.push(`… et ${tab.length - 20} autre(s)`);
      return lignes.join('\n');
    };
    const e = new EmbedBuilder().setColor(COULEUR).setTitle('🗓️ Absences de l’équipe')
      .addFields(
        { name: `🟠 Absents aujourd’hui (${actives.length})`, value: liste(actives, a => `• <@${a.userId}> — jusqu’au ${tsF(a.end)} (${tsR(a.end)})`) || 'Personne n’est absent ✅' },
        { name: `📅 Bientôt — 14 jours (${bientot.length})`, value: liste(bientot, a => `• <@${a.userId}> — du ${tsD(a.start)} au ${tsD(a.end)}`) || 'Aucune absence prévue.' }
      );
    return interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  if (sub === 'mes-absences') {
    const miennes = srv.items
      .filter(a => a.userId === interaction.user.id && ['pending', 'upcoming', 'active'].includes(phase(a, now)))
      .sort((x, y) => x.start - y.start);
    if (!miennes.length) return repondre(interaction, 'ℹ️ Tu n’as aucune absence en attente, en cours ou à venir. Utilise `/absence déclarer`.');
    const e = new EmbedBuilder().setColor(COULEUR).setTitle('🗓️ Tes absences');
    miennes.slice(0, 15).forEach(a => {
      let v = `${tsF(a.start)} → ${tsF(a.end)}\nMotif : ${tronquer(a.reason || '—', 200)}`;
      if (a.extension) v += `\n⏩ Prolongation demandée jusqu’au ${tsF(a.extension.end)} (en attente)`;
      e.addFields({ name: ETIQUETTES[phase(a, now)], value: v });
    });
    return interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
  }

  if (sub === 'prolonger') {
    const active = srv.items.find(a => a.userId === interaction.user.id && phase(a, now) === 'active');
    if (!active) return repondre(interaction, 'ℹ️ Tu n’as aucune absence en cours à prolonger.');
    if (active.extension) return repondre(interaction, '⏳ Une demande de prolongation est déjà en attente pour cette absence.');
    return interaction.showModal(modaleProlonger(interaction, active));
  }

  if (sub === 'retour') {
    const active = srv.items.find(a => a.userId === interaction.user.id && phase(a, now) === 'active');
    if (!active) return repondre(interaction, 'ℹ️ Tu n’as aucune absence en cours. (Pour une absence pas encore commencée, utilise `/absence annuler`.)');
    active.returnedAt = now;
    active.extension = null;
    sauver();
    majMessage(interaction.client, interaction.guild.id, active);
    const salon = await salonDemandes(interaction.client, cfg);
    if (salon) salon.send({ content: `↩️ <@${interaction.user.id}> est de retour (absence prévue jusqu’au ${tsF(active.end)}).`, allowedMentions: { parse: [] } }).catch(() => { });
    return repondre(interaction, '↩️ Bon retour ! Ton absence est terminée.');
  }
}

// ── Autocomplétion de /absence annuler ──────────────────────────────
async function autocomplete(interaction) {
  const now = Date.now();
  const q = String(interaction.options.getFocused() || '').toLowerCase();
  const items = interaction.guild
    ? serveur(interaction.guild.id).items.filter(a => a.userId === interaction.user.id && annulable(a, now))
    : [];
  const choix = items
    .map(a => ({ name: tronquer(`${courtParis(a.start)} → ${courtParis(a.end)} · ${ETIQUETTES[phase(a, now)]}`, 100), value: a.id }))
    .filter(c => !q || c.name.toLowerCase().includes(q))
    .slice(0, 25);
  return interaction.respond(choix);
}

// ── Modales et boutons ──────────────────────────────────────────────
async function envoyerDemande(interaction, srv, a, { extension = false } = {}) {
  const salon = await salonDemandes(interaction.client, srv.config);
  if (!salon) return false;
  try {
    const msg = await salon.send({
      embeds: [embedDemande(a, interaction.user, { extension })],
      components: boutonsDemande(a, extension),
      allowedMentions: { parse: [] }
    });
    if (extension) {
      a.extension.messageId = msg.id;
      a.extension.channelId = msg.channelId;
    } else {
      a.messageId = msg.id;
      a.channelId = msg.channelId;
    }
    return true;
  } catch (e) {
    console.error('[Absence] envoi de la demande :', e.message);
    return false;
  }
}

async function soumettreDeclaration(interaction) {
  if (!interaction.guild) return;
  const srv = serveur(interaction.guild.id);
  if (!estStaff(interaction, srv.config)) return repondre(interaction, '❌ Cette commande est réservée au staff.');
  const now = Date.now();
  const debut = lireDateParis(interaction.fields.getTextInputValue('debut'), [0, 0]);
  const fin = lireDateParis(interaction.fields.getTextInputValue('fin'), [23, 59]);
  const motif = interaction.fields.getTextInputValue('motif').trim();
  let infos = '';
  try { infos = interaction.fields.getTextInputValue('infos').trim(); } catch { /* champ absent */ }
  const aide = 'Format attendu : `JJ/MM/AAAA HH:MM` (heure de Paris), par exemple `24/12/2026 18:30`.';

  if (debut === null) return repondre(interaction, `❌ Date de début invalide. ${aide}`);
  if (fin === null) return repondre(interaction, `❌ Date de fin invalide. ${aide}`);
  if (!motif) return repondre(interaction, '❌ Le motif est obligatoire.');
  if (debut < now - TOLERANCE_DEBUT_MS) return repondre(interaction, '❌ Le début ne peut pas être dans le passé.');
  if (fin <= debut) return repondre(interaction, '❌ La fin doit être après le début.');
  if (fin - debut > MAX_DUREE_MS) return repondre(interaction, '❌ Une absence ne peut pas dépasser 1 an.');
  if (srv.items.filter(a => a.userId === interaction.user.id && a.status === 'pending').length >= MAX_EN_ATTENTE) {
    return repondre(interaction, `❌ Tu as déjà ${MAX_EN_ATTENTE} demandes en attente.`);
  }
  const chevauche = srv.items.find(a => a.userId === interaction.user.id
    && (a.status === 'pending' || (a.status === 'approved' && !a.returnedAt))
    && a.start < fin && debut < a.end);
  if (chevauche) return repondre(interaction, `❌ Cette période chevauche une absence existante (${tsF(chevauche.start)} → ${tsF(chevauche.end)}).`);

  const a = {
    id: nouvelId(), userId: interaction.user.id, start: debut, end: fin,
    reason: motif, info: infos, status: 'pending', createdAt: now,
    channelId: null, messageId: null, decidedBy: null, returnedAt: null, extension: null
  };
  srv.items.push(a);
  if (!(await envoyerDemande(interaction, srv, a))) {
    srv.items.pop();
    return repondre(interaction, '❌ Je n’ai pas pu envoyer la demande : le salon des absences est introuvable ou inaccessible. Préviens un responsable (`/absence configurer`).');
  }
  sauver();
  return interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [new EmbedBuilder().setColor(COULEUR).setTitle('✅ Demande envoyée')
      .setDescription(`Ta demande d’absence a été transmise aux responsables.\n${tsF(debut)} → ${tsF(fin)} (${dureeHumaine(fin - debut)})`)
      .setFooter({ text: 'Tu seras prévenu en MP de la décision.' })]
  });
}

async function soumettreProlongation(interaction, id) {
  if (!interaction.guild) return;
  const srv = serveur(interaction.guild.id);
  const now = Date.now();
  const a = srv.items.find(x => x.id === id && x.userId === interaction.user.id);
  if (!a || phase(a, now) !== 'active') return repondre(interaction, 'ℹ️ Cette absence n’est plus en cours.');
  if (a.extension) return repondre(interaction, '⏳ Une demande de prolongation est déjà en attente.');
  const fin = lireDateParis(interaction.fields.getTextInputValue('fin'), [23, 59]);
  const motif = interaction.fields.getTextInputValue('motif').trim();
  if (fin === null) return repondre(interaction, '❌ Date invalide. Format attendu : `JJ/MM/AAAA HH:MM` (heure de Paris).');
  if (fin <= a.end) return repondre(interaction, `❌ La nouvelle fin doit être après la fin actuelle (${tsF(a.end)}).`);
  if (fin - a.start > MAX_DUREE_MS) return repondre(interaction, '❌ Une absence ne peut pas dépasser 1 an.');
  if (!motif) return repondre(interaction, '❌ Le motif est obligatoire.');
  a.extension = { end: fin, reason: motif, messageId: null, channelId: null };
  if (!(await envoyerDemande(interaction, srv, a, { extension: true }))) {
    a.extension = null;
    return repondre(interaction, '❌ Je n’ai pas pu envoyer la demande : le salon des absences est introuvable ou inaccessible.');
  }
  sauver();
  return repondre(interaction, `✅ Demande de prolongation envoyée jusqu’au ${tsF(fin)}.`);
}

async function traiterBouton(interaction) {
  const [, action, id] = interaction.customId.split(':');
  if (!interaction.guild) return;
  if (!estResponsable(interaction)) return repondre(interaction, '❌ Seuls les membres qui ont « Gérer le serveur » peuvent traiter une demande.');
  const srv = serveur(interaction.guild.id);
  const a = srv.items.find(x => x.id === id);
  const extension = action === 'xok' || action === 'xno';
  const user = a ? await interaction.client.users.fetch(a.userId).catch(() => null) : null;

  if (!a || (extension ? !a.extension : a.status !== 'pending')) {
    await repondre(interaction, 'ℹ️ Cette demande a déjà été traitée (ou n’existe plus).');
    return interaction.message.edit({ components: [] }).catch(() => { });
  }

  if (!extension) {
    a.status = action === 'ok' ? 'approved' : 'refused';
    a.decidedBy = interaction.user.id;
    sauver();
    await interaction.update({ embeds: [embedDemande(a, user)], components: [], allowedMentions: { parse: [] } });
    mp(interaction.client, a.userId, a.status === 'approved'
      ? `✅ Ton absence du ${tsF(a.start)} au ${tsF(a.end)} sur **${interaction.guild.name}** a été **approuvée**.`
      : `❌ Ta demande d’absence du ${tsF(a.start)} au ${tsF(a.end)} sur **${interaction.guild.name}** a été **refusée**. Contacte un responsable si besoin.`);
    return;
  }

  const ext = a.extension;
  const accepte = action === 'xok';
  const e = embedDemande(a, user, { extension: true });
  e.setColor(accepte ? VERT : ROUGE).addFields({ name: 'Statut', value: `${accepte ? '✅ Approuvée' : '❌ Refusée'} · par <@${interaction.user.id}>` });
  if (accepte) a.end = ext.end;
  a.extension = null;
  sauver();
  await interaction.update({ embeds: [e], components: [], allowedMentions: { parse: [] } });
  majMessage(interaction.client, interaction.guild.id, a);
  mp(interaction.client, a.userId, accepte
    ? `✅ Ta prolongation sur **${interaction.guild.name}** a été **approuvée** : tu es absent jusqu’au ${tsF(a.end)}.`
    : `❌ Ta demande de prolongation sur **${interaction.guild.name}** a été **refusée**.`);
}

async function routeAbsenceInteraction(interaction) {
  const id = interaction.customId || '';
  try {
    if (interaction.isModalSubmit()) {
      if (id === 'absence:declare') return await soumettreDeclaration(interaction);
      if (id.startsWith('absence:extend:')) return await soumettreProlongation(interaction, id.split(':')[2]);
    }
    if (interaction.isButton() && /^absence:(ok|no|xok|xno):/.test(id)) return await traiterBouton(interaction);
  } catch (e) {
    console.error('[Absence] interaction :', e);
    const payload = { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload); else await interaction.reply(payload);
    } catch { /* ignoré */ }
  }
}

// ── API pour le dashboard web (src/core/webDashboard.js) ────────────
// Liste lisible des absences non annulées/refusées des 30 derniers jours et à venir.
function listerPourDashboard(guild) {
  const now = Date.now();
  return serveur(guild.id).items
    .filter(a => (a.status === 'pending' || a.status === 'approved') && a.end >= now - 30 * 24 * 3600 * 1000)
    .sort((x, y) => x.start - y.start)
    .map(a => ({
      id: a.id,
      member: guild.members.cache.get(a.userId)?.displayName || a.userId,
      from: new Date(a.start + decalageParis(a.start)).toISOString().slice(0, 10),
      to: new Date(a.end + decalageParis(a.end)).toISOString().slice(0, 10),
      reason: a.reason || '',
      status: phase(a, now)
    }));
}

// Ajoute une absence déjà approuvée (saisie depuis le dashboard par un responsable).
// from / to : « AAAA-MM-JJ ». Retourne { ok: true } ou { error }.
function ajouterDepuisDashboard(guild, { userId, from, to, reason, decidedBy }) {
  const conv = d => String(d || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');
  const debut = lireDateParis(conv(from), [0, 0]);
  const fin = lireDateParis(conv(to), [23, 59]);
  if (debut === null || fin === null) return { error: 'invalid_date' };
  if (fin <= debut) return { error: 'end_before_start' };
  if (fin - debut > MAX_DUREE_MS) return { error: 'too_long' };
  const srv = serveur(guild.id);
  if (srv.items.some(a => a.userId === userId && (a.status === 'pending' || (a.status === 'approved' && !a.returnedAt)) && a.start < fin && debut < a.end)) {
    return { error: 'overlap' };
  }
  srv.items.push({
    id: nouvelId(), userId, start: debut, end: fin, reason: String(reason || 'Ajoutée depuis le dashboard').slice(0, 100), info: '',
    status: 'approved', createdAt: Date.now(), channelId: null, messageId: null, decidedBy: decidedBy || null, returnedAt: null, extension: null
  });
  sauver();
  return { ok: true };
}

// Annule une absence (n'importe quelle phase) depuis le dashboard.
function annulerDepuisDashboard(client, guild, id) {
  const a = serveur(guild.id).items.find(x => x.id === id);
  if (!a || a.status === 'cancelled') return { error: 'not_found' };
  a.status = 'cancelled';
  a.extension = null;
  sauver();
  majMessage(client, guild.id, a);
  return { ok: true };
}

module.exports = {
  data, execute, autocomplete, routeAbsenceInteraction,
  serveur, sauver, phase, lireDateParis,
  listerPourDashboard, ajouterDepuisDashboard, annulerDepuisDashboard
};
