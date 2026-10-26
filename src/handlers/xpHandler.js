const {
  AttachmentBuilder
} = require('discord.js');
const {
  getGuildConfig,
  getGuildBucket,
  persist
} = require('../core/config');
const {
  getLevelFromXp,
  applyRoleRewards
} = require('./xpEngine');
const {
  generateLevelUpCard
} = require('./levelUpImage');
const {
  isPremium,
  isFounder
} = require('../core/premium');
const cooldowns = new Map();

// Minutes déjà cumulées en vocal par membre (clé guildId-userId)
const voiceMinutes = new Map();
// Minutes consécutives passées en vocal (session en cours) — sert au bonus progressif
const voiceSession = new Map();
const VOICE_TICK_MS = 60 * 1000;

// ────────────────────────────────────────────────
// Ajoute de l'XP à un membre et annonce la montée de niveau.
// Utilisé par les messages ET par le vocal.
// ────────────────────────────────────────────────
async function grantXp(member, cfg, gained, source = 'message') {
  const guild = member.guild;
  const bucket = getGuildBucket(guild.id, 'xpData', {});
  const uid = String(member.id);
  const before = bucket[uid] || 0;
  const after = before + gained;
  bucket[uid] = after;
  persist('xpData');
  const beforeLevel = getLevelFromXp(before).level;
  const afterInfo = getLevelFromXp(after);
  const afterLevel = afterInfo.level;
  if (afterLevel <= beforeLevel) return;
  await applyRoleRewards(member, cfg, afterLevel);
  const channel = cfg.xp_level_channel_id ? guild.channels.cache.get(String(cfg.xp_level_channel_id)) : null;
  if (!channel?.isTextBased?.()) return;
  const badge = isFounder(member.id) ? 'Founder' : isPremium(member.id) ? 'Premium' : '';

  // Message simple (mention du membre) + carte verte générée en pièce jointe
  const allowedMentions = {
    parse: []
  };
  const content = source === 'voice' ? `${member} vient d'atteindre le **niveau ${afterLevel}** grâce au vocal ! 🎙️` : `${member} vient d'atteindre le **niveau ${afterLevel}** !`;
  let files = [];
  try {
    const buffer = generateLevelUpCard({
      guildId: member.guild?.id,
      username: member.user.username,
      badge,
      level: afterLevel,
      totalXp: after,
      gainedXp: gained,
      source,
      currentXp: afterInfo.currentXp,
      neededXp: afterInfo.neededXp
    });
    files = [new AttachmentBuilder(buffer, {
      name: 'levelup.png'
    })];
  } catch (imgError) {
    console.error('Erreur de génération de la carte de level up :', imgError.message);
  }
  try {
    await channel.send({
      content,
      files,
      allowedMentions
    });
  } catch (sendError) {
    console.error('Erreur d\'envoi du level up :', sendError.message);
    if (files.length) {
      await channel.send({
        content,
        allowedMentions
      }).catch(() => {});
    }
  }
}

// ────────────────────────────────────────────────
// XP en vocal : un tick par minute, chaque membre éligible cumule
// des minutes ; à chaque `xp_voice_interval` minutes → `xp_voice_amount` XP.
// Exclus : bots, salon AFK, salons ignorés, membres sourd (casque coupé).
// ────────────────────────────────────────────────
async function voiceXpTick(client) {
  const stillInVoice = new Set();
  for (const guild of client.guilds.cache.values()) {
    try {
      const cfg = getGuildConfig(guild.id);
      if (!cfg.xp_enabled || !cfg.xp_voice_enabled) continue;
      const interval = Math.max(1, parseInt(cfg.xp_voice_interval, 10) || 1);
      const baseAmount = Math.max(0, parseInt(cfg.xp_voice_amount, 10) || 0);
      const bonusEvery = Math.max(0, parseInt(cfg.xp_voice_bonus_minutes, 10) || 0);
      const bonusAmount = Math.max(0, parseInt(cfg.xp_voice_bonus_amount, 10) || 0);
      const bonusMaxTiers = Math.max(0, parseInt(cfg.xp_voice_bonus_max, 10) || 0);
      if (baseAmount <= 0 && (bonusEvery <= 0 || bonusAmount <= 0)) continue;
      const ignored = cfg.xp_ignored_channels || [];
      for (const state of guild.voiceStates.cache.values()) {
        const member = state.member;
        if (!member || member.user.bot || !state.channelId) continue;
        if (state.channelId === guild.afkChannelId) continue;
        if (ignored.includes(state.channelId)) continue;
        if (state.selfDeaf || state.serverDeaf) continue;
        const key = `${guild.id}-${member.id}`;
        stillInVoice.add(key);
        const session = (voiceSession.get(key) || 0) + 1;
        voiceSession.set(key, session);
        const minutes = (voiceMinutes.get(key) || 0) + 1;
        if (minutes >= interval) {
          voiceMinutes.set(key, 0);
          // Bonus progressif : +bonusAmount XP par palier de `bonusEvery` minutes
          // consécutives en vocal (plafonné à `bonusMaxTiers` paliers).
          let tiers = bonusEvery > 0 ? Math.floor(session / bonusEvery) : 0;
          if (bonusMaxTiers > 0) tiers = Math.min(tiers, bonusMaxTiers);
          const amount = baseAmount + tiers * bonusAmount;
          if (amount > 0) await grantXp(member, cfg, amount, 'voice');
        } else {
          voiceMinutes.set(key, minutes);
        }
      }
    } catch (e) {
      console.error('Erreur XP vocal :', e.message);
    }
  }
  // Purge des membres qui ont quitté le vocal (le compteur repart à zéro)
  for (const key of voiceMinutes.keys()) {
    if (!stillInVoice.has(key)) voiceMinutes.delete(key);
  }
  for (const key of voiceSession.keys()) {
    if (!stillInVoice.has(key)) voiceSession.delete(key);
  }
}
function registerXpHandler(client) {
  client.on('messageCreate', async message => {
    try {
      if (!message.guild || message.author.bot) return;
      const cfg = getGuildConfig(message.guild.id);
      if (!cfg.xp_enabled) return;
      if ((cfg.xp_ignored_channels || []).includes(message.channel.id)) return;
      const key = `${message.guild.id}-${message.author.id}`;
      const cooldown = (cfg.xp_cooldown ?? 60) * 1000;
      const now = Date.now();
      if (cooldowns.has(key) && now - cooldowns.get(key) < cooldown) return;
      cooldowns.set(key, now);
      const min = cfg.xp_min ?? 15;
      const max = cfg.xp_max ?? 25;
      const gained = Math.floor(Math.random() * (max - min + 1)) + min;
      await grantXp(message.member, cfg, gained);
    } catch (e) {
      console.error('Erreur du système XP :', e.message);
    }
  });
  setInterval(() => {
    voiceXpTick(client).catch(e => console.error('Erreur XP vocal :', e.message));
  }, VOICE_TICK_MS);
  console.log('✅ Système XP initialisé (messages + vocal).');
}
module.exports = {
  registerXpHandler
};