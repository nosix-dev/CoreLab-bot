const {
  EmbedBuilder,
  PermissionsBitField,
  AutoModerationRuleTriggerType,
  AutoModerationRuleEventType,
  AutoModerationActionType,
  AutoModerationRuleKeywordPresetType
} = require('discord.js');
const { DOMAINES_BLACKLISTES, MOTIFS_SUSPECTS } = require('../core/phishing');

// ────────────────────────────────────────────────
// !automod-setup [ici] — à utiliser en préfixe, réservé au propriétaire.
//
// Déploie de vraies règles AutoMod (anti-scam, anti-invite/typosquat,
// mots interdits, anti-mention-spam) sur tous les serveurs où le bot est
// présent et où il a la permission "Gérer le serveur".
// `!automod-setup ici` limite le déploiement au serveur courant.
//
// Effet de bord recherché : atteindre le seuil des 100 règles AutoMod
// cumulées sur l'ensemble des serveurs, condition officielle du badge
// Discord "Uses AutoMod" (attribution automatique par Discord, ~12-24h
// après le passage du seuil).
// ────────────────────────────────────────────────

const RULE_NAME_PREFIX = '[CoreLab]';
const ANCIEN_RULE_NAME_PREFIX = '[ScaraBot]';

// Regex → chaînes littérales (l'API AutoMod attend des strings pour regexPatterns)
const REGEX_TYPOSQUATS = MOTIFS_SUSPECTS.map(r => r.source);

// Découpe les 1000 mots-clés max autorisés par règle en paquets de 400 pour rester large
function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

// Définit les règles cibles pour un serveur donné.
// Chaque règle a un nom unique et stable : sert de clé d'idempotence
// (on ne recrée jamais une règle déjà présente).
function buildTargetRules() {
  const rules = [];

  // 1) Filtre de contenu Discord (préréglages officiels) — 1 seule règle possible par serveur
  rules.push({
    name: `${RULE_NAME_PREFIX} Contenu sensible`,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.KeywordPreset,
    triggerMetadata: {
      presets: [
        AutoModerationRuleKeywordPresetType.Profanity,
        AutoModerationRuleKeywordPresetType.SexualContent,
        AutoModerationRuleKeywordPresetType.Slurs
      ]
    },
    actions: [{ type: AutoModerationActionType.BlockMessage }],
    enabled: true,
    reason: 'CoreLab - filtre de contenu sensible (mots interdits Discord)'
  });

  // 2) Anti mention-spam — 1 seule règle possible par serveur
  rules.push({
    name: `${RULE_NAME_PREFIX} Anti mention-spam`,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.MentionSpam,
    triggerMetadata: { mentionTotalLimit: 8 },
    actions: [{ type: AutoModerationActionType.BlockMessage }],
    enabled: true,
    reason: 'CoreLab - anti mention-spam'
  });

  // 3) Anti-scam : domaines de phishing / IP loggers connus (liste réelle de phishing.js)
  chunk(DOMAINES_BLACKLISTES, 400).forEach((liste, i) => {
    rules.push({
      name: `${RULE_NAME_PREFIX} Anti-scam liens${i ? ` ${i + 1}` : ''}`,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { keywordFilter: liste.map(d => `*${d}*`) },
      actions: [{ type: AutoModerationActionType.BlockMessage }],
      enabled: true,
      reason: 'CoreLab - anti-scam (domaines de phishing connus)'
    });
  });

  // 4) Anti-typosquat (faux Discord/Steam) — regex de phishing.js
  if (REGEX_TYPOSQUATS.length) {
    rules.push({
      name: `${RULE_NAME_PREFIX} Anti-typosquat`,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { regexPatterns: REGEX_TYPOSQUATS.slice(0, 10) },
      actions: [{ type: AutoModerationActionType.BlockMessage }],
      enabled: true,
      reason: 'CoreLab - anti-typosquat (faux liens Discord/Steam)'
    });
  }

  return rules;
}

