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
const fs = require('fs');
const path = require('path');
const { chargerDonnees, sauvegarderDonnees } = require('./data');
const { dossierPersistant } = require('./persistentPath');

const FICHIER = 'audit_journal.json';
const DOSSIER_MEDIA = dossierPersistant('audit_media');
const MAX_IMAGE_OCTETS = 8 * 1024 * 1024;
const EXT_IMAGES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
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

function supprimerMedias(entrees) {
  for (const e of entrees) {
    for (const a of e.attachments || []) {
      if (a.file) { try { fs.unlinkSync(path.join(DOSSIER_MEDIA, path.basename(a.file))); } catch { /* déjà supprimé */ } }
    }
  }
}

// Télécharge les images d'un message qui vient d'être supprimé (avant que Discord ne retire le fichier).
async function sauverPieces(guildId, message) {
  const liste = [];
  for (const a of [...(message.attachments?.values?.() || [])].slice(0, 10)) {
    const type = String(a.contentType || '').split(';')[0].toLowerCase();
    const info = { name: coupe(a.name || 'fichier', 120), type: type || null, size: a.size || 0, url: a.url || null, file: null };
    const ext = EXT_IMAGES[type];
    if (ext && a.url && (a.size || 0) <= MAX_IMAGE_OCTETS) {
      try {
        const rep = await fetch(a.url, { signal: AbortSignal.timeout(8000) });
        if (rep.ok) {
          const buf = Buffer.from(await rep.arrayBuffer());
          if (buf.length <= MAX_IMAGE_OCTETS) {
            const nom = `${guildId}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.${ext}`;
            fs.writeFileSync(path.join(DOSSIER_MEDIA, nom), buf);
            info.file = nom;
          }
        }
      } catch { /* image non récupérable : on garde juste le lien */ }
    }
    liste.push(info);
  }
  return liste;
}

// Chemin d'une image conservée (null si le nom est invalide ou n'appartient pas au serveur)
function cheminMedia(guildId, nom) {
  const n = path.basename(String(nom || ''));
  if (!new RegExp(`^${guildId}_[a-z0-9]+\\.(png|jpg|gif|webp)$`).test(n)) return null;
  const f = path.join(DOSSIER_MEDIA, n);
  return fs.existsSync(f) ? f : null;
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
  if (b.entries.length > MAX_PAR_SERVEUR) supprimerMedias(b.entries.splice(0, b.entries.length - MAX_PAR_SERVEUR));
  planifierSauvegarde();
}

