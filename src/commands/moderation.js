const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const {
  store,
  persist
} = require('../core/data');
const {
  sendLog
} = require('../core/utils');
const {
  getGuildConfig
} = require('../core/config');

// Pour Node.js < 18, décommentez la ligne ci-dessous et installez node-fetch
// const fetch = require('node-fetch');
const {
  toCV2Payload
} = require("../core/componentsV2");
const { glassPayload } = require('../core/glassEmbed');
async function sendInfraction(guild, type, member, moderator, reason) {
  const icons = {
    Ban: '🔨',
    Kick: '👢',
    Warn: '⚠️',
    Mute: '🔇'
  };
  const labels = {
    Ban: 'Ban',
    Kick: 'Expulsion',
    Warn: 'Avertissement',
    Mute: 'Mute'
  };
  const embed = new EmbedBuilder().setAuthor({
    name: `${icons[type] || '📋'} ${labels[type] || type}`,
    iconURL: guild.iconURL()
  }).setColor(0xFFFFFF).setThumbnail(member.user.displayAvatarURL({
    size: 256
  })).addFields({
    name: '👤 Membre',
    value: `${member}\n\`${member.id}\``,
    inline: true
  }, {
    name: '🛡️ Modérateur',
    value: `${moderator}`,
    inline: true
  }, {
    name: '\u200B',
    value: '\u200B',
    inline: true
  }, {
    name: '📝 Raison',
    value: reason || 'Aucune raison fournie',
    inline: false
  }).setFooter({
    text: guild.name,
    iconURL: guild.iconURL()
  }).setTimestamp();
  const cfg = getGuildConfig(guild.id);
  const infractionChannel = cfg.infraction_channel_id ? guild.channels.cache.get(cfg.infraction_channel_id) : null;
  if (infractionChannel) {
    await infractionChannel.send(await glassPayload({
      embeds: [embed]
    }, { guild, badge: `SANCTION · ${(labels[type] || type).toUpperCase()}` })).catch(() => {});
  } else {
    await sendLog(guild, embed, 'log_sanctions');
  }
}

// ─── KICK ───
const kick = {
  data: new SlashCommandBuilder().setName('kick').setDescription('Expulser un membre').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const reason = interaction.options.getString('raison') || 'Aucune';
    if (!member) return interaction.reply({
      content: '❌ Membre introuvable.',
      flags: MessageFlags.Ephemeral
    });
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });
    try {
      await member.send(await glassPayload({
        embeds: [new EmbedBuilder().setTitle('👢 Vous avez été expulsé').setDescription(`Vous avez été **expulsé** du serveur **${interaction.guild.name}**.`).addFields({
          name: 'Raison',
          value: reason
        }).setColor(0xffa500)]
      }, { guild: interaction.guild, badge: 'SANCTION · EXPULSION' }));
    } catch (_) {}
    await member.kick(reason);
    await sendInfraction(interaction.guild, 'Kick', member, interaction.user, reason);
    await interaction.editReply(`✅ ${member} a été expulsé.`);
  }
};

// ─── BAN ───
const ban = {
  data: new SlashCommandBuilder().setName('ban').setDescription('Bannir un membre').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const reason = interaction.options.getString('raison') || 'Aucune';
    if (!member) return interaction.reply({
      content: '❌ Membre introuvable.',
      flags: MessageFlags.Ephemeral
    });
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });
    try {
      await member.send(await glassPayload({
        embeds: [new EmbedBuilder().setTitle('🚫 Vous avez été banni').setDescription(`Vous avez été **banni** du serveur **${interaction.guild.name}**.`).addFields({
          name: 'Raison',
          value: reason
        }).setColor(0xff0000)]
      }, { guild: interaction.guild, badge: 'SANCTION · BANNISSEMENT' }));
    } catch (_) {}
    await member.ban({
      reason
    });
    await sendInfraction(interaction.guild, 'Ban', member, interaction.user, reason);
    await interaction.editReply(`✅ ${member} a été banni.`);
  }
};

