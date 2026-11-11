// src/core/webDashboard.js : API du dashboard web CoreLab
// Fonctionne avec le serveur http natif de index.js (pas besoin d'Express).
// Routes : /panel/auth/login, /panel/auth/callback, /panel/api/...
// Variables d'environnement : DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, DASHBOARD_URL
//   (DISCORD_CLIENT_ID est facultatif : 1403513450273177772 par défaut)
//
// Les réglages lus/écrits ici sont EXACTEMENT ceux de /settings, /protect, /xp_config, /rankup…
// (bot_config.json via obtenirConfigGuilde, et rankup.json pour le Rankup).

const crypto = require('crypto');
const { obtenirConfigGuilde, persister } = require('./config');

const DISCORD = 'https://discord.com/api/v10';
const ADMIN = 0x8n;
const MANAGE_GUILD = 0x20n;
const TEXT_CHANNEL_TYPES = [0, 5];
const CATEGORY_TYPE = 4;
const MAX_LIST = 25;

/* ============================================================
   Modules affichés dans le dashboard.
   store : 'config' (bot_config.json, par défaut) ou 'rankup'
   Types : bool | text | longtext | number | select | color
           channel | category | role | channels | roles | ranks | xproles
   Options : section (titre de groupe), hint, dep (clé bool qui active le champ),
             premium (réservé aux abonnés personnalisation), assign (le bot donne ce rôle),
             emptyDelete (champ vide = clé supprimée → valeur par défaut du bot)
   ============================================================ */
const B = (key, label, def, x) => ({ key, label, type: 'bool', def, ...x });
const T = (key, label, max, x) => ({ key, label, type: 'text', max, def: '', ...x });
const L = (key, label, max, x) => ({ key, label, type: 'longtext', max, def: '', ...x });
const N = (key, label, def, min, max, x) => ({ key, label, type: 'number', def, min, max, ...x });
const S = (key, label, def, options, x) => ({ key, label, type: 'select', def, options, ...x });
const CH = (key, label, x) => ({ key, label, type: 'channel', def: '', ...x });
const CAT = (key, label, x) => ({ key, label, type: 'category', def: '', ...x });
const RO = (key, label, x) => ({ key, label, type: 'role', def: '', assign: true, ...x });
const CHS = (key, label, x) => ({ key, label, type: 'channels', def: [], ...x });
const ROS = (key, label, x) => ({ key, label, type: 'roles', def: [], assign: true, ...x });
const O = (...pairs) => pairs.map(([v, l]) => ({ v, l }));

const ACTIONS = O(['kick', 'Expulser'], ['ban', 'Bannir'], ['timeout', 'Mettre en sourdine (timeout)']);
const LANGS = O(['fr', 'Français'], ['en', 'English'], ['es', 'Español'], ['de', 'Deutsch'], ['it', 'Italiano'], ['pt', 'Português'], ['nl', 'Nederlands'], ['pl', 'Polski'], ['ru', 'Русский'], ['tr', 'Türkçe'], ['ar', 'العربية'], ['ja', '日本語'], ['ko', '한국어'], ['zh-CN', '中文 (简体)']);

