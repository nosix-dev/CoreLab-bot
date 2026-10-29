'use strict';

// ─────────────────────────────────────────────────────────────────────────
// protectionChangeLog.js — journal des changements de configuration
//
// Chaque fois qu'un membre active/désactive une protection ou change un
// réglage (panneau /protect-settings, assistant Setup, commandes), une ligne
// est postée dans le salon de logs de protection :
//
//   [09:37:43] 🔄 @BRATONY (`bratony`) a changé la **langue** du bot de `en` à `fr`.
//   [09:38:02] 🟢 @BRATONY (`bratony`) a **activé** la protection **Anti-spam**.
//
// Le journal se base sur une comparaison avant/après de la config autour de
// l'interaction : tout ce qui est listé dans TRACKED est donc couvert, quel
// que soit l'endroit du code qui modifie le réglage.
// ─────────────────────────────────────────────────────────────────────────

const { getGuildConfig } = require('./config');
const { getProtectionLogChannel } = require('./protectionLog');

// kind : 'bool' (activé/désactivé) · 'channel' · 'role' · 'text'
// p    : tournure de phrase (avec article), le libellé en gras
const TRACKED = {
  // ── Protections (interrupteurs) ──
  raidmode_enabled: { kind: 'bool', p: 'la protection **RaidMode**' },
  anti_ddos_enabled: { kind: 'bool', p: 'la protection **Anti-DDoS**' },
  anti_ddos_voice_enabled: { kind: 'bool', p: 'la protection **Anti-DDoS vocal**' },
  captcha_enabled: { kind: 'bool', p: 'la protection **Captcha**' },
  anti_bot_enabled: { kind: 'bool', p: 'la protection **Anti-bot**' },
  anti_alt_enabled: { kind: 'bool', p: 'la protection **Anti-alt**' },
  antispam: { kind: 'bool', p: 'la protection **Anti-spam**' },
  antieveryone: { kind: 'bool', p: 'la protection **Anti-@everyone**' },
  anti_link_enabled: { kind: 'bool', p: 'la protection **Anti-lien**' },
  anti_nuke_enabled: { kind: 'bool', p: 'la protection **Anti-Nuke**' },
  anti_ghostping_enabled: { kind: 'bool', p: 'la protection **Anti-Ghostping**' },
  anti_phishing: { kind: 'bool', p: 'la protection **Anti-phishing**' },
  anti_scam_image: { kind: 'bool', p: 'la protection **Anti-arnaque (OCR)**' },
  dm_lock_enabled: { kind: 'bool', p: 'la **Fermeture des MP**' },
  auth_double_detection_enabled: { kind: 'bool', p: 'la détection de **Compte double**' },
  auth_enabled: { kind: 'bool', p: 'l\'**Authentification**' },
  tag_role_enabled: { kind: 'bool', p: 'le **Rôle de Tag**' },
  signalement_enabled: { kind: 'bool', p: 'les **Signalements**' },
  transparence_enabled: { kind: 'bool', p: 'la **Transparence**' },
  honeypot_enabled: { kind: 'bool', p: 'le **HoneyPot**' },
  lockdown_active: { kind: 'bool', p: 'le **verrouillage du serveur**' },

  // ── Réglages ──
  language: { kind: 'text', p: 'la **langue** du bot' },
  min_account_age_days: { kind: 'text', p: 'l\'**âge minimum du compte** (jours)' },
  raidmode_threshold: { kind: 'text', p: 'le **seuil du RaidMode** (arrivées)' },
  raidmode_window_seconds: { kind: 'text', p: 'la **fenêtre du RaidMode** (s)' },
  raidmode_action: { kind: 'text', p: 'l\'**action du RaidMode**' },
  raidmode_duration_minutes: { kind: 'text', p: 'la **durée du lockdown RaidMode** (min)' },
  anti_ddos_threshold: { kind: 'text', p: 'le **seuil de l\'Anti-DDoS** (messages)' },
  anti_ddos_window_seconds: { kind: 'text', p: 'la **fenêtre de l\'Anti-DDoS** (s)' },
  anti_ddos_min_users: { kind: 'text', p: 'le **minimum d\'auteurs de l\'Anti-DDoS**' },
  anti_ddos_duration_minutes: { kind: 'text', p: 'la **durée de l\'alerte Anti-DDoS** (min)' },
  anti_ddos_action: { kind: 'text', p: 'l\'**action de l\'Anti-DDoS**' },
  anti_ddos_voice_threshold: { kind: 'text', p: 'le **seuil de l\'Anti-DDoS vocal**' },
  anti_ddos_voice_window_seconds: { kind: 'text', p: 'la **fenêtre de l\'Anti-DDoS vocal** (s)' },
  anti_ddos_voice_min_users: { kind: 'text', p: 'le **minimum d\'utilisateurs de l\'Anti-DDoS vocal**' },
  anti_ddos_voice_duration_minutes: { kind: 'text', p: 'la **durée de l\'alerte Anti-DDoS vocal** (min)' },
  captcha_timeout_minutes: { kind: 'text', p: 'le **délai du Captcha** (min)' },
  captcha_max_attempts: { kind: 'text', p: 'les **tentatives max du Captcha**' },
  captcha_kick_on_fail: { kind: 'text', p: 'l\'**expulsion en cas d\'échec du Captcha**' },
  honeypot_action: { kind: 'text', p: 'l\'**action du HoneyPot**' },
  honeypot_duration_minutes: { kind: 'text', p: 'la **durée du HoneyPot** (min)' },

  // ── Salons / rôles ──
  protection_log_channel_id: { kind: 'channel', p: 'le **salon de logs de protection**' },
  infraction_channel_id: { kind: 'channel', p: 'le **salon des sanctions**' },
  signalement_channel_id: { kind: 'channel', p: 'le **salon des signalements**' },
  transparence_channel_id: { kind: 'channel', p: 'le **salon de transparence**' },
  captcha_channel_id: { kind: 'channel', p: 'le **salon du Captcha**' },
  auth_review_channel_id: { kind: 'channel', p: 'le **salon de revue de l\'Authentification**' },
  honeypot_channel_id: { kind: 'channel', p: 'le **salon du HoneyPot**' },
  honeypot_review_channel_id: { kind: 'channel', p: 'le **salon de revue du HoneyPot**' },
  captcha_role_id: { kind: 'role', p: 'le **rôle « non vérifié » du Captcha**' },
  captcha_verified_role_id: { kind: 'role', p: 'le **rôle « vérifié » du Captcha**' },
  auth_pending_role_id: { kind: 'role', p: 'le **rôle d\'attente de l\'Authentification**' },
  tag_role_id: { kind: 'role', p: 'le **rôle de Tag**' }
};
const KEYS = Object.keys(TRACKED);