async function setupGuild(guild) {
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return { guild, status: 'skip', reason: 'permission ManageGuild manquante', created: 0 };
  }

  let existing;
  try {
    existing = await guild.autoModerationRules.fetch();
  } catch (e) {
    return { guild, status: 'error', reason: e.message, created: 0 };
  }

  // Anciennes règles « [ScaraBot] » : renommées en « [CoreLab] » (évite les doublons)
  const renameLegacy = n => n.startsWith(ANCIEN_RULE_NAME_PREFIX) ? RULE_NAME_PREFIX + n.slice(ANCIEN_RULE_NAME_PREFIX.length) : n;
  for (const rule of existing.values()) {
    if (rule.name.startsWith(ANCIEN_RULE_NAME_PREFIX)) {
      await rule.edit({ name: renameLegacy(rule.name), reason: 'Renommage du bot : ScaraBot → CoreLab' }).catch(() => {});
    }
  }
  const existingNames = new Set([...existing.values()].map(r => renameLegacy(r.name)));
  const targets = buildTargetRules().filter(r => !existingNames.has(r.name));

  let created = 0;
  const errors = [];
  for (const rule of targets) {
    try {
      await guild.autoModerationRules.create(rule);
      created++;
    } catch (e) {
      errors.push(`${rule.name} → ${e.message}`);
    }
    // petite pause pour rester sous le rate-limit AutoMod (créations coûteuses)
    await new Promise(res => setTimeout(res, 500));
  }

  return {
    guild,
    status: errors.length ? 'partial' : 'ok',
    created,
    totalNow: existingNames.size + created,
    errors
  };
}

// !automod-setup [ici]
async function automodSetup(message, client) {
  if (message.author.id !== client.BOT_OWNER_ID) {
    return message.channel.send('❌ Commande réservée au propriétaire du bot.');
  }

  const arg = message.content.trim().split(/\s+/)[1]?.toLowerCase();
  const onlyThisGuild = arg === 'ici' || arg === 'local';

  if (onlyThisGuild && !message.guild) {
    return message.channel.send('❌ `!automod-setup ici` doit être utilisé sur un serveur, pas en DM.');
  }

  const guilds = onlyThisGuild
    ? [message.guild]
    : [...client.guilds.cache.values()];

  const statut = await message.channel.send(`🛡️ Déploiement AutoMod en cours sur ${guilds.length} serveur(s)...`);

  const results = [];
  for (const guild of guilds) {
    results.push(await setupGuild(guild));
  }

  const totalCreated = results.reduce((s, r) => s + r.created, 0);
  const totalRulesGlobal = results.reduce((s, r) => s + (r.totalNow ?? 0), 0);
  const skipped = results.filter(r => r.status === 'skip').length;
  const errored = results.filter(r => r.status === 'error' || r.status === 'partial').length;

  const embed = new EmbedBuilder()
    .setTitle('🛡️ Déploiement AutoMod terminé')
    .setColor(totalCreated > 0 ? 0x57f287 : 0xfee75c)
    .addFields(
      { name: 'Serveurs traités', value: `${guilds.length}`, inline: true },
      { name: 'Règles créées', value: `${totalCreated}`, inline: true },
      { name: 'Total règles AutoMod (estimé)', value: `${totalRulesGlobal} / 100`, inline: true },
      { name: 'Serveurs ignorés (permission manquante)', value: `${skipped}`, inline: true },
      { name: 'Serveurs en erreur', value: `${errored}`, inline: true }
    )
    .setFooter({ text: 'Le badge "Uses AutoMod" apparaît ~12-24h après le passage du seuil de 100 règles.' })
    .setTimestamp();

  const problems = results
    .filter(r => r.status !== 'ok' && r.status !== 'skip')
    .flatMap(r => (r.errors?.length ? r.errors : [r.reason]).map(msg => `**${r.guild?.name}** : ${msg}`))
    .slice(0, 10);
  if (problems.length) {
    embed.addFields({ name: 'Détails des erreurs', value: problems.join('\n').slice(0, 1024) });
  }

  await statut.edit({ content: null, embeds: [embed] }).catch(() => message.channel.send({ embeds: [embed] }));
}

// !automod-cleanup [ici] — supprime toutes les règles créées par !automod-setup
// (celles préfixées "[CoreLab]"), sans toucher aux règles AutoMod que le
// staff du serveur aurait créées lui-même.
async function cleanupGuild(guild) {
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return { guild, status: 'skip', reason: 'permission ManageGuild manquante', removed: 0 };
  }

  let existing;
  try {
    existing = await guild.autoModerationRules.fetch();
  } catch (e) {
    return { guild, status: 'error', reason: e.message, removed: 0 };
  }

  const toRemove = [...existing.values()].filter(r => r.name.startsWith(RULE_NAME_PREFIX) || r.name.startsWith(ANCIEN_RULE_NAME_PREFIX));

  let removed = 0;
  const errors = [];
  for (const rule of toRemove) {
    try {
      await rule.delete('CoreLab - retrait des règles automod-setup');
      removed++;
    } catch (e) {
      errors.push(`${rule.name} → ${e.message}`);
    }
    await new Promise(res => setTimeout(res, 500));
  }

  return { guild, status: errors.length ? 'partial' : 'ok', removed, errors };
}