const MODULES = [
  /* ---------- Général ---------- */
  {
    id: 'general', name: '⚙️ Général', group: 'Général', toggle: null,
    desc: 'Langue du bot, rôle de mute et salons divers.',
    fields: [
      S('language', 'Langue du bot', 'fr', O(['fr', 'Français'], ['en', 'English'])),
      RO('mute_role', 'Rôle de mute', { hint: 'Utilisé par les commandes de sanction.' }),
      CH('suggestion_channel_id', 'Salon des suggestions', { section: 'Salons' }),
      CH('photo_channel_id', 'Salon photo'),
      CH('repost_channel_id', 'Salon de repost'),
      RO('photo_winner_role_id', 'Rôle du gagnant photo')
    ]
  },
  {
    id: 'logs', name: '📋 Logs', group: 'Général', toggle: null,
    desc: 'Journal des événements du serveur (messages, membres, bans…).',
    fields: [
      CH('log_channel_id', 'Salon des logs', { hint: 'Sans salon, aucun log n’est envoyé.' }),
      S('log_style', 'Style des logs', 'image', O(['image', 'Carte image'], ['embed', 'Embed classique'])),
      B('log_messages', 'Messages (supprimés / modifiés)', true, { section: 'Types de logs' }),
      B('log_members', 'Arrivées et départs', true),
      B('log_members_update', 'Changements de profil et de rôles', true),
      B('log_roles', 'Création / suppression de rôles', true),
      B('log_channels', 'Salons', true),
      B('log_voice', 'Salons vocaux', true),
      B('log_emojis', 'Emojis', true),
      B('log_server', 'Réglages du serveur', true),
      B('log_bans', 'Bans et débans', true)
    ]
  },
  {
    id: 'translation', name: '🌐 Traduction auto', group: 'Général', toggle: 'translation_enabled',
    desc: 'Traduit automatiquement les messages.',
    fields: [
      B('translation_enabled', 'Activer la traduction', false),
      S('translation_scope', 'Portée', 'server', O(['server', 'Serveur entier'], ['channel', 'Salon précis']), { dep: 'translation_enabled' }),
      CH('translation_channel_id', 'Salon à traduire', { hint: 'Utilisé si la portée est « Salon précis ».', dep: 'translation_enabled' }),
      S('translation_target_lang', 'Langue cible', 'fr', LANGS, { dep: 'translation_enabled' }),
      B('translation_omnidirectional', 'Traduction dans les deux sens', false, { dep: 'translation_enabled' })
    ]
  },

  /* ---------- Membres ---------- */
  {
    id: 'welcome', name: '👋 Bienvenue & départs', group: 'Membres', toggle: null,
    desc: 'Messages d’arrivée et de départ, MP de bienvenue, rôles d’arrivée.',
    fields: [
      CH('welcome_channel_id', 'Salon de bienvenue', { section: 'Salons', hint: 'Sans salon, aucun message de bienvenue.' }),
      CH('goodbye_channel_id', 'Salon d’au revoir'),
      B('welcome_dm_enabled', 'Envoyer un MP de bienvenue', true, { section: 'Message privé' }),
      L('welcome_dm_message', 'Texte du MP', 1000, { dep: 'welcome_dm_enabled' }),
      B('send_rules_dm', 'Envoyer le règlement en MP', false),
      L('rules_dm_text', 'Texte du règlement en MP', 1500, { dep: 'send_rules_dm' }),
      RO('member_role_id', 'Rôle membre (après le règlement)', { section: 'Rôles' }),
      RO('member_role_id_2', 'Second rôle membre'),
      N('min_account_age_days', 'Âge minimum du compte (jours)', 0, 0, 365, { hint: '0 = désactivé. Les comptes plus récents sont expulsés.' }),
      T('welcome_appearance.title', 'Titre du message de bienvenue', 256, { section: 'Apparence (Premium)', premium: true, emptyDelete: true, hint: 'Vide = titre par défaut. Variables : {user.mention} {user.name} {server.name} {server.member_count}' }),
      L('welcome_appearance.description', 'Texte du message de bienvenue', 1500, { premium: true, emptyDelete: true, hint: 'Variables : {user.mention} {user.name} {user.id} {user.joined_at} {server.name} {server.member_count}' }),
      { key: 'welcome_appearance.color', label: 'Couleur du message de bienvenue', type: 'color', def: '#e8510d', premium: true },
      T('goodbye_appearance.title', 'Titre du message d’au revoir', 256, { premium: true, emptyDelete: true }),
      L('goodbye_appearance.description', 'Texte du message d’au revoir', 1500, { premium: true, emptyDelete: true }),
      { key: 'goodbye_appearance.color', label: 'Couleur du message d’au revoir', type: 'color', def: '#e8510d', premium: true }
    ]
  },
  {
    id: 'autorole', name: '🎭 Rôles automatiques', group: 'Membres', toggle: 'autorole_enabled',
    desc: 'Donne automatiquement des rôles aux nouveaux arrivants et aux bots.',
    fields: [
      B('autorole_enabled', 'Activer les rôles automatiques', false),
      ROS('autorole_role_ids', 'Rôles donnés aux membres', { dep: 'autorole_enabled' }),
      ROS('autorole_bot_role_ids', 'Rôles donnés aux bots', { dep: 'autorole_enabled' }),
      N('autorole_delay_seconds', 'Délai avant attribution (secondes)', 0, 0, 3600, { dep: 'autorole_enabled' }),
      B('autorole_wait_screening', 'Attendre la validation du règlement Discord', true, { dep: 'autorole_enabled' })
    ]
  },
  {
    id: 'tagrole', name: '🏷️ Rôle de tag', group: 'Membres', toggle: 'tag_role_enabled',
    desc: 'Donne un rôle aux membres qui portent le tag du serveur.',
    fields: [
      B('tag_role_enabled', 'Activer le rôle de tag', false),
      RO('tag_role_id', 'Rôle donné', { dep: 'tag_role_enabled' })
    ]
  },
  {
    id: 'birthday', name: '🎂 Anniversaires', group: 'Membres', toggle: null,
    desc: 'Annonce des anniversaires et rôle du jour.',
    fields: [
      CH('anniversaire_channel_id', 'Salon des anniversaires'),
      RO('anniversaire_role_id', 'Rôle d’anniversaire')
    ]
  },

  /* ---------- Animation ---------- */
  {
    id: 'levels', name: '⭐ Niveaux & XP', group: 'Animation', toggle: 'xp_enabled',
    desc: 'Les messages donnent de l’XP, des niveaux et des rôles de récompense.',
    fields: [
      B('xp_enabled', 'Activer l’XP', false),
      N('xp_cooldown', 'Délai entre deux gains (secondes)', 60, 0, 3600, { dep: 'xp_enabled' }),
      N('xp_min', 'XP minimum par message', 15, 1, 1000, { dep: 'xp_enabled' }),
      N('xp_max', 'XP maximum par message', 25, 1, 1000, { dep: 'xp_enabled' }),
      CH('xp_level_channel_id', 'Salon des annonces de niveau', { dep: 'xp_enabled', hint: 'Vide = dans le salon du message.' }),
      CHS('xp_ignored_channels', 'Salons ignorés (pas d’XP)', { dep: 'xp_enabled' }),
      S('xp_roles_mode', 'Mode des rôles de récompense', 'stack', O(['stack', 'Cumulatif : garde tous les rôles'], ['replace', 'Remplacement : garde le plus haut']), { section: 'Récompenses', dep: 'xp_enabled' }),
      { key: 'xp_roles', label: 'Rôles par niveau', type: 'xproles', def: [], assign: true, dep: 'xp_enabled' }
    ],
    check: v => (v.xp_min > v.xp_max ? 'L’XP minimum doit être inférieur ou égal à l’XP maximum.' : null)
  },
  {
    id: 'rankup', name: '🏆 Rankup', group: 'Animation', toggle: 'enabled', store: 'rankup',
    desc: 'Des rôles automatiques selon les messages et le temps passé en vocal.',
    fields: [
      B('enabled', 'Activer le Rankup', true),
      S('mode', 'Condition quand un palier demande messages et vocal', 'all', O(['all', 'Les deux'], ['any', 'L’un des deux']), { dep: 'enabled' }),
      CH('channelId', 'Salon d’annonce (optionnel)', { dep: 'enabled' }),
      { key: 'ranks', label: 'Paliers', type: 'ranks', def: [], assign: true, dep: 'enabled', hint: '0 = pas de condition sur ce critère. Les rôles dangereux, gérés par un bot ou au-dessus du bot sont refusés.' }
    ]
  },
  {
    id: 'starboard', name: '🌟 Starboard', group: 'Animation', toggle: 'starboard_enabled',
    desc: 'Met en avant les messages qui reçoivent assez d’étoiles.',
    fields: [
      B('starboard_enabled', 'Activer le starboard', false),
      CH('starboard_channel_id', 'Salon du starboard', { dep: 'starboard_enabled' }),
      N('starboard_threshold', 'Nombre de réactions requises', 3, 1, 100, { dep: 'starboard_enabled' }),
      CHS('starboard_ignored_channels', 'Salons ignorés', { dep: 'starboard_enabled' }),
      B('starboard_allow_self_star', 'Compter la réaction de l’auteur', true, { dep: 'starboard_enabled' }),
      B('starboard_ignore_nsfw', 'Ignorer les salons NSFW', false, { dep: 'starboard_enabled' }),
      B('starboard_remove_on_unstar', 'Retirer le message si les réactions repassent sous le seuil', true, { dep: 'starboard_enabled' })
    ]
  },
  {
    id: 'counting', name: '🔢 Comptage', group: 'Animation', toggle: 'counting_enabled',
    desc: 'Jeu de comptage dans un salon.',
    fields: [
      B('counting_enabled', 'Activer le comptage', false),
      CH('counting_channel_id', 'Salon de comptage', { dep: 'counting_enabled' }),
      B('counting_allow_consecutive', 'Autoriser un membre à compter deux fois de suite', false, { dep: 'counting_enabled' }),
      B('counting_delete_wrong', 'Supprimer les mauvais nombres', true, { dep: 'counting_enabled' }),
      B('counting_reset_on_error', 'Remettre à zéro en cas d’erreur', true, { dep: 'counting_enabled' })
    ]
  },
  {
    id: 'bump', name: '📣 Rappel de bump', group: 'Animation', toggle: 'bump_enabled',
    desc: 'Rappelle de bumper le serveur et remercie les membres.',
    fields: [
      B('bump_enabled', 'Activer le rappel de bump', false),
      CH('bump_channel_id', 'Salon du rappel', { dep: 'bump_enabled' }),
      { key: 'bump_role_id', label: 'Rôle à mentionner', type: 'role', def: '', dep: 'bump_enabled' },
      B('bump_thanks', 'Remercier après un bump', true, { dep: 'bump_enabled' })
    ]
  },

  /* ---------- Protection ---------- */
  {
    id: 'automod', name: '🛡️ Anti-spam & anti-scam', group: 'Protection', toggle: null,
    desc: 'Filtres automatiques de messages et de comptes.',
    fields: [
      CH('protection_log_channel_id', 'Salon des logs de protection'),
      B('antispam', 'Anti-spam', false, { section: 'Messages' }),
      B('antieveryone', 'Anti @everyone / @here', false),
      B('anti_link_enabled', 'Anti-liens', false),
      B('anti_phishing', 'Anti-phishing', false),
      B('anti_scam_image', 'Anti-scam par image', false),
      B('anti_scam_ai', 'Anti-scam par IA', false),
      B('anti_ghostping_enabled', 'Détection des ghost pings', false),
      B('anti_bot_enabled', 'Anti-bot (refuser les bots non autorisés)', false, { section: 'Comptes' }),
      B('anti_alt_enabled', 'Anti-alt (comptes trop récents)', false),
      N('anti_alt_min_days', 'Âge minimum anti-alt (jours)', 7, 1, 365, { dep: 'anti_alt_enabled' })
    ]
  },
  {
    id: 'antinuke', name: '☢️ Anti-nuke', group: 'Protection', toggle: 'anti_nuke_enabled',
    desc: 'Bloque les suppressions massives de salons, rôles et membres.',
    fields: [
      B('anti_nuke_enabled', 'Activer l’anti-nuke', false),
      N('anti_nuke_threshold', 'Actions tolérées', 3, 1, 50, { dep: 'anti_nuke_enabled' }),
      N('anti_nuke_window_seconds', 'Fenêtre de détection (secondes)', 10, 1, 300, { dep: 'anti_nuke_enabled' }),
      B('anti_perm_escalation_enabled', 'Bloquer l’escalade de permissions', false)
    ]
  },
  {
    id: 'raid', name: '🚨 Anti-raid', group: 'Protection', toggle: 'raidmode_enabled',
    desc: 'Détecte les arrivées massives de membres.',
    fields: [
      B('raidmode_enabled', 'Activer le mode anti-raid', false),
      N('raidmode_threshold', 'Arrivées avant déclenchement', 10, 2, 200, { dep: 'raidmode_enabled' }),
      N('raidmode_window_seconds', 'Fenêtre de détection (secondes)', 30, 5, 600, { dep: 'raidmode_enabled' }),
      S('raidmode_action', 'Action', 'kick', ACTIONS, { dep: 'raidmode_enabled' }),
      N('raidmode_duration_minutes', 'Durée de la sanction (minutes)', 15, 1, 10080, { dep: 'raidmode_enabled', hint: 'Pour le timeout.' }),
      B('dm_lock_enabled', 'Verrouiller les MP des membres entrants', false)
    ]
  },
  {
    id: 'ddos', name: '🌊 Anti-flood', group: 'Protection', toggle: null,
    desc: 'Réagit aux vagues de messages et de connexions en vocal.',
    fields: [
      B('anti_ddos_enabled', 'Anti-flood des salons textuels', false, { section: 'Texte' }),
      N('anti_ddos_threshold', 'Messages avant déclenchement', 30, 5, 1000, { dep: 'anti_ddos_enabled' }),
      N('anti_ddos_window_seconds', 'Fenêtre (secondes)', 10, 1, 300, { dep: 'anti_ddos_enabled' }),
      N('anti_ddos_min_users', 'Membres différents minimum', 5, 1, 100, { dep: 'anti_ddos_enabled' }),
      N('anti_ddos_duration_minutes', 'Durée de la protection (minutes)', 10, 1, 1440, { dep: 'anti_ddos_enabled' }),
      S('anti_ddos_action', 'Action', 'slowmode', O(['slowmode', 'Mode lent'], ['lock', 'Verrouiller le salon']), { dep: 'anti_ddos_enabled' }),
      B('anti_ddos_voice_enabled', 'Anti-flood des salons vocaux', false, { section: 'Vocal' }),
      N('anti_ddos_voice_threshold', 'Connexions avant déclenchement', 15, 3, 500, { dep: 'anti_ddos_voice_enabled' }),
      N('anti_ddos_voice_window_seconds', 'Fenêtre (secondes)', 10, 1, 300, { dep: 'anti_ddos_voice_enabled' }),
      N('anti_ddos_voice_min_users', 'Membres différents minimum', 6, 1, 100, { dep: 'anti_ddos_voice_enabled' }),
      N('anti_ddos_voice_duration_minutes', 'Durée de la protection (minutes)', 10, 1, 1440, { dep: 'anti_ddos_voice_enabled' }),
      S('anti_ddos_voice_action', 'Action', 'lock', O(['lock', 'Verrouiller le salon'], ['slowmode', 'Mode lent']), { dep: 'anti_ddos_voice_enabled' })
    ]
  },
  {
    id: 'captcha', name: '🔒 Captcha', group: 'Protection', toggle: 'captcha_enabled',
    desc: 'Vérifie les nouveaux membres avant de leur donner l’accès.',
    fields: [
      B('captcha_enabled', 'Activer le captcha', false),
      CH('captcha_channel_id', 'Salon de vérification', { dep: 'captcha_enabled' }),
      RO('captcha_role_id', 'Rôle donné pendant la vérification', { dep: 'captcha_enabled' }),
      RO('captcha_verified_role_id', 'Rôle donné une fois vérifié', { dep: 'captcha_enabled' }),
      N('captcha_timeout_minutes', 'Temps pour répondre (minutes)', 5, 1, 120, { dep: 'captcha_enabled' }),
      N('captcha_max_attempts', 'Essais autorisés', 3, 1, 20, { dep: 'captcha_enabled' }),
      B('captcha_kick_on_fail', 'Expulser en cas d’échec', true, { dep: 'captcha_enabled' })
    ]
  },
  {
    id: 'honeypot', name: '🍯 HoneyPot', group: 'Protection', toggle: 'honeypot_enabled',
    desc: 'Un salon piège pour attraper les bots et les comptes piratés.',
    fields: [
      B('honeypot_enabled', 'Activer le HoneyPot', false, { hint: 'Le message du salon piège se crée avec /protect.' }),
      CH('honeypot_channel_id', 'Salon piège', { dep: 'honeypot_enabled' }),
      CH('honeypot_review_channel_id', 'Salon de vérification des sanctions', { dep: 'honeypot_enabled' }),
      CH('infraction_channel_id', 'Salon des infractions', { section: 'Sanctions par défaut' }),
      S('infraction_default_action', 'Action par défaut', 'timeout', ACTIONS),
      N('infraction_default_duration_minutes', 'Durée par défaut (minutes)', 1440, 1, 40320)
    ]
  },
  {
    id: 'auth', name: '🪪 Vérification des comptes', group: 'Protection', toggle: 'auth_enabled',
    desc: 'Contrôle manuel des nouveaux comptes suspects.',
    fields: [
      B('auth_enabled', 'Activer la vérification', false),
      RO('auth_pending_role_id', 'Rôle en attente de validation', { dep: 'auth_enabled' }),
      CH('auth_review_channel_id', 'Salon de validation par le staff', { dep: 'auth_enabled' }),
      B('auth_double_detection_enabled', 'Détection des doubles comptes', true, { dep: 'auth_enabled' })
    ]
  },
  {
    id: 'transparency', name: '🔍 Signalements & transparence', group: 'Protection', toggle: null,
    desc: 'Signalements des membres et journal public des sanctions.',
    fields: [
      B('signalement_enabled', 'Activer les signalements', false),
      CH('signalement_channel_id', 'Salon des signalements', { dep: 'signalement_enabled' }),
      B('transparence_enabled', 'Activer le journal de transparence', false),
      CH('transparence_channel_id', 'Salon de transparence', { dep: 'transparence_enabled' })
    ]
  }
];