// ─── WARN ───
const warn = {
  data: new SlashCommandBuilder().setName('warn').setDescription('Avertir un membre').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const reason = interaction.options.getString('raison');
    const uid = String(member.id);
    if (!store.warns[uid]) store.warns[uid] = [];
    store.warns[uid].push({
      reason: reason,
      moderator: interaction.user.id,
      date: new Date().toISOString(),
      guild_id: interaction.guild.id
    });
    persist('warns');
    await sendInfraction(interaction.guild, 'Warn', member, interaction.user, reason);
    await interaction.reply({
      content: `✅ ${member} averti (${store.warns[uid].length} avertissement(s)).`,
      flags: MessageFlags.Ephemeral
    });
  }
};

// ─── WARNINFOS ───
const warninfos = {
  data: new SlashCommandBuilder().setName('warninfos').setDescription('Voir les avertissements d\'un membre').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const warns = (store.warns[String(member.id)] || []).filter(w => w.guild_id === interaction.guild.id);
    if (!warns.length) return interaction.reply({
      content: 'Aucun avertissement.',
      flags: MessageFlags.Ephemeral
    });
    const lines = warns.map((w, i) => `\`${i + 1}\` ${w.reason} — <t:${Math.floor(new Date(w.date).getTime() / 1000)}:R>`);
    const embed = new EmbedBuilder().setTitle(`Avertissements de ${member.user.username}`).setDescription(lines.join('\n')).setColor(0xffa500);
    await interaction.reply(await glassPayload({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    }, { guild: interaction.guild, client: interaction.client, badge: 'AVERTISSEMENTS', avatar: member.user.displayAvatarURL({ extension: 'png', size: 256 }) }));
  }
};

// ─── PURGE (version classique : bulkDelete/suppression manuelle, sans clonage de salon) ───
const purge = {
  data: new SlashCommandBuilder().setName('purge').setDescription('Supprimer des messages').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addIntegerOption(o => o.setName('quantite').setDescription('Quantité (1-100)').setRequired(false).setMinValue(1).setMaxValue(100)).addBooleanOption(o => o.setName('tout').setDescription('Supprimer TOUS les messages de ce salon').setRequired(false)),
  async execute(interaction) {
    const all = interaction.options.getBoolean('tout') ?? false;
    const n = interaction.options.getInteger('quantite') ?? 10;

    // ── PURGE D'UNE QUANTITÉ PRÉCISE ──────────────────────────
    if (!all) {
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });
      const messages = await interaction.channel.messages.fetch({
        limit: n
      });
      const ids = messages.map(m => m.id);
      if (!ids.length) return interaction.editReply('ℹ️ Aucun message.');
      try {
        const deleted = await interaction.channel.bulkDelete(ids, true);
        await interaction.editReply(`🗑️ ${deleted.size} message(s) supprimé(s).`);
      } catch {
        let count = 0;
        for (const msg of messages.values()) {
          try {
            await msg.delete();
            count++;
          } catch {}
        }
        await interaction.editReply(`🗑️ ${count} message(s) supprimé(s).`);
      }
      return;
    }

    // ── SUPPRESSION TOTALE CLASSIQUE (boucle de suppression, sans clonage du salon) ──
    const embed = new EmbedBuilder().setTitle('⚠️ Confirmation requise').setDescription(`Vous êtes sur le point de supprimer **TOUS** les messages dans ${interaction.channel}.\n\nCette action est **irréversible** !`).setColor(0xFFA500);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('purge_all_confirm').setLabel('✅ Oui, tout supprimer').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('purge_all_cancel').setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary));
    await interaction.reply(toCV2Payload({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral
    }));
    const reply = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({
      time: 30000,
      max: 1
    });
    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) return i.reply({
        content: '❌ Vous ne pouvez pas utiliser ce bouton.',
        flags: MessageFlags.Ephemeral
      });
      if (i.customId === 'purge_all_cancel') {
        await i.update(toCV2Payload({
          content: '❌ Purge annulée.'
        }));
        return;
      }
      await i.update(toCV2Payload({
        content: '⏳ Suppression en cours...'
      }));
      try {
        const channel = interaction.channel;
        let totalDeleted = 0;
        let safety = 0;
        while (safety < 200) {
          safety++;
          const fetched = await channel.messages.fetch({
            limit: 100
          });
          if (fetched.size === 0) break;
          if (fetched.size === 1) {
            try {
              await fetched.first().delete();
              totalDeleted++;
            } catch {}
            continue;
          }
          try {
            const deleted = await channel.bulkDelete(fetched, true);
            totalDeleted += deleted.size;
            // Messages de plus de 14 jours : bulkDelete les ignore, suppression manuelle
            if (deleted.size < fetched.size) {
              const remaining = fetched.filter(m => !deleted.has(m.id));
              for (const msg of remaining.values()) {
                try {
                  await msg.delete();
                  totalDeleted++;
                } catch {}
              }
            }
          } catch {
            for (const msg of fetched.values()) {
              try {
                await msg.delete();
                totalDeleted++;
              } catch {}
            }
          }
        }
        await i.editReply(toCV2Payload({
          content: `✅ ${totalDeleted} message(s) supprimé(s) dans ${channel}.`
        }));
      } catch (err) {
        console.error('Erreur purge totale:', err);
        await i.editReply(toCV2Payload({
          content: '❌ Erreur lors de la suppression.'
        }));
      }
    });
    collector.on('end', async (collected, reason) => {
      if (reason === 'time' && collected.size === 0) {
        try {
          await interaction.editReply(toCV2Payload({
            content: '⏱️ Temps écoulé, purge annulée.'
          }));
        } catch {}
      }
    });
  }
};

