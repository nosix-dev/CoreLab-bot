// /blacklist-membre — blacklist d'un membre (présent ou déjà parti) pour qu'il ne puisse plus rejoindre le serveur.
//   ajouter  : enregistre + bannit tout de suite (même si la personne a déjà quitté, via son ID)
//   retirer  : retire de la blacklist + débannit
//   liste    : affiche les membres blacklistés du serveur
// Sécurité : à chaque arrivée, un membre blacklisté est re-banni automatiquement (au cas où le ban Discord aurait été retiré).
// Stockage : blacklist_members.json à la racine du bot (écritures asynchrones).

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { dossierPersistant, fichierPersistant } = require('../core/persistentPath');
const { sendLog } = require('../core/utils');
const { glassPayload } = require('../core/glassEmbed');

const FILE = fichierPersistant('blacklist_members.json');
let data = {};
try { if (fs.existsSync(FILE)) data = JSON.parse(fs.readFileSync(FILE, 'utf-8')); } catch { data = {}; }

let writing = Promise.resolve();
function save() {
  writing = writing
    .then(() => fs.promises.writeFile(FILE, JSON.stringify(data, null, 2), 'utf-8'))
    .catch(e => console.error('[blacklist] sauvegarde impossible :', e.message));
}
const list = guildId => data[guildId] || (data[guildId] = {});

// MP « Vous avez été banni » (même carte verre fumé que /ban). À envoyer AVANT le ban.
async function sendBanDm(user, guild, reason) {
  if (!user) return;
  try {
    await user.send(await glassPayload({
      embeds: [new EmbedBuilder().setTitle('🚫 Vous avez été banni')
        .setDescription(`Vous avez été **banni** du serveur **${guild.name}**.`)
        .addFields({ name: 'Raison', value: reason || 'Aucune' })
        .setColor(0xff0000)]
    }, { guild, badge: 'SANCTION · BANNISSEMENT' }));
  } catch (_) { /* MP fermés ou aucun serveur en commun */ }
}

function logEmbed(title, userId, tag, by, reason) {
  return new EmbedBuilder()
    .setColor(0xFFFFFF)
    .setTitle(title)
    .addFields(
      { name: '👤 Membre', value: `${tag ? `${tag}\n` : ''}<@${userId}>\n\`${userId}\``, inline: true },
      { name: '🛡️ Par', value: by, inline: true },
      { name: '📝 Raison', value: reason || 'Aucune raison fournie' }
    )
    .setTimestamp();
}

