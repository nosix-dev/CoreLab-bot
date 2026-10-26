// Pub CoreLab (Components V2) — deux façons de l'envoyer :
//  1) /promo  → commande slash installable sur TON COMPTE (User Install) :
//             fonctionne dans n'importe quel serveur, même sans le bot.
//  2) !pub <url_webhook> → via un webhook (en DM avec le bot ou sur un serveur où il est).
// Réservé au propriétaire du bot.

const {
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags
} = require('discord.js');

const DESCRIPTION = 'Le bot tout-en-un : Modération, Anti-Scam, Logs, Tickets, XP, Économie, Backup Economie, Crypto, Pokemon.';
const WEBHOOK_REGEX = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/(\d{15,25})\/([\w-]+)$/;

function buildComponents(client) {
  const avatar = client.user.displayAvatarURL({ extension: 'png', size: 256 });
  const serveurs = client.guilds.cache.size;
  const utilisateurs = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);

  return {
    avatar,
    components: [
      {
        type: 17, // Container
        accent_color: 0xFFFFFF,
        components: [
          {
            type: 9, // Section
            components: [
              { type: 10, content: `## ${client.user.username}` },
              { type: 10, content: DESCRIPTION }
            ],
            accessory: { type: 11, media: { url: avatar } } // Thumbnail
          },
          { type: 10, content: `📊 **${serveurs.toLocaleString('fr-FR')}** Serveurs  👥 **${utilisateurs.toLocaleString('fr-FR')}** Utilisateurs` },
          { type: 14, divider: true, spacing: 1 }, // Separator
          {
            type: 1, // Action row
            components: [
              { type: 2, style: 5, label: 'Ajouter', url: 'https://discord.com/oauth2/authorize?client_id=1403513450273177772&scope=bot%20applications.commands&permissions=8' },
              { type: 2, style: 5, label: 'Serveur', url: 'https://discord.gg/WecpyxrSBT' },
              { type: 2, style: 5, label: 'Voter', url: 'https://top.gg/bot/1403513450273177772/vote' }
            ]
          }
        ]
      }
    ]
  };
}

// ───────── /promo (User Install) ─────────
const data = new SlashCommandBuilder()
  .setName('pub')
  .setDescription('📢 Envoie la pub CoreLab dans ce salon (propriétaire uniquement)')
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
  .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel);

async function execute(interaction, client) {
  if (interaction.user.id !== client.BOT_OWNER_ID) {
    return interaction.reply({ content: '❌ Vous n\'êtes pas autorisé.', flags: MessageFlags.Ephemeral });
  }
  const { components } = buildComponents(client);
  return interaction.reply({ components, flags: MessageFlags.IsComponentsV2 });
}

// ───────── !pub <url_webhook> ─────────
async function pub(message, client) {
  if (message.author.id !== client.BOT_OWNER_ID) return;

  const url = message.content.trim().split(/\s+/)[1];

  // Le message contient le token du webhook : on le supprime tout de suite.
  if (message.guild) await message.delete().catch(() => { });

  if (!url || !WEBHOOK_REGEX.test(url)) {
    return message.channel.send('❌ Utilisez `!pub <url_webhook>`.').catch(() => { });
  }

  try {
    const { avatar, components } = buildComponents(client);
    const res = await fetch(`${url}?with_components=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: client.user.username,
        avatar_url: avatar,
        flags: 1 << 15, // IS_COMPONENTS_V2
        components
      })
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('[!pub] Erreur webhook :', res.status, err);
      return message.channel.send(`❌ Échec (${res.status}). Vérifiez l'URL du webhook.`).catch(() => { });
    }
    message.channel.send('✅ Pub envoyée.').catch(() => { });
  } catch (e) {
    console.error('[!pub] Erreur :', e);
    message.channel.send('❌ Erreur lors de l\'envoi.').catch(() => { });
  }
}

module.exports = { data, execute, pub };