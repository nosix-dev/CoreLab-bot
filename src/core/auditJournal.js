'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Journal d'audit complet (consultable avec /audit, exportable en CSV / JSON)
//  • Enregistre automatiquement toutes les actions du journal d'audit Discord
//    (bans, kicks, timeouts, rôles, salons, serveur, webhooks, invitations…)
//  • Enregistre les commandes de staff du bot (celles qui demandent une permission)
//  • Conservation : 90 jours, 5000 entrées maximum par serveur (les plus anciennes partent d'abord)
// Fichier de données : audit_journal.json → { [guildId]: { seq, entries: [...] } }
// ─────────────────────────────────────────────────────────────────────────

const {
  AuditLogEvent,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { chargerDonnees, sauvegarderDonnees } = require('./data');

const FICHIER = 'audit_journal.json';
const RETENTION_JOURS = 90;
const MAX_PAR_SERVEUR = 5000;
const PAR_PAGE = 10;
const PREFIX_PAGE = 'auditp';
const TZ = 'Europe/Paris';

const TYPES = {
  membres: 'Membres',
  salons: 'Salons',
  roles: 'Rôles',
  messages: 'Messages',
  serveur: 'Serveur',
  automod: 'AutoMod',
  commandes: 'Commandes staff',
  autres: 'Autres',
};

const ACTIONS = {
  MemberKick: 'Membre expulsé', MemberBanAdd: 'Membre banni', MemberBanRemove: 'Bannissement levé',
  MemberUpdate: 'Membre modifié', MemberRoleUpdate: 'Rôles du membre modifiés', MemberPrune: 'Membres inactifs expulsés',
  MemberMove: 'Membre déplacé en vocal', MemberDisconnect: 'Membre déconnecté du vocal', BotAdd: 'Bot ajouté',
  ChannelCreate: 'Salon créé', ChannelUpdate: 'Salon modifié', ChannelDelete: 'Salon supprimé',
  ChannelOverwriteCreate: 'Permission de salon ajoutée', ChannelOverwriteUpdate: 'Permission de salon modifiée', ChannelOverwriteDelete: 'Permission de salon retirée',
  RoleCreate: 'Rôle créé', RoleUpdate: 'Rôle modifié', RoleDelete: 'Rôle supprimé',
  GuildUpdate: 'Serveur modifié', InviteCreate: 'Invitation créée', InviteUpdate: 'Invitation modifiée', InviteDelete: 'Invitation supprimée',
  WebhookCreate: 'Webhook créé', WebhookUpdate: 'Webhook modifié', WebhookDelete: 'Webhook supprimé',
  EmojiCreate: 'Emoji créé', EmojiUpdate: 'Emoji modifié', EmojiDelete: 'Emoji supprimé',
  StickerCreate: 'Sticker créé', StickerUpdate: 'Sticker modifié', StickerDelete: 'Sticker supprimé',
  MessageDelete: 'Message supprimé', MessageBulkDelete: 'Messages supprimés en masse', MessagePin: 'Message épinglé', MessageUnpin: 'Message désépinglé',
  IntegrationCreate: 'Intégration ajoutée', IntegrationUpdate: 'Intégration modifiée', IntegrationDelete: 'Intégration supprimée',
  AutoModerationRuleCreate: 'Règle AutoMod créée', AutoModerationRuleUpdate: 'Règle AutoMod modifiée', AutoModerationRuleDelete: 'Règle AutoMod supprimée',
  AutoModerationBlockMessage: 'Message bloqué par AutoMod', AutoModerationFlagToChannel: 'Message signalé par AutoMod', AutoModerationUserCommunicationDisabled: 'Membre réduit au silence par AutoMod',
  ThreadCreate: 'Fil créé', ThreadUpdate: 'Fil modifié', ThreadDelete: 'Fil supprimé',
  GuildScheduledEventCreate: 'Événement créé', GuildScheduledEventUpdate: 'Événement modifié', GuildScheduledEventDelete: 'Événement supprimé',
};

// ── Stockage ───────────────────────────────────────────────────────────────
let donnees = chargerDonnees(FICHIER, {});
let timerSauvegarde = null;

function planifierSauvegarde() {
  if (timerSauvegarde) return;
  timerSauvegarde = setTimeout(() => {
    timerSauvegarde = null;
    sauvegarderDonnees(FICHIER, donnees);
  }, 3000);
  timerSauvegarde.unref?.();
}

function bucket(guildId) {
  const g = String(guildId);
  if (!donnees[g]) donnees[g] = { seq: 0, entries: [] };
  return donnees[g];
}

function ajouter(guildId, entree) {
  const b = bucket(guildId);
  b.seq += 1;
  b.entries.push({ id: b.seq, ts: Date.now(), ...entree });
  if (b.entries.length > MAX_PAR_SERVEUR) b.entries.splice(0, b.entries.length - MAX_PAR_SERVEUR);
  planifierSauvegarde();
}

function purger() {
  const limite = Date.now() - RETENTION_JOURS * 86400000;
  let change = false;
  for (const b of Object.values(donnees)) {
    const avant = b.entries.length;
    b.entries = b.entries.filter(e => e.ts >= limite);
    if (b.entries.length !== avant) change = true;
  }
  if (change) planifierSauvegarde();
}

// ── Utilitaires de mise en forme ───────────────────────────────────────────
const coupe = (t, n) => { t = String(t ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function categorieDe(nomAction) {
  if (/^(Member|Bot)/.test(nomAction)) return 'membres';
  if (/^Channel/.test(nomAction)) return 'salons';
  if (/^Role/.test(nomAction)) return 'roles';
  if (/^Message/.test(nomAction)) return 'messages';
  if (/^AutoModeration/.test(nomAction)) return 'automod';
  if (/^(Guild|Integration|Invite|Webhook|Emoji|Sticker|Soundboard|StageInstance|Thread)/.test(nomAction)) return 'serveur';
  return 'autres';
}

function libelleAction(nomAction) {
  return ACTIONS[nomAction] || String(nomAction).replace(/([a-z])([A-Z])/g, '$1 $2');
}

function fmtValeur(v) {
  if (v === null || v === undefined) return '∅';
  if (Array.isArray(v)) return v.map(x => x?.name ?? x?.id ?? x).join(', ') || '∅';
  if (typeof v === 'object') return v.name ?? v.id ?? JSON.stringify(v);
  return String(v);
}

function resumeChangements(changes) {
  if (!Array.isArray(changes) || !changes.length) return '';
  return changes.slice(0, 4).map(c => {
    if (c.key === '$add') return `+ ${fmtValeur(c.new)}`;
    if (c.key === '$remove') return `− ${fmtValeur(c.new)}`;
    return `${c.key} : ${coupe(fmtValeur(c.old), 40)} → ${coupe(fmtValeur(c.new), 40)}`;
  }).join(' ; ') + (changes.length > 4 ? ` (+${changes.length - 4})` : '');
}

function fmtDate(ts) {
  const p = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ts)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// ── Cache des entrées récentes (reçues par la passerelle, donc sans aucune requête REST) ──
// Sert à savoir « qui a fait ça ? » pour les logs et l'anti-nuke sans appeler GET /audit-logs à chaque événement.
const TTL_CACHE_MS = 60 * 1000;
const cacheRecent = new Map(); // guildId -> [{ action, targetId, executor, executorId, ts }]

function memoriser(guildId, entry) {
  const liste = cacheRecent.get(guildId) || [];
  const limite = Date.now() - TTL_CACHE_MS;
  const frais = liste.filter(e => e.ts >= limite);
  frais.push({
    action: entry.action,
    targetId: entry.targetId ? String(entry.targetId) : null,
    executor: entry.executor || null,
    executorId: entry.executorId || null,
    ts: Date.now(),
  });
  cacheRecent.set(guildId, frais.slice(-200));
}

function chercherDansCache(guild, actionType, targetId) {
  const limite = Date.now() - TTL_CACHE_MS;
  const liste = cacheRecent.get(guild.id) || [];
  for (let i = liste.length - 1; i >= 0; i--) {
    const e = liste[i];
    if (e.ts < limite || e.action !== actionType) continue;
    if (targetId !== null && targetId !== undefined && e.targetId !== String(targetId)) continue;
    return e.executor || (e.executorId ? guild.client.users.cache.get(e.executorId) : null) || null;
  }
  return undefined; // rien trouvé
}

// Renvoie l'auteur d'une action. Attend un court instant que l'entrée arrive par la passerelle, puis abandonne (null).
async function acteurRecent(guild, actionType, targetId = null, attenteMax = 900) {
  if (!guild?.id) return null;
  let trouve = chercherDansCache(guild, actionType, targetId);
  const debut = Date.now();
  while (trouve === undefined && Date.now() - debut < attenteMax) {
    await new Promise(r => setTimeout(r, 150));
    trouve = chercherDansCache(guild, actionType, targetId);
  }
  return trouve || null;
}

// ── Enregistrement ─────────────────────────────────────────────────────────
function enregistrerEntreeDiscord(entry, guild) {
  if (!guild?.id) return;
  memoriser(guild.id, entry);
  const nomAction = AuditLogEvent[entry.action] || String(entry.action);
  const cible = entry.target;
  ajouter(guild.id, {
    type: categorieDe(nomAction),
    action: libelleAction(nomAction),
    actorId: entry.executorId || null,
    actorTag: entry.executor?.tag || entry.executor?.username || null,
    targetId: entry.targetId || null,
    targetType: entry.targetType || null,
    targetLabel: coupe(cible?.tag ?? cible?.username ?? cible?.name ?? '', 100) || null,
    details: coupe(resumeChangements(entry.changes), 300) || null,
    reason: coupe(entry.reason || '', 200) || null,
  });
}

// Commandes slash réservées au staff (celles qui demandent une permission par défaut)
function resumeOptions(options, acc = []) {
  for (const o of options || []) {
    if (o.options?.length) { resumeOptions(o.options, acc); continue; }
    if (/token|mot.?de.?passe|password|secret|cle|clé/i.test(o.name)) { acc.push(`${o.name}=***`); continue; }
    if (o.user) acc.push(`${o.name}=<@${o.user.id}>`);
    else if (o.channel) acc.push(`${o.name}=#${o.channel.name ?? o.channel.id}`);
    else if (o.role) acc.push(`${o.name}=@${o.role.name ?? o.role.id}`);
    else if (o.attachment) acc.push(`${o.name}=[fichier]`);
    else if (o.value !== undefined) acc.push(`${o.name}=${coupe(o.value, 60)}`);
  }
  return acc;
}

function enregistrerCommande(interaction, cmd) {
  try {
    if (!interaction.guild || !cmd?.data?.default_member_permissions) return;
    const sub = interaction.options?.getSubcommand?.(false);
    if (interaction.commandName === 'audit' && sub === 'voir') return;
    const nom = `/${interaction.commandName}${sub ? ` ${sub}` : ''}`;
    ajouter(interaction.guild.id, {
      type: 'commandes',
      action: nom,
      actorId: interaction.user.id,
      actorTag: interaction.user.tag,
      targetId: null,
      targetType: null,
      targetLabel: interaction.channel?.name ? `#${interaction.channel.name}` : null,
      details: coupe(resumeOptions(interaction.options?.data).join(' ; '), 300) || null,
      reason: null,
    });
  } catch (e) {
    console.error('[Audit] commande non enregistrée :', e.message);
  }
}

function installer(client) {
  client.on('guildAuditLogEntryCreate', (entry, guild) => {
    try { enregistrerEntreeDiscord(entry, guild); } catch (e) { console.error('[Audit] entrée ignorée :', e.message); }
  });
  purger();
  setInterval(purger, 6 * 3600 * 1000).unref?.();
}

// ── Lecture / filtres ──────────────────────────────────────────────────────
function lister(guildId, { actorId, targetId, type, jours } = {}) {
  const depuis = jours ? Date.now() - jours * 86400000 : 0;
  return bucket(guildId).entries
    .filter(e => (!actorId || e.actorId === actorId)
      && (!targetId || e.targetId === targetId)
      && (!type || e.type === type)
      && e.ts >= depuis)
    .sort((a, b) => (b.ts - a.ts) || (b.id - a.id));
}

function cibleAffichee(e) {
  if (e.targetType === 'User' && e.targetId) return `<@${e.targetId}>`;
  if (e.targetLabel) return `${e.targetType ? `${e.targetType} ` : ''}**${e.targetLabel}**`;
  if (e.targetId) return `${e.targetType || 'Cible'} \`${e.targetId}\``;
  return null;
}

function ligne(e) {
  const acteur = e.actorId ? `<@${e.actorId}>` : 'Discord';
  const cible = cibleAffichee(e);
  const parts = [`**#${e.id}** · <t:${Math.floor(e.ts / 1000)}:R> · **${e.action}**`, `👤 ${acteur}${cible ? ` → 🎯 ${cible}` : ''}`];
  if (e.details) parts.push(`↳ ${e.details}`);
  if (e.reason) parts.push(`📝 ${e.reason}`);
  return parts.join('\n');
}

// ── Page de consultation (embed + boutons) ─────────────────────────────────
function boutonsPage(page, total, f) {
  const cle = `${f.actorId || 0}:${f.targetId || 0}:${f.type || '*'}:${f.jours || 0}`;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX_PAGE}:${page - 1}:${cle}`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`${PREFIX_PAGE}:noop`).setLabel(`${page}/${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`${PREFIX_PAGE}:${page + 1}:${cle}`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= total),
  );
}

function construirePage(guildId, filtres, page = 1) {
  const resultats = lister(guildId, filtres);
  const total = Math.max(1, Math.ceil(resultats.length / PAR_PAGE));
  page = Math.min(Math.max(1, page), total);
  const tranche = resultats.slice((page - 1) * PAR_PAGE, page * PAR_PAGE);

  const filtresTxt = [
    filtres.actorId && `acteur <@${filtres.actorId}>`,
    filtres.targetId && `cible <@${filtres.targetId}>`,
    filtres.type && `type ${TYPES[filtres.type] || filtres.type}`,
    filtres.jours && `${filtres.jours} dernier(s) jour(s)`,
  ].filter(Boolean).join(' · ');

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📋 Journal d\'audit')
    .setDescription(coupe(tranche.length ? tranche.map(ligne).join('\n\n') : '*Aucune entrée pour ces filtres.*', 4000))
    .setFooter({ text: `${resultats.length} entrée(s)${filtresTxt ? ` • ${filtresTxt.replace(/<@\d+>/g, '…')}` : ''}` });
  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  if (total > 1) payload.components = [boutonsPage(page, total, filtres)];
  return payload;
}

