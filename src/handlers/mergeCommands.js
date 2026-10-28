'use strict';
/**
 * Fusion de commandes slash en sous-commandes (limite Discord : 100 commandes globales).
 *
 * Aucune logique existante n'est réécrite : chaque commande source reste intacte,
 * elle est simplement rangée sous une commande parente. À l'exécution, le routeur
 * remet le contexte d'origine (commandName / sous-commande) puis appelle le execute() d'origine.
 *
 * Fonctionne avec le système de noms anglais existant (commandLocalizations.js) :
 * le JSON fusionné passe par localizeCommandMetadata() comme n'importe quelle commande,
 * et normalizeCommandInteraction() remet les noms internes avant d'arriver ici.
 *
 * Règles :
 *  - source plate (sans sous-commande)      → devient une sous-commande
 *  - source avec sous-commandes (sans groupe) → devient un groupe de sous-commandes
 *  - source avec groupes                    → non fusionnable (profondeur max Discord), ignorée
 *  - `extend: true` : ajoute des sous-commandes à une commande existante (ex. /config)
 *
 * Pour annuler une fusion : supprimer son bloc dans MERGES (les commandes d'origine reviennent seules).
 */
const { MessageFlags } = require('discord.js');

let OWNER_IDS = [];
try { OWNER_IDS = require('../core/constants').OWNER_IDS || []; } catch { /* optionnel */ }
let PATH_NAME_OVERRIDES = {};
try { PATH_NAME_OVERRIDES = require('../core/commandLocalizations').PATH_NAME_OVERRIDES || {}; } catch { /* optionnel */ }