/* ============================================================ */

const sessions = new Map(); // token -> { user, guilds, exp }
const states = new Map();   // state -> timestamp
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (s.exp < now) sessions.delete(k);
  for (const [k, t] of states) if (now - t > 600000) states.delete(k);
}, 300000).unref();

const hasAccess = (perms, owner) => {
  if (owner) return true;
  try { const p = BigInt(perms || '0'); return (p & ADMIN) === ADMIN || (p & MANAGE_GUILD) === MANAGE_GUILD; }
  catch { return false; }
};
const publicField = f => ({ key: f.key, label: f.label, type: f.type, hint: f.hint, min: f.min, max: f.max, options: f.options, section: f.section, dep: f.dep, premium: !!f.premium, assign: !!f.assign });

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const setPath = (o, p, v) => {
  const ks = p.split('.'); let c = o;
  for (let i = 0; i < ks.length - 1; i++) { if (c[ks[i]] == null || typeof c[ks[i]] !== 'object') c[ks[i]] = {}; c = c[ks[i]]; }
  c[ks[ks.length - 1]] = v;
};
const delPath = (o, p) => {
  const ks = p.split('.'); let c = o;
  for (let i = 0; i < ks.length - 1; i++) { c = c?.[ks[i]]; if (c == null) return; }
  delete c[ks[ks.length - 1]];
};

