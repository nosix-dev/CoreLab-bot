const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
// Réseau : IPv4 en priorité (IPv6 cassé sur certains nœuds) + délai de connexion plus long
// (corrige les « ConnectTimeoutError ... discord.com:443 » sur hébergement gratuit)
try { dns.setDefaultResultOrder('ipv4first'); } catch {}
try { require('net').setDefaultAutoSelectFamily(false); } catch {}
try {
  const { setGlobalDispatcher, Agent } = require('undici');
  setGlobalDispatcher(new Agent({ connect: { timeout: 30000 } }));
} catch (e) {
  console.error('Impossible de régler le timeout réseau :', e.message);
}
require('dotenv').config();

// ────────────────────────────────────────────────
// Serveur HTTP minimal (requis par Render pour un Web Service).
// Démarre en premier pour que Render détecte le port tout de suite.
// Sert aussi de cible de ping (UptimeRobot) pour garder l'instance éveillée.
// ────────────────────────────────────────────────
try {
  const http = require('http');
  const os = require('os');
  const RENDER_PORT = process.env.PORT || 10000;

  // CPU du process, échantillonné toutes les 5 s
  let lastUsage = process.cpuUsage(), lastTime = Date.now(), cpuPct = 0;
  setInterval(() => {
    const t = Date.now() - lastTime;
    const u = process.cpuUsage(lastUsage);
    cpuPct = ((u.user + u.system) / 1000 / t / os.cpus().length) * 100;
    lastUsage = process.cpuUsage();
    lastTime = Date.now();
  }, 5000).unref();

  const buildStatus = () => {
    const fsl = require('fs');
    let storage = { used: 0, total: 0 };
    try {
      const s = fsl.statfsSync('/');
      storage = { total: s.bsize * s.blocks, used: s.bsize * (s.blocks - s.bavail) };
    } catch {}
    // Mémoire : limite du conteneur si elle existe, sinon RAM de la machine
    let memTotal = os.totalmem();
    try {
      const m = fsl.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
      if (m !== 'max') memTotal = Math.min(memTotal, Number(m));
    } catch {}
    return {
      bot: client.isReady() ? 'online' : 'offline',
      discord: client.ws.status === 0 ? 'ok' : 'down',
      latency_ms: Math.max(0, Math.round(client.ws.ping)),
      uptime_s: Math.floor((client.uptime || 0) / 1000),
      servers: client.guilds.cache.size,
      users: client.guilds.cache.reduce((a, g) => a + (g.memberCount || 0), 0),
      commands: client.commands?.size || 0,
      cpu: { percent: Math.min(100, +cpuPct.toFixed(1)), cores: os.cpus().length, model: os.cpus()[0]?.model || '' },
      memory: { used: process.memoryUsage().rss, total: memTotal },
      storage,
    };
  };

  http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/status') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      });
      try { return res.end(JSON.stringify(buildStatus())); }
      catch { return res.end(JSON.stringify({ bot: 'offline' })); }
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('CoreLab en ligne');
  }).on('error', err => {
    console.error('[HTTP] Serveur keep-alive non démarré :', err.message);
  }).listen(RENDER_PORT, '0.0.0.0', () => {
    console.log(`[HTTP] Serveur actif sur le port ${RENDER_PORT}`);
  });
} catch (e) {
  console.error('[HTTP] Erreur :', e.message);
}

const fs = require('fs');
const path = require('path');
const {
  MessageFlags,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  AttachmentBuilder,
  ChannelType,
  AuditLogEvent
} = require('discord.js');

// Définit une couleur par défaut pour tous les embeds si aucune couleur n'est fournie.
// On surcharge `toJSON` afin d'ajouter la couleur au moment où Discord.js sérialise l'embed.
try {
  const _origToJSON = EmbedBuilder.prototype.toJSON;
  EmbedBuilder.prototype.toJSON = function () {
    const out = _origToJSON.call(this);
    if (out && (out.color === undefined || out.color === null)) {
      out.color = 0xFFFFFF;
    }
    return out;
  };
} catch (e) {
  // En cas d'échec (version inattendue de discord.js), continuer sans écraser.
  console.error('Impossible d\'injecter la couleur d\'embed par défaut :', e.message);
}
const {
  createClient
} = require('./src/core/client');

const {
  registerCommands
} = require('./src/handlers/register');
const {
  normalizeCommandInteraction
} = require('./src/core/commandLocalizations');
const {
  setPremium,
  isPremium,
  setCustomization,
  setTotal,
  buildPremiumMessage
} = require('./src/core/premium');
const {
  broadcast,
  routeBroadcastInteraction,
  routeBroadcastEmbedInteraction
} = require('./src/commands/broadcast');
const {
  deleteDm
} = require('./src/commands/deleteDm');
const {
  dm,
  routeDmInteraction
} = require('./src/commands/dm');
const {
  pub
} = require('./src/commands/pub');
const {
  prefixCommands: automodPrefixCommands
} = require('./src/commands/automod');
const {
  registerAutomodOnJoinHandler
} = require('./src/handlers/automodOnJoin');
const {
  registerLogHandlers
} = require('./src/handlers/logs');
const {
  checkSlashPermissions,
  routeTicketInteraction,
  routeReglementInteraction,
  routePartnershipInteraction
} = require('./src/handlers/interactions');
const {
  handleRulesReaction
} = require('./src/core/reglement');
const {
  prefixCommands: extendedPrefixCommands,
  routeMpUnsubscribeInteraction
} = require('./src/commands/extended');
const {
  registerWelcomeImageHandler
} = require('./src/handlers/welcomeImage');
const {
  registerXpHandler
} = require('./src/handlers/xpHandler');
const {
  registerHelpHandler
} = require('./src/handlers/help');
const {
  registerCountingHandler
} = require('./src/handlers/counting');
const {
  registerCommunityHandlers
} = require('./src/handlers/community');
const {
  routeMarcheInteraction,
  startMarche
} = require('./src/handlers/cardMarket');
const {
  startCombat
} = require('./src/handlers/cardBattle');
const {
  registerWelcomeHandler
} = require('./src/handlers/welcome');
const {
  getGuildBucket,
  setGuildBucket
} = require('./src/core/data');
const {
  registerGoodbyeHandler
} = require('./src/handlers/goodbye');
const {
  registerProtectionHandlers,
  routeProtectionInteraction
} = require('./src/handlers/protection');
const {
  routeIaInteraction,
  registerIaMessageHandler,
  rehydrateIaSessions
} = require('./src/handlers/aiChat');
const {
  registerStarboardHandlers,
  routeStarboardInteraction
} = require('./src/handlers/starboard');
const {
  generateStarboardCard
} = require('./src/core/starboardCard');
const {
  registerAntiScamHandler
} = require('./src/handlers/antiScam');
const {
  registerPartnershipAutoHandler
} = require('./src/handlers/partnershipAuto');
const {
  registerNicknameGuardHandler,
  synchroniserPseudosAuDemarrage
} = require('./src/handlers/nicknameGuard');
const {
  registerBotRoleHandler,
  synchroniserRoleAuDemarrage
} = require('./src/handlers/botRole');
const {
  registerAutoRoleHandler
} = require('./src/handlers/autoRoleHandler');
const {
  registerBumpReminderHandler
} = require('./src/handlers/bumpReminder');
const {
  libelleLangue
} = require('./src/core/languages');
const {
  traduireDeepL,
  memeLangue
} = require('./src/core/deeplTranslate');
const {
  routeSettingsInteraction
} = require('./src/handlers/settingsPanel');
const {
  routeEmbedInteraction
} = require('./src/core/embedManager');
const {
  handleEventButton,
  startEventLoop
} = require('./src/core/eventManager');
const {
  routeAgendaInteraction
} = require('./src/commands/agenda');
const {
  routeVoteInteraction
} = require('./src/core/vote');
const {
  PREMIUM_SKU_ID,
  CUSTOMIZATION_SKU_ID,
  TOTAL_SKU_ID,
  OWNER_IDS,
  PREFIX,
  FILES,
  BOT_OWNER_ID,
  STAR_THRESHOLD
} = require('./src/core/constants');
const {
  startTasks
} = require('./src/tasks');
const {
  loadData,
  saveData,
  store,
  persist
} = require('./src/core/data');
const {
  getGuildConfig
} = require('./src/core/config');