// ─────────────────────────────────────────────────────────────────────
// CONFIG DES FUSIONS
//   name        : nom de la commande parente
//   description : ≤ 100 caractères (ne pas y mettre « Premium », réservé au contrôle premium)
//   extend      : true = ajouter à la commande existante `name`
//   subs        : { from: nom d'origine, as: nouveau nom (optionnel), en: nom anglais affiché (optionnel) }
// ─────────────────────────────────────────────────────────────────────
const MERGES = [
  {
    name: 'mod',
    description: '🛡️ Modération : kick, ban, mute, timeout, avertissements',
    subs: [
      { from: 'kick' },
      { from: 'ban' },
      { from: 'bannissement-temporaire', as: 'ban-temp', en: 'temp-ban' },
      { from: 'timeout' },
      { from: 'untimeout' },
      { from: 'mute' },
      { from: 'muet-temporaire', as: 'mute-temp', en: 'temp-mute' },
      { from: 'muet-retirer', as: 'unmute' },
      { from: 'warn' },
      { from: 'warninfos', as: 'warn-infos', en: 'warn-info' }
    ]
  },
  {
    name: 'infraction',
    description: '📋 Infractions et avertissements d\'un membre',
    subs: [
      { from: 'infractions', as: 'liste', en: 'list' },
      { from: 'infraction-ajouter', as: 'ajouter', en: 'add' },
      { from: 'infractions-reinitialiser', as: 'reinitialiser', en: 'reset' },
      { from: 'avertissement-reinitialiser', as: 'avertissements-reset', en: 'reset-warnings' }
    ]
  },
  {
    name: 'purge',
    description: '🧹 Nettoyage : messages, membre, salons, purge automatique',
    subs: [
      { from: 'purge', as: 'messages', en: 'messages' },
      { from: 'purgeuser', as: 'membre', en: 'user' },
      { from: 'deletechannels', as: 'salons', en: 'channels' },
      { from: 'purge-temp', as: 'auto', en: 'auto' },
      { from: 'purge-temp-liste', as: 'auto-liste', en: 'auto-list' },
      { from: 'purge-temp-retirer', as: 'auto-retirer', en: 'auto-remove' }
    ]
  },
  {
    name: 'verrouillage',
    description: '🔒 Verrouiller ou rouvrir un salon ou tout le serveur',
    subs: [
      { from: 'verrouiller', as: 'salon', en: 'channel' },
      { from: 'deverrouiller', as: 'salon-ouvrir', en: 'channel-unlock' },
      { from: 'verrouillage-total', as: 'serveur', en: 'server' },
      { from: 'deverrouillage-total', as: 'serveur-ouvrir', en: 'server-unlock' }
    ]
  },
  {
    name: 'role',
    description: '🎭 Gérer les rôles : ajouter, retirer, supprimer, temporaires',
    subs: [
      { from: 'role-ajouter', as: 'ajouter', en: 'add' },
      { from: 'role-retirer', as: 'retirer', en: 'remove' },
      { from: 'role-delete', as: 'supprimer', en: 'delete' },
      { from: 'role-temporaire', as: 'temporaire', en: 'temp' },
      { from: 'role-temporaire-liste', as: 'temporaire-liste', en: 'temp-list' },
      { from: 'role-temporaire-retirer', as: 'temporaire-retirer', en: 'temp-remove' }
    ]
  },
  {
    name: 'rappel',
    description: '⏰ Rappels : créer, lister, retirer',
    subs: [
      { from: 'rappel', as: 'creer', en: 'create' },
      { from: 'rappels', as: 'liste', en: 'list' },
      { from: 'rappel-retirer', as: 'retirer', en: 'remove' }
    ]
  },
  {
    name: 'planification',
    description: '🗓️ Messages planifiés : créer, lister, retirer',
    subs: [
      { from: 'planifier', as: 'creer', en: 'create' },
      { from: 'planification-liste', as: 'liste', en: 'list' },
      { from: 'planification-retirer', as: 'retirer', en: 'remove' }
    ]
  },
  {
    name: 'sondage',
    description: '📊 Sondages : créer, fermer, lister',
    subs: [
      { from: 'sondage', as: 'creer', en: 'create' },
      { from: 'sondage-fermer', as: 'fermer', en: 'close' },
      { from: 'sondage-liste', as: 'liste', en: 'list' }
    ]
  },
  {
    name: 'concours',
    description: '🎁 Concours : créer, lister, retirer un gagnant',
    subs: [
      { from: 'concours', as: 'creer', en: 'create' },
      { from: 'concours-liste', as: 'liste', en: 'list' },
      { from: 'concours-retirage', as: 'retirage', en: 'reroll' }
    ]
  },
  {
    name: 'stats',
    description: '📈 Statistiques : serveur, membre, bot',
    subs: [
      { from: 'serveur-statistiques', as: 'serveur', en: 'server' },
      { from: 'membre-statistiques', as: 'membre', en: 'member' },
      { from: 'bot-infos', as: 'bot', en: 'bot' }
    ]
  },
  {
    name: 'profil',
    description: '🖼️ Avatar et bannière d\'un membre',
    subs: [
      { from: 'avatar' },
      { from: 'banniere' }
    ]
  },
  {
    name: 'pseudo',
    description: '✏️ Changer ou réinitialiser un pseudo',
    subs: [
      { from: 'pseudo-definir', as: 'definir', en: 'set' },
      { from: 'pseudo-reinitialiser', as: 'reinitialiser', en: 'reset' }
    ]
  },
  {
    name: 'poke',
    description: '🎴 Pokémon : roue et combats',
    subs: [
      { from: 'poke-wheel', as: 'roue', en: 'wheel' },
      { from: 'poke-fight', as: 'combat', en: 'fight' }
    ]
  },
  {
    name: 'message',
    description: '💬 Envoyer un message, une annonce ou un embed',
    subs: [
      { from: 'annonce' },
      { from: 'message', as: 'envoyer', en: 'send' },
      { from: 'embed' }
    ]
  },
  {
    name: 'panel',
    description: '🧰 Panneaux : protection, crypto, bump',
    subs: [
      { from: 'protect-settings', as: 'protection', en: 'protection' },
      { from: 'crypto-panel', as: 'crypto', en: 'crypto' },
      { from: 'bump-rappel', as: 'bump', en: 'bump' }
    ]
  },
  {
    // Ajoute des sous-commandes à /config (déjà fait pour starboard, ticket, etc.)
    name: 'config',
    extend: true,
    subs: [
      { from: 'config-panel', as: 'panel', en: 'panel' },
      { from: 'config-ia', as: 'ia', en: 'ai' },
      { from: 'serverstats-setup', as: 'stats-salons', en: 'stats-channels' }
    ]
  }
];

