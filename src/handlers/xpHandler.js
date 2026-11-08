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

// ────────────────────────────────────────────────
// Ajoute de l'XP à un membre et annonce la montée de niveau.
// Utilisé par les messages (le vocal ne donne plus d'XP : voir /rankup).
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
  const content = `${member} vient d'atteindre le **niveau ${afterLevel}** !`;
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
  console.log('✅ Système XP initialisé (messages).');
}
module.exports = {
  registerXpHandler,
  grantXp
};