function readBody(req, limit = 60000) {
  return new Promise((ok, ko) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > limit) { ko(new Error('trop gros')); req.destroy(); } });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { ko(e); } });
    req.on('error', ko);
  });
}

/* ---------- Accès aux données (config du bot ou Rankup) ---------- */
function rankupApi() { try { return require('../commands/rankup').dashboard || null; } catch { return null; } }
function source(mod, guildId) {
  if (mod.store === 'rankup') {
    const api = rankupApi();
    if (!api) return { enabled: false, mode: 'all', channelId: null, ranks: [] };
    return api.cfgOf(guildId, false) || { enabled: false, mode: 'all', channelId: null, ranks: [] };
  }
  return obtenirConfigGuilde(guildId);
}
function commit(mod, guildId) {
  if (mod.store === 'rankup') {
    const api = rankupApi();
    if (!api) throw new Error('Rankup indisponible');
    api.cfgOf(guildId, true); // crée l'entrée si besoin
    return api.save();
  }
  return persister('configuration');
}
function target(mod, guildId) {
  if (mod.store === 'rankup') {
    const api = rankupApi();
    if (!api) throw new Error('Rankup indisponible');
    return api.cfgOf(guildId, true);
  }
  return obtenirConfigGuilde(guildId);
}

function premiumOk(userId) {
  try { return !!require('./premium').estPremiumCustomisation(userId); } catch { return false; }
}