// ─────────────────────────────────────────────────────────────────────

const NAME_RE = /^[-_\p{L}\p{N}]{1,32}$/u;
const warn = (m) => console.warn(`[Fusion] ⚠️  ${m}`);

const permsOf = (json) => json.default_member_permissions ?? null;
const hasPerms = (interaction, perms) => {
  if (perms == null) return true;
  const p = interaction.memberPermissions;
  return !!p && p.has(BigInt(perms));
};
const deny = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral });

function validate(json) {
  const problems = [];
  if (!NAME_RE.test(json.name) || json.name !== json.name.toLowerCase()) problems.push(`nom invalide « ${json.name} »`);
  if (!json.description || json.description.length > 100) problems.push('description vide ou > 100 caractères');
  const walk = (opts, path) => {
    if (opts.length > 25) problems.push(`${path} : plus de 25 entrées`);
    for (const o of opts) {
      if ((o.type === 1 || o.type === 2) && (!NAME_RE.test(o.name) || o.name !== o.name.toLowerCase())) problems.push(`${path}/${o.name} : nom invalide`);
      if (o.description && o.description.length > 100) problems.push(`${path}/${o.name} : description > 100`);
      if (o.options) walk(o.options, `${path}/${o.name}`);
    }
  };
  walk(json.options || [], json.name);
  if (JSON.stringify(json).length > 7500) problems.push('commande trop volumineuse (limite Discord 8000 caractères)');
  return problems;
}

function buildEntries(client, spec) {
  const entries = [];
  for (const s of spec.subs) {
    const src = client.commands.get(s.from);
    if (!src) { warn(`/${s.from} introuvable (déjà fusionnée ou absente) — ignorée.`); continue; }
    const json = src.data.toJSON();
    const opts = json.options || [];
    if (opts.some((o) => o.type === 2)) { warn(`/${s.from} contient des groupes — fusion impossible, laissée seule.`); continue; }
    entries.push({
      from: s.from,
      as: s.as || s.from,
      en: s.en || null,
      src,
      json,
      isGroup: opts.some((o) => o.type === 1),
      perms: permsOf(json),
      noDm: json.dm_permission === false
    });
  }
  return entries;
}

