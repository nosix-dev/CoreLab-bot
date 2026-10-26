const {
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const {
  store,
  persist
} = require('../core/data');
const {
  getGuildConfig
} = require('../core/config');

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────
const {
  toCV2Payload
} = require("../core/componentsV2");
function isAdmin(message) {
  return !!message.member?.permissions.has(PermissionFlagsBits.Administrator);
}
function requireGuild(message) {
  return !!message.guild;
}

// Récupère le premier membre mentionné dans le message (hors mention du bot)
function getMentionedMember(message) {
  return message.mentions.members?.first() || null;
}

// Récupère le premier rôle mentionné dans le message
function getMentionedRole(message) {
  return message.mentions.roles?.first() || null;
}

// Découpe le contenu du message après le nom de la commande, en retirant les mentions
function getArgsAfterCommand(message, commandName) {
  const raw = message.content.slice(message.content.indexOf(commandName) + commandName.length).trim();
  return raw.split(/\s+/).filter(Boolean);
}

// Texte restant après avoir retiré la commande et les mentions (pour les raisons / textes libres)
function getFreeText(message, commandName) {
  let text = message.content.slice(message.content.indexOf(commandName) + commandName.length).trim();
  text = text.replace(/<@!?\d+>/g, '').replace(/<@&\d+>/g, '').trim();
  return text;
}

// Parse une durée du type "10m", "2h", "1d" (minutes/heures/jours) → millisecondes
function parseDuration(str) {
  if (!str) return null;
  const match = /^(\d+)\s*(m|min|h|heure|heures|j|jour|jours|d)$/i.exec(str.trim());
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('m')) return value * 60_000;
  if (unit.startsWith('h')) return value * 3_600_000;
  return value * 86_400_000; // j / jour(s) / d
}
function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} heure${hours > 1 ? 's' : ''}`;
  const days = Math.round(hours / 24);
  return `${days} jour${days > 1 ? 's' : ''}`;
}

// ────────────────────────────────────────────────
// Commandes préfixe (!)
// ────────────────────────────────────────────────

const prefixCommands = {
  // !purge <nombre>
  purge: async message => {
    if (!requireGuild(message)) return;
    if (!isAdmin(message)) return message.reply('❌ Vous n\'avez pas la permission.');
    const [arg] = getArgsAfterCommand(message, 'purge');
    const n = Math.min(100, Math.max(1, parseInt(arg, 10) || 10));
    try {
      const deleted = await message.channel.bulkDelete(n + 1, true); // +1 pour inclure le message !purge
      const reply = await message.channel.send(`🗑️ ${deleted.size - 1} message(s) supprimé(s).`);
      setTimeout(() => reply.delete().catch(() => {}), 4000);
    } catch (e) {
      message.channel.send('❌ Impossible de supprimer ces messages (trop vieux de 14 jours ?).');
    }
  },
  // !purgeuser @membre <nombre>
  purgeuser: async message => {
    if (!requireGuild(message)) return;
    if (!isAdmin(message)) return message.reply('❌ Vous n\'avez pas la permission.');
    const member = getMentionedMember(message);
    if (!member) return message.reply('❌ Utilisez `!purgeuser @membre <quantité>`.');
    const args = getArgsAfterCommand(message, 'purgeuser').filter(a => !/^<@!?\d+>$/.test(a));
    const n = Math.min(100, Math.max(1, parseInt(args[0], 10) || 10));
    const messages = await message.channel.messages.fetch({
      limit: 100
    });
    const ids = messages.filter(m => m.author.id === member.id).map(m => m.id).slice(0, n);
    if (!ids.length) return message.reply(`ℹ️ Aucun message de ${member} à supprimer.`);
    const deleted = await message.channel.bulkDelete(ids, true);
    message.channel.send(`🗑️ ${deleted.size} message(s) de ${member} supprimé(s).`);
  },
  // !timeout @membre <10m|2h|1j> [raison]
  timeout: async message => {
    if (!requireGuild(message)) return;
    if (!isAdmin(message)) return message.reply('❌ Vous n\'avez pas la permission.');
    const member = getMentionedMember(message);
    if (!member) return message.reply('❌ Utilisez `!timeout @membre <durée ex: 10m/2h/1j> [raison]`.');
    const args = getArgsAfterCommand(message, 'timeout').filter(a => !/^<@!?\d+>$/.test(a));
    const durationMs = parseDuration(args[0]);
    if (!durationMs) return message.reply('❌ Durée invalide. Exemples : `10m`, `2h`, `1j`.');
    const MAX_MS = 28 * 24 * 60 * 60 * 1000;
    if (durationMs > MAX_MS) return message.reply('❌ La durée maximale d\'un timeout est **28 jours**.');
    const reason = args.slice(1).join(' ') || 'Aucune';
    try {
      await member.timeout(durationMs, reason);
    } catch (e) {
      return message.reply('❌ Impossible de mettre ce membre en timeout.');
    }
    try {
      await member.send(toCV2Payload({
        embeds: [new EmbedBuilder().setColor(0xFF5C5C).setTitle('🔇 Tu as été mis en timeout').addFields({
          name: '🏠 Serveur',
          value: message.guild.name,
          inline: true
        }, {
          name: '⏱️ Durée',
          value: formatDuration(durationMs),
          inline: true
        }, {
          name: '📋 Raison',
          value: reason
        }).setTimestamp()]
      }));
    } catch {}
    message.channel.send(`✅ ${member} a été mis en timeout pendant **${formatDuration(durationMs)}**.\n📋 Raison : ${reason}`);
  },
  // !untimeout @membre
  untimeout: async message => {
    if (!requireGuild(message)) return;
    if (!isAdmin(message)) return message.reply('❌ Vous n\'avez pas la permission.');
    const member = getMentionedMember(message);
    if (!member) return message.reply('❌ Utilisez `!untimeout @membre`.');
    try {
      await member.timeout(null);
      message.channel.send(`✅ Timeout retiré pour ${member}.`);
    } catch {
      message.reply('❌ Impossible de retirer le timeout de ce membre.');
    }
  },
  // !mute @membre <10m|2h|1j> [raison]
  mute: async message => {
    if (!requireGuild(message)) return;
    if (!isAdmin(message)) return message.reply('❌ Vous n\'avez pas la permission.');
    const member = getMentionedMember(message);
    if (!member) return message.reply('❌ Utilisez `!mute @membre <durée ex: 10m/2h/1j> [raison]`.');
    const args = getArgsAfterCommand(message, 'mute').filter(a => !/^<@!?\d+>$/.test(a));
    const durationMs = parseDuration(args[0]);
    if (!durationMs) return message.reply('❌ Durée invalide. Exemples : `10m`, `2h`, `1j`.');
    const reason = args.slice(1).join(' ') || 'Aucune';
    const cfg = getGuildConfig(message.guild.id);
    const role = message.guild.roles.cache.get(cfg.mute_role);
    if (!role) return message.reply('❌ Rôle de mute non configuré (voir `/settings`).');
    try {
      await member.roles.add(role, reason);
    } catch {
      return message.reply('❌ Impossible de rendre muet ce membre. Vérifiez les permissions du bot.');
    }
    const gid = String(message.guild.id);
    const uid = String(member.id);
    if (!store.tempMutes[gid]) store.tempMutes[gid] = {};
    store.tempMutes[gid][uid] = {
      guild_id: message.guild.id,
      end_time: new Date(Date.now() + durationMs).toISOString(),
      reason
    };
    persist('tempMutes');
    setTimeout(async () => {
      try {
        await member.roles.remove(role);
      } catch {}
      if (store.tempMutes[gid]?.[uid]) {
        delete store.tempMutes[gid][uid];
        persist('tempMutes');
      }
    }, durationMs);
    message.channel.send(`🔇 ${member} a été rendu muet pendant **${formatDuration(durationMs)}**.\n📋 Raison : ${reason}`);
  },
  // !unmute @membre
  unmute: async message => {
    if (!requireGuild(message)) return;
    if (!isAdmin(message)) return message.reply('❌ Vous n\'avez pas la permission.');
    const member = getMentionedMember(message);
    if (!member) return message.reply('❌ Utilisez `!unmute @membre`.');
    const cfg = getGuildConfig(message.guild.id);
    const role = message.guild.roles.cache.get(cfg.mute_role);
    if (!role) return message.reply('❌ Rôle de mute non configuré (voir `/settings`).');
    if (!member.roles.cache.has(role.id)) return message.reply(`ℹ️ ${member} n'est pas muet.`);
    await member.roles.remove(role);
    const gid = String(message.guild.id);
    const uid = String(member.id);
    if (store.tempMutes[gid]?.[uid]) {
      delete store.tempMutes[gid][uid];
      persist('tempMutes');
    }
    message.channel.send(`🔊 ${member} peut de nouveau parler.`);
  },
  // !lock (verrouille le salon actuel)
  lock: async message => {
    if (!requireGuild(message)) return;
    if (!isAdmin(message)) return message.reply('❌ Vous n\'avez pas la permission.');
    await message.channel.permissionOverwrites.edit(message.guild.id, {
      SendMessages: false
    });
    message.channel.send(`🔒 Salon verrouillé.`);
  },
  // !unlock (déverrouille le salon actuel)
  unlock: async message => {
    if (!requireGuild(message)) return;
    if (!isAdmin(message)) return message.reply('❌ Vous n\'avez pas la permission.');
    await message.channel.permissionOverwrites.delete(message.guild.id);
    message.channel.send(`🔓 Salon déverrouillé.`);
  },
  // !addrole @membre @role
  addrole: async message => {
    if (!requireGuild(message)) return;
    if (!isAdmin(message)) return message.reply('❌ Vous n\'avez pas la permission.');
    const member = getMentionedMember(message);
    const role = getMentionedRole(message);
    if (!member || !role) return message.reply('❌ Utilisez `!addrole @membre @role`.');
    try {
      await member.roles.add(role);
      message.channel.send(`✅ Rôle ${role} ajouté à ${member}.`);
    } catch {
      message.reply(`❌ Impossible d'ajouter le rôle ${role.name}.`);
    }
  },
  // !removerole @membre @role
  removerole: async message => {
    if (!requireGuild(message)) return;
    if (!isAdmin(message)) return message.reply('❌ Vous n\'avez pas la permission.');
    const member = getMentionedMember(message);
    const role = getMentionedRole(message);
    if (!member || !role) return message.reply('❌ Utilisez `!removerole @membre @role`.');
    try {
      await member.roles.remove(role);
      message.channel.send(`✅ Rôle ${role} retiré à ${member}.`);
    } catch {
      message.reply(`❌ Impossible de retirer le rôle ${role.name}.`);
    }
  },
  // !mp @membre <texte>
  mp: async message => {
    if (!requireGuild(message)) return;
    if (!isAdmin(message)) return message.reply('❌ Vous n\'avez pas la permission.');
    const member = getMentionedMember(message);
    if (!member) return message.reply('❌ Utilisez `!mp @membre <texte>`.');
    const text = getFreeText(message, 'mp');
    if (!text) return message.reply('❌ Utilisez `!mp @membre <texte>`.');
    try {
      await member.send(text);
      message.reply(`✅ MP envoyé à ${member}.`);
    } catch {
      message.reply(`❌ Impossible d'envoyer un MP à ${member} (DM fermés).`);
    }
  },
  // !annonce <texte>
  annonce: async message => {
    if (!requireGuild(message)) return;
    if (!isAdmin(message)) return message.reply('❌ Vous n\'avez pas la permission.');
    const text = getFreeText(message, 'annonce');
    const attachments = [...message.attachments.values()];
    if (!text && !attachments.length) return message.reply('❌ Utilisez `!annonce votre texte` (vous pouvez aussi joindre un fichier).');
    const payload = {};
    if (text) payload.content = text;
    if (attachments.length) payload.files = attachments.map(a => a.url);
    await message.channel.send(payload);
    try {
      await message.delete();
    } catch {}
  },
  // !tts <texte>
  tts: async message => {
    if (!requireGuild(message)) return;
    const text = getFreeText(message, 'tts');
    if (!text) return message.reply('❌ Utilisez `!tts votre texte`.');
    await message.channel.send({
      content: text,
      tts: true
    });
  }
};
module.exports = {
  commands: [],
  prefixCommands
};