/* ---------- Lecture d'un champ ---------- */
function readField(f, raw) {
  switch (f.type) {
    case 'bool': return raw === undefined || raw === null ? !!f.def : raw !== false;
    case 'text': case 'longtext': return typeof raw === 'string' ? raw : (f.def || '');
    case 'number': { const n = Number(raw); return raw === null || raw === undefined || !Number.isFinite(n) ? f.def : n; }
    case 'select': return typeof raw === 'string' && raw ? raw : f.def;
    case 'channel': case 'category': case 'role': return raw ? String(raw) : '';
    case 'channels': case 'roles': return Array.isArray(raw) ? raw.map(String) : [];
    case 'color': return Number.isInteger(raw) ? '#' + raw.toString(16).padStart(6, '0') : (f.def || '#ffffff');
    case 'ranks': return Array.isArray(raw) ? raw.map(r => ({ roleId: String(r.roleId), messages: r.messages | 0, minutes: r.minutes | 0 })) : [];
    case 'xproles': return Array.isArray(raw) ? raw.map(r => ({ level: r.level | 0, roleId: String(r.roleId) })) : [];
    default: return raw;
  }
}
function readValues(mod, guildId) {
  const src = source(mod, guildId), out = {};
  for (const f of mod.fields) {
    const key = mod.store === 'rankup' ? f.key : f.key;
    out[f.key] = readField(f, getPath(src, key));
  }
  return out;
}