// ─── PURGEUSER ───
const purgeuser = {
  data: new SlashCommandBuilder().setName('purgeuser').setDescription('Supprimer les messages d\'un utilisateur').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('quantite').setDescription('Quantité (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const n = interaction.options.getInteger('quantite');
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });
    const messages = await interaction.channel.messages.fetch({
      limit: 100
    });
    const ids = messages.filter(msg => msg.author.id === member.id).map(msg => msg.id).slice(0, n);
    if (!ids.length) return interaction.editReply(`ℹ️ Aucun message de ${member} à supprimer.`);
    const deleted = await interaction.channel.bulkDelete(ids, true);
    await interaction.editReply(`🗑️ ${deleted.size} message(s) de ${member} supprimé(s).`);
  }
};

// ─── MUTE ───
const mute = {
  data: new SlashCommandBuilder().setName('mute').setDescription('Rendre muet un membre (sans limite de durée)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const reason = interaction.options.getString('raison') || 'Aucune';
    if (!member) return interaction.reply({
      content: '❌ Membre introuvable.',
      flags: MessageFlags.Ephemeral
    });
    const cfg = getGuildConfig(interaction.guild.id);
    const role = interaction.guild.roles.cache.get(cfg.mute_role);
    if (!role) return interaction.reply({
      content: '❌ Rôle de mute non configuré.',
      flags: MessageFlags.Ephemeral
    });
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });
    if (member.roles.cache.has(role.id)) {
      return interaction.editReply(`ℹ️ ${member} est déjà muet.`);
    }
    try {
      await member.roles.add(role, reason);
    } catch {
      return interaction.editReply('❌ Impossible de rendre muet ce membre. Vérifiez les permissions du bot.');
    }
    await sendInfraction(interaction.guild, 'Mute', member, interaction.user, reason);
    await interaction.editReply(`🔇 ${member} a été rendu muet.`);
  }
};

