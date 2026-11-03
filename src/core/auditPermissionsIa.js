'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Audit des permissions de l'assistant IA (/audit permissions-ia)
//  • Vérifie la configuration (salon, catégorie, clé API)
//  • Vérifie les permissions du bot (serveur, catégorie, salon principal)
//  • Vérifie que le salon principal est en lecture seule pour @everyone
//  • Vérifie que chaque salon IA privé n'est visible que de son propriétaire
//    (et du bot), et signale les salons orphelins / les accès en trop
// Lecture seule : ne modifie jamais le serveur ni la configuration.
// ─────────────────────────────────────────────────────────────────────────

const { EmbedBuilder, PermissionFlagsBits: P, OverwriteType } = require('discord.js');
const { getGuildConfig } = require('./config');

const NIVEAU = { ok: 0, info: 1, avert: 2, crit: 3 };
const ICONE = { ok: '✅', info: 'ℹ️', avert: '⚠️', crit: '❌' };

const coupe = (t, n) => { t = String(t ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// Permissions dont le bot a besoin pour faire fonctionner l'IA
const PERMS_BOT_SERVEUR = [
  [P.ViewChannel, 'Voir les salons'],
  [P.SendMessages, 'Envoyer des messages'],
  [P.ReadMessageHistory, 'Voir l\'historique'],
  [P.AttachFiles, 'Joindre des fichiers'],
  [P.ManageChannels, 'Gérer les salons'],
];
const PERMS_BOT_SALON = [
  [P.ViewChannel, 'Voir le salon'],
  [P.SendMessages, 'Envoyer des messages'],
  [P.ReadMessageHistory, 'Voir l\'historique'],
  [P.AttachFiles, 'Joindre des fichiers'],
];

function manquantes(perms, liste) {
  if (!perms) return liste.map(([, nom]) => nom);
  return liste.filter(([bit]) => !perms.has(bit)).map(([, nom]) => nom);
}

function auditerPermissionsIa(guild) {
  const cfg = getGuildConfig(guild.id);
  const me = guild.members.me;
  const constats = []; // { niveau, section, texte }
  const ajouter = (niveau, section, texte) => constats.push({ niveau, section, texte });

  // ── 1. Configuration ────────────────────────────────────────────────────
  const S1 = 'Configuration';
  const canal = cfg.ia_channel_id ? guild.channels.cache.get(String(cfg.ia_channel_id)) : null;
  const categorie = cfg.ia_category_id ? guild.channels.cache.get(String(cfg.ia_category_id)) : null;

  if (!cfg.ia_enabled) ajouter('info', S1, 'L\'assistant IA est **désactivé** sur ce serveur (`/config-ia` pour l\'activer).');
  else ajouter('ok', S1, 'L\'assistant IA est activé.');

  if (cfg.ia_channel_id && !canal) ajouter('crit', S1, `Le salon IA configuré (\`${cfg.ia_channel_id}\`) n'existe plus : relance \`/config-ia\`.`);
  else if (!cfg.ia_channel_id && cfg.ia_enabled) ajouter('crit', S1, 'Aucun salon IA n\'est enregistré alors que l\'IA est activée.');
  else if (canal) ajouter('ok', S1, `Salon principal : ${canal}.`);

  if (cfg.ia_category_id && !categorie) ajouter('avert', S1, 'La catégorie IA enregistrée n\'existe plus (elle sera recréée à la prochaine ouverture d\'un salon).');
  else if (categorie) ajouter('ok', S1, `Catégorie : **${coupe(categorie.name, 60)}**.`);

  if (!process.env.GEMINI_API_KEY) ajouter('crit', S1, 'La clé `GEMINI_API_KEY` n\'est pas définie sur le bot : l\'IA ne pourra pas répondre.');
  else ajouter('ok', S1, 'Clé `GEMINI_API_KEY` présente (valeur non affichée).');

  // ── 2. Permissions du bot ───────────────────────────────────────────────
  const S2 = 'Permissions du bot';
  if (!me) {
    ajouter('crit', S2, 'Impossible de lire les permissions du bot sur ce serveur.');
  } else {
    const manque = manquantes(me.permissions, PERMS_BOT_SERVEUR);
    if (manque.length) ajouter('crit', S2, `Permissions serveur manquantes : **${manque.join(', ')}**.`);
    else ajouter('ok', S2, 'Le bot a toutes les permissions serveur nécessaires.');

    if (me.permissions.has(P.Administrator)) {
      ajouter('avert', S2, 'Le bot a la permission **Administrateur** : inutile pour l\'IA, mieux vaut ne donner que les permissions nécessaires.');
    }
    if (!me.permissions.has(P.Administrator) && me.permissions.has(P.MentionEveryone)) {
      ajouter('info', S2, 'Le bot peut mentionner @everyone / @here (non utilisé par l\'IA).');
    }

    if (categorie) {
      const m = manquantes(categorie.permissionsFor(me), [[P.ViewChannel, 'Voir la catégorie'], [P.ManageChannels, 'Gérer les salons']]);
      if (m.length) ajouter('crit', S2, `Dans la catégorie IA, il manque : **${m.join(', ')}** (création des salons privés impossible).`);
    }
    if (canal) {
      const m = manquantes(canal.permissionsFor(me), PERMS_BOT_SALON);
      if (m.length) ajouter('crit', S2, `Dans le salon principal, il manque : **${m.join(', ')}**.`);
    }
  }

  // ── 3. Salon principal ──────────────────────────────────────────────────
  const S3 = 'Salon principal';
  if (canal) {
    const pe = canal.permissionsFor(guild.roles.everyone);
    if (pe?.has(P.SendMessages)) ajouter('avert', S3, '@everyone peut **écrire** dans le salon principal (il devrait être en lecture seule, le panneau sert uniquement au bouton).');
    else ajouter('ok', S3, '@everyone est en lecture seule dans le salon principal.');

    if (!pe?.has(P.ViewChannel)) ajouter('avert', S3, '@everyone ne peut **pas voir** le salon principal : les membres ne verront pas le bouton « Parler à l\'IA ».');

    const exposes = [];
    for (const ow of canal.permissionOverwrites.cache.values()) {
      if (ow.id === guild.roles.everyone.id || ow.id === me?.id) continue;
      if (ow.allow.has(P.SendMessages) || ow.allow.has(P.ManageMessages) || ow.allow.has(P.ManageChannels)) {
        exposes.push(ow.type === OverwriteType.Role ? `<@&${ow.id}>` : `<@${ow.id}>`);
      }
    }
    if (exposes.length) ajouter('info', S3, `Droits d'écriture / gestion accordés explicitement à : ${exposes.slice(0, 8).join(', ')}${exposes.length > 8 ? '…' : ''}.`);
  } else {
    ajouter('info', S3, 'Aucun salon principal à vérifier.');
  }

  // ── 4. Salons IA privés ─────────────────────────────────────────────────
  const S4 = 'Salons IA privés';
  const tickets = cfg.ia_tickets || {};
  const idsSuivis = new Set(Object.values(tickets).map(String));
  let nbOk = 0;
  const obsoletes = [];

  for (const [userId, channelId] of Object.entries(tickets)) {
    const ch = guild.channels.cache.get(String(channelId));
    if (!ch) { obsoletes.push(`<@${userId}>`); continue; }

    const problemes = [];
    const gravite = { v: 'ok' };
    const monter = n => { if (NIVEAU[n] > NIVEAU[gravite.v]) gravite.v = n; };

    if (ch.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) {
      problemes.push('visible par @everyone');
      monter('crit');
    }
    const permsProprio = guild.members.cache.get(userId) ? ch.permissionsFor(userId) : null;
    const ow = ch.permissionOverwrites.cache.get(userId);
    if (!ow || !ow.allow.has(P.ViewChannel) || !ow.allow.has(P.SendMessages)) {
      problemes.push('le propriétaire ne peut pas voir/écrire');
      monter('avert');
    } else if (permsProprio && (permsProprio.has(P.ManageChannels) || permsProprio.has(P.ManageMessages)) && !permsProprio.has(P.Administrator)) {
      // Le propriétaire a des droits de gestion via ses rôles : information utile, pas une erreur
      monter('info');
    }
    if (me) {
      const m = manquantes(ch.permissionsFor(me), PERMS_BOT_SALON);
      if (m.length) { problemes.push(`le bot ne peut pas : ${m.join(', ')}`); monter('crit'); }
    }
    // Accès supplémentaires (rôles / membres autres que le propriétaire et le bot)
    const autres = [];
    for (const o of ch.permissionOverwrites.cache.values()) {
      if (o.id === guild.roles.everyone.id || o.id === userId || o.id === me?.id) continue;
      if (o.allow.has(P.ViewChannel)) autres.push(o.type === OverwriteType.Role ? `<@&${o.id}>` : `<@${o.id}>`);
    }
    if (autres.length) { problemes.push(`accès supplémentaire : ${autres.slice(0, 4).join(', ')}${autres.length > 4 ? '…' : ''}`); monter('avert'); }
    if (categorie && ch.parentId !== categorie.id) { problemes.push('hors de la catégorie IA'); monter('info'); }

    if (problemes.length) ajouter(gravite.v === 'ok' ? 'info' : gravite.v, S4, `${ch} (<@${userId}>) : ${problemes.join(' ; ')}.`);
    else nbOk++;
  }

  if (Object.keys(tickets).length === 0) ajouter('info', S4, 'Aucun salon IA privé ouvert pour le moment.');
  else if (nbOk) ajouter('ok', S4, `${nbOk} salon(s) IA privé(s) correctement verrouillé(s).`);

  if (obsoletes.length) {
    ajouter('info', S4, `${obsoletes.length} entrée(s) pointent vers un salon supprimé (${obsoletes.slice(0, 5).join(', ')}${obsoletes.length > 5 ? '…' : ''}) — sans risque, nettoyées à la prochaine fermeture.`);
  }

  // Salons « ia-… » dans la catégorie IA qui ne sont plus suivis par le bot
  if (categorie) {
    const orphelins = guild.channels.cache.filter(c => c.parentId === categorie.id
      && c.id !== canal?.id && !idsSuivis.has(c.id) && /^ia-/i.test(c.name));
    if (orphelins.size) {
      const visibles = orphelins.filter(c => c.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel));
      ajouter(visibles.size ? 'crit' : 'avert', S4,
        `${orphelins.size} salon(s) « ia-… » non suivi(s) par le bot : ${[...orphelins.values()].slice(0, 5).map(c => `${c}`).join(', ')}${orphelins.size > 5 ? '…' : ''}`
        + `${visibles.size ? ` — dont **${visibles.size} visible(s) par @everyone**` : ''}.`);
    }
  }

  return constats;
}

function construireRapport(guild) {
  const constats = auditerPermissionsIa(guild);
  const pire = constats.reduce((m, c) => Math.max(m, NIVEAU[c.niveau]), 0);
  const couleur = pire >= NIVEAU.crit ? 0xED4245 : pire >= NIVEAU.avert ? 0xFEE75C : 0x57F287;
  const compte = n => constats.filter(c => c.niveau === n).length;

  const embed = new EmbedBuilder()
    .setColor(couleur)
    .setTitle('🛡️ Audit des permissions — Assistant IA')
    .setDescription(
      pire >= NIVEAU.crit ? '**Des problèmes importants ont été trouvés.**'
        : pire >= NIVEAU.avert ? '**Quelques points méritent votre attention.**'
          : '**Tout est en ordre.**',
    )
    .setFooter({ text: `${compte('crit')} critique(s) · ${compte('avert')} avertissement(s) · ${compte('ok')} point(s) OK • Lecture seule, rien n'a été modifié` })
    .setTimestamp();

  const sections = [...new Set(constats.map(c => c.section))];
  for (const nom of sections) {
    const lignes = constats
      .filter(c => c.section === nom)
      // les problèmes d'abord, puis les OK
      .sort((a, b) => NIVEAU[b.niveau] - NIVEAU[a.niveau])
      .map(c => `${ICONE[c.niveau]} ${c.texte}`);
    embed.addFields({ name: nom, value: coupe(lignes.join('\n'), 1024) });
  }
  return embed;
}

module.exports = { auditerPermissionsIa, construireRapport };
