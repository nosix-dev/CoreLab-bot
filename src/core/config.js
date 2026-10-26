const { stockage, persister } = require('./data');

function obtenirConfigGuilde(idGuilde) {
    const id = String(idGuilde);
    if (!stockage.configuration[id]) {
        stockage.configuration[id] = {
            member_role_id: null,
            member_role_id_2: null,
            photo_channel_id: null,
            repost_channel_id: null,
            ticket_channel_id: null,
            mute_role: null,
            log_channel_id: null,
            suggestion_channel_id: null,
            photo_winner_role_id: null,
            welcome_channel_id: null,
            goodbye_channel_id: null,
            anniversaire_channel_id: null,
            anniversaire_role_id: null,
            ticket_panel_channel_id: null,
            min_account_age_days: 0,
            send_rules_dm: false,
            rules_dm_text: '',
            welcome_dm_enabled: true,
            welcome_dm_message: 'Bienvenue sur le serveur, profite bien !',
            ticket_reasons: {},
            antispam: false,
            antieveryone: false,
            anti_phishing: false,
            anti_scam_image: false,
            anti_bot_enabled: false,
            anti_alt_enabled: false,
            anti_alt_min_days: 7,
            anti_link_enabled: false,
            anti_nuke_enabled: false,
            anti_nuke_threshold: 3,
            anti_nuke_window_seconds: 10,
            anti_ghostping_enabled: false,
            anti_ddos_enabled: false,
            anti_ddos_threshold: 30,
            anti_ddos_window_seconds: 10,
            anti_ddos_min_users: 5,
            anti_ddos_duration_minutes: 10,
            anti_ddos_action: 'slowmode',
            anti_ddos_state: null,
            anti_ddos_voice_enabled: false,
            anti_ddos_voice_threshold: 15,
            anti_ddos_voice_window_seconds: 10,
            anti_ddos_voice_min_users: 6,
            anti_ddos_voice_duration_minutes: 10,
            anti_ddos_voice_action: 'lock',
            anti_ddos_voice_state: null,
            language: 'fr',
            xp_enabled: false,
            xp_cooldown: 60,
            xp_min: 15,
            xp_max: 25,
            xp_voice_enabled: false,
            xp_voice_interval: 1,
            xp_voice_amount: 10,
            xp_voice_bonus_minutes: 30,
            xp_voice_bonus_amount: 5,
            xp_voice_bonus_max: 10,
            xp_level_channel_id: null,
            xp_roles: [],
            xp_roles_mode: 'stack',
            xp_ignored_channels: [],
            protection_log_channel_id: null,
            raidmode_enabled: false,
            raidmode_threshold: 10,
            raidmode_window_seconds: 30,
            raidmode_action: 'kick',
            raidmode_duration_minutes: 15,
            captcha_enabled: false,
            captcha_role_id: null,
            captcha_channel_id: null,
            captcha_verified_role_id: null,
            captcha_timeout_minutes: 5,
            captcha_max_attempts: 3,
            captcha_kick_on_fail: true,
            tag_role_enabled: false,
            tag_role_id: null,
            signalement_enabled: false,
            signalement_channel_id: null,
            dm_lock_enabled: false,
            lockdown_active: false,
            lockdown_channel_ids: [],
            lockdown_previous_state: {},
            honeypot_enabled: false,
            honeypot_channel_id: null,
            honeypot_review_channel_id: null,
            infraction_channel_id: null,
            transparence_enabled: false,
            transparence_channel_id: null,
            auth_enabled: false,
            auth_pending_role_id: null,
            auth_review_channel_id: null,
            rules_title: null,
            bot_nickname: null,
            translation_enabled: false,
            translation_scope: 'server',
            translation_channel_id: null,
            translation_target_lang: 'fr',
            translation_omnidirectional: false,
            starboard_enabled: false,
            starboard_channel_id: null,
            starboard_threshold: 3,
            starboard_emoji_raw: '⭐',
            starboard_emoji_id: null,
            starboard_emoji_customized: false,
            starboard_ignored_channels: [],
            starboard_allow_self_star: true,
            starboard_ignore_nsfw: false,
            starboard_remove_on_unstar: true,
            serverstats_enabled: false,
            serverstats_category_id: null,
            serverstats_counters: [],
            counting_enabled: false,
            counting_channel_id: null,
            counting_allow_consecutive: false,
            counting_delete_wrong: true,
            counting_reset_on_error: true,
        };
        persister('configuration');
    }
    const config = stockage.configuration[id];
    if (config.min_account_age_days === undefined) config.min_account_age_days = 0;
    if (config.send_rules_dm === undefined) config.send_rules_dm = false;
    if (config.rules_dm_text === undefined) config.rules_dm_text = '';
    if (config.language === undefined) config.language = 'fr';
    if (config.xp_enabled === undefined) config.xp_enabled = false;
    if (config.xp_cooldown === undefined) config.xp_cooldown = 60;
    if (config.xp_min === undefined) config.xp_min = 15;
    if (config.xp_max === undefined) config.xp_max = 25;
    if (config.xp_voice_enabled === undefined) config.xp_voice_enabled = false;
    if (config.xp_voice_interval === undefined) config.xp_voice_interval = 1;
    if (config.xp_voice_amount === undefined) config.xp_voice_amount = 10;
    if (config.xp_voice_bonus_minutes === undefined) config.xp_voice_bonus_minutes = 30;
    if (config.xp_voice_bonus_amount === undefined) config.xp_voice_bonus_amount = 5;
    if (config.xp_voice_bonus_max === undefined) config.xp_voice_bonus_max = 10;
    if (config.xp_level_channel_id === undefined) config.xp_level_channel_id = null;
    if (config.xp_roles === undefined) config.xp_roles = [];
    if (config.xp_roles_mode === undefined) config.xp_roles_mode = 'stack';
    if (config.xp_ignored_channels === undefined) config.xp_ignored_channels = [];
    if (config.translation_enabled === undefined) config.translation_enabled = false;
    if (config.translation_scope === undefined) config.translation_scope = 'server';
    if (config.translation_channel_id === undefined) config.translation_channel_id = null;
    if (config.translation_target_lang === undefined) config.translation_target_lang = 'fr';
    if (config.translation_omnidirectional === undefined) config.translation_omnidirectional = false;
    if (config.protection_log_channel_id === undefined) config.protection_log_channel_id = null;
    if (config.raidmode_enabled === undefined) config.raidmode_enabled = false;
    if (config.raidmode_threshold === undefined) config.raidmode_threshold = 10;
    if (config.raidmode_window_seconds === undefined) config.raidmode_window_seconds = 30;
    if (config.raidmode_action === undefined) config.raidmode_action = 'kick';
    if (config.raidmode_duration_minutes === undefined) config.raidmode_duration_minutes = 15;
    if (config.captcha_enabled === undefined) config.captcha_enabled = false;
    if (config.captcha_role_id === undefined) config.captcha_role_id = null;
    if (config.captcha_channel_id === undefined) config.captcha_channel_id = null;
    if (config.captcha_verified_role_id === undefined) config.captcha_verified_role_id = null;
    if (config.captcha_timeout_minutes === undefined) config.captcha_timeout_minutes = 5;
    if (config.captcha_max_attempts === undefined) config.captcha_max_attempts = 3;
    if (config.captcha_kick_on_fail === undefined) config.captcha_kick_on_fail = true;
    if (config.tag_role_enabled === undefined) config.tag_role_enabled = false;
    if (config.tag_role_id === undefined) config.tag_role_id = null;
    if (config.signalement_enabled === undefined) config.signalement_enabled = false;
    if (config.signalement_channel_id === undefined) config.signalement_channel_id = null;
    if (config.dm_lock_enabled === undefined) config.dm_lock_enabled = false;
    if (config.lockdown_active === undefined) config.lockdown_active = false;
    if (config.lockdown_channel_ids === undefined) config.lockdown_channel_ids = [];
    if (config.lockdown_previous_state === undefined) config.lockdown_previous_state = {};
    if (config.honeypot_enabled === undefined) config.honeypot_enabled = false;
    if (config.honeypot_channel_id === undefined) config.honeypot_channel_id = null;
    if (config.honeypot_review_channel_id === undefined) config.honeypot_review_channel_id = null;
    if (config.infraction_channel_id === undefined) config.infraction_channel_id = null;
    if (config.transparence_enabled === undefined) config.transparence_enabled = false;
    if (config.transparence_channel_id === undefined) config.transparence_channel_id = null;
    if (config.auth_enabled === undefined) config.auth_enabled = false;
    if (config.auth_pending_role_id === undefined) config.auth_pending_role_id = null;
    if (config.auth_review_channel_id === undefined) config.auth_review_channel_id = null;
    if (config.rules_title === undefined) config.rules_title = null;
    if (config.bot_nickname === undefined) config.bot_nickname = null;
    if (config.starboard_enabled === undefined) config.starboard_enabled = false;
    if (config.starboard_channel_id === undefined) config.starboard_channel_id = null;
    if (config.starboard_threshold === undefined) config.starboard_threshold = 3;
    if (config.starboard_emoji_raw === undefined) config.starboard_emoji_raw = '⭐';
    if (config.starboard_emoji_customized === undefined) config.starboard_emoji_customized = false;
    if (config.starboard_emoji_id === undefined) config.starboard_emoji_id = null;
    if (config.starboard_ignored_channels === undefined) config.starboard_ignored_channels = [];
    if (config.starboard_allow_self_star === undefined) config.starboard_allow_self_star = true;
    if (config.starboard_ignore_nsfw === undefined) config.starboard_ignore_nsfw = false;
    if (config.starboard_remove_on_unstar === undefined) config.starboard_remove_on_unstar = true;
    if (config.ia_enabled === undefined) config.ia_enabled = false;
    if (config.ia_category_id === undefined) config.ia_category_id = null;
    if (config.ia_channel_id === undefined) config.ia_channel_id = null;
    if (config.ia_message_id === undefined) config.ia_message_id = null;
    if (config.ia_tickets === undefined) config.ia_tickets = {};
    if (config.anti_bot_enabled === undefined) config.anti_bot_enabled = false;
    if (config.anti_alt_enabled === undefined) config.anti_alt_enabled = false;
    if (config.anti_alt_min_days === undefined) config.anti_alt_min_days = 7;
    if (config.anti_link_enabled === undefined) config.anti_link_enabled = false;
    if (config.anti_nuke_enabled === undefined) config.anti_nuke_enabled = false;
    if (config.anti_nuke_threshold === undefined) config.anti_nuke_threshold = 3;
    if (config.anti_nuke_window_seconds === undefined) config.anti_nuke_window_seconds = 10;
    if (config.anti_ghostping_enabled === undefined) config.anti_ghostping_enabled = false;
    if (config.anti_ddos_enabled === undefined) config.anti_ddos_enabled = false;
    if (config.anti_ddos_threshold === undefined) config.anti_ddos_threshold = 30;
    if (config.anti_ddos_window_seconds === undefined) config.anti_ddos_window_seconds = 10;
    if (config.anti_ddos_min_users === undefined) config.anti_ddos_min_users = 5;
    if (config.anti_ddos_duration_minutes === undefined) config.anti_ddos_duration_minutes = 10;
    if (config.anti_ddos_action === undefined) config.anti_ddos_action = 'slowmode';
    if (config.anti_ddos_state === undefined) config.anti_ddos_state = null;
    if (config.anti_ddos_voice_enabled === undefined) config.anti_ddos_voice_enabled = false;
    if (config.anti_ddos_voice_threshold === undefined) config.anti_ddos_voice_threshold = 15;
    if (config.anti_ddos_voice_window_seconds === undefined) config.anti_ddos_voice_window_seconds = 10;
    if (config.anti_ddos_voice_min_users === undefined) config.anti_ddos_voice_min_users = 6;
    if (config.anti_ddos_voice_duration_minutes === undefined) config.anti_ddos_voice_duration_minutes = 10;
    if (config.anti_ddos_voice_action === undefined) config.anti_ddos_voice_action = 'lock';
    if (config.anti_ddos_voice_state === undefined) config.anti_ddos_voice_state = null;
    if (config.serverstats_enabled === undefined) config.serverstats_enabled = false;
    if (config.serverstats_category_id === undefined) config.serverstats_category_id = null;
    if (config.serverstats_counters === undefined) config.serverstats_counters = [];
    if (config.counting_enabled === undefined) config.counting_enabled = false;
    if (config.counting_channel_id === undefined) config.counting_channel_id = null;
    if (config.counting_allow_consecutive === undefined) config.counting_allow_consecutive = false;
    if (config.counting_delete_wrong === undefined) config.counting_delete_wrong = true;
    if (config.counting_reset_on_error === undefined) config.counting_reset_on_error = true;
    return config;
}

function obtenirCompartimentGuilde(idGuilde, cle, valeurParDefaut = {}) {
    if (!stockage[cle]) stockage[cle] = {};
    const id = String(idGuilde);
    if (stockage[cle][id] === undefined) {
        stockage[cle][id] = Array.isArray(valeurParDefaut) ? [...valeurParDefaut] : { ...valeurParDefaut };
    }
    return stockage[cle][id];
}

function definirCompartimentGuilde(idGuilde, cle, valeur) {
    if (!stockage[cle]) stockage[cle] = {};
    const id = String(idGuilde);
    stockage[cle][id] = valeur;
    persister(cle);
}

module.exports = {
    // exports français d'origine
    obtenirConfigGuilde,
    obtenirCompartimentGuilde,
    definirCompartimentGuilde,
    persister,

    // alias anglais — pour compatibilité avec index.js et les autres fichiers
    getGuildConfig: obtenirConfigGuilde,
    getGuildBucket: obtenirCompartimentGuilde,
    setGuildBucket: definirCompartimentGuilde,
    persist: persister,
};