// ─── DELETECHANNELS ───
const deletechannels = {
  data: new SlashCommandBuilder().setName('deletechannels').setDescription('Supprimer un salon ou une catégorie entière').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName('mode').setDescription('Choisir ce que vous voulez supprimer').setRequired(true).addChoices({
    name: 'Supprimer un salon',
    value: 'salon'
  }, {
    name: 'Supprimer toute la catégorie',
    value: 'categorie'
  }, {
    name: 'Supprimer TOUT LE SERVEUR (toutes les catégories + tous les salons)',
    value: 'serveur'
  })).addChannelOption(o => o.setName('categorie').setDescription('Catégorie à traiter (requis sauf en mode "tout le serveur")').addChannelTypes(ChannelType.GuildCategory).setRequired(false)).addChannelOption(o => o.setName('salon').setDescription('Salon à supprimer (si mode = salon)').setRequired(false)).addStringOption(o => o.setName('raison').setDescription('Raison de la suppression').setRequired(false)),
  async execute(interaction) {
    const category = interaction.options.getChannel('categorie');
    const mode = interaction.options.getString('mode');
    const targetChannel = interaction.options.getChannel('salon');
    const reason = interaction.options.getString('raison') || 'Aucune raison fournie';
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        content: '❌ Le bot n’a pas la permission de gérer les salons.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (mode !== 'serveur' && (!category || category.type !== ChannelType.GuildCategory)) {
      return interaction.reply({
        content: '❌ Catégorie invalide.',
        flags: MessageFlags.Ephemeral
      });
    }
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });
    if (mode === 'serveur') {
      const confirmId = `deletechannels_confirm_serveur`;
      const cancelId = `deletechannels_cancel_serveur`;
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(confirmId).setLabel('✅ Confirmer').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(cancelId).setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary));
      const totalSalons = interaction.guild.channels.cache.size;
      const message = await interaction.editReply({
        content: `🚨 **ATTENTION** : vous êtes sur le point de supprimer **TOUS les salons et TOUTES les catégories** du serveur (${totalSalons} salons au total). Cette action est irréversible.\nRaison : ${reason}`,
        components: [row]
      });
      const collector = message.createMessageComponentCollector({
        time: 30000,
        max: 1
      });
      collector.on('collect', async i => {
        if (i.user.id !== interaction.user.id) return i.reply({
          content: '❌ Vous ne pouvez pas utiliser ce bouton.',
          flags: MessageFlags.Ephemeral
        });
        if (i.customId === cancelId) {
          await i.update({
            content: '❌ Suppression annulée.',
            components: [],
            embeds: []
          });
          return;
        }
        await i.update({
          content: '⏳ Suppression de tous les salons du serveur en cours...',
          components: [],
          embeds: []
        });
        try {
          const tousLesSalons = Array.from(interaction.guild.channels.cache.values());
          let supprimes = 0;
          for (const salon of tousLesSalons) {
            try {
              await salon.delete(reason);
              supprimes++;
            } catch (e) {
              console.error(`Erreur suppression du salon ${salon.name} :`, e.message);
            }
          }
          await i.editReply({
            content: `✅ ${supprimes} salon(s)/catégorie(s) supprimé(s) sur ${tousLesSalons.length}.`,
            components: [],
            embeds: []
          });
        } catch (e) {
          await i.editReply({
            content: '❌ Une erreur est survenue lors de la suppression du serveur.',
            components: [],
            embeds: []
          });
          console.error('Erreur suppression totale du serveur :', e.message);
        }
      });
      collector.on('end', async (_, reasonEnd) => {
        if (reasonEnd === 'time') {
          try {
            await interaction.editReply({
              content: '⏱️ Temps écoulé, suppression annulée.',
              components: [],
              embeds: []
            });
          } catch {}
        }
      });
      return;
    }
    if (mode === 'salon') {
      if (!targetChannel) {
        return interaction.editReply('❌ Précisez un salon à supprimer, ou passez en mode « catégorie » pour supprimer toute la catégorie.');
      }
      if (targetChannel.parentId !== category.id) {
        return interaction.editReply('❌ Ce salon n’appartient pas à la catégorie sélectionnée.');
      }
      const confirmId = `deletechannels_confirm_${category.id}_${targetChannel.id}`;
      const cancelId = `deletechannels_cancel_${category.id}_${targetChannel.id}`;
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(confirmId).setLabel('✅ Confirmer').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(cancelId).setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary));
      const message = await interaction.editReply({
        content: `⚠️ Vous êtes sur le point de supprimer le salon ${targetChannel} dans la catégorie ${category}.\nRaison : ${reason}`,
        components: [row]
      });
      const collector = message.createMessageComponentCollector({
        time: 30000,
        max: 1
      });
      collector.on('collect', async i => {
        if (i.user.id !== interaction.user.id) return i.reply({
          content: '❌ Vous ne pouvez pas utiliser ce bouton.',
          flags: MessageFlags.Ephemeral
        });
        if (i.customId === cancelId) {
          await i.update({
            content: '❌ Suppression annulée.',
            components: [],
            embeds: []
          });
          return;
        }
        await i.update({
          content: '⏳ Suppression du salon en cours...',
          components: [],
          embeds: []
        });
        try {
          await targetChannel.delete(reason);
          await i.editReply({
            content: `✅ Le salon ${targetChannel} a été supprimé.`,
            components: [],
            embeds: []
          });
        } catch (e) {
          await i.editReply({
            content: `❌ Impossible de supprimer le salon ${targetChannel}.`,
            components: [],
            embeds: []
          });
          console.error('Erreur suppression salon :', e.message);
        }
      });
      collector.on('end', async (_, reasonEnd) => {
        if (reasonEnd === 'time') {
          try {
            await interaction.editReply({
              content: '⏱️ Temps écoulé, suppression annulée.',
              components: [],
              embeds: []
            });
          } catch {}
        }
      });
      return;
    }

    // Mode catégorie
    const confirmId = `deletechannels_confirm_${category.id}_category`;
    const cancelId = `deletechannels_cancel_${category.id}_category`;
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(confirmId).setLabel('✅ Confirmer').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(cancelId).setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary));
    const message = await interaction.editReply({
      content: `⚠️ Vous êtes sur le point de supprimer toute la catégorie ${category} et tous ses salons.\nRaison : ${reason}`,
      components: [row]
    });
    const collector = message.createMessageComponentCollector({
      time: 30000,
      max: 1
    });
    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) return i.reply({
        content: '❌ Vous ne pouvez pas utiliser ce bouton.',
        flags: MessageFlags.Ephemeral
      });
      if (i.customId === cancelId) {
        await i.update({
          content: '❌ Suppression annulée.',
          components: [],
          embeds: []
        });
        return;
      }
      await i.update({
        content: '⏳ Suppression de la catégorie et de ses salons en cours...',
        components: [],
        embeds: []
      });
      try {
        const children = Array.from(category.children.cache.values());
        for (const child of children) {
          try {
            await child.delete(reason);
          } catch (e) {
            console.error(`Erreur suppression du salon ${child.name} :`, e.message);
          }
        }
        await category.delete(reason);
        await i.editReply({
          content: `✅ La catégorie ${category} et ses salons ont été supprimés.`,
          components: [],
          embeds: []
        });
      } catch (e) {
        await i.editReply({
          content: `❌ Impossible de supprimer la catégorie ${category}.`,
          components: [],
          embeds: []
        });
        console.error('Erreur suppression catégorie :', e.message);
      }
    });
    collector.on('end', async (_, reasonEnd) => {
      if (reasonEnd === 'time') {
        try {
          await interaction.editReply({
            content: '⏱️ Temps écoulé, suppression annulée.',
            components: [],
            embeds: []
          });
        } catch {}
      }
    });
  }
};
module.exports = [kick, ban, warn, warninfos, purge, purgeuser, mute, deletechannels];