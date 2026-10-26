const { obtenirConfigGuilde } = require('./config');
// ────────────────────────────────────────────────
// Langues supportées (en ajouter d'autres ici plus tard, ex: es: { name: 'Español', flag: '🇪🇸' })
// ────────────────────────────────────────────────
const LANGUES = {
    en: { name: 'English', flag: '🇬🇧' },
    fr: { name: 'Français', flag: '🇫🇷' },
};
const LANGUE_PAR_DEFAUT = 'en';
// ────────────────────────────────────────────────
// Chaînes de traduction
// ────────────────────────────────────────────────
const CHAINES = {
    en: {
        // ── Welcome message ──────────────────────────
        welcome_content: '👋 Thanks for the invite{inviter}!',
        welcome_title: 'Thanks for adding me!',
        welcome_greeting: '🇬🇧 Hey **{guild}**!',
        welcome_intro: "I'm happy to be part of your server! Thanks to you, I'm now active on **{count} servers**.",
        welcome_lang_info: 'To change my language, use the menu below.',
        welcome_help_info: 'Need help? Use the `/help` command!',
        stats_title: '📊 My stats',
        stats_servers: 'Active servers',
        stats_uptime: 'Uptime',
        stats_members: 'Members here',
        lang_select_placeholder: '🌍 Choose a language',
        current_language: 'Current language',
        lang_changed: 'Language changed',
        support_button: 'Support',
        delete_button: 'Delete',
        no_permission: "❌ You don't have permission to do this.",
        added_by: 'Added by',

        // ── Generic ──────────────────────────────────
        missing_permission: '❌ Missing permission.',
        general_enabled: 'Enabled',
        general_disabled: 'Disabled',
        state_enabled: 'enabled',
        state_disabled: 'disabled',
        not_set: '❌ Not set',

        // ── /setnick ─────────────────────────────────
        setnick_too_long: '❌ Max 32 characters.',
        setnick_success: '✅ Nickname → **{nickname}**',

        // ── /resetnick ───────────────────────────────
        resetnick_success: '✅ Nickname reset to default.',

        // ── /announce ────────────────────────────────
        announce_sent: '✅ Announcement sent!',

        // ── /settings ──────────────────────────────────
        config_home_title: '⚙️ Server configuration',
        config_home_welcome_field: '👋 Welcome',
        config_home_welcome_value: 'Select a category from the menu below to configure the bot.',
        config_home_stats_field: '📊 Statistics',
        config_home_categories_field: '📁 Categories',
        config_category_select_placeholder: '📁 Select a category...',
        config_setting_select_placeholder: '🔧 Choose a setting to change...',
        config_back_button: '⬅️ Back to categories',
        config_premium_category_title: '⭐ Premium Category',
        config_premium_category_desc: "This category is reserved for **Premium** members. Unlock it to enjoy all of CoreLab's advanced features.",
        config_premium_setting_title: '⭐ Premium Setting',
        config_premium_setting_desc: "The **{setting}** setting is reserved for **Premium** members. Unlock it to enjoy all of CoreLab's advanced features.",
        config_choosing_role: 'Configuring **{setting}**',
        config_choosing_channel: 'Configuring **{setting}**',
        config_role_set: '✅ Role set: {role}',
        config_channel_set: '✅ Channel set: {channel}',
        config_boolean_set: '✅ **{setting}**: {value}',
        config_invalid_number: '❌ Invalid value: enter a positive whole number.',
        config_setting_updated: '✅ **{setting}** updated.',
        config_title_suffix: 'Configuration',
        config_settings_count: 'Settings',
        config_categories_count: 'Categories',

        cat_channels_title: '📍 Channels',
        cat_channels_desc: 'All channels used by the bot.',
        cat_logs_title: '📋 Logs',
        cat_logs_desc: 'Pick the logs channel, then select an event type to enable or disable it.',
        cat_roles_title: '🎭 Roles',
        cat_roles_desc: 'All roles automatically assigned by the bot.',
        cat_moderation_title: '🛡️ Moderation',
        cat_moderation_desc: 'Settings related to auto-moderation and security.',
        cat_bienvenue_title: '👋 Welcome & Goodbye',
        cat_bienvenue_desc: 'Messages sent to new members.',
        cat_reglement_title: '📜 Rules',
        cat_reglement_desc: 'Automatic sending of the rules via direct message.',
        cat_premium_title: '⭐ Premium',
        cat_premium_desc: 'Everything reserved for Premium / Customization members: welcome & goodbye, level-up image, tickets, backup...',
        cat_niveaux_title: '📈 Levels',
        cat_niveaux_desc: 'XP and level system (messages + voice), reward roles and level-up announcement.',
        cat_xp_title: 'Système d\'XP',
        cat_xp_desc: 'Configure le système d\'XP : gains, cooldown, salon d\'annonce, rôles de récompense et apparence du message de niveau.',
        cat_reponses_auto_title: '💬 Auto-responses',
        cat_reponses_auto_desc: 'Keyword-triggered automatic replies (manage entries with /autoreponse-ajouter).',
        cat_traduction_title: '🌐 Translation',
        cat_traduction_desc: 'Automatic server-wide translation (admin system, separate from each member\'s personal /traduction).',

        setting_photo_channel: 'Photos channel',
        setting_repost_channel: 'Starboard',
        setting_ticket_channel: 'Ticket category',
        setting_ticket_panel_channel: 'Ticket panel channel',
        setting_log_channel: 'Logs channel',
        setting_log_embed: 'Logs as embeds (off = image cards)',
        setting_log_messages: 'Deleted / edited messages',
        setting_log_messages_sent: 'Sent messages (very verbose)',
        setting_log_members: 'Members joining / leaving',
        setting_log_members_update: 'Member roles, nickname, timeout',
        setting_log_roles: 'Role create / update / delete',
        setting_log_channels: 'Channels & threads changes',
        setting_log_voice: 'Voice activity',
        setting_log_bans: 'Bans / unbans',
        setting_log_server: 'Server changes & invites',
        setting_log_emojis: 'Emojis & stickers',
        setting_log_sanctions: 'Moderation sanctions',
        setting_suggestion_channel: 'Suggestions channel',
        setting_welcome_channel: 'Welcome channel',
        setting_goodbye_channel: 'Goodbye channel',
        setting_anniversaire_channel: 'Birthdays channel',
        setting_infraction_channel: 'Infractions channel',

        setting_member_role: 'Member role (rules)',
        setting_member_role_2: 'Member role 2 (rules)',
        setting_mute_role: 'Mute role',
        setting_photo_winner_role: 'Photo of the Month role',
        setting_anniversaire_role: 'Birthday role',

        setting_antispam: 'Anti-spam',
        setting_antieveryone: 'Anti-@everyone',
        setting_anti_phishing: 'Anti-phishing / IP-logger',
        setting_anti_scam_image: 'Anti-scam image (OCR)',
        setting_min_account_age: 'Minimum account age (days)',

        setting_welcome_dm_enabled: 'Welcome DM enabled',
        setting_welcome_dm_message: 'Welcome message (DM)',

        setting_send_rules_dm: 'Send the rules by DM',
        setting_rules_dm_text: 'Rules text (DM)',

        setting_xp_enabled: 'XP system enabled',
        setting_xp_cooldown: 'Cooldown (seconds)',
        setting_xp_min: 'Minimum XP per message',
        setting_xp_max: 'Maximum XP per message',
        setting_xp_voice_enabled: 'XP while in voice',
        setting_xp_voice_interval: 'Voice XP interval (minutes)',
        setting_xp_voice_amount: 'XP per voice interval',
        setting_xp_voice_bonus_minutes: 'Voice bonus: every X minutes in a row (0 = off)',
        setting_xp_voice_bonus_amount: 'Voice bonus: extra XP per tier',
        setting_xp_voice_bonus_max: 'Voice bonus: max tiers (0 = no cap)',
        setting_xp_level_channel: 'Level-up channel',

        setting_autoresponse_enabled: 'Auto-responses enabled',

        setting_translation_enabled: 'Auto-translation enabled',
        setting_translation_scope: 'Scope ("server" or "channel")',
        setting_translation_channel: 'Translation channel (if scope = channel)',
        setting_translation_target_lang: 'Target language code (e.g. fr, en)',

        // ── /ticket ──────────────────────────────────
        // (embed/rows built in ticket.js, not covered here)

        // ── /tempban ─────────────────────────────────
        tempban_failed: '❌ Unable to ban this member.',
        tempban_success: '🚫 {member} banned for {days} day(s).',

        // ── /tempmute ────────────────────────────────
        mute_role_missing: '❌ Mute role not configured.',
        tempmute_success: '🔇 {member} muted for {minutes} minute(s).',

        // ── /unmute ──────────────────────────────────
        unmute_not_muted: '✅ {member} is not muted.',
        unmute_success: '✅ {member} unmuted.',

        // ── /timeout ─────────────────────────────────
        timeout_success: '⏳ {member} timed out for {minutes} min.',

        // ── /untimeout ───────────────────────────────
        untimeout_success: '✅ Timeout removed for {member}.',

        // ── /addrole ─────────────────────────────────
        addrole_success: '✅ Role **{role}** added to {member}.',
        addrole_failed: "❌ Unable to add the role **{role}**. Check the bot's permissions.",

        // ── /removerole ──────────────────────────────
        removerole_success: '✅ Role **{role}** removed from {member}.',
        removerole_failed: "❌ Unable to remove the role **{role}**. Check the bot's permissions.",

        // ── /antispam ────────────────────────────────
        antispam_toggled: '🛡️ Anti-spam {state}.',

        // ── /antieveryone ────────────────────────────
        antieveryone_toggled: '🔕 Anti-@everyone {state}.',

        // ── /resetwarn ───────────────────────────────
        resetwarn_success: "✅ {member}'s warns removed.",
        resetwarn_none: '{member} has no warns.',

        // ── /birthday ────────────────────────────────
        birthday_invalid_format: '❌ Invalid format. E.g.: `26/12/2001`',
        birthday_saved: '🎂 Date saved: **{date}**',
        birthday_invalid_date: '❌ Invalid date.',

        // ── /mp ──────────────────────────────────────
        dm_no_valid_member: '❌ No valid member found.',
        dm_sent: '✅ Message sent to {count} member(s).',

        // ── /infractions ─────────────────────────────
        infractions_title: "📋 {member}'s infractions",
        infractions_total: 'Total',
        infractions_next: 'Next sanction',
        infractions_none: 'None',
        infractions_next_mute10: 'Next: Mute 10min',
        infractions_next_mute1h: 'Next: Mute 1h',
        infractions_next_kick: 'Next: Kick',
        infractions_next_ban: 'Next: Ban',
        infractions_ban_label: '🚫 Ban',
        infractions_recent: 'Recent infractions',
        infractions_no_reason: 'No reason provided',

        // ── /add-infraction ───────────────────────
        infraction_add_success: '✅ Infraction added to {member} ({count} total).',

        // ── /infractions_reset ───────────────────────
        infractions_reset_success: "✅ {member}'s infractions have been reset.",

        // ── /message ─────────────────────────────────
        message_sent: '✅ Message sent in {channel}.',

        // ── Control panel (@CoreLab mention) ────────
        panel_title: '┃ Welcome to the control panel',
        panel_subtitle: 'Advanced Discord management system — online and operational.',
        panel_status_title: '🔸 SYSTEM STATUS',
        panel_status_value: '• Online  •  Latency **{latency}ms**  •  Uptime **{uptime}**',
        panel_servers_title: '🖥️ Active servers',
        panel_servers_value: '{count} servers',
        panel_commands_title: '⚙️ Commands',
        panel_commands_value: '{count} available',
        panel_footer: 'CoreLab • Main panel • Today at {time}',
        panel_current_server_title: '🔖 Current server',
        panel_current_server_value: 'Server of **{owner}**\n[{id}]',
    },
    fr: {
        // ── Welcome message ──────────────────────────
        welcome_content: "👋 Merci pour l'invitation{inviter} !",
        welcome_title: "Merci de m'avoir ajouté !",
        welcome_greeting: '🇫🇷 Salut **{guild}** !',
        welcome_intro: 'Je suis ravi de faire partie de ton serveur ! Grâce à toi, je suis maintenant présent sur **{count} serveurs**.',
        welcome_lang_info: 'Pour changer ma langue, utilise le menu ci-dessous.',
        welcome_help_info: "Besoin d'aide ? Utilise la commande `/aide` !",
        stats_title: '📊 Mes statistiques',
        stats_servers: 'Serveurs actifs',
        stats_uptime: 'Uptime',
        stats_members: 'Membres ici',
        lang_select_placeholder: '🌍 Choisir une langue',
        current_language: 'Langue actuelle',
        lang_changed: 'Langue modifiée',
        support_button: 'Support',
        delete_button: 'Supprimer',
        no_permission: "❌ Tu n'as pas la permission de faire ça.",
        added_by: 'Ajouté par',

        // ── Generic ──────────────────────────────────
        missing_permission: '❌ Permission manquante.',
        general_enabled: 'Activé',
        general_disabled: 'Désactivé',
        state_enabled: 'activé',
        state_disabled: 'désactivé',
        not_set: '❌ Non défini',

        // ── /setnick ─────────────────────────────────
        setnick_too_long: '❌ 32 caractères maximum.',
        setnick_success: '✅ Pseudo → **{nickname}**',

        // ── /resetnick ───────────────────────────────
        resetnick_success: '✅ Pseudo réinitialisé par défaut.',

        // ── /announce ────────────────────────────────
        announce_sent: '✅ Annonce envoyée !',

        // ── /settings ──────────────────────────────────
        config_home_title: '⚙️ Configuration du serveur',
        config_home_welcome_field: '👋 Bienvenue',
        config_home_welcome_value: 'Sélectionne une catégorie dans le menu ci-dessous pour configurer le bot.',
        config_home_stats_field: '📊 Statistiques',
        config_home_categories_field: '📁 Catégories',
        config_category_select_placeholder: '📁 Sélectionner une catégorie...',
        config_setting_select_placeholder: '🔧 Choisir un paramètre à modifier...',
        config_back_button: '⬅️ Retour aux catégories',
        config_premium_category_title: '⭐ Catégorie Premium',
        config_premium_category_desc: "Cette catégorie est réservée aux membres **Premium**. Débloque-la pour profiter de toutes les fonctionnalités avancées de CoreLab.",
        config_premium_setting_title: '⭐ Paramètre Premium',
        config_premium_setting_desc: "Le paramètre **{setting}** est réservé aux membres **Premium**. Débloque-le pour profiter de toutes les fonctionnalités avancées de CoreLab.",
        config_choosing_role: 'Configuration de **{setting}**',
        config_choosing_channel: 'Configuration de **{setting}**',
        config_role_set: '✅ Rôle défini : {role}',
        config_channel_set: '✅ Salon défini : {channel}',
        config_boolean_set: '✅ **{setting}** : {value}',
        config_invalid_number: '❌ Valeur invalide : entre un nombre entier positif.',
        config_setting_updated: '✅ **{setting}** mis à jour.',
        config_title_suffix: 'Configuration',
        config_settings_count: 'Paramètres',
        config_categories_count: 'Catégories',

        cat_channels_title: '📍 Salons',
        cat_channels_desc: 'Tous les salons utilisés par le bot.',
        cat_logs_title: '📋 Logs',
        cat_logs_desc: "Choisis le salon des logs puis sélectionne un type d'événement pour l'activer ou le désactiver.",
        cat_roles_title: '🎭 Rôles',
        cat_roles_desc: 'Tous les rôles attribués automatiquement par le bot.',
        cat_moderation_title: '🛡️ Modération',
        cat_moderation_desc: "Paramètres liés à l'automodération et à la sécurité.",
        cat_bienvenue_title: '👋 Bienvenue & Départs',
        cat_bienvenue_desc: 'Messages envoyés aux nouveaux membres.',
        cat_reglement_title: '📜 Règlement',
        cat_reglement_desc: 'Envoi automatique du règlement par message privé.',
        cat_premium_title: '⭐ Premium',
        cat_premium_desc: 'Tout ce qui est réservé aux membres Premium / Personnalisation : bienvenue & au revoir, image de niveau, tickets, backup...',
        cat_niveaux_title: '📈 Niveaux',
        cat_niveaux_desc: "Système d'XP et de niveaux (messages + vocal), rôles de récompense et annonce de montée de niveau.",
        cat_reponses_auto_title: '💬 Réponses automatiques',
        cat_reponses_auto_desc: "Réponses déclenchées par mot-clé (gérer les entrées via /autoreponse-ajouter).",
        cat_traduction_title: '🌐 Traduction',
        cat_traduction_desc: "Traduction automatique globale du serveur (système admin, indépendant du /traduction personnel de chaque membre).",

        setting_photo_channel: 'Salon photos',
        setting_repost_channel: 'Starboard',
        setting_ticket_channel: 'Catégorie tickets',
        setting_ticket_panel_channel: 'Salon du panneau tickets',
        setting_log_channel: 'Salon des logs',
        setting_log_embed: 'Logs en embed (désactivé = images)',
        setting_log_messages: 'Messages supprimés / modifiés',
        setting_log_messages_sent: 'Messages envoyés (très verbeux)',
        setting_log_members: 'Arrivées / départs de membres',
        setting_log_members_update: 'Rôles, pseudo, timeout des membres',
        setting_log_roles: 'Création / modif. / suppression de rôles',
        setting_log_channels: 'Salons et fils (création, modif., suppression)',
        setting_log_voice: 'Activité vocale',
        setting_log_bans: 'Bannissements / débannissements',
        setting_log_server: 'Modifications du serveur et invitations',
        setting_log_emojis: 'Emojis et stickers',
        setting_log_sanctions: 'Sanctions de modération',
        setting_suggestion_channel: 'Salon des suggestions',
        setting_welcome_channel: 'Salon de bienvenue',
        setting_goodbye_channel: 'Salon de départ',
        setting_anniversaire_channel: 'Salon anniversaires',
        setting_infraction_channel: 'Salon des infractions',

        setting_member_role: 'Rôle membre (règlement)',
        setting_member_role_2: 'Rôle membre 2 (règlement)',
        setting_mute_role: 'Rôle muet',
        setting_photo_winner_role: 'Rôle photo du mois',
        setting_anniversaire_role: "Rôle d'anniversaire",

        setting_antispam: 'Anti-spam',
        setting_antieveryone: 'Anti-@everyone',
        setting_anti_phishing: 'Anti-phishing / IP-logger',
        setting_anti_scam_image: 'Anti-arnaque image (OCR)',
        setting_min_account_age: 'Âge minimum du compte (jours)',

        setting_welcome_dm_enabled: 'MP de bienvenue activé',
        setting_welcome_dm_message: 'Message de bienvenue (MP)',

        setting_send_rules_dm: 'Envoyer le règlement par MP',
        setting_rules_dm_text: 'Texte du règlement (MP)',

        setting_xp_enabled: 'Système XP activé',
        setting_xp_cooldown: 'Cooldown (secondes)',
        setting_xp_min: 'XP minimum par message',
        setting_xp_max: 'XP maximum par message',
        setting_xp_voice_enabled: 'XP en vocal',
        setting_xp_voice_interval: 'Intervalle XP vocal (minutes)',
        setting_xp_voice_amount: 'XP par intervalle en vocal',
        setting_xp_voice_bonus_minutes: 'Bonus vocal : tous les X min d\'affilée (0 = off)',
        setting_xp_voice_bonus_amount: 'Bonus vocal : XP en plus par palier',
        setting_xp_voice_bonus_max: 'Bonus vocal : paliers max (0 = illimité)',
        setting_xp_level_channel: 'Salon de montée de niveau',

        setting_autoresponse_enabled: 'Réponses automatiques activées',

        setting_translation_enabled: 'Traduction automatique activée',
        setting_translation_scope: 'Portée ("server" ou "channel")',
        setting_translation_channel: 'Salon de traduction (si portée = channel)',
        setting_translation_target_lang: 'Code langue cible (ex. fr, en)',

        // ── /tempban ─────────────────────────────────
        tempban_failed: '❌ Impossible de bannir ce membre.',
        tempban_success: '🚫 {member} banni pour {days} jour(s).',

        // ── /tempmute ────────────────────────────────
        mute_role_missing: '❌ Rôle muet non configuré.',
        tempmute_success: '🔇 {member} rendu muet pour {minutes} minute(s).',

        // ── /unmute ──────────────────────────────────
        unmute_not_muted: "✅ {member} n'est pas muet.",
        unmute_success: '✅ {member} n\'est plus muet.',

        // ── /timeout ─────────────────────────────────
        timeout_success: '⏳ {member} mis en isolement pour {minutes} min.',

        // ── /untimeout ───────────────────────────────
        untimeout_success: '✅ Isolement retiré pour {member}.',

        // ── /addrole ─────────────────────────────────
        addrole_success: '✅ Rôle **{role}** ajouté à {member}.',
        addrole_failed: "❌ Impossible d'ajouter le rôle **{role}**. Vérifie les permissions du bot.",

        // ── /removerole ──────────────────────────────
        removerole_success: '✅ Rôle **{role}** retiré à {member}.',
        removerole_failed: "❌ Impossible de retirer le rôle **{role}**. Vérifie les permissions du bot.",

        // ── /antispam ────────────────────────────────
        antispam_toggled: '🛡️ Anti-spam {state}.',

        // ── /antieveryone ────────────────────────────
        antieveryone_toggled: '🔕 Anti-@everyone {state}.',

        // ── /resetwarn ───────────────────────────────
        resetwarn_success: '✅ Avertissements de {member} supprimés.',
        resetwarn_none: "{member} n'a aucun avertissement.",

        // ── /birthday ────────────────────────────────
        birthday_invalid_format: '❌ Format invalide. Ex : `26/12/2001`',
        birthday_saved: '🎂 Date enregistrée : **{date}**',
        birthday_invalid_date: '❌ Date invalide.',

        // ── /mp ──────────────────────────────────────
        dm_no_valid_member: '❌ Aucun membre valide trouvé.',
        dm_sent: '✅ Message envoyé à {count} membre(s).',

        // ── /infractions ─────────────────────────────
        infractions_title: '📋 Infractions de {member}',
        infractions_total: 'Total',
        infractions_next: 'Prochaine sanction',
        infractions_none: 'Aucune',
        infractions_next_mute10: 'Prochaine : Mute 10min',
        infractions_next_mute1h: 'Prochaine : Mute 1h',
        infractions_next_kick: 'Prochaine : Kick',
        infractions_next_ban: 'Prochaine : Ban',
        infractions_ban_label: '🚫 Ban',
        infractions_recent: 'Infractions récentes',
        infractions_no_reason: 'Aucune raison fournie',

        // ── /add-infraction ───────────────────────
        infraction_add_success: '✅ Infraction ajoutée à {member} ({count} au total).',

        // ── /infractions_reset ───────────────────────
        infractions_reset_success: '✅ Infractions de {member} réinitialisées.',

        // ── /message ─────────────────────────────────
        message_sent: '✅ Message envoyé dans {channel}.',

        // ── Panneau de contrôle (mention @CoreLab) ──
        panel_title: '┃ Bienvenue dans le panneau de contrôle',
        panel_subtitle: 'Système de gestion Discord avancé — en ligne et opérationnel.',
        panel_status_title: '🔸 ÉTAT DU SYSTÈME',
        panel_status_value: '• En ligne  •  Latence **{latency}ms**  •  Uptime **{uptime}**',
        panel_servers_title: '🖥️ Serveurs actifs',
        panel_servers_value: '{count} serveurs',
        panel_commands_title: '⚙️ Commandes',
        panel_commands_value: '{count} disponibles',
        panel_footer: "CoreLab • Panneau principal • Aujourd'hui à {time}",
        panel_current_server_title: '🔖 Serveur actuel',
        panel_current_server_value: 'Serveur de **{owner}**\n[{id}]',
    },
};
// ────────────────────────────────────────────────
// traduire(idGuilde, cle, variables) — résout une chaîne pour la langue configurée
// de la guilde, avec repli sur la langue par défaut si la clé ou la langue est manquante.
// ────────────────────────────────────────────────
function traduire(idGuilde, cle, variables = {}) {
    const config = obtenirConfigGuilde(idGuilde);
    const langue = CHAINES[config?.language] ? config.language : LANGUE_PAR_DEFAUT;
    let chaine = CHAINES[langue][cle] ?? CHAINES[LANGUE_PAR_DEFAUT][cle] ?? cle;
    for (const [k, v] of Object.entries(variables)) {
        chaine = chaine.replaceAll(`{${k}}`, v);
    }
    return chaine;
}
module.exports = {
    // exports français d'origine
    LANGUES,
    CHAINES,
    LANGUE_PAR_DEFAUT,
    traduire,

    // alias anglais — pour compatibilité avec welcome.js et extended.js
    LANGUAGES: LANGUES,
    STRINGS: CHAINES,
    DEFAULT_LANGUAGE: LANGUE_PAR_DEFAUT,
    t: traduire,
};