function snapshot(cfg) {
  const out = {};
  for (const k of KEYS) out[k] = cfg[k] === undefined ? null : cfg[k];
  return out;
}

function formatValue(kind, v) {
  if (v === null || v === undefined || v === '' || v === false && kind !== 'text') return '*aucun*';
  if (kind === 'channel') return `<#${v}>`;
  if (kind === 'role') return `<@&${v}>`;
  return `\`${String(v)}\``;
}

function heure() {
  return new Date().toLocaleTimeString('fr-FR', { hour12: false, timeZone: 'Europe/Paris' });
}

function buildLines(user, before, after) {
  const lines = [];
  const who = `<@${user.id}> (\`${user.username ?? user.tag}\`)`;
  for (const k of KEYS) {
    if (before[k] === after[k]) continue;
    const t = TRACKED[k];
    if (t.kind === 'bool') {
      const on = !!after[k];
      if (!!before[k] === on) continue;
      lines.push(`[${heure()}] ${on ? '🟢' : '🔴'} ${who} a **${on ? 'activé' : 'désactivé'}** ${t.p}.`);
    } else {
      lines.push(`[${heure()}] 🔄 ${who} a changé ${t.p} de ${formatValue(t.kind, before[k])} à ${formatValue(t.kind, after[k])}.`);
    }
  }
  return lines;
}

// Exécute `fn` (le traitement de l'interaction) puis journalise ce qui a changé dans la config.
async function withChangeLog(interaction, fn) {
  const guild = interaction.guild;
  if (!guild || !interaction.user) return fn();
  const before = snapshot(getGuildConfig(guild.id));
  try {
    return await fn();
  } finally {
    try {
      const lines = buildLines(interaction.user, before, snapshot(getGuildConfig(guild.id)));
      if (lines.length) {
        const channel = getProtectionLogChannel(guild);
        if (channel) await channel.send({ content: lines.join('\n').slice(0, 1900), allowedMentions: { parse: [] } });
      }
    } catch (e) {
      console.error('Erreur journal des changements de protection :', e.message);
    }
  }
}

module.exports = { withChangeLog, TRACKED };
