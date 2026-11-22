// src/core/captchaSetup.js : actions du dashboard pour la vérification (captcha)
//   setupRoles : crée les rôles « Non vérifié » / « Vérifié » manquants, le salon de vérification si besoin,
//                puis règle les salons : un membre non vérifié ne voit que le salon de vérification.
//                Les membres déjà présents gardent leur accès (ils n'ont pas le rôle « Non vérifié »).
//   publish    : publie dans le salon de vérification un panneau avec le bouton « Me vérifier ».
//                Chaque publication crée un message ; le précédent panneau est supprimé.

const { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { obtenirConfigGuilde, persister } = require('./config');

const NOM_NON_VERIFIE = 'Non vérifié';
const NOM_VERIFIE = 'Vérifié';
const SALONS_CONCERNES = [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildCategory, ChannelType.GuildMedia].filter(t => t !== undefined);

const ko = (code, error, reason) => ({ code, body: { error, reason } });

async function setupRoles(guild, user) {
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const P = PermissionFlagsBits;
  if (!me || !me.permissions.has(P.ManageRoles) || !me.permissions.has(P.ManageChannels)) {
    return ko(400, 'permissions', 'Le bot a besoin des permissions « Gérer les rôles » et « Gérer les salons ».');
  }
  const cfg = obtenirConfigGuilde(guild.id);
  const raison = `Configuration de la vérification par ${user.username} (dashboard)`;
  const creer = async (id, nom, couleur) => {
    let r = id ? guild.roles.cache.get(String(id)) : null;
    if (!r) r = guild.roles.cache.find(x => x.name === nom && !x.managed);
    if (!r) r = await guild.roles.create({ name: nom, color: couleur, permissions: [], mentionable: false, reason: raison });
    return r;
  };
  let nonVerifie, verifie;
  try {
    nonVerifie = await creer(cfg.captcha_role_id, NOM_NON_VERIFIE, 0x6b6878);
    verifie = await creer(cfg.captcha_verified_role_id, NOM_VERIFIE, 0x3ba55d);
  } catch (e) {
    return ko(400, 'discord', `Création des rôles impossible : ${e.message}`);
  }
  if (nonVerifie.position >= me.roles.highest.position) return ko(400, 'permissions', `Le rôle « ${nonVerifie.name} » est au-dessus du rôle du bot : place le rôle du bot plus haut.`);

  let salon = cfg.captcha_channel_id ? guild.channels.cache.get(String(cfg.captcha_channel_id)) : null;
  let cree = false;
  if (!salon) {
    try {
      salon = await guild.channels.create({ name: '🔐・vérification', type: ChannelType.GuildText, reason: raison });
      cree = true;
    } catch (e) { return ko(400, 'discord', `Création du salon impossible : ${e.message}`); }
  }
  // Le salon de vérification : visible et lisible par les non vérifiés, mais sans pouvoir parler librement (le bot lit leur code).
  await salon.permissionOverwrites.edit(nonVerifie, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: false, EmbedLinks: false }, { reason: raison }).catch(() => { });
  await salon.permissionOverwrites.edit(verifie, { ViewChannel: false }, { reason: raison }).catch(() => { });

  let regles = 0, echecs = 0;
  for (const c of guild.channels.cache.values()) {
    if (c.id === salon.id || !SALONS_CONCERNES.includes(c.type) || !c.manageable) { if (c.id !== salon.id && SALONS_CONCERNES.includes(c.type)) echecs++; continue; }
    try {
      await c.permissionOverwrites.edit(nonVerifie, { ViewChannel: false }, { reason: raison });
      regles++;
    } catch { echecs++; }
  }

  cfg.captcha_role_id = nonVerifie.id;
  cfg.captcha_verified_role_id = verifie.id;
  cfg.captcha_channel_id = salon.id;
  persister('configuration');
  return {
    code: 200,
    body: {
      ok: true, channelsUpdated: regles, channelsFailed: echecs,
      roles: [nonVerifie, verifie].map(r => ({ id: r.id, name: r.name, ok: true })),
      channels: cree ? [{ id: salon.id, name: salon.name }] : [],
      channelId: salon.id
    }
  };
}

async function publish(guild, user) {
  const cfg = obtenirConfigGuilde(guild.id);
  const salon = cfg.captcha_channel_id ? guild.channels.cache.get(String(cfg.captcha_channel_id)) : null;
  if (!salon || !salon.isTextBased?.()) return ko(400, 'invalid', 'Choisis et enregistre d’abord un salon de vérification.');
  if (!cfg.captcha_role_id) return ko(400, 'invalid', 'Choisis et enregistre d’abord le rôle avant vérification.');
  const embed = new EmbedBuilder()
    .setTitle('🔐 Vérification')
    .setColor(0xE8510D)
    .setDescription(`Bienvenue sur **${guild.name}** !\nPour accéder au serveur, clique sur **Me vérifier** : un code s'affiche dans ce salon, recopie-le exactement.`)
    .setFooter({ text: `${cfg.captcha_max_attempts || 3} essai(s) · ${cfg.captcha_timeout_minutes || 5} minute(s) pour répondre` });
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('protect_captcha_start').setLabel('Me vérifier').setEmoji('🔐').setStyle(ButtonStyle.Success));
  let msg;
  try {
    if (cfg.captcha_panel_message_id) await salon.messages.delete(String(cfg.captcha_panel_message_id)).catch(() => { });
    msg = await salon.send({ embeds: [embed], components: [row] });
  } catch (e) {
    return ko(400, 'discord', `Publication impossible : ${e.message}`);
  }
  cfg.captcha_panel_message_id = msg.id;
  persister('configuration');
  console.log(`[Captcha] panneau publié par ${user.username} sur ${guild.name}`);
  return { code: 200, body: { ok: true, messageId: msg.id } };
}

module.exports = { setupRoles, publish };