function applyOne(client, spec, legacy) {
  const base = spec.extend ? client.commands.get(spec.name) : null;
  if (spec.extend && !base) { warn(`/${spec.name} introuvable — extension ignorée.`); return; }

  let baseJson = null;
  if (base) {
    baseJson = base.data.toJSON();
    if ((baseJson.options || []).some((o) => o.type !== 1 && o.type !== 2)) {
      warn(`/${spec.name} a des options directes : impossible d'y ajouter des sous-commandes.`);
      return;
    }
  }

  let entries = buildEntries(client, spec).filter((e) => !(base && e.from === spec.name));
  const taken = new Set((baseJson?.options || []).map((o) => o.name));
  entries = entries.filter((e) => {
    if (taken.has(e.as)) { warn(`/${spec.name} ${e.as} existe déjà — /${e.from} ignorée.`); return false; }
    taken.add(e.as);
    return true;
  });
  if (!entries.length) return;

  const newOptions = entries.map((e) => ({
    type: e.isGroup ? 2 : 1,
    name: e.as,
    description: (e.json.description || e.as).slice(0, 100),
    options: e.json.options || []
  }));

  const srcPerms = entries.map((e) => e.perms);
  let json;
  if (baseJson) {
    json = { ...baseJson, options: [...(baseJson.options || []), ...newOptions] };
    for (const e of entries) {
      if (e.perms !== permsOf(baseJson)) warn(`/${e.from} (perms ${e.perms}) rangée sous /${spec.name} (perms ${permsOf(baseJson)}) : contrôle fait dans le code.`);
    }
  } else {
    const samePerms = srcPerms.every((p) => p === srcPerms[0]);
    json = {
      name: spec.name,
      description: spec.description.slice(0, 100),
      options: newOptions,
      default_member_permissions: samePerms ? srcPerms[0] : null,
      dm_permission: entries.every((e) => e.noDm) ? false : true,
      nsfw: false
    };
  }

  const problems = validate(json);
  if (problems.length) { warn(`/${spec.name} non appliquée : ${problems.join(' ; ')}`); return; }

  const byChild = new Map(entries.map((e) => [e.as, e]));
  const hasAuto = !!base?.autocomplete || entries.some((e) => e.src.autocomplete);

  const data = {
    name: json.name,
    description: json.description,
    options: json.options,
    // Copie profonde : localizeCommandMetadata() modifie le JSON en place à chaque enregistrement.
    toJSON: () => JSON.parse(JSON.stringify(json))
  };

  const route = (interaction) => {
    const o = interaction.options;
    const key = o.getSubcommandGroup(false) || o.getSubcommand(false);
    return key ? byChild.get(key) : null;
  };
  const enter = (interaction, entry) => {
    interaction.commandName = entry.from;
    interaction.options._group = null;
    if (!entry.isGroup) interaction.options._subcommand = null;
  };

  const merged = {
    data,
    async execute(interaction, client2) {
      const entry = route(interaction);
      if (!entry) {
        if (base) return base.execute(interaction, client2);
        return deny(interaction, '❌ Sous-commande inconnue.');
      }
      if (entry.src.ownerOnly && !OWNER_IDS.includes(interaction.user.id)) return deny(interaction, '❌ Cette commande est réservée au propriétaire du bot.');
      if (entry.src.adminOnly && !interaction.member?.permissions?.has('Administrator')) return deny(interaction, '❌ Cette commande est réservée aux administrateurs.');
      if (!hasPerms(interaction, entry.perms)) return deny(interaction, '❌ Tu n\'as pas la permission d\'utiliser cette commande.');
      if (entry.noDm && !interaction.inGuild()) return deny(interaction, '❌ Cette commande est utilisable uniquement sur un serveur.');
      enter(interaction, entry);
      return entry.src.execute(interaction, client2);
    }
  };
  if (hasAuto) {
    merged.autocomplete = async (interaction) => {
      const entry = route(interaction);
      if (!entry) return base?.autocomplete ? base.autocomplete(interaction) : undefined;
      if (!entry.src.autocomplete) return undefined;
      enter(interaction, entry);
      return entry.src.autocomplete(interaction);
    };
  }
  for (const k of ['ownerOnly', 'adminOnly']) if (base?.[k]) merged[k] = base[k];

  for (const e of entries) {
    if (e.en) PATH_NAME_OVERRIDES[`${spec.name}/${e.as}`] = e.en;
    client.commands.delete(e.from);
    legacy.set(e.from, `/${spec.name} ${e.as}`);
  }
  client.commands.set(spec.name, merged);
}

function patchHelpCategories(legacy) {
  try {
    const { HELP_CATEGORIES } = require('../core/helpCategories');
    for (const cat of HELP_CATEGORIES) {
      cat.commands = [...new Set(cat.commands.map((n) => (legacy.has(n) ? legacy.get(n).split(' ')[0].slice(1) : n)))];
    }
  } catch { /* aide optionnelle */ }
}

function applyMerges(client, merges = MERGES) {
  const before = client.commands.size;
  const legacy = new Map(); // ancien nom → « /parent sous-commande »
  for (const spec of merges) {
    try { applyOne(client, spec, legacy); } catch (e) { warn(`/${spec.name} : ${e.message}`); }
  }
  patchHelpCategories(legacy);
  for (const [oldName, now] of legacy) console.log(`[Fusion] /${oldName} → ${now}`);
  console.log(`[Fusion] ${before} → ${client.commands.size} commandes`);
  client.legacyCommandMap = legacy;
  return legacy;
}

module.exports = { applyMerges, MERGES };