// Émoji par défaut si rien n'est configuré via /starboard-settings
const STAR_EMOJI_ID_DEFAULT = '1548657085699461121';
const STAR_EMOJI_DEFAULT = `<:heartwhite:${STAR_EMOJI_ID_DEFAULT}>`;

// Lit l'émoji configuré via /starboard-settings (cfg.starboard_emoji_id / starboard_emoji_raw).
// Retourne { display, reactValue } : display = format à afficher dans les embeds/textes,
// reactValue = valeur à passer à message.react() (id brut pour un émoji perso, ou l'unicode).
function getStarboardEmoji(cfg) {
  if (!cfg.starboard_emoji_customized) {
    return {
      display: STAR_EMOJI_DEFAULT,
      reactValue: STAR_EMOJI_ID_DEFAULT
    };
  }
  if (cfg.starboard_emoji_id) {
    return {
      display: cfg.starboard_emoji_raw || STAR_EMOJI_DEFAULT,
      reactValue: cfg.starboard_emoji_id
    };
  }
  if (cfg.starboard_emoji_raw) {
    return {
      display: cfg.starboard_emoji_raw,
      reactValue: cfg.starboard_emoji_raw
    };
  }
  return {
    display: STAR_EMOJI_DEFAULT,
    reactValue: STAR_EMOJI_ID_DEFAULT
  };
}
const PANEL_BANNER_PATH = path.join(__dirname, 'assets', 'standard.gif');
const client = createClient();

function truncate(text, maxLength = 1000) {
  if (text == null) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}
function compress_image(inputPath, outputPath = null, maxSizeMb = 8, quality = 85) {
  return outputPath || inputPath;
}
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const CONFIG_FILE = FILES.CONFIG;
const WARNS_FILE = FILES.WARNS;
const MUTE_DATA_FILE = FILES.MUTE;
const BAN_DATA_FILE = FILES.BAN;
const STARBOARD_FILE = FILES.STARBOARD;
const BIRTHDAYS_FILE = FILES.BIRTHDAYS;
const YT_NOTIFS_FILE = FILES.YT;
const BLOG_NOTIFS_FILE = FILES.BLOG;
const MEDAL_NOTIFS_FILE = FILES.MEDAL;
const XP_FILE = FILES.XP;
const REMINDERS_FILE = FILES.REMINDERS;
const EVENTS_FILE = FILES.EVENTS;
const REACTION_ROLES_FILE = FILES.REACTION_ROLES;
const POLLS_FILE = FILES.POLLS;
const GIVEAWAYS_FILE = FILES.GIVEAWAYS;
const HACKED_DETECTION_FILE = FILES.HACKED;
const TEMP_ROLES_FILE = FILES.TEMP_ROLES;
const AUTORESPONSE_FILE = FILES.AUTORESPONSE;
const TICKET_FORMS_FILE = FILES.TICKET_FORMS;
const PREMIUM_FILE = FILES.PREMIUM;
const AUTO_TRANSLATE_FILE = FILES.AUTO_TRANSLATE;
const WELCOME_IMAGES_DIR = 'welcome_images';
if (!fs.existsSync(WELCOME_IMAGES_DIR)) {
  fs.mkdirSync(WELCOME_IMAGES_DIR, {
    recursive: true
  });
}
function load_data(filePath, defaultValue = {}) {
  return loadData(filePath, defaultValue);
}
function save_data(filePath, data) {
  saveData(filePath, data);
}
const config = load_data(CONFIG_FILE);
const warns = load_data(WARNS_FILE);
const mute_data = load_data(MUTE_DATA_FILE);
const ban_data = load_data(BAN_DATA_FILE);
const starboard = load_data(STARBOARD_FILE);
const birthdays = load_data(BIRTHDAYS_FILE);
const yt_notifs = load_data(YT_NOTIFS_FILE);
const blog_notifs = load_data(BLOG_NOTIFS_FILE);
const medal_notifs = load_data(MEDAL_NOTIFS_FILE);
const xp_data = load_data(XP_FILE);
const reminders_data = load_data(REMINDERS_FILE, {
  reminders: []
});
const events_data = load_data(EVENTS_FILE, {
  events: []
});
const polls_data = load_data(POLLS_FILE, {});
const giveaways_data = load_data(GIVEAWAYS_FILE, {});
const reaction_roles = load_data(REACTION_ROLES_FILE);
const hacked_detection_data = load_data(HACKED_DETECTION_FILE);
const temp_roles_data = load_data(TEMP_ROLES_FILE);
const autoresponses_data = load_data(AUTORESPONSE_FILE);
const ticket_forms_data = load_data(TICKET_FORMS_FILE);
const auto_translate_data = load_data(AUTO_TRANSLATE_FILE);
const premium_data = load_data(PREMIUM_FILE, {
  users: {}
});
const HACKED_SPAM_CACHE = {};
const HACKED_DM_CACHE = {};
const HACKED_LINK_CACHE = {};
const TRANSLATIONS = {
  fr: {
    error_generic: '❌ Une erreur s\u2019est produite.',
    config_saved: '✅ Configuration sauvegardée.',
    reminder_set: '⏰ Rappel défini.',
    request_error: '❌ Impossible d\u2019effectuer cette action.'
  },
  en: {
    error_generic: '❌ An error occurred.',
    config_saved: '✅ Configuration saved.',
    reminder_set: '⏰ Reminder set.',
    request_error: '❌ Unable to complete this action.'
  }
};
async function premium_anti_raid(member, guild, hackedScore, target = null) {
  if (isPremium(member.id)) hackedScore *= 0.5;
  if (target && isPremium(target.id)) {
    for (const channel of guild.channels.cache.values()) {
      try {
        await channel.permissionOverwrites.edit(guild.id, {
          SendMessages: false
        });
      } catch { }
    }
  }
  return hackedScore;
}
async function safeReply(interaction, message, options = {}) {
  const payload = {
    content: message,
    ...options
  };
  if (interaction.deferred) {
    return interaction.editReply(payload);
  }
  if (interaction.replied) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}
