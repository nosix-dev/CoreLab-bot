// ────────────────────────────────────────────────
// bumpReminder.js — Rappel de bump Disboard
// Détecte un bump réussi de Disboard, attend 2 h, puis relance le serveur
// dans un salon (avec un rôle pingé en option).
//
//  • Détection indépendante de la langue : on cherche le 👍 / « Bump done » /
//    « Bump effectué » dans l'embed de Disboard (aucun besoin de lire le contenu
//    des messages des membres)
//  • Si quelqu'un bump trop tôt, Disboard indique le temps restant : le minuteur
//    est alors recalé dessus (utile pour démarrer le rappel sans attendre un bump)
//  • Le minuteur est sauvegardé : il survit aux redémarrages de l'hébergeur
//    (rappel envoyé au redémarrage s'il est arrivé à échéance entre-temps)
//  • Remerciement optionnel après un bump, compteur de bumps par membre
//
// Config stockée dans getGuildConfig(guild.id) :
//   bump_enabled, bump_channel_id, bump_role_id, bump_thanks,
//   bump_next_at, bump_reminded, bump_last_channel_id, bump_count, bump_users{}
// ────────────────────────────────────────────────

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildConfig, persist } = require('../core/config');
const { toCV2Payload } = require('../core/componentsV2');
const { glassPayload } = require('../core/glassEmbed');

const DISBOARD_ID = '302050872383242240';
const COOLDOWN_MS = 2 * 60 * 60 * 1000;      // Disboard : 1 bump toutes les 2 h
const INTERVALLE_VERIF_MS = 30 * 1000;       // vérification des rappels dus
const MAX_MINUTES_ATTENTE = 150;             // garde-fou sur le temps lu dans le message Disboard

// Messages Disboard déjà traités (messageCreate + messageUpdate peuvent se suivre).
const dejaTraites = new Set();

// Retourne la config du serveur avec les valeurs par défaut du rappel de bump.
function lireConfigBump(guildId) {
  const cfg = getGuildConfig(guildId);
  if (cfg.bump_enabled === undefined) cfg.bump_enabled = false;
  if (cfg.bump_channel_id === undefined) cfg.bump_channel_id = null;
  if (cfg.bump_role_id === undefined) cfg.bump_role_id = null;
  if (cfg.bump_thanks === undefined) cfg.bump_thanks = true;
  if (typeof cfg.bump_next_at !== 'number') cfg.bump_next_at = 0;
  if (cfg.bump_reminded === undefined) cfg.bump_reminded = false;
  if (cfg.bump_last_channel_id === undefined) cfg.bump_last_channel_id = null;
  if (typeof cfg.bump_count !== 'number') cfg.bump_count = 0;
  if (!cfg.bump_users || typeof cfg.bump_users !== 'object') cfg.bump_users = {};
  return cfg;
}

// « 1 h 10 », « 118 minutes », « 2 heures »… → nombre de minutes (ou null).
function extraireMinutes(texte) {
  let total = 0;
  let trouve = false;
  const h = texte.match(/(\d+)\s*(?:h\b|hours?|heures?)/i);
  const m = texte.match(/(\d+)\s*min/i);
  if (h) { total += parseInt(h[1], 10) * 60; trouve = true; }
  if (m) { total += parseInt(m[1], 10); trouve = true; }
  return trouve ? total : null;
}

// Analyse le texte d'un message Disboard.
//  → { type: 'succes' } | { type: 'attente', minutes } | null
function analyserTexteDisboard(texte) {
  const t = String(texte || '').replace(/\s+/g, ' ');
  if (!t.trim()) return null;

  // Bump refusé : « Please wait another X minutes… » → on recale sur le temps restant.
  const minutes = extraireMinutes(t);
  if (minutes !== null && /(wait|attend|patient|espera|warte|aspett)/i.test(t)) {
    return { type: 'attente', minutes };
  }
  // Bump réussi : « Bump done! 👍 » / « Bump effectué ! 👍 »
  if (/👍|:thumbsup:|bump\s*(done|effectu)/i.test(t)) {
    return { type: 'succes' };
  }
  return null;
}

function texteDuMessage(message) {
  const parties = [message.content || ''];
  for (const e of message.embeds || []) {
    parties.push(e.title || '', e.description || '');
  }
  return parties.join(' ');
}

