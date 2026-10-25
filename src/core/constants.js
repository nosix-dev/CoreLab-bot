const constantes = {
    ID_PROPRIETAIRE_BOT: '1252736157285093397',
    IDS_PROPRIETAIRES: new Set(['1252736157285093397']),
    ID_SKU_PREMIUM: '1516591204836311103',
    // ⚠️ Remplace cette valeur par l'ID du SKU du 2e abonnement (Personnalisation),
    // créé dans Discord Developer Portal > Monetization > SKUs.
    ID_SKU_CUSTOMISATION: '1528126759155929239',
    // ⚠️ Remplace cette valeur par l'ID du SKU du 3e abonnement (Total),
    // créé dans Discord Developer Portal > Monetization > SKUs.
    // Cet abonnement donne accès aux commandes Premium ET à la Personnalisation en même temps.
    ID_SKU_TOTAL: '1528374770809442554',
    // Salon où CoreLab poste une notification (avec boutons Blacklist / Statistique)
    // à chaque fois qu'il est ajouté à un nouveau serveur.
    SALON_NOTIF_AJOUT_BOT: '1541117119402475531',
    SEUIL_ETOILES: 1,
    PREFIXE: '!',
    DOSSIER_IMAGES_BIENVENUE: 'welcome_images',
    MAX_SAUVEGARDES_GRATUIT: 3,
    MAX_SAUVEGARDES_PREMIUM: 10,
    FICHIERS: {
        CONFIGURATION: 'bot_config.json',
        AVERTISSEMENTS: 'warns.json',
        SOURDINE: 'mute_data.json',
        BANNISSEMENT: 'ban_data.json',
        TABLEAU_ETOILES: 'starboard.json',
        STARBOARD_MESSAGES: 'starboard_messages.json',
        ANNIVERSAIRES: 'birthdays.json',
        YOUTUBE: 'yt_notifs.json',
        BLOG: 'blog_notifs.json',
        MEDAILLE: 'medal_notifs.json',
        TIKTOK: 'tiktok_notifs.json',
        XP: 'xp_data.json',
        RAPPELS: 'reminders.json',
        EVENEMENTS: 'events.json',
        SONDAGES: 'polls.json',
        CONCOURS: 'giveaways.json',
        ROLES_REACTION: 'reaction_roles.json',
        COMPTES_PIRATES: 'hacked_detection.json',
        ROLES_TEMPORAIRES: 'temp_roles.json',
        REPONSE_AUTO: 'autoresponses.json',
        FORMULAIRES_TICKET: 'ticket_forms.json',
        FORMULAIRES: 'formulaires.json',
        PREMIUM: 'premium_users.json',
        TRADUCTION_AUTO: 'auto_translate.json',
        LANGUE_UTILISATEUR: 'user_translation_prefs.json',
        SAUVEGARDES: 'backups.json',
        VOCAL_TEMPORAIRE: 'temp_voice.json',
        PLANIFIES: 'scheduled_messages.json',
        PURGE_TEMPORAIRE: 'temp_purge.json',
        ANNONCE_VOCALE: 'vocal_announce.json',
        MOTS_INTERDITS: 'badwords.json',
        INFRACTIONS: 'infractions.json',
        LOGS_DETAILLES: 'detailed_logs.json',
        PARTENARIATS: 'partnerships.json',
        PARTENARIATS_AUTO: 'partnerships_auto.json',
        BANNISSEMENTS_TEMPORAIRES: 'temp_bans.json',
        SOURDINES_TEMPORAIRES: 'temp_mutes.json',
        BLACKLIST_SERVEURS: 'guild_blacklist.json',
        BLACKLIST_UTILISATEURS: 'user_blacklist.json',
        BOUTONS_DIFFUSION: 'broadcast_buttons.json',
        EMBEDS_PERSONNALISES: 'custom_embeds.json',
        ECONOMIE: 'economy.json',
        COMPTAGE: 'counting.json',
    },
    COMMANDES_PUBLIQUES: new Set([
        'anniversaire', 'invite', 'aide', 'rank', 'leaderboard',
        'rappel', 'reminder', 'events', 'suggestion', 'premium',
        'traduction_setup', 'traduction_supprimer', 'traduction_liste',
    ]),
    COMMANDES_PREMIUM: new Set([
        'backup_creer', 'backup_liste', 'backup_coller', 'backup_restaurer', 'backup_supprimer',
        'tts', 'sondage', 'giveaway', 'rr_creer', 'rr_ajouter', 'rr_supprimer', 'rr_liste',
        'tempvoice_setup', 'vocal_annonce_setup', 'welcome_image', 'planifier', 'temp_purge',
        'autoreponse_ajouter', 'xp_config', 'xp_add', 'xp_reset', 'xp_remove', 'leaderboard', 'rank',
        'vocal_annonce_toggle', 'suggestion', 'sondage_fermer', 'sondage_liste',
        'rappel', 'rappels', 'rappel_supprimer', 'planifier_liste', 'planifier_supprimer',
        'partenariat', 'partenariat_liste', 'partenariat_reset', 'partenariat_stats',
        'autoreponse_liste', 'autoreponse_modifier', 'autoreponse_supprimer', 'autoreponse_vider',
        'blog', 'blog_liste', 'blog_supprimer', 'mp', 'events', 'event_supprimer', 'event_creer',
        'notification', 'youtube_liste', 'youtube', 'youtube_supprimer',
    ]),
};