client.config = config;
client.warns = warns;
client.mute_data = mute_data;
client.ban_data = ban_data;
client.starboard = starboard;
client.birthdays = birthdays;
client.yt_notifs = yt_notifs;
client.blog_notifs = blog_notifs;
client.medal_notifs = medal_notifs;
client.xp_data = xp_data;
client.reminders_data = reminders_data;
client.events_data = events_data;
client.polls_data = polls_data;
client.giveaways_data = giveaways_data;
client.reaction_roles = reaction_roles;
client.hacked_detection_data = hacked_detection_data;
client.temp_roles_data = temp_roles_data;
client.autoresponses_data = autoresponses_data;
client.ticket_forms_data = ticket_forms_data;
client.auto_translate_data = auto_translate_data;
client.premium_data = premium_data;
client.owner_ids = OWNER_IDS;
client.prefix = PREFIX;
client.startTime = new Date();
client.truncate = truncate;
client.compress_image = compress_image;
client.premium_anti_raid = premium_anti_raid;
client.HACKED_SPAM_CACHE = HACKED_SPAM_CACHE;
client.HACKED_DM_CACHE = HACKED_DM_CACHE;
client.HACKED_LINK_CACHE = HACKED_LINK_CACHE;
client.TRANSLATIONS = TRANSLATIONS;
client.RAPIDAPI_KEY = RAPIDAPI_KEY;
client.BOT_OWNER_ID = BOT_OWNER_ID;
client.STAR_THRESHOLD = STAR_THRESHOLD;
client.load_data = load_data;
client.save_data = save_data;
client.prefixCommands = {
  broadcast,
  deletedm: deleteDm,
  dm,
  pub,
  ...automodPrefixCommands,
  ...extendedPrefixCommands
};
let statusIndex = 0;
function getStatuses(client) {
  const totalMembers = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
  return [{
    name: '!help pour voir les commande !',
    type: 0
  }, {
    name: 'Version 5.5.1 ⚙️',
    type: 0
  }];
}
function startStatusRotation(client) {
  setInterval(() => {
    if (!client.isReady()) return;
    try {
      const statuses = getStatuses(client);
      const current = statuses[statusIndex];
      client.user.setPresence({
        status: 'online',
        activities: [{
          name: current.name,
          type: current.type
        }]
      });
      statusIndex = (statusIndex + 1) % statuses.length;
    } catch (e) {
      console.warn('change_status ignoré :', e.message);
    }
  }, 10000);
}

