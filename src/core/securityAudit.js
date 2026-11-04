'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Audit de sécurité (/audit) — lecture seule, ne modifie jamais le serveur.
// 3 catégories : Configuration du serveur · Rôles · Salons
// Chaque contrôle donne : ok (1 pt) · warn (0,5 pt) · fail (0 pt), pondéré.
// Score par catégorie et score global sur 100, grade A → E.
// ─────────────────────────────────────────────────────────────────────────

const {
  PermissionFlagsBits: P,
  GuildMFALevel,
  GuildVerificationLevel,
  GuildExplicitContentFilter,
  GuildDefaultMessageNotifications,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { getGuildConfig } = require('./config');

const ICONE = { ok: '✅', warn: '⚠️', fail: '❌' };
const POINTS = { ok: 1, warn: 0.5, fail: 0 };
const GRAVITE = { fail: 2, warn: 1, ok: 0 };

const coupe = (t, n) => { t = String(t ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const ok = (id, titre, poids = 1) => ({ id, statut: 'ok', titre, detail: '', poids });
const ko = (statut, id, titre, detail, poids = 1) => ({ id, statut, titre, detail, poids });

const PERMS_DANGEREUSES = [
  [P.ManageGuild, 'Gérer le serveur'], [P.ManageRoles, 'Gérer les rôles'], [P.ManageChannels, 'Gérer les salons'],
  [P.BanMembers, 'Bannir'], [P.KickMembers, 'Expulser'], [P.ManageWebhooks, 'Gérer les webhooks'],
  [P.MentionEveryone, 'Mentionner @everyone'],
];

// ── Catégorie 1 : configuration du serveur ─────────────────────────────────
function controlesServeur(guild) {
  const cfg = getGuildConfig(guild.id);
  const r = [];

  r.push(guild.mfaLevel === GuildMFALevel.Elevated
    ? ok('mfa', 'Double authentification (2FA) pour la modération', 2)
    : ko('fail', 'mfa', 'Double authentification (2FA) pour la modération',
      'La 2FA n\'est pas requise. Le propriétaire du serveur doit l\'activer dans les paramètres, pour protéger la modération si un compte staff est compromis.', 2));

  const v = guild.verificationLevel;
  r.push(v >= GuildVerificationLevel.Medium
    ? ok('verif', 'Niveau de vérification du serveur')
    : ko(v === GuildVerificationLevel.None ? 'fail' : 'warn', 'verif', 'Niveau de vérification du serveur',
      'Le niveau de vérification est trop bas. Passez au minimum à « Moyen » (compte inscrit depuis plus de 5 minutes) pour freiner les raids.'));

  const f = guild.explicitContentFilter;
  r.push(f === GuildExplicitContentFilter.AllMembers
    ? ok('filtre', 'Filtre de contenu explicite')
    : ko(f === GuildExplicitContentFilter.Disabled ? 'fail' : 'warn', 'filtre', 'Filtre de contenu explicite',
      'Le filtre ne scanne pas tous les membres. Activez-le sur « Tous les membres » dans Paramètres du serveur → Modération.'));

  r.push(guild.defaultMessageNotifications === GuildDefaultMessageNotifications.OnlyMentions
    ? ok('notifs', 'Notifications par défaut')
    : ko('warn', 'notifs', 'Notifications par défaut',
      'Les notifications par défaut sont réglées sur « Tous les messages » : un spam notifie tout le monde. Passez sur « @mentions uniquement ».', 0.5));

  r.push(cfg.anti_nuke_enabled
    ? ok('nuke', 'Protection anti-nuke')
    : ko('warn', 'nuke', 'Protection anti-nuke',
      'L\'anti-nuke est désactivé : suppressions de salons ou de rôles et bannissements en masse ne sont pas bloqués. Activez-le avec /protect.'));

  r.push(cfg.raidmode_enabled || cfg.captcha_enabled || cfg.anti_alt_enabled
    ? ok('raid', 'Protection anti-raid')
    : ko('warn', 'raid', 'Protection anti-raid',
      'Aucune protection contre les vagues d\'arrivées (RaidMode, captcha ou anti-alt). Activez-en une avec /protect.'));

  r.push(cfg.protection_log_channel_id || cfg.log_channel_id
    ? ok('logs', 'Salon de logs de sécurité', 0.5)
    : ko('warn', 'logs', 'Salon de logs de sécurité',
      'Aucun salon de logs configuré : les alertes de protection ne sont lues par personne. Définissez-le avec /protect.', 0.5));

  return r;
}

// ── Catégorie 2 : rôles ────────────────────────────────────────────────────
function controlesRoles(guild) {
  const cfg = getGuildConfig(guild.id);
  const everyone = guild.roles.everyone;
  const roles = [...guild.roles.cache.values()].filter(x => x.id !== everyone.id);
  const r = [];

  const admins = roles.filter(x => x.permissions.has(P.Administrator));
  if (!admins.length || cfg.auth_enabled) {
    r.push(ok('admins', 'Rôles administrateurs', 2));
  } else {
    const liste = admins.slice(0, 5).map(x => `• ${x.managed ? '🤖 ' : ''}<@&${x.id}>`).join('\n');
    r.push(ko('warn', 'admins', 'Rôles administrateurs',
      `${admins.length} rôle(s) Administrateur ne sont pas protégés par l'Authentification (/protect). Chacun est une cible de compromission :\n${liste}${admins.length > 5 ? `\n• … et ${admins.length - 5} autre(s)` : ''}`, 2));
  }

  r.push(admins.filter(x => !x.managed).length <= 3
    ? ok('nbadmins', 'Nombre de rôles administrateurs')
    : ko('warn', 'nbadmins', 'Nombre de rôles administrateurs',
      `${admins.filter(x => !x.managed).length} rôles non-bots ont la permission Administrateur. Réduisez-les : donnez uniquement les permissions nécessaires.`));

  const dangEveryone = PERMS_DANGEREUSES.filter(([p]) => everyone.permissions.has(p)).map(([, n]) => n);
  if (everyone.permissions.has(P.Administrator)) {
    r.push(ko('fail', 'everyone', '@everyone dangereux', '@everyone possède la permission Administrateur : tous les membres contrôlent le serveur. À retirer immédiatement.', 3));
  } else if (dangEveryone.length) {
    r.push(ko('fail', 'everyone', '@everyone dangereux', `@everyone possède des permissions sensibles : ${dangEveryone.join(', ')}. À retirer pour tous les membres.`, 3));
  } else {
    r.push(ok('everyone', '@everyone dangereux', 3));
  }

  const sensibles = roles.filter(x => !x.managed && !x.permissions.has(P.Administrator)
    && (x.permissions.has(P.ManageRoles) || x.permissions.has(P.ManageGuild) || x.permissions.has(P.ManageWebhooks)));
  r.push(sensibles.length <= 2
    ? ok('sensibles', 'Rôles avec permissions sensibles')
    : ko('warn', 'sensibles', 'Rôles avec permissions sensibles',
      `${sensibles.length} rôles peuvent gérer le serveur, les rôles ou les webhooks : ${sensibles.slice(0, 4).map(x => `<@&${x.id}>`).join(', ')}${sensibles.length > 4 ? '…' : ''}. Vérifiez qu'ils sont tous nécessaires.`));

  const mentionAll = roles.filter(x => !x.managed && !x.permissions.has(P.Administrator) && x.permissions.has(P.MentionEveryone));
  r.push(!mentionAll.length
    ? ok('mentionall', 'Mention de @everyone', 0.5)
    : ko('warn', 'mentionall', 'Mention de @everyone',
      `${mentionAll.length} rôle(s) peuvent mentionner @everyone/@here : ${mentionAll.slice(0, 4).map(x => `<@&${x.id}>`).join(', ')}. Réservez cette permission au staff.`, 0.5));

  return r;
}

// ── Catégorie 3 : salons ───────────────────────────────────────────────────
function controlesSalons(guild) {
  const everyone = guild.roles.everyone;
  const salons = [...guild.channels.cache.values()].filter(c => c.permissionOverwrites && !c.isThread?.());
  const r = [];

  // Permissions redondantes (identiques à la catégorie, ou vides)
  let redondantes = 0; const salonsRedondants = new Set();
  for (const c of salons) {
    const parent = c.parent;
    for (const o of c.permissionOverwrites.cache.values()) {
      const vide = o.allow.bitfield === 0n && o.deny.bitfield === 0n;
      const po = parent?.permissionOverwrites?.cache.get(o.id);
      const memeQueCategorie = po && po.allow.bitfield === o.allow.bitfield && po.deny.bitfield === o.deny.bitfield;
      if (vide || memeQueCategorie) { redondantes++; salonsRedondants.add(c.id); }
    }
  }
  r.push(!redondantes
    ? ok('redond', 'Permissions de salon redondantes')
    : ko('warn', 'redond', 'Permissions de salon redondantes',
      `${redondantes} permission(s) redondante(s) sur ${salonsRedondants.size} salon(s). Une permission redondante doit être modifiée à plusieurs endroits pour agir réellement, ce qui crée des angles morts. Nettoyez-les.`));

  // @everyone peut mentionner @everyone dans un salon
  const mentionSalons = salons.filter(c => c.permissionOverwrites.cache.get(everyone.id)?.allow.has(P.MentionEveryone));
  r.push(!mentionSalons.length
    ? ok('mention', 'Mention de @everyone dans les salons')
    : ko('warn', 'mention', 'Mention de @everyone dans les salons',
      `@everyone peut mentionner @everyone dans ${mentionSalons.length} salon(s) : ${mentionSalons.slice(0, 4).map(c => `<#${c.id}>`).join(', ')}.`));

  // Salons sensibles visibles de tous
  const sensibles = salons.filter(c => /(^|[-_ ])(logs?|staff|mod(o|ération|eration)?|admin|team|privé|prive)([-_ ]|$)/i.test(c.name)
    && c.permissionsFor(everyone)?.has(P.ViewChannel));
  r.push(!sensibles.length
    ? ok('visibles', 'Salons sensibles visibles de tous', 2)
    : ko('fail', 'visibles', 'Salons sensibles visibles de tous',
      `${sensibles.length} salon(s) à vocation privée sont visibles par @everyone : ${sensibles.slice(0, 4).map(c => `<#${c.id}>`).join(', ')}${sensibles.length > 4 ? '…' : ''}.`, 2));

  // @everyone peut écrire dans règlement / annonces
  const lecture = salons.filter(c => /(règle|regle|rules|annonce|announce|news|bienvenue|welcome)/i.test(c.name)
    && c.permissionsFor(everyone)?.has(P.SendMessages));
  r.push(!lecture.length
    ? ok('lecture', 'Salons d\'information en lecture seule')
    : ko('warn', 'lecture', 'Salons d\'information en lecture seule',
      `@everyone peut écrire dans ${lecture.length} salon(s) d'information : ${lecture.slice(0, 4).map(c => `<#${c.id}>`).join(', ')}. Passez-les en lecture seule.`));

  return r;
}

// ── Analyse complète ───────────────────────────────────────────────────────
function noter(controles) {
  const total = controles.reduce((a, c) => a + c.poids, 0) || 1;
  const gagne = controles.reduce((a, c) => a + c.poids * POINTS[c.statut], 0);
  return Math.round((gagne / total) * 100);
}
function compter(controles) {
  return { ok: controles.filter(c => c.statut === 'ok').length, warn: controles.filter(c => c.statut === 'warn').length, fail: controles.filter(c => c.statut === 'fail').length };
}
function grade(score) {
  if (score >= 85) return { lettre: 'A', label: score >= 95 ? 'Excellent' : 'Bon', pastille: '🟢', couleur: 0x57F287 };
  if (score >= 70) return { lettre: 'B', label: 'Correct', pastille: '🟢', couleur: 0x57F287 };
  if (score >= 55) return { lettre: 'C', label: 'Moyen', pastille: '🟡', couleur: 0xF1C40F };
  if (score >= 40) return { lettre: 'D', label: 'Faible', pastille: '🟠', couleur: 0xE67E22 };
  return { lettre: 'E', label: 'Critique', pastille: '🔴', couleur: 0xED4245 };
}

function analyser(guild) {
  const defs = [
    { key: 'serveur', nom: 'Configuration du serveur', emoji: '⚙️', controles: controlesServeur(guild) },
    { key: 'roles', nom: 'Rôles', emoji: '🛡️', controles: controlesRoles(guild) },
    { key: 'salons', nom: 'Salons', emoji: '#️⃣', controles: controlesSalons(guild) },
  ];
  const categories = defs.map(d => ({ ...d, score: noter(d.controles), ...{ n: compter(d.controles) } }));
  const tous = categories.flatMap(c => c.controles);
  const score = noter(tous);
  const problemes = tous.filter(c => c.statut !== 'ok')
    .sort((a, b) => GRAVITE[b.statut] - GRAVITE[a.statut] || b.poids - a.poids);
  return { score, grade: grade(score), categories, problemes };
}

// ── Affichage (Components V2) ──────────────────────────────────────────────
const txt = (c) => new TextDisplayBuilder().setContent(coupe(c, 3900));
const sep = (divider = true) => new SeparatorBuilder().setDivider(divider).setSpacing(SeparatorSpacingSize.Small);
const barre = (score) => { const n = Math.round(score / 5); return '█'.repeat(n) + '░'.repeat(20 - n); };
const FLAGS = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

function construireAccueil(guild, res) {
  const c = new ContainerBuilder().setAccentColor(res.grade.couleur);
  c.addSectionComponents(new SectionBuilder()
    .addTextDisplayComponents(txt(`## 📜 Audit de sécurité \`BETA\`\n-# Serveur de ${guild.name}`))
    .setButtonAccessory(new ButtonBuilder().setCustomId('secaudit:refresh').setLabel('Actualiser').setEmoji('🔄').setStyle(ButtonStyle.Secondary)));

  c.addTextDisplayComponents(txt(`${res.grade.pastille} **Score global :** \`${res.score}/100\` · ${res.grade.label}\n\`${barre(res.score)}\``));
  c.addSeparatorComponents(sep());
  c.addTextDisplayComponents(txt('**Résumé par catégorie**'));

  for (const cat of res.categories) {
    c.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(txt(`${cat.emoji} **${cat.nom}** · \`${cat.score}/100\`\n✅ ${cat.n.ok} · ⚠️ ${cat.n.warn} · ❌ ${cat.n.fail}`))
      .setButtonAccessory(new ButtonBuilder().setCustomId(`secaudit:detail:${cat.key}`).setLabel('Détails').setEmoji('👁️').setStyle(ButtonStyle.Secondary)));
  }

  c.addSeparatorComponents(sep());
  if (!res.problemes.length) {
    c.addTextDisplayComponents(txt('### ✅ Aucun problème détecté\nVotre serveur respecte toutes les vérifications de l\'audit.'));
  } else {
    const blocs = res.problemes.slice(0, 3).map(p => `${ICONE[p.statut]} **${p.titre}**\n${p.detail.split('\n').map(l => `> ${l}`).join('\n')}`);
    c.addTextDisplayComponents(txt(`**Problèmes détectés (${res.problemes.length})**\n\n${blocs.join('\n\n')}`));
    if (res.problemes.length > 3) c.addTextDisplayComponents(txt(`-# ${res.problemes.length - 3} autre(s) problème(s) : ouvrez « Détails » pour la liste complète.`));
  }
  return { components: [c], flags: FLAGS, allowedMentions: { parse: [] } };
}

function construireDetail(guild, res, key) {
  const cat = res.categories.find(x => x.key === key) || res.categories[0];
  const g = grade(cat.score);
  const c = new ContainerBuilder().setAccentColor(g.couleur);
  c.addTextDisplayComponents(txt(`## ${cat.emoji} ${cat.nom}\n${g.pastille} \`${cat.score}/100\` · ✅ ${cat.n.ok} · ⚠️ ${cat.n.warn} · ❌ ${cat.n.fail}`));
  c.addSeparatorComponents(sep());
  const lignes = [...cat.controles]
    .sort((a, b) => GRAVITE[b.statut] - GRAVITE[a.statut])
    .map(x => `${ICONE[x.statut]} **${x.titre}**${x.detail ? `\n${x.detail.split('\n').map(l => `> ${l}`).join('\n')}` : ''}`);
  c.addTextDisplayComponents(txt(lignes.join('\n\n')));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('secaudit:home').setLabel('Retour').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`secaudit:detail:${cat.key}`).setLabel('Actualiser').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  ));
  return { components: [c], flags: FLAGS, allowedMentions: { parse: [] } };
}

module.exports = { analyser, construireAccueil, construireDetail };