async function traiterMessage(message) {
  if (!message.guild || message.author?.id !== DISBOARD_ID) return;
  if (message.partial) {
    message = await message.fetch().catch(() => null);
    if (!message) return;
  }

  // Si Discord fournit le nom de la commande utilisée, on ne garde que /bump.
  const nomCommande = message.interactionMetadata?.name ?? message.interaction?.commandName;
  if (nomCommande && !/bump/i.test(nomCommande)) return;

  const cfg = lireConfigBump(message.guild.id);
  if (!cfg.bump_enabled) return;

  const analyse = analyserTexteDisboard(texteDuMessage(message));
  if (!analyse) return;

  if (dejaTraites.has(message.id)) return;
  dejaTraites.add(message.id);
  if (dejaTraites.size > 300) dejaTraites.delete(dejaTraites.values().next().value);

  cfg.bump_last_channel_id = message.channel.id;
  cfg.bump_reminded = false;

  if (analyse.type === 'attente') {
    if (analyse.minutes < 0 || analyse.minutes > MAX_MINUTES_ATTENTE) return;
    // +1 min de marge pour être sûr que le bump soit bien disponible.
    cfg.bump_next_at = Date.now() + (analyse.minutes + 1) * 60 * 1000;
    persist('configuration');
    return;
  }

  // Bump réussi
  const utilisateur = message.interactionMetadata?.user ?? message.interaction?.user ?? null;
  cfg.bump_next_at = Date.now() + COOLDOWN_MS;
  cfg.bump_count += 1;
  if (utilisateur?.id) cfg.bump_users[utilisateur.id] = (cfg.bump_users[utilisateur.id] || 0) + 1;
  persist('configuration');

  if (cfg.bump_thanks) {
    const ts = Math.floor(cfg.bump_next_at / 1000);
    const qui = utilisateur?.id ? ` <@${utilisateur.id}>` : '';
    const merci = new EmbedBuilder().setTitle('🙏 Merci pour le bump !')
      .setDescription(`Merci${qui} d'avoir bumpé le serveur !\nProchain bump possible : <t:${ts}:R>`).setColor(0xFFFFFF);
    await message.channel.send(await glassPayload({
      embeds: [merci],
      allowedMentions: { users: utilisateur?.id ? [utilisateur.id] : [] },
    }, { guild: message.guild, client: message.client, badge: 'BUMP', avatar: utilisateur?.displayAvatarURL ? utilisateur.displayAvatarURL({ extension: 'png', size: 256 }) : undefined })).catch(() => { });
  }
}

async function envoyerRappel(guild, cfg) {
  const idSalon = cfg.bump_channel_id || cfg.bump_last_channel_id;
  const salon = idSalon ? await guild.channels.fetch(idSalon).catch(() => null) : null;
  if (!salon?.isTextBased?.()) {
    console.warn(`[Bump] ${guild.name} (${guild.id}) : aucun salon valide pour le rappel.`);
    return;
  }
  const me = guild.members.me;
  const perms = me ? salon.permissionsFor(me) : null;
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    console.warn(`[Bump] ${guild.name} (${guild.id}) : je ne peux pas écrire dans #${salon.name}.`);
    return;
  }

  const role = cfg.bump_role_id ? guild.roles.cache.get(cfg.bump_role_id) : null;
  const embed = new EmbedBuilder()
    .setTitle('🔔 C\'est l\'heure de bump !')
    .setDescription('Le serveur peut de nouveau être bumpé sur **Disboard**.\nTape `/bump` dans ce salon pour le faire remonter dans la liste.')
    .setColor(0xFFFFFF);

  await salon.send(await glassPayload({
    content: role ? `<@&${role.id}>` : undefined,
    embeds: [embed],
    allowedMentions: { roles: role ? [role.id] : [] },
  }, { guild, client: guild.client, badge: 'RAPPEL BUMP' }));
}

async function verifierRappels(client) {
  if (!client.isReady()) return;
  const maintenant = Date.now();

  for (const guild of client.guilds.cache.values()) {
    const cfg = getGuildConfig(guild.id);
    if (!cfg.bump_enabled || !cfg.bump_next_at || cfg.bump_reminded) continue;
    if (maintenant < cfg.bump_next_at) continue;

    // On marque « rappelé » AVANT l'envoi : pas de doublon si le tick suivant arrive pendant l'envoi.
    cfg.bump_reminded = true;
    persist('configuration');
    try {
      await envoyerRappel(guild, lireConfigBump(guild.id));
    } catch (e) {
      console.error(`[Bump] Rappel ${guild.id} :`, e.message);
      // Erreur temporaire (réseau…) : on réessaie au tick suivant.
      // Erreur définitive (permissions manquantes, salon supprimé) : on n'insiste pas.
      if (![50001, 50013, 10003].includes(e?.code)) {
        cfg.bump_reminded = false;
        persist('configuration');
      }
    }
  }
}

function registerBumpReminderHandler(client) {
  client.on('messageCreate', (message) => {
    traiterMessage(message).catch(e => console.error('[Bump] messageCreate :', e.message));
  });
  // Disboard répond parfois en différé : le texte final arrive via une modification du message.
  client.on('messageUpdate', (_ancien, nouveau) => {
    traiterMessage(nouveau).catch(e => console.error('[Bump] messageUpdate :', e.message));
  });

  setInterval(() => {
    verifierRappels(client).catch(e => console.error('[Bump] vérification :', e.message));
  }, INTERVALLE_VERIF_MS);
}

module.exports = {
  registerBumpReminderHandler,
  lireConfigBump,
  analyserTexteDisboard,
  extraireMinutes,
  DISBOARD_ID,
};