// ────────────────────────────────────────────────
// Carte verte StarBoard (photo en fond) pour le système « photo ».
// Renvoie un AttachmentBuilder, ou null si la génération échoue
// (l'appelant retombe alors sur l'ancien embed).
// ────────────────────────────────────────────────
async function buildPhotoStarCard(message, count) {
  try {
    // Photo : pièce jointe image (type MIME ou extension), sinon image d'un embed
    const img = message.attachments.find(a => (a.contentType && a.contentType.startsWith('image/')) || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a.name || a.url || ''))
      || null;
    const embedImg = !img ? (message.embeds || []).map(e => e.image?.url || e.thumbnail?.url).find(Boolean) : null;
    const buffer = await generateStarboardCard({
      guildId: message.guild?.id,
      author: message.member?.displayName || message.author?.globalName || message.author?.username || 'Inconnu',
      score: count,
      threshold: Number(STAR_THRESHOLD) || 5,
      content: (message.cleanContent || '').replace(/<a?:(\w+):\d+>/g, ':$1:').trim(),
      imageUrl: img ? img.url : (embedImg || null),
      footer: `${client.user.username} · StarBoard`
    });
    return new AttachmentBuilder(buffer, {
      name: `starboard_${message.id}_${count}.png`
    });
  } catch (e) {
    console.error('Erreur génération carte StarBoard :', e.message);
    return null;
  }
}
async function updateStarboardCount(reaction) {
  try {
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }
    let message = reaction.message;
    if (message.partial) {
      try {
        message = await message.fetch();
      } catch {
        return;
      }
    }
    if (!message.guild) return;
    const gcfgStar = getGuildConfig(message.guild.id);
    const starEmoji = getStarboardEmoji(gcfgStar);
    const matchesEmoji = starEmoji.reactValue === reaction.emoji.id || !reaction.emoji.id && reaction.emoji.name === starEmoji.reactValue;
    if (!matchesEmoji) return;
    if (message.channel.id !== gcfgStar.photo_channel_id) return;
    const repostId = store.starboard[message.id];
    if (!repostId) return;
    const repostChannel = gcfgStar.repost_channel_id ? message.guild.channels.cache.get(gcfgStar.repost_channel_id) : null;
    if (!repostChannel) return;
    const starReaction = message.reactions.cache.find(r => starEmoji.reactValue === r.emoji.id || !r.emoji.id && r.emoji.name === starEmoji.reactValue);
    const count = starReaction ? starReaction.count : 0;
    const repostMsg = await repostChannel.messages.fetch(repostId).catch(() => null);
    if (!repostMsg) return;

    // Nouvelle carte verte (remplace aussi les anciens posts à embed)
    const card = await buildPhotoStarCard(message, count);
    if (card) {
      const linkRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Message original').setStyle(ButtonStyle.Link).setURL(message.url));
      await repostMsg.edit({
        embeds: [],
        files: [card],
        attachments: [],
        components: [linkRow]
      });
      return;
    }

    // Secours : ancien système (mise à jour du champ Score de l'embed)
    if (!repostMsg.embeds[0]) return;
    const newEmbed = EmbedBuilder.from(repostMsg.embeds[0]);
    const fields = repostMsg.embeds[0].fields.map(f => f.name === 'Score' ? {
      name: 'Score',
      value: `${starEmoji.display} **${count}**`,
      inline: true
    } : f);
    newEmbed.setFields(fields);
    await repostMsg.edit({
      embeds: [newEmbed]
    });
  } catch (e) {
    console.error('Erreur maj starboard:', e.message);
  }
}
client.once('clientReady', async () => {
  console.log('══════════════════════════════════════════════');
  console.log(`CoreLab connecté : ${client.user.tag} | ${client.guilds.cache.size} serveurs`);
  try { await require('./src/core/cardTheme').initRemote(client); } catch (e) { console.error('[cardTheme] init:', e.message); }
  try {
    await registerCommands(client);
  } catch (e) {
    console.error('❌ Erreur sync commandes:', e.message);
  }
  startTasks(client);
  startEventLoop(client);
  try { require('./src/core/dashboardServer').start(client); } catch (e) { console.error('❌ Dashboard:', e.message); }
  startCombat();
  startMarche(client);
  startStatusRotation(client);
  synchroniserPseudosAuDemarrage(client);
  synchroniserRoleAuDemarrage(client);
  rehydrateIaSessions(client);
  try { require('./src/handlers/updateNotifier').notifyUpdate(client).catch(e => console.error('❌ Annonce de mise à jour:', e.message)); } catch (e) { console.error('❌ Annonce de mise à jour:', e.message); }
  console.log('══════════════════════════════════════════════');
});
client.on('interactionCreate', async interaction => {
  // Les commandes sont enregistrées sous leur nom anglais : on remet ici les noms internes
  // (commande / groupe / sous-commande) avant tout dispatch, pour que les handlers restent inchangés.
  if (interaction.isChatInputCommand() || interaction.isAutocomplete()) normalizeCommandInteraction(interaction);
  // Autocomplétion générique : toute commande qui exporte `autocomplete` (ex. /market)
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (cmd?.autocomplete) {
      try {
        await cmd.autocomplete(interaction);
      } catch (e) {
        if (e?.code !== 10062) console.error(`[Autocomplete] /${interaction.commandName} :`, e.message);
      }
    }
    return;
  }
  if (interaction.isChatInputCommand()) {
    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;
    try {
      const allowed = await checkSlashPermissions(interaction);
      if (!allowed) return;
      const isPremiumCommand = cmd.data?.description?.includes('Premium');
      if (isPremiumCommand && !isPremium(interaction.user.id)) {
        return await interaction.reply(buildPremiumMessage());
      }

      // Filet de sécurité : si la commande n'a rien répondu au bout de 2s
      // (réseau lent, DNS, API externe qui traîne...), on defer automatiquement
      // pour éviter le "Unknown interaction" (10062) causé par un token expiré.
      const autoDeferTimer = setTimeout(() => {
        if (!interaction.deferred && !interaction.replied) {
          interaction.deferReply({
            flags: MessageFlags.Ephemeral
          }).catch(() => { });
        }
      }, 2000);
      try {
        await cmd.execute(interaction, client);
      } finally {
        clearTimeout(autoDeferTimer);
      }
    } catch (e) {
      if (e?.code === 10062) {
        console.error(`[interactionCreate] Interaction expirée pour /${interaction.commandName} (réseau lent probablement).`);
      } else {
        console.error(e);
      }
    }
    return;
  }
  if (interaction.isButton() || interaction.isChannelSelectMenu() || interaction.isModalSubmit() || interaction.isRoleSelectMenu() || interaction.isStringSelectMenu() || interaction.isMentionableSelectMenu()) {
    const id = interaction.customId || '';
    if (id.startsWith('mkt_')) {
      return routeMarcheInteraction(interaction);
    }
    if (id.startsWith('agenda_')) {
      return routeAgendaInteraction(interaction).catch(e => console.error('[Agenda] interaction :', e));
    }
    if (id.startsWith('evt_')) {
      return handleEventButton(interaction).catch(e => console.error('[Event] bouton :', e));
    }
    if (id.startsWith('ticket_')) {
      return routeTicketInteraction(interaction);
    }
    if (id.startsWith('partner_')) {
      return routePartnershipInteraction(interaction);
    }
    if (id.startsWith('protect_')) {
      return routeProtectionInteraction(interaction);
    }
    if (id.startsWith('ia_')) {
      return routeIaInteraction(interaction);
    }
    if (id.startsWith('starboard_')) {
      return routeStarboardInteraction(interaction);
    }
    if (id.startsWith('broadcast_')) {
      return routeBroadcastInteraction(interaction);
    }
    if (id.startsWith('dm_')) {
      return routeDmInteraction(interaction);
    }
    if (id.startsWith('bcembed::')) {
      return routeBroadcastEmbedInteraction(interaction);
    }
    if (id.startsWith('vote_')) {
      return routeVoteInteraction(interaction);
    }
    if (id.startsWith('settings_trans_') || id.startsWith('settings_ar_')) {
      return routeSettingsInteraction(interaction);
    }
    if (id === 'reglement_role_select' || id.startsWith('reglement_rules_modal_') || id === 'accept_rules_global') {
      return routeReglementInteraction(interaction);
    }
    if (id.startsWith('embedm::')) {
      return routeEmbedInteraction(interaction);
    }
    if (id.startsWith('mp_desabonner')) {
      return routeMpUnsubscribeInteraction(interaction);
    }
  }
  if (interaction.isButton() && interaction.customId.startsWith('rolebtn_')) {
    const {
      getGuildBucket,
      setGuildBucket
    } = require('./src/core/data');
    const id = interaction.customId.split('_')[1];
    const bucket = getGuildBucket(interaction.guild.id, 'buttonRoles', []);
    const entry = bucket.find(e => e.id === id);
    if (!entry) {
      return interaction.reply({
        content: '❌ Bouton introuvable.',
        ephemeral: true
      });
    }
    const role = interaction.guild.roles.cache.get(entry.roleId);
    if (!role) {
      return interaction.reply({
        content: '❌ Rôle introuvable.',
        ephemeral: true
      });
    }
    const member = interaction.member;
    try {
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
        return interaction.reply({
          content: `🗑️ Rôle retiré : ${role.name}`,
          ephemeral: true
        });
      } else {
        await member.roles.add(role);
        return interaction.reply({
          content: `✅ Rôle ajouté : ${role.name}`,
          ephemeral: true
        });
      }
    } catch (err) {
      console.error('Erreur rôle bouton:', err);
      return interaction.reply({
        content: '❌ Impossible de modifier les rôles.',
        ephemeral: true
      });
    }
  }
  if (interaction.isButton() && (interaction.customId.startsWith('botleave_confirm_') || interaction.customId === 'botleave_cancel')) {
    if (interaction.user.id !== BOT_OWNER_ID) {
      return interaction.reply({
        content: '❌ Action réservée au propriétaire du bot.',
        flags: MessageFlags.Ephemeral
      }).catch(() => { });
    }
    if (interaction.customId === 'botleave_cancel') {
      return interaction.update({
        content: '❌ Annulé.',
        components: []
      }).catch(() => { });
    }
    const guildId = interaction.customId.replace('botleave_confirm_', '');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return interaction.update({
        content: '❌ Serveur introuvable (peut-être déjà quitté).',
        components: []
      }).catch(() => { });
    }
    const guildName = guild.name;
    try {
      await guild.leave();
      await interaction.update({
        content: `✅ CoreLab a quitté **${guildName}**.`,
        components: []
      });
    } catch (e) {
      console.error('Erreur en quittant le serveur:', e.message);
      await interaction.update({
        content: `❌ Impossible de quitter **${guildName}** : ${e.message}`,
        components: []
      }).catch(() => { });
    }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('botadd_stats_')) {
    const guildId = interaction.customId.replace('botadd_stats_', '');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return interaction.reply({
        content: '❌ Serveur introuvable (le bot l\'a peut-être déjà quitté).',
        flags: MessageFlags.Ephemeral
      }).catch(() => { });
    }
    const owner = await guild.fetchOwner().catch(() => null);
    const canal = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
    const vocaux = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;
    const estBlackliste = !!(store.blacklistServeurs && store.blacklistServeurs[guild.id]);
    const embed = new EmbedBuilder().setTitle(`📊 Statistiques — ${guild.name}`).setThumbnail(guild.iconURL() ?? null).setColor(0xFFFFFF).addFields({
      name: '🆔 ID',
      value: `\`${guild.id}\``,
      inline: true
    }, {
      name: '👑 Propriétaire',
      value: owner ? `**${owner.user.tag}**\nID: \`${owner.id}\`` : 'Inconnu',
      inline: true
    }, {
      name: '👥 Membres',
      value: `\`${guild.memberCount}\``,
      inline: true
    }, {
      name: '🚀 Niveau de boost',
      value: `\`${guild.premiumTier ?? 0}\` (${guild.premiumSubscriptionCount ?? 0} boosts)`,
      inline: true
    }, {
      name: '💬 Salons textuels',
      value: `\`${canal}\``,
      inline: true
    }, {
      name: '🔊 Salons vocaux',
      value: `\`${vocaux}\``,
      inline: true
    }, {
      name: '📅 Créé le',
      value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
      inline: true
    }, {
      name: '⛔ Blacklist',
      value: estBlackliste ? '✅ Oui' : '❌ Non',
      inline: true
    }).setFooter({
      text: `Total de serveurs du bot : ${client.guilds.cache.size}`
    });
    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    }).catch(() => { });
  }
  if (interaction.isButton() && interaction.customId.startsWith('botadd_blacklist_') && !interaction.customId.includes('_confirm_') && interaction.customId !== 'botadd_blacklist_cancel') {
    if (interaction.user.id !== BOT_OWNER_ID) {
      return interaction.reply({
        content: '❌ Action réservée au propriétaire du bot.',
        flags: MessageFlags.Ephemeral
      }).catch(() => { });
    }
    const guildId = interaction.customId.replace('botadd_blacklist_', '');
    const guild = client.guilds.cache.get(guildId);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`botadd_blacklist_confirm_${guildId}`).setLabel('Confirmer').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('botadd_blacklist_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary));
    const embed = new EmbedBuilder().setTitle('⚠️ Confirmation requise').setDescription(`CoreLab va **quitter** ${guild ? `**${guild.name}**` : `\`${guildId}\``} et blacklister ce serveur **ainsi que son propriétaire** (et l'inviteur si identifiable) : ces personnes ne pourront plus réinviter le bot sur **aucun** serveur.\nConfirmez-vous ?`).setColor(0xE74C3C);
    return interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral
    }).catch(() => { });
  }
  if (interaction.isButton() && interaction.customId === 'botadd_blacklist_cancel') {
    return interaction.update({
      content: '❌ Annulé.',
      components: []
    }).catch(() => { });
  }
  if (interaction.isButton() && interaction.customId.startsWith('botadd_blacklist_confirm_')) {
    if (interaction.user.id !== BOT_OWNER_ID) {
      return interaction.reply({
        content: '❌ Action réservée au propriétaire du bot.',
        flags: MessageFlags.Ephemeral
      }).catch(() => { });
    }
    const guildId = interaction.customId.replace('botadd_blacklist_confirm_', '');
    const guild = client.guilds.cache.get(guildId);
    const guildName = guild?.name ?? guildId;

    // Récupération du propriétaire et de l'inviteur (journal d'audit), pour
    // les blacklister eux aussi : ils ne pourront plus réinviter le bot
    // sur AUCUN serveur, pas seulement celui-ci.
    const utilisateursABlacklister = [];
    if (guild) {
      const owner = await guild.fetchOwner().catch(() => null);
      if (owner) utilisateursABlacklister.push({
        id: owner.id,
        tag: owner.user.tag,
        role: 'propriétaire',
        user: owner.user
      });
      try {
        const auditLogs = await guild.fetchAuditLogs({
          type: AuditLogEvent.BotAdd,
          limit: 5
        });
        const entry = auditLogs.entries.find(e => e.target?.id === client.user.id);
        const inviter = entry?.executor ?? null;
        if (inviter && !utilisateursABlacklister.some(u => u.id === inviter.id)) {
          utilisateursABlacklister.push({
            id: inviter.id,
            tag: inviter.tag,
            role: 'inviteur',
            user: inviter
          });
        }
      } catch (e) {
        console.warn(`Impossible de lire le journal d'audit pour ${guildName} (blacklist utilisateur) :`, e.message);
      }
    }

    // Notifie chaque utilisateur blacklisté par MP.
    for (const u of utilisateursABlacklister) {
      await notifierUtilisateurBlackliste(u.user, guildName);
    }
    if (!store.blacklistServeurs) store.blacklistServeurs = {};
    store.blacklistServeurs[guildId] = {
      name: guildName,
      by: interaction.user.id,
      at: new Date().toISOString()
    };
    persist('blacklistServeurs');
    if (!store.blacklistUtilisateurs) store.blacklistUtilisateurs = {};
    for (const u of utilisateursABlacklister) {
      store.blacklistUtilisateurs[u.id] = {
        tag: u.tag,
        role: u.role,
        fromGuild: guildId,
        fromGuildName: guildName,
        by: interaction.user.id,
        at: new Date().toISOString()
      };
    }
    if (utilisateursABlacklister.length) persist('blacklistUtilisateurs');
    const utilisateursTexte = utilisateursABlacklister.length ? `\n👤 Utilisateur(s) blacklisté(s) : ${utilisateursABlacklister.map(u => `**${u.tag}** (${u.role})`).join(', ')}` : '';
    try {
      if (guild) await guild.leave();
      await interaction.update({
        content: `⛔ **${guildName}** a été blacklisté et CoreLab a quitté ce serveur.${utilisateursTexte}`,
        components: []
      });
    } catch (e) {
      console.error('Erreur en quittant le serveur blacklisté :', e.message);
      await interaction.update({
        content: `⛔ **${guildName}** a été blacklisté (mais le bot n'a pas pu quitter automatiquement : ${e.message}).${utilisateursTexte}`,
        components: []
      }).catch(() => { });
    }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('botadd_whitelist_')) {
    if (interaction.user.id !== BOT_OWNER_ID) {
      return interaction.reply({
        content: '❌ Action réservée au propriétaire du bot.',
        flags: MessageFlags.Ephemeral
      }).catch(() => { });
    }
    const guildId = interaction.customId.replace('botadd_whitelist_', '');
    const guildName = store.blacklistServeurs?.[guildId]?.name ?? client.guilds.cache.get(guildId)?.name ?? guildId;
    const etaitBlackliste = !!(store.blacklistServeurs && store.blacklistServeurs[guildId]);
    if (etaitBlackliste) {
      delete store.blacklistServeurs[guildId];
      persist('blacklistServeurs');
    }

    // Retire également tous les utilisateurs blacklistés à cause de ce serveur
    // (propriétaire / inviteur), pour bien "remettre par défaut".
    const utilisateursRetires = [];
    if (store.blacklistUtilisateurs) {
      for (const [uid, data] of Object.entries(store.blacklistUtilisateurs)) {
        if (data.fromGuild === guildId) {
          utilisateursRetires.push(data.tag ?? uid);
          delete store.blacklistUtilisateurs[uid];
        }
      }
      if (utilisateursRetires.length) persist('blacklistUtilisateurs');
    }
    const utilisateursTexte = utilisateursRetires.length ? `\n👤 Utilisateur(s) retiré(s) de la blacklist : ${utilisateursRetires.map(t => `**${t}**`).join(', ')}` : '';
    return interaction.reply({
      content: etaitBlackliste ? `✅ **${guildName}** a été whitelisté (retiré de la blacklist, remis par défaut).${utilisateursTexte}` : `ℹ️ **${guildName}** n'était pas blacklisté, rien à faire.`,
      flags: MessageFlags.Ephemeral
    }).catch(() => { });
  }
  if (interaction.isButton() && interaction.customId.startsWith('concours_join_')) {
    const giveawayId = interaction.customId.replace('concours_join_', '');
    const bucket = getGuildBucket(interaction.guild.id, 'giveaways', []);
    const entry = bucket.find(g => g.id === giveawayId);
    if (!entry || !entry.active) return interaction.reply({
      content: '❌ Ce giveaway est terminé.',
      flags: MessageFlags.Ephemeral
    });
    if (entry.roleId && !interaction.member.roles.cache.has(entry.roleId)) {
      return interaction.reply({
        content: `❌ Tu dois avoir le rôle <@&${entry.roleId}> pour participer.`,
        flags: MessageFlags.Ephemeral
      });
    }
    if (entry.participants.includes(interaction.user.id)) {
      entry.participants = entry.participants.filter(id => id !== interaction.user.id);
      setGuildBucket(interaction.guild.id, 'giveaways', bucket);
      return interaction.reply({
        content: '➖ Tu ne participes plus.',
        flags: MessageFlags.Ephemeral
      });
    }
    entry.participants.push(interaction.user.id);
    setGuildBucket(interaction.guild.id, 'giveaways', bucket);
    return interaction.reply({
      content: '✅ Tu participes au giveaway !',
      flags: MessageFlags.Ephemeral
    });
  }
});
client.on('messageReactionAdd', (reaction, user) => {
  if (user.bot) return;
  updateStarboardCount(reaction);
  handleRulesReaction(reaction, user);
});
client.on('messageReactionRemove', (reaction, user) => {
  if (user.bot) return;
  updateStarboardCount(reaction);
});
client.on('messageCreate', async message => {
  console.log(`[MSG REÇU] "${message.content}" de ${message.author.tag}`);
  if (message.author.bot) return;
  if (!message.guild) {
    if (message.author.id !== BOT_OWNER_ID) {
      try {
        const owner = await client.users.fetch(BOT_OWNER_ID);
        await owner.send(`📩 **${message.author.tag}** (${message.author.id}) t'a envoyé un DM :\n${message.content || '*[sans texte]*'}`);
      } catch (e) {
        console.error('Erreur notif DM owner:', e.message);
      }
    }
    if (message.content.startsWith(client.prefix)) {
      const name = message.content.slice(client.prefix.length).trim().split(/\s+/)[0].toLowerCase();
      const handler = client.prefixCommands?.[name];
      if (handler) {
        try {
          await handler(message, client);
        } catch (e) {
          console.error(`[DM] Erreur commande DM ${name}:`, e);
        }
      }
    }
    return;
  }
  const isRealMention = message.content.includes(`<@${client.user.id}>`) || message.content.includes(`<@!${client.user.id}>`);
  if (isRealMention && !message.mentions.everyone) {
    const latency = Math.round(client.ws.ping);
    const uptime = client.uptime;
    const hours = Math.floor(uptime / 3600000);
    const minutes = Math.floor(uptime % 3600000 / 60000);
    const seconds = Math.floor(uptime % 60000 / 1000);
    const uptimeStr = hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
    const totalCommands = client.commands?.size || 0;
    const panelBanner = new AttachmentBuilder(PANEL_BANNER_PATH, {
      name: 'standard.gif'
    });
    const embed = new EmbedBuilder().setColor(0xFFFFFF).setAuthor({
      name: "CoreLab",
      iconURL: client.user.displayAvatarURL()
    }).setThumbnail(client.user.displayAvatarURL()).setImage('attachment://standard.gif').addFields({
      name: "┃ Bienvenue sur le panneau de contrôle",
      value: "*Système de gestion Discord avancé — en ligne et opérationnel.*",
      inline: false
    }, {
      name: "🔸 ÉTAT DU SYSTÈME",
      value: `• En ligne  •  Latence **${latency}ms**  •  Disponibilité **${uptimeStr}**`,
      inline: false
    }, {
      name: "🖥️ Serveurs actifs",
      value: `\`\`\`${client.guilds.cache.size} serveurs\`\`\``,
      inline: true
    }, {
      name: "⚙️ Commandes",
      value: `\`\`\`${totalCommands} disponibles\`\`\``,
      inline: true
    }, {
      name: "🏷️ Serveur actuel",
      value: `\`\`\`${message.guild.name}\n[${message.guild.id}]\`\`\``,
      inline: false
    }).setFooter({
      text: `CoreLab • Panneau principal • Aujourd'hui à ${new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
      })}`,
      iconURL: client.user.displayAvatarURL()
    });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Liens').setEmoji('🔗').setStyle(5).setURL(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`));
    return await message.channel.send({
      embeds: [embed],
      components: [row],
      files: [panelBanner]
    });
  }

  // ────────────────────────────────────────────────
  // Traduction personnalisée par utilisateur (/traduction)
  // Chaque membre choisit sa propre langue cible ; tout message écrit
  // dans une autre langue est traduit publiquement pour lui — y compris
  // ses propres messages s'ils ne sont pas déjà dans sa langue cible.
  // Respecte la portée choisie (un salon précis ou tout le serveur).
  // Indépendant du système admin ci-dessous (les deux tournent en parallèle).
  // ────────────────────────────────────────────────
  // cfgGuild vient désormais de getGuildConfig() (et non plus d'une lecture
  // brute sur store.config[id]) : getGuildConfig() garantit que
  // translation_enabled / translation_scope / translation_channel_id /
  // translation_target_lang existent toujours avec une valeur par défaut
  // explicite (false / null / null / 'fr'). Avant ce correctif, ces clés
  // pouvaient rester "undefined" sur une guilde déjà configurée avant
  // l'ajout du système de traduction, ce qui rendait la désactivation
  // via /settings incohérente selon les endroits du code.
  const cfgGuild = getGuildConfig(message.guild.id);
  const traductionDesactiveeParAdmin = cfgGuild.translation_enabled === false;
  const prefsTraductionPerso = getGuildBucket(message.guild.id, 'userTranslationPrefs', {});
  const preferencesActives = Object.entries(prefsTraductionPerso).filter(([, pref]) => {
    if (!pref?.code) return false;
    if (pref.scope === 'channel') return pref.channelId === message.channel.id;
    return true; // portée "server" (ou anciennes préférences sans portée définie)
  });
  if (!traductionDesactiveeParAdmin && preferencesActives.length && message.content && message.content.trim().length > 0) {
    // Regroupe par langue cible distincte pour ne traduire qu'une fois par langue,
    // même si plusieurs membres ont choisi la même cible.
    // DeepL détecte lui-même la langue source (pas besoin de sonde séparée).
    const languesCibles = new Set(preferencesActives.map(([, pref]) => pref.code).filter(Boolean));
    for (const codeCible of languesCibles) {
      try {
        const resultat = await traduireDeepL(message.content, codeCible);
        // On nettoie les retours à la ligne parasites que DeepL peut ajouter
        // en début/fin de traduction (et on réduit les sauts de ligne multiples internes).
        const texteTraduit = (resultat.text || '').trim().replace(/\n{2,}/g, '\n');
        // On ignore si : pas de texte, texte déjà dans la langue cible (DeepL l'a détecté comme source),
        // ou traduction identique au message d'origine.
        if (!texteTraduit || memeLangue(resultat.detectedSourceLang, codeCible) || texteTraduit.toLowerCase() === message.content.toLowerCase()) continue;
        const nomAuteur = message.member?.displayName || message.author.username;
        await message.channel.send(`🌐 **Traduction** (${libelleLangue(codeCible)})\n${texteTraduit}\n*Message original de ${nomAuteur}*`);
      } catch (erreur) {
        console.error(`Erreur traduction personnalisée (${codeCible}):`, erreur.message);
      }
    }
  }

  // ── Traduction automatique admin ──
  // Test strict === true : cfgGuild vient toujours de getGuildConfig(),
  // donc translation_enabled est garanti initialisé (plus de undefined fantôme).
  if (cfgGuild.translation_enabled === true && message.content) {
    const scope = cfgGuild.translation_scope;
    const inScope = scope === 'server' || scope === 'channel' && cfgGuild.translation_channel_id === message.channel.id;
    if (inScope) {
      try {
        let target;
        let resultat;
        if (cfgGuild.translation_omnidirectional === true) {
          // Mode omnidirectionnel : tout ce qui n'est pas en français part vers le français.
          // On traduit d'abord vers 'fr' (DeepL détecte la langue source au passage) ;
          // si la source détectée est déjà le français, on retraduit vers la langue
          // "non-francophones" configurée (translation_target_lang), sinon le résultat FR suffit.
          const secondaire = cfgGuild.translation_target_lang || 'en';
          resultat = await traduireDeepL(message.content, 'fr');
          if (memeLangue(resultat.detectedSourceLang, 'fr')) {
            target = secondaire;
            resultat = await traduireDeepL(message.content, secondaire, 'fr');
          } else {
            target = 'fr';
          }
        } else {
          target = cfgGuild.translation_target_lang || 'fr';
          resultat = await traduireDeepL(message.content, target);
        }
        const texteTraduit = (resultat.text || '').trim().replace(/\n{2,}/g, '\n');

        // On ignore si le message est déjà dans la langue cible, ou si la traduction
        // est identique au texte d'origine (rien à afficher dans ces cas).
        if (texteTraduit && !memeLangue(resultat.detectedSourceLang, target) && texteTraduit.toLowerCase() !== message.content.toLowerCase()) {
          const nomAuteur = message.member?.displayName || message.author.username;
          await message.channel.send(`🌐 **Traduction** (${libelleLangue(target)})\n${texteTraduit}\n*Message original de ${nomAuteur}*`);
        }
      } catch (e) {
        console.error('Erreur traduction:', e.message);
      }
      return;
    }
  }
  const gcfgStar = getGuildConfig(message.guild.id);
  if (gcfgStar.photo_channel_id === message.channel.id && message.attachments.size > 0) {
    try {
      const starEmoji = getStarboardEmoji(gcfgStar);
      await message.react(starEmoji.reactValue);
      const repostChannel = gcfgStar.repost_channel_id ? message.guild.channels.cache.get(gcfgStar.repost_channel_id) : null;
      if (repostChannel) {
        const firstAttachment = message.attachments.first();
        const nomAuteur = message.member?.displayName || message.author.username;
        const content = `${starEmoji.display} **Nouvelle photo de ${nomAuteur} !**`;
        const linkRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Message original').setStyle(ButtonStyle.Link).setURL(message.url));

        // Carte verte StarBoard (photo en fond) à la place de l'embed
        const card = await buildPhotoStarCard(message, 1);
        let sent;
        if (card) {
          sent = await repostChannel.send({
            content,
            files: [card],
            components: [linkRow],
            allowedMentions: {
              parse: []
            }
          });
        } else {
          // Secours : ancien embed si la carte n'a pas pu être générée
          const emb = new EmbedBuilder()
            .setColor(0xFFFFFF)
            .setAuthor({ name: nomAuteur, iconURL: message.author.displayAvatarURL({ size: 128 }) })
            .setTitle(`${starEmoji.display}  StarBoard`)
            .addFields(
              { name: '👤  Auteur', value: `<@${message.author.id}>`, inline: true },
              { name: 'Score', value: `${starEmoji.display} **1**`, inline: true },
              { name: '🔗  Message original', value: `[Cliquer ici →](${message.url})`, inline: false },
            )
            .setImage(firstAttachment.url)
            .setFooter({ text: `CoreLab • StarBoard`, iconURL: client.user.displayAvatarURL() })
            .setTimestamp(message.createdAt);
          sent = await repostChannel.send({
            content,
            embeds: [emb]
          });
        }
        store.starboard[message.id] = sent.id;
        persist('starboard');
      }
    } catch (e) {
      console.error('Starboard erreur:', e.message);
    }
  }
  const arBucket = store.autoresponses && store.autoresponses[message.guild.id] || [];
  if (arBucket.length && cfgGuild?.autoresponse_enabled !== false) {
    const contentLower = message.content.toLowerCase();
    const match = arBucket.find(ar => ar && ar.keyword && contentLower.includes(ar.keyword.toLowerCase()));
    if (match) {
      try {
        await message.reply(match.response);
      } catch (e) {
        console.error('Erreur auto-réponse:', e.message);
      }
      return;
    }
  }
  if (!message.content.startsWith(client.prefix)) return;
  const name = message.content.slice(client.prefix.length).trim().split(/\s+/)[0].toLowerCase();
  const handler = client.prefixCommands?.[name];
  if (!handler) return;
  // broadcast réservé au propriétaire du bot uniquement
  if (name === 'broadcast' && message.author.id !== BOT_OWNER_ID) return;
  try {
    await handler(message, client);
  } catch (e) {
    console.error(`Erreur commande prefix ${name}:`, e);
  }
});
client.on('entitlementCreate', entitlement => {
  const skuId = String(entitlement.skuId);
  const expires = entitlement.endsAt?.toISOString?.() ?? null;
  if (skuId === PREMIUM_SKU_ID) return setPremium(entitlement.userId, true, expires);
  if (skuId === CUSTOMIZATION_SKU_ID) return setCustomization(entitlement.userId, true, expires);
  if (skuId === TOTAL_SKU_ID) return setTotal(entitlement.userId, true, expires);
});
client.on('entitlementUpdate', entitlement => {
  const skuId = String(entitlement.skuId);
  const expires = entitlement.endsAt?.toISOString?.() ?? null;
  const active = !(entitlement.endsAt && new Date() >= entitlement.endsAt);
  if (skuId === PREMIUM_SKU_ID) return setPremium(entitlement.userId, active, expires);
  if (skuId === CUSTOMIZATION_SKU_ID) return setCustomization(entitlement.userId, active, expires);
  if (skuId === TOTAL_SKU_ID) return setTotal(entitlement.userId, active, expires);
});
client.on('entitlementDelete', entitlement => {
  const skuId = String(entitlement.skuId);
  if (skuId === PREMIUM_SKU_ID) return setPremium(entitlement.userId, false);
  if (skuId === CUSTOMIZATION_SKU_ID) return setCustomization(entitlement.userId, false);
  if (skuId === TOTAL_SKU_ID) return setTotal(entitlement.userId, false);
});
const token = process.env.TOKEN || process.env.TOKEN;
if (!token) {
  console.error('⚠️ TOKEN ou TOKEN manquant dans .env');
  process.exit(1);
}
process.on('uncaughtException', err => {
  console.error('❌ Exception non gérée (le bot continue de tourner) :', err);
});