/* ---------- Validation d'un champ ---------- */
function checkField(f, v, cur, ctx) {
  const bad = reason => ({ err: reason });
  const roleCheck = id => {
    const role = ctx.guild.roles.cache.get(String(id));
    if (!role || role.id === ctx.guild.id) return 'rôle introuvable';
    if (f.assign) { const p = ctx.roleProblem(ctx.guild, role, ctx.executor); if (p) return `${role.name} : ${p}`; }
    return null;
  };
  switch (f.type) {
    case 'bool': return { value: v === true };
    case 'text': case 'longtext': return { value: String(v ?? '').slice(0, f.max || 200) };
    case 'number': {
      const n = Number(v);
      if (!Number.isFinite(n)) return bad('nombre invalide');
      return { value: Math.min(f.max ?? 1e9, Math.max(f.min ?? -1e9, Math.round(n))) };
    }
    case 'select': {
      const s = String(v ?? '');
      if (!f.options.some(o => o.v === s) && s !== cur) return bad('choix invalide');
      return { value: s };
    }
    case 'color': {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(v ?? ''));
      return m ? { value: parseInt(m[1], 16) } : bad('couleur invalide');
    }
    case 'channel': case 'category': {
      const id = v ? String(v) : '';
      if (id && id !== String(cur || '') && !(f.type === 'channel' ? ctx.chanIds : ctx.catIds).has(id)) return bad('salon introuvable');
      return { value: id || null };
    }
    case 'role': {
      const id = v ? String(v) : '';
      if (id && id !== String(cur || '')) { const e = roleCheck(id); if (e) return bad(e); }
      return { value: id || null };
    }
    case 'channels': {
      if (!Array.isArray(v) || v.length > MAX_LIST * 2) return bad('liste invalide');
      const ids = [...new Set(v.map(String))];
      const old = new Set((cur || []).map(String));
      for (const id of ids) if (!old.has(id) && !ctx.chanIds.has(id)) return bad('salon introuvable');
      return { value: ids };
    }
    case 'roles': {
      if (!Array.isArray(v) || v.length > MAX_LIST) return bad('liste invalide');
      const ids = [...new Set(v.map(String))];
      const old = new Set((cur || []).map(String));
      for (const id of ids) if (!old.has(id)) { const e = roleCheck(id); if (e) return bad(e); }
      return { value: ids };
    }
    case 'ranks': {
      if (!Array.isArray(v) || v.length > MAX_LIST) return bad(`${MAX_LIST} paliers maximum`);
      const old = new Set((cur || []).map(r => String(r.roleId)));
      const seen = new Set(), out = [];
      for (const r of v) {
        const roleId = String(r?.roleId || '');
        const messages = Math.min(10_000_000, Math.max(0, Math.round(Number(r?.messages) || 0)));
        const minutes = Math.min(6_000_000, Math.max(0, Math.round(Number(r?.minutes) || 0)));
        if (!roleId) return bad('choisis un rôle pour chaque palier');
        if (seen.has(roleId)) return bad('un rôle ne peut être utilisé que dans un seul palier');
        if (!messages && !minutes) return bad('chaque palier demande au moins des messages ou du vocal');
        if (!old.has(roleId)) { const e = roleCheck(roleId); if (e) return bad(e); }
        seen.add(roleId); out.push({ roleId, messages, minutes });
      }
      return { value: out };
    }
    case 'xproles': {
      if (!Array.isArray(v) || v.length > 50) return bad('50 rôles maximum');
      const old = new Set((cur || []).map(r => String(r.roleId)));
      const out = [];
      for (const r of v) {
        const roleId = String(r?.roleId || '');
        const level = Math.min(1000, Math.max(1, Math.round(Number(r?.level) || 0)));
        if (!roleId) return bad('choisis un rôle pour chaque niveau');
        if (!old.has(roleId)) { const e = roleCheck(roleId); if (e) return bad(e); }
        out.push({ level, roleId });
      }
      return { value: out };
    }
    default: return bad('type inconnu');
  }
}