function estAutorise(interaction) {
  const p = interaction.memberPermissions;
  return !!p && (p.has(PermissionFlagsBits.ViewAuditLog) || p.has(PermissionFlagsBits.Administrator));
}

async function handleAuditButton(interaction) {
  if (!interaction.guild) return;
  if (!estAutorise(interaction)) {
    return interaction.reply({ content: '❌ Réservé aux personnes qui peuvent voir le journal d\'audit.', flags: MessageFlags.Ephemeral });
  }
  const [, pageBrute, actorId, targetId, type, jours] = interaction.customId.split(':');
  const filtres = {
    actorId: actorId !== '0' ? actorId : undefined,
    targetId: targetId !== '0' ? targetId : undefined,
    type: type !== '*' ? type : undefined,
    jours: Number(jours) || undefined,
  };
  return interaction.update(construirePage(interaction.guild.id, filtres, parseInt(pageBrute, 10) || 1));
}

// ── Statistiques ───────────────────────────────────────────────────────────
function statistiques(guildId, jours) {
  const entrees = lister(guildId, { jours });
  const parActeur = new Map();
  const parType = new Map();
  const parAction = new Map();
  for (const e of entrees) {
    const a = e.actorId || 'discord';
    parActeur.set(a, (parActeur.get(a) || 0) + 1);
    parType.set(e.type, (parType.get(e.type) || 0) + 1);
    parAction.set(e.action, (parAction.get(e.action) || 0) + 1);
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return { total: entrees.length, acteurs: top(parActeur, 5), types: top(parType, 8), actions: top(parAction, 5) };
}

// ── Export ─────────────────────────────────────────────────────────────────
function exporter(guildId, filtres, format) {
  const entrees = lister(guildId, filtres).reverse(); // du plus ancien au plus récent
  if (format === 'json') {
    return { contenu: JSON.stringify(entrees.map(e => ({ ...e, date: fmtDate(e.ts) })), null, 2), extension: 'json', nombre: entrees.length };
  }
  const cell = v => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const entete = ['id', 'date', 'type', 'action', 'acteur_id', 'acteur', 'cible_id', 'cible_type', 'cible', 'details', 'raison'];
  const lignes = entrees.map(e => [
    e.id, fmtDate(e.ts), TYPES[e.type] || e.type, e.action, e.actorId, e.actorTag,
    e.targetId, e.targetType, e.targetLabel, e.details, e.reason,
  ].map(cell).join(';'));
  // BOM UTF-8 + séparateur « ; » : s'ouvre directement dans Excel en français
  return { contenu: `\uFEFF${entete.join(';')}\n${lignes.join('\n')}`, extension: 'csv', nombre: entrees.length };
}

module.exports = {
  TYPES, PREFIX_PAGE, installer, enregistrerCommande, enregistrerEntreeDiscord,
  acteurRecent, lister, construirePage, handleAuditButton, estAutorise, statistiques, exporter, fmtDate,
};