// Envoie un MP à un utilisateur pour l'informer qu'il (ou son serveur) est
// blacklisté et ne peut pas inviter CoreLab. Échoue silencieusement si les
// MP sont fermés.
async function notifierUtilisateurBlackliste(user, guildName) {
  if (!user) return;
  try {
    await user.send({
      content: `⛔ Vous avez tenté d'inviter **CoreLab** sur **${guildName}**, mais vous avez été **blacklisté par le créateur du bot**. Vous ne pouvez plus inviter CoreLab sur aucun serveur.`
    });
  } catch (e) {
    console.warn(`Impossible d'envoyer le MP de blacklist à ${user.tag ?? user.id} :`, e.message);
  }
}

// Quitte automatiquement (et en priorité, avant les logs/bienvenue) tout
// serveur figurant dans la blacklist, ou tout serveur dont le propriétaire
// ou l'inviteur du bot figure dans la blacklist utilisateurs (empêche un
// propriétaire blacklisté de réinviter le bot via un AUTRE serveur).
client.on('guildCreate', async guild => {
  if (store.blacklistServeurs && store.blacklistServeurs[guild.id]) {
    console.log(`⛔ Serveur blacklisté (${guild.name} / ${guild.id}) : le bot quitte immédiatement.`);
    const owner = await guild.fetchOwner().catch(() => null);
    if (owner) await notifierUtilisateurBlackliste(owner.user, guild.name);
    await guild.leave().catch(() => { });
    return;
  }
  if (store.blacklistUtilisateurs && Object.keys(store.blacklistUtilisateurs).length) {
    const owner = await guild.fetchOwner().catch(() => null);
    if (owner && store.blacklistUtilisateurs[owner.id]) {
      console.log(`⛔ Propriétaire blacklisté (${owner.user.tag} / ${owner.id}) sur ${guild.name} : le bot quitte immédiatement.`);
      await notifierUtilisateurBlackliste(owner.user, guild.name);
      await guild.leave().catch(() => { });
      return;
    }
    try {
      const auditLogs = await guild.fetchAuditLogs({
        type: AuditLogEvent.BotAdd,
        limit: 5
      });
      const entry = auditLogs.entries.find(e => e.target?.id === client.user.id);
      const inviter = entry?.executor ?? null;
      if (inviter && store.blacklistUtilisateurs[inviter.id]) {
        console.log(`⛔ Inviteur blacklisté (${inviter.tag} / ${inviter.id}) sur ${guild.name} : le bot quitte immédiatement.`);
        await notifierUtilisateurBlackliste(inviter, guild.name);
        await guild.leave().catch(() => { });
      }
    } catch (e) {
      console.warn(`Impossible de lire le journal d'audit pour ${guild.name} (vérif blacklist utilisateur) :`, e.message);
    }
  }
});
console.log('Lancement CoreLab (JavaScript)...');
registerLogHandlers(client);
registerWelcomeImageHandler(client);
registerWelcomeHandler(client);
registerGoodbyeHandler(client);
registerXpHandler(client);
registerProtectionHandlers(client);
registerStarboardHandlers(client);
registerAntiScamHandler(client);
registerNicknameGuardHandler(client);
registerPartnershipAutoHandler(client);
registerBotRoleHandler(client);
registerAutoRoleHandler(client);
require('./src/handlers/joinRequest').registerJoinRequestHandler(client);
registerBumpReminderHandler(client);
require('./src/commands/blacklist').registerBlacklistHandler(client);
registerAutomodOnJoinHandler(client);
registerIaMessageHandler(client);
registerHelpHandler(client);
registerCountingHandler(client);
registerCommunityHandlers(client);