const cmd = {
  data: new SlashCommandBuilder()
    .setName('blacklist-membre')
    .setDescription('Blacklister un membre pour qu’il ne puisse plus rejoindre le serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addSubcommand(s => s.setName('ajouter')
      .setDescription('Blacklister un membre (même s’il a quitté le serveur)')
      .addUserOption(o => o.setName('membre').setDescription('Le membre à blacklister'))
      .addStringOption(o => o.setName('id').setDescription('Ou son ID Discord (s’il a déjà quitté)'))
      .addStringOption(o => o.setName('raison').setDescription('Raison de la blacklist')))
    .addSubcommand(s => s.setName('retirer')
      .setDescription('Retirer un membre de la blacklist')
      .addStringOption(o => o.setName('id').setDescription('ID Discord du membre').setRequired(true)))
    .addSubcommand(s => s.setName('liste')
      .setDescription('Voir les membres blacklistés de ce serveur')),

  async execute(interaction) {
    const { guild } = interaction;
    const eph = { flags: MessageFlags.Ephemeral };
    if (!guild) return interaction.reply({ content: '❌ Commande utilisable uniquement dans un serveur.', ...eph });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({ content: '❌ Il te faut la permission « Bannir des membres ».', ...eph });
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'liste') {
      const entries = Object.entries(list(guild.id));
      if (!entries.length) return interaction.reply({ content: '✅ Aucun membre blacklisté sur ce serveur.', ...eph });
      const lines = entries.slice(0, 25).map(([id, e]) =>
        `• ${e.tag ? `**${e.tag}** ` : ''}\`${id}\` — ${e.reason || 'Aucune raison'} (<t:${Math.floor(new Date(e.date).getTime() / 1000)}:d>)`);
      const emb = new EmbedBuilder().setColor(0xFFFFFF)
        .setTitle(`⛔ Blacklist — ${entries.length} membre${entries.length > 1 ? 's' : ''}`)
        .setDescription(lines.join('\n').slice(0, 4000));
      return interaction.reply({ embeds: [emb], ...eph });
    }

    if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({ content: '❌ Je n’ai pas la permission « Bannir des membres ».', ...eph });
    }

    if (sub === 'ajouter') {
      const user = interaction.options.getUser('membre');
      const rawId = (interaction.options.getString('id') || '').trim();
      const id = user?.id || (/^\d{15,22}$/.test(rawId) ? rawId : null);
      if (!id) return interaction.reply({ content: '❌ Indique un membre ou un ID Discord valide.', ...eph });
      const reason = interaction.options.getString('raison') || 'Blacklisté';

      if (id === interaction.user.id) return interaction.reply({ content: '❌ Tu ne peux pas te blacklister toi-même.', ...eph });
      if (id === interaction.client.user.id) return interaction.reply({ content: '❌ Je ne peux pas me blacklister.', ...eph });
      if (id === guild.ownerId) return interaction.reply({ content: '❌ Impossible de blacklister le propriétaire du serveur.', ...eph });

      const member = await guild.members.fetch(id).catch(() => null);
      if (member) {
        if (!member.bannable) return interaction.reply({ content: '❌ Je ne peux pas bannir ce membre (rôle trop élevé).', ...eph });
        if (guild.ownerId !== interaction.user.id && member.roles.highest.position >= interaction.member.roles.highest.position) {
          return interaction.reply({ content: '❌ Ce membre a un rôle supérieur ou égal au tien.', ...eph });
        }
      }
      await interaction.deferReply(eph);

      const target = user || await interaction.client.users.fetch(id).catch(() => null);
      const tag = target?.tag || null;
      list(guild.id)[id] = { tag, reason, by: interaction.user.id, date: new Date().toISOString() };
      save();

      await sendBanDm(target, guild, reason);

      let banned = true;
      try {
        await guild.members.ban(id, { reason: `Blacklist par ${interaction.user.tag} : ${reason}` });
      } catch (e) {
        banned = false;
        console.error('[blacklist] ban impossible :', e.message);
      }
      sendLog(guild, logEmbed('⛔ Membre blacklisté', id, tag, `${interaction.user}`, reason), 'log_sanctions').catch(() => {});
      return interaction.editReply({
        content: `⛔ **${tag || id}** est blacklisté${member ? ' et a été banni' : (banned ? ' (banni d’avance, il ne pourra pas revenir)' : '')}.` +
          (banned ? '' : '\n⚠️ Le ban Discord a échoué, mais il sera banni dès qu’il tentera de rejoindre.')
      });
    }

    if (sub === 'retirer') {
      const id = interaction.options.getString('id').trim();
      const entry = list(guild.id)[id];
      if (!entry) return interaction.reply({ content: '❌ Cet ID n’est pas dans la blacklist.', ...eph });
      delete list(guild.id)[id];
      save();
      await guild.members.unban(id, `Retiré de la blacklist par ${interaction.user.tag}`).catch(() => {});
      sendLog(guild, logEmbed('✅ Membre retiré de la blacklist', id, entry.tag, `${interaction.user}`, null), 'log_sanctions').catch(() => {});
      return interaction.reply({ content: `✅ **${entry.tag || id}** a été retiré de la blacklist et débanni.`, ...eph });
    }
  }
};

// Re-bannit automatiquement un membre blacklisté qui tente de rejoindre.
function registerBlacklistHandler(client) {
  client.on('guildMemberAdd', async member => {
    const entry = data[member.guild.id]?.[member.id];
    if (!entry) return;
    await sendBanDm(member.user, member.guild, entry.reason);
    try {
      await member.ban({ reason: `Blacklist : ${entry.reason || 'Blacklisté'}` });
      {
        const emb = logEmbed('⛔ Membre blacklisté refusé', member.id, member.user.tag, `${client.user}`, entry.reason);
        require('../core/protectionLog').sendProtectionEmbed(member.guild, emb, 'SANCTION').then(ok => ok || sendLog(member.guild, emb, 'log_sanctions')).catch(() => {});
      }
    } catch (e) {
      console.error(`[blacklist] ban à l'arrivée impossible (${member.id}) :`, e.message);
    }
  });
}

module.exports = { commands: [cmd], registerBlacklistHandler };