// ────────────────────────────────────────────────
// ALIAS ANGLAIS — pour compatibilité avec index.js
// (index.js importe des noms en anglais ; on les fait
// pointer vers les mêmes valeurs que les constantes FR)
// ────────────────────────────────────────────────
constantes.BOT_OWNER_ID = constantes.ID_PROPRIETAIRE_BOT;
constantes.OWNER_IDS = constantes.IDS_PROPRIETAIRES;
constantes.PREMIUM_SKU_ID = constantes.ID_SKU_PREMIUM;
constantes.CUSTOMIZATION_SKU_ID = constantes.ID_SKU_CUSTOMISATION;
constantes.TOTAL_SKU_ID = constantes.ID_SKU_TOTAL;
constantes.STAR_THRESHOLD = constantes.SEUIL_ETOILES;
constantes.PREFIX = constantes.PREFIXE;
constantes.FILES = {
    CONFIG: constantes.FICHIERS.CONFIGURATION,
    WARNS: constantes.FICHIERS.AVERTISSEMENTS,
    MUTE: constantes.FICHIERS.SOURDINE,
    BAN: constantes.FICHIERS.BANNISSEMENT,
    STARBOARD: constantes.FICHIERS.TABLEAU_ETOILES,
    BIRTHDAYS: constantes.FICHIERS.ANNIVERSAIRES,
    YT: constantes.FICHIERS.YOUTUBE,
    BLOG: constantes.FICHIERS.BLOG,
    MEDAL: constantes.FICHIERS.MEDAILLE,
    TIKTOK: constantes.FICHIERS.TIKTOK,
    XP: constantes.FICHIERS.XP,
    REMINDERS: constantes.FICHIERS.RAPPELS,
    EVENTS: constantes.FICHIERS.EVENEMENTS,
    REACTION_ROLES: constantes.FICHIERS.ROLES_REACTION,
    POLLS: constantes.FICHIERS.SONDAGES,
    GIVEAWAYS: constantes.FICHIERS.CONCOURS,
    HACKED: constantes.FICHIERS.COMPTES_PIRATES,
    TEMP_ROLES: constantes.FICHIERS.ROLES_TEMPORAIRES,
    AUTORESPONSE: constantes.FICHIERS.REPONSE_AUTO,
    TICKET_FORMS: constantes.FICHIERS.FORMULAIRES_TICKET,
    PREMIUM: constantes.FICHIERS.PREMIUM,
    AUTO_TRANSLATE: constantes.FICHIERS.TRADUCTION_AUTO,
};

module.exports = constantes;