function purger() {
  const limite = Date.now() - RETENTION_JOURS * 86400000;
  let change = false;
  for (const b of Object.values(donnees)) {
    const avant = b.entries.length;
    supprimerMedias(b.entries.filter(e => e.ts < limite));
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
    source: 'discord', discordId: entry.id || null,
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

// ── Évènements négatifs pour le dashboard (messages supprimés, sanctions, départs…) ──
// action (libellé) → catégorie du dashboard
const NEGATIFS = {
  'Message supprimé': 'messages', 'Messages supprimés en masse': 'messages',
  'Message bloqué par AutoMod': 'messages', 'Message signalé par AutoMod': 'messages',
  'Membre expulsé': 'moderation', 'Membre banni': 'moderation', 'Membre mis en timeout': 'moderation',
  'Avertissement': 'moderation', 'Mute': 'moderation', 'Membre réduit au silence par AutoMod': 'moderation',
  'Membres inactifs expulsés': 'moderation',
  'Membre parti': 'members', 'Bot ajouté': 'members',
  'Salon supprimé': 'channels', 'Fil supprimé': 'channels', 'Permission de salon retirée': 'channels',
  'Rôle supprimé': 'roles',
  'Membre déconnecté du vocal': 'voice',
  'Absence déclarée': 'staff', 'Absence approuvée': 'staff', 'Absence refusée': 'staff', 'Absence annulée': 'staff',
  'Webhook supprimé': 'server', 'Invitation supprimée': 'server', 'Emoji supprimé': 'server', 'Sticker supprimé': 'server',
  'Intégration supprimée': 'server', 'Règle AutoMod supprimée': 'server', 'Événement supprimé': 'server',
};

// Ajoute un évènement hors journal Discord (message supprimé avec contenu, départ, avertissement…).
function ajouterEvenement(guildId, entree) {
  try {
    ajouter(guildId, {
      type: entree.type || 'membres', action: entree.action,
      actorId: entree.actorId || null, actorTag: entree.actorTag || null,
      targetId: entree.targetId || null, targetType: entree.targetType || null,
      targetLabel: coupe(entree.targetLabel || '', 100) || null,
      details: coupe(entree.details || '', 300) || null, reason: coupe(entree.reason || '', 200) || null,
      channelId: entree.channelId || null, channelName: entree.channelName || null,
      content: entree.content ? coupe(entree.content, 1500) : null, messageId: entree.messageId || null,
      source: entree.source || 'discord',
      sentAt: entree.sentAt || null, replyTo: entree.replyTo || null,
      attachments: Array.isArray(entree.attachments) && entree.attachments.length ? entree.attachments : null,
    });
  } catch (e) { console.error('[Audit] évènement non enregistré :', e.message); }
}

function categorieNegative(e) {
  if (e.action === 'Membre modifié' && /communication_disabled_until/.test(e.details || '') && !/→ ∅/.test(e.details || '')) {
    return { cat: 'moderation', titre: 'Membre mis en timeout' };
  }
  const cat = NEGATIFS[e.action];
  return cat ? { cat, titre: e.action } : null;
}

const CODES = {
  'Message supprimé': 'message.delete', 'Messages supprimés en masse': 'message.bulk_delete', 'Message bloqué par AutoMod': 'automod.block_message',
  'Message signalé par AutoMod': 'automod.flag_message', 'Membre expulsé': 'member.kick', 'Membre banni': 'member.ban',
  'Membre mis en timeout': 'member.timeout', 'Avertissement': 'member.warn', 'Mute': 'member.mute', 'Membre parti': 'member.leave',
  'Bot ajouté': 'bot.add', 'Salon supprimé': 'channel.delete', 'Fil supprimé': 'thread.delete', 'Rôle supprimé': 'role.delete',
  'Membre déconnecté du vocal': 'voice.disconnect', 'Absence déclarée': 'absence.declare', 'Absence approuvée': 'absence.approve',
  'Absence refusée': 'absence.refuse', 'Absence annulée': 'absence.cancel',
};

function descriptionDe(titre, e) {
  const cible = e.targetLabel || null, acteur = e.actorTag || null;
  const par = acteur ? [' par ', { b: acteur }] : [];
  const salon = e.channelName ? [' dans ', { ch: e.channelName }] : [];
  switch (titre) {
    case 'Message supprimé': return ['Message de ', { b: cible || 'Quelqu’un' }, ' supprimé', ...salon, ...par];
    case 'Messages supprimés en masse': return [{ b: e.details || 'Plusieurs messages' }, ' supprimés', ...salon];
    case 'Membre expulsé': return [{ b: cible || 'Un membre' }, ' a été expulsé', ...par];
    case 'Membre banni': return [{ b: cible || 'Un membre' }, ' a été banni', ...par];
    case 'Membre mis en timeout': return [{ b: cible || 'Un membre' }, ' a été mis en timeout', ...par];
    case 'Avertissement': return [{ b: cible || 'Un membre' }, ' a reçu un avertissement', ...par];
    case 'Mute': return [{ b: cible || 'Un membre' }, ' a été rendu muet', ...par];
    case 'Membre parti': return [{ b: cible || 'Un membre' }, ' a quitté le serveur'];
    case 'Absence déclarée': return ['Absence déclarée', ...par];
    case 'Absence approuvée': return ['Absence de ', { b: cible || 'un membre' }, ' approuvée', ...par];
    case 'Absence refusée': return ['Absence de ', { b: cible || 'un membre' }, ' refusée', ...par];
    case 'Absence annulée': return ['Absence annulée', ...par];
    default: return [titre, ...(cible ? [' : ', { b: cible }] : []), ...par];
  }
}

function debutJourParis(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null;
  const utc = Date.parse(`${dateStr}T00:00:00Z`);
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = {};
  for (const x of f.formatToParts(new Date(utc))) p[x.type] = x.value;
  const decalage = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utc;
  return utc - decalage;
}

// Page de résultats au format attendu par le dashboard : { entries, next, actions }
function pourDashboard(guildId, { type, q, before, limit = 50, actor, action, from, to } = {}) {
  const recherche = String(q || '').trim().toLowerCase();
  const auteur = String(actor || '').trim().toLowerCase().replace(/^@/, '');
  const avant = Number(before) || Infinity;
  const max = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const debut = debutJourParis(from);
  const fin = debutJourParis(to) !== null ? debutJourParis(to) + 86400000 : null;
  const tout = [];
  for (const e of bucket(guildId).entries) {
    const n = categorieNegative(e);
    if (!n || e.id >= avant) continue;
    if (type && n.cat !== type) continue;
    if (action && n.titre !== action) continue;
    if (debut !== null && e.ts < debut) continue;
    if (fin !== null && e.ts >= fin) continue;
    if (auteur && ![e.actorTag, e.actorId, e.targetLabel, e.targetId].some(v => String(v || '').toLowerCase().includes(auteur))) continue;
    if (recherche && ![n.titre, e.actorTag, e.targetLabel, e.channelName, e.content, e.details, e.reason].some(v => String(v || '').toLowerCase().includes(recherche))) continue;
    tout.push({ e, n });
  }
  tout.sort((a, b) => (b.e.ts - a.e.ts) || (b.e.id - a.e.id));
  const page = tout.slice(0, max);
  return {
    entries: page.map(({ e, n }) => ({
      id: e.id, ts: new Date(e.ts).toISOString(), category: n.cat, title: n.titre,
      code: CODES[n.titre] || n.titre,
      source: e.source === 'bot' ? 'Bot' : 'Discord',
      description: descriptionDe(n.titre, e),
      actor: e.actorTag || e.actorId ? { id: e.actorId, name: e.actorTag || e.actorId } : null,
      target: e.targetLabel || e.targetId ? { id: e.targetId, name: e.targetLabel || e.targetId } : null,
      channel: e.channelName ? { id: e.channelId, name: e.channelName } : null,
      content: e.content || '', messageId: e.messageId || null, sentAt: e.sentAt || null, replyTo: e.replyTo || null,
      attachments: (e.attachments || []).map(a => ({ name: a.name, type: a.type, size: a.size, url: a.url, media: a.file || null })),
      reason: e.reason || '', details: n.titre === 'Messages supprimés en masse' ? '' : (e.details || ''),
    })),
    next: tout.length > max ? page[page.length - 1].e.id : null,
    actions: [...new Set([...Object.keys(NEGATIFS), 'Membre mis en timeout'])].sort((a, b) => a.localeCompare(b, 'fr')),
  };
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
    .setColor(0xE8510D)
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
  TYPES, PREFIX_PAGE, installer, ajouterEvenement, pourDashboard, sauverPieces, cheminMedia, enregistrerCommande, enregistrerEntreeDiscord,
  acteurRecent, lister, construirePage, handleAuditButton, estAutorise, statistiques, exporter, fmtDate,
};