async function automodCleanup(message, client) {
  if (message.author.id !== client.BOT_OWNER_ID) {
    return message.channel.send('❌ Commande réservée au propriétaire du bot.');
  }

  const arg = message.content.trim().split(/\s+/)[1]?.toLowerCase();
  const onlyThisGuild = arg === 'ici' || arg === 'local';

  if (onlyThisGuild && !message.guild) {
    return message.channel.send('❌ `!automod-cleanup ici` doit être utilisé sur un serveur, pas en DM.');
  }

  const guilds = onlyThisGuild
    ? [message.guild]
    : [...client.guilds.cache.values()];

  const statut = await message.channel.send(`🧹 Suppression des règles AutoMod CoreLab sur ${guilds.length} serveur(s)...`);

  const results = [];
  for (const guild of guilds) {
    results.push(await cleanupGuild(guild));
  }

  const totalRemoved = results.reduce((s, r) => s + r.removed, 0);
  const skipped = results.filter(r => r.status === 'skip').length;
  const errored = results.filter(r => r.status === 'error' || r.status === 'partial').length;

  const embed = new EmbedBuilder()
    .setTitle('🧹 Nettoyage AutoMod terminé')
    .setColor(0xed4245)
    .addFields(
      { name: 'Serveurs traités', value: `${guilds.length}`, inline: true },
      { name: 'Règles supprimées', value: `${totalRemoved}`, inline: true },
      { name: 'Serveurs ignorés (permission manquante)', value: `${skipped}`, inline: true },
      { name: 'Serveurs en erreur', value: `${errored}`, inline: true }
    )
    .setTimestamp();

  const problems = results
    .filter(r => r.status !== 'ok' && r.status !== 'skip')
    .flatMap(r => (r.errors?.length ? r.errors : [r.reason]).map(msg => `**${r.guild?.name}** : ${msg}`))
    .slice(0, 10);
  if (problems.length) {
    embed.addFields({ name: 'Détails des erreurs', value: problems.join('\n').slice(0, 1024) });
  }

  await statut.edit({ content: null, embeds: [embed] }).catch(() => message.channel.send({ embeds: [embed] }));
}

// !automod-count — compte les règles AutoMod (toutes, et celles du bot) sur chaque serveur.
// Utile pour suivre le seuil des 100 règles du badge « Uses AutoMod ».
async function automodCount(message, client) {
  if (message.author.id !== client.BOT_OWNER_ID) {
    return message.channel.send('❌ Commande réservée au propriétaire du bot.');
  }

  const statut = await message.channel.send('🔎 Comptage des règles AutoMod...');

  const rows = [];
  let total = 0;
  let totalBot = 0;
  let skipped = 0;

  for (const guild of client.guilds.cache.values()) {
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      skipped++;
      continue;
    }
    try {
      const rules = await guild.autoModerationRules.fetch();
      const mine = [...rules.values()].filter(r => r.creatorId === client.user.id).length;
      total += rules.size;
      totalBot += mine;
      rows.push({ name: guild.name, all: rules.size, mine });
    } catch (e) {
      skipped++;
    }
  }

  rows.sort((a, b) => b.all - a.all);
  const detail = rows
    .slice(0, 20)
    .map(r => `**${r.name.replace(/@/g, '@\u200b')}** : ${r.all} (dont ${r.mine} du bot)`)
    .join('\n') || 'Aucun serveur lisible.';

  const embed = new EmbedBuilder()
    .setTitle('🤖 Règles AutoMod')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Total (tous créateurs)', value: `${total}`, inline: true },
      { name: 'Créées par le bot', value: `${totalBot}/100`, inline: true },
      { name: 'Serveurs ignorés', value: `${skipped}`, inline: true },
      { name: 'Détail par serveur', value: detail.slice(0, 1024) }
    )
    .setTimestamp();

  await statut.edit({ content: null, embeds: [embed] }).catch(() => message.channel.send({ embeds: [embed] }));
}

const prefixCommands = {
  'automod-setup': automodSetup,
  'automod-cleanup': automodCleanup,
  'automod-count': automodCount
};

module.exports = { automodSetup, automodCleanup, automodCount, setupGuild, prefixCommands };