// ────────────────────────────────────────────────
// DIAGNOSTIC TEMPORAIRE : à retirer une fois le souci résolu
// ────────────────────────────────────────────────
client.on('shardError', err => console.error('[SHARD ERROR]', err));
client.on('shardDisconnect', (event, id) => console.error(`[SHARD ${id}] Déconnecté :`, event));
client.on('shardReconnecting', id => console.log(`[SHARD ${id}] Reconnexion...`));

// ────────────────────────────────────────────────
// Connexion avec retry automatique en cas d'échec réseau/DNS
// ────────────────────────────────────────────────
async function connectWithRetry(client, token, maxRetries = 10) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[LOGIN] Tentative ${attempt}/${maxRetries}...`);
      await client.login(token);
      console.log('[LOGIN] ✅ Connexion réussie.');
      return;
    } catch (err) {
      console.error(`[LOGIN] ❌ Échec tentative ${attempt}: ${err.message}`);
      if (attempt === maxRetries) {
        console.error('[LOGIN] 🛑 Abandon après plusieurs tentatives. Le process va s\'arrêter (Render le relancera).');
        process.exit(1);
      }
      const delay = Math.min(5000 * attempt, 30000);
      console.log(`[LOGIN] ⏳ Nouvelle tentative dans ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
connectWithRetry(client, token);