// Retourne true si la requête concerne /panel (elle est alors traitée ici)
exports.handle = function (req, res, ctx) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/panel' && !url.pathname.startsWith('/panel/')) return false;
  route(req, res, ctx, url).catch(e => {
    console.error('[WebDashboard] :', e.message);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"server"}'); }
  });
  return true;
};
exports.MODULES = MODULES;
exports._test = { sessions, checkField, readValues };

async function route(req, res, { client }, url) {
  const env = process.env;
  const DEFAULT_ID = '1403513450273177772';
  const envId = (env.DISCORD_CLIENT_ID || '').trim();
  // Un vrai Client ID est un nombre de 17 à 20 chiffres : sinon (ex. un secret collé par erreur) on prend l'ID par défaut
  const CLIENT_ID = /^\d{17,20}$/.test(envId) ? envId : DEFAULT_ID;
  const SECRET = (env.DISCORD_CLIENT_SECRET || '').trim(), REDIRECT = (env.DISCORD_REDIRECT_URI || '').trim(), SITE = (env.DASHBOARD_URL || '').trim();
  if (envId && CLIENT_ID !== envId) console.warn('[WebDashboard] DISCORD_CLIENT_ID invalide (ce n\'est pas un nombre) : ID par défaut utilisé');
  if (SECRET && /^\d+$/.test(SECRET)) console.warn('[WebDashboard] DISCORD_CLIENT_SECRET ne contient que des chiffres : c\'est probablement l\'ID et non le secret');
  const cors = origin => ({
    'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS', 'Cache-Control': 'no-store'
  });
  if (!SECRET || !REDIRECT || !SITE) {
    res.writeHead(503, { 'Content-Type': 'application/json', ...cors('*') });
    return res.end('{"error":"not_configured"}');
  }
  const ORIGIN = new URL(SITE).origin;
  const J = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...cors(ORIGIN) }); res.end(JSON.stringify(obj)); };
  const go = loc => { res.writeHead(302, { Location: loc }); res.end(); };

  if (req.method === 'OPTIONS') { res.writeHead(204, cors(ORIGIN)); return res.end(); }
  const p = url.pathname.slice('/panel'.length) || '/';

  /* ---------- Connexion Discord ---------- */
  if (p === '/auth/login') {
    const state = crypto.randomBytes(16).toString('hex');
    states.set(state, Date.now());
    console.log(`[WebDashboard] login : client_id=${CLIENT_ID} secret=${SECRET.length} car. redirect=${REDIRECT}`);
    const q = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', scope: 'identify guilds', redirect_uri: REDIRECT, state });
    return go(`https://discord.com/oauth2/authorize?${q}`);
  }
  if (p === '/auth/callback') {
    const code = url.searchParams.get('code'), state = url.searchParams.get('state');
    if (url.searchParams.get('error')) return go(`${SITE}#error=denied`); // refus ou annulation sur Discord
    if (!code || !state || !states.has(state)) return go(`${SITE}#error=state`);
    states.delete(state);
    try {
      const r = await fetch(`${DISCORD}/oauth2/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT })
      });
      const raw = await r.text();
      let tk = {};
      try { tk = JSON.parse(raw); } catch {}
      if (!tk.access_token) {
        console.error('[WebDashboard] token', r.status, raw.slice(0, 200));
        throw new Error('jeton refusé par Discord');
      }
      const headers = { Authorization: `Bearer ${tk.access_token}` };
      const [user, guilds] = await Promise.all([
        fetch(`${DISCORD}/users/@me`, { headers }).then(x => x.json()),
        fetch(`${DISCORD}/users/@me/guilds`, { headers }).then(x => x.json())
      ]);
      if (!user.id || !Array.isArray(guilds)) throw new Error('profil illisible');
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, {
        user: { id: user.id, username: user.global_name || user.username, avatar: user.avatar },
        guilds: guilds.filter(g => hasAccess(g.permissions, g.owner)).map(g => ({ id: g.id, name: g.name, icon: g.icon })),
        exp: Date.now() + 6 * 3600 * 1000
      });
      return go(`${SITE}#token=${token}`);
    } catch (e) {
      console.error('[WebDashboard] connexion :', e.message);
      return go(`${SITE}#error=login`);
    }
  }

  /* ---------- Session ---------- */
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  const sess = sessions.get(tok);
  if (!sess || sess.exp < Date.now()) return J(401, { error: 'unauthorized' });

  if (p === '/api/me' && req.method === 'GET') {
    return J(200, { user: sess.user, guilds: sess.guilds.map(g => ({ ...g, botIn: client.guilds.cache.has(g.id) })) });
  }
  if (p === '/api/logout' && req.method === 'POST') { sessions.delete(tok); return J(200, { ok: true }); }

  const m = p.match(/^\/api\/guilds\/(\d+)(?:\/(meta)|\/modules\/(\w+))?$/);
  if (!m) return J(404, { error: 'not_found' });
  const [, guildId, isMeta, modId] = m;
  if (!sess.guilds.some(g => g.id === guildId)) return J(403, { error: 'forbidden' });
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return J(404, { error: 'bot_absent' });

  if (!isMeta && !modId && req.method === 'GET') {
    const modules = MODULES.map(mod => {
      const v = readValues(mod, guildId);
      return { id: mod.id, name: mod.name, group: mod.group, desc: mod.desc, enabled: mod.toggle ? !!v[mod.toggle] : null };
    });
    return J(200, { id: guild.id, name: guild.name, icon: guild.icon, members: guild.memberCount, channels: guild.channels.cache.size, roles: guild.roles.cache.size, modules });
  }

  if (isMeta && req.method === 'GET') {
    const { roleProblem } = require('../commands/roleMenu');
    const byName = (a, b) => a.name.localeCompare(b.name);
    return J(200, {
      premium: premiumOk(sess.user.id),
      channels: guild.channels.cache.filter(c => TEXT_CHANNEL_TYPES.includes(c.type)).map(c => ({ id: c.id, name: c.name })).sort(byName),
      categories: guild.channels.cache.filter(c => c.type === CATEGORY_TYPE).map(c => ({ id: c.id, name: c.name })).sort(byName),
      roles: guild.roles.cache.filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name, ok: !roleProblem(guild, r) })).sort(byName)
    });
  }

  if (modId) {
    const mod = MODULES.find(x => x.id === modId);
    if (!mod) return J(404, { error: 'module' });

    if (req.method === 'GET') {
      return J(200, { module: { id: mod.id, name: mod.name, desc: mod.desc, fields: mod.fields.map(publicField) }, values: readValues(mod, guildId), premium: premiumOk(sess.user.id) });
    }

    if (req.method === 'PUT') {
      let body;
      try { body = await readBody(req); } catch { return J(400, { error: 'invalid' }); }
      const { roleProblem } = require('../commands/roleMenu');
      const executor = await guild.members.fetch(sess.user.id).catch(() => null);
      const vctx = {
        guild, roleProblem, executor,
        chanIds: new Set(guild.channels.cache.filter(c => TEXT_CHANNEL_TYPES.includes(c.type)).map(c => c.id)),
        catIds: new Set(guild.channels.cache.filter(c => c.type === CATEGORY_TYPE).map(c => c.id))
      };
      const allowPremium = premiumOk(sess.user.id);
      const current = readValues(mod, guildId);
      const src = source(mod, guildId);
      const staged = [];
      for (const f of mod.fields) {
        if (!(f.key in body)) continue;
        if (JSON.stringify(body[f.key]) === JSON.stringify(current[f.key])) continue; // inchangé : on n'écrit rien
        if (f.premium && !allowPremium) return J(403, { error: 'premium', field: f.key });
        const r = checkField(f, body[f.key], getPath(src, f.key), vctx);
        if (r.err) return J(400, { error: 'invalid', field: f.key, label: f.label, reason: r.err });
        staged.push([f, r.value]);
      }
      if (mod.check) {
        const next = { ...current };
        for (const [f, v] of staged) next[f.key] = f.type === 'color' ? '#' + v.toString(16).padStart(6, '0') : (v === null ? '' : v);
        const problem = mod.check(next);
        if (problem) return J(400, { error: 'invalid', reason: problem });
      }
      const dest = target(mod, guildId);
      for (const [f, v] of staged) {
        if (f.emptyDelete && v === '') delPath(dest, f.key);
        else setPath(dest, f.key, v);
      }
      await commit(mod, guildId);
      console.log(`[WebDashboard] ${sess.user.username} a modifié « ${mod.id} » sur ${guild.name} (${staged.length} réglage(s))`);
      return J(200, { ok: true, values: readValues(mod, guildId) });
    }
  }
  return J(405, { error: 'method' });
}