'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  AttachmentBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize
} = require('discord.js');
const path = require('path');
const fs = require('fs');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { themedCtx } = require('../core/cardTheme');
const { getGuildBucket, persist } = require('../core/config');
const alertsLib = require('../core/cryptoAlerts');

// ── Police (même logique que protectCard.js) ──
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
try {
  const b = path.join(FONT_DIR, 'Poppins-Bold.ttf');
  const r = path.join(FONT_DIR, 'Poppins-Regular.ttf');
  if (fs.existsSync(b) && fs.existsSync(r)) {
    GlobalFonts.registerFromPath(b, 'CryptoCardBold');
    GlobalFonts.registerFromPath(r, 'CryptoCard');
    FONT = 'CryptoCard';
    FONT_BOLD = 'CryptoCardBold';
  }
} catch { /* police système */ }

// ────────────────────────────────────────────────
// /crypto-panel — configuration des wallets crypto du serveur
// • Admin (Gérer le serveur) : ajouter / modifier / supprimer des adresses
// • Personnalisation (titre, description, couleur, footer)
// • Publication d'un embed public dans un salon (re-publier = modifier le message existant)
// Données stockées dans economyData[guildId].crypto (aucune autre modification requise)
// ⚠️ Uniquement des adresses PUBLIQUES : les clés privées / phrases secrètes sont refusées.
// ────────────────────────────────────────────────

const MAX_CUSTOM = 14; // 10 presets + 14 custom + "Autre" = 25 options max dans un select
const PANEL_TIMEOUT = 15 * 60 * 1000;
const DEFAULT_COLOR = 0xFFFFFF; // barre blanche
const DEFAULT_TITLE = '💰 Adresses crypto';
const DEFAULT_DESC = "Envoie uniquement sur le **réseau indiqué**. Vérifie toujours l'adresse avant d'envoyer : une transaction crypto est **irréversible**.";

const B58 = '1-9A-HJ-NP-Za-km-z';
const HEX40 = /^0x[a-fA-F0-9]{40}$/;

const PRESETS = {
  BTC: { tile: 'BTC', emoji: '🟠', name: 'Bitcoin', symbol: 'BTC', network: 'Bitcoin', regex: /^(bc1[a-z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/ },
  ETH: { tile: 'ETH', emoji: '🔷', name: 'Ethereum', symbol: 'ETH', network: 'ERC-20', regex: HEX40 },
  USDT_TRC20: { tile: 'USDT TRC-20', emoji: '💵', name: 'Tether', symbol: 'USDT', network: 'TRC-20 (Tron)', regex: new RegExp(`^T[${B58}]{33}$`) },
  USDT_ERC20: { tile: 'USDT ERC-20', emoji: '💵', name: 'Tether', symbol: 'USDT', network: 'ERC-20 (Ethereum)', regex: HEX40 },
  SOL: { tile: 'SOL', emoji: '🟣', name: 'Solana', symbol: 'SOL', network: 'Solana', regex: new RegExp(`^[${B58}]{32,44}$`) },
  LTC: { tile: 'LTC', emoji: '⚪', name: 'Litecoin', symbol: 'LTC', network: 'Litecoin', regex: /^(ltc1[a-z0-9]{25,87}|[LM3][a-km-zA-HJ-NP-Z1-9]{26,33})$/ },
  BNB: { tile: 'BNB BEP-20', emoji: '🟡', name: 'BNB', symbol: 'BNB', network: 'BEP-20 (BSC)', regex: HEX40 },
  XRP: { tile: 'XRP', emoji: '⚫', name: 'XRP', symbol: 'XRP', network: 'XRP Ledger', regex: new RegExp(`^r[${B58}]{24,34}$`) },
  DOGE: { tile: 'DOGE', emoji: '🐕', name: 'Dogecoin', symbol: 'DOGE', network: 'Dogecoin', regex: new RegExp(`^D[5-9A-HJ-NP-U][${B58}]{32}$`) },
  TON: { tile: 'TON', emoji: '💎', name: 'Toncoin', symbol: 'TON', network: 'TON', regex: /^(EQ|UQ)[A-Za-z0-9_-]{46}$/ }
};

// ── Données ──

function getCfg(guildId) {
  const bucket = getGuildBucket(guildId, 'economyData', { settings: {}, accounts: {} });
  if (!bucket.crypto || typeof bucket.crypto !== 'object') bucket.crypto = {};
  const c = bucket.crypto;
  if (!c.wallets || typeof c.wallets !== 'object') c.wallets = {};
  if (c.title === undefined) c.title = null;
  if (c.description === undefined) c.description = null;
  if (c.footer === undefined) c.footer = null;
  if (c.color === undefined) c.color = null;
  if (c.channelId === undefined) c.channelId = null;
  if (c.messageId === undefined) c.messageId = null;
  return c;
}

function save() { persist('economyData'); }

function metaFor(key, wallet) {
  if (PRESETS[key]) return PRESETS[key];
  return {
    emoji: '🪙',
    name: wallet?.symbol || key,
    symbol: wallet?.symbol || key,
    network: wallet?.network || '—',
    regex: null
  };
}

function customKeys(cfg) {
  return Object.keys(cfg.wallets).filter(k => !PRESETS[k]);
}

function shortAddr(addr) {
  return addr.length > 16 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
}

// Refuse tout ce qui ressemble à une clé privée / phrase secrète
function secretWarning(value) {
  const words = value.trim().split(/\s+/);
  const looksSecret =
    words.length >= 12 ||
    /^(0x)?[a-fA-F0-9]{64}$/.test(value) ||
    /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(value) ||
    /^[xyz]prv/i.test(value);
  return looksSecret
    ? '🚫 Ça ressemble à une **clé privée ou une phrase secrète**. Ne la partage jamais, nulle part. Entre uniquement ton **adresse publique** (de réception).'
    : null;
}

function parseColor(raw) {
  const v = String(raw || '').trim().replace(/^#/, '');
  if (!v) return { value: null };
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return { error: true };
  return { value: parseInt(v, 16) };
}

// ── Embeds ──

function buildPublicEmbed(cfg) {
  const embed = new EmbedBuilder()
    .setTitle((cfg.title || DEFAULT_TITLE).slice(0, 256))
    .setDescription((cfg.description || DEFAULT_DESC).slice(0, 4000))
    .setColor(cfg.color ?? DEFAULT_COLOR);

  const entries = Object.entries(cfg.wallets);
  if (!entries.length) {
    embed.addFields({ name: 'Aucun wallet', value: '*Rien de configuré pour le moment.*' });
  }
  for (const [key, w] of entries) {
    const m = metaFor(key, w);
    embed.addFields({
      name: `${m.emoji} ${m.name} (${m.symbol}) • ${m.network}`.slice(0, 256),
      value: `\`\`\`\n${w.address}\n\`\`\`${w.memo ? `\n🏷️ Memo / Tag : \`${w.memo}\`` : ''}`.slice(0, 1024)
    });
  }
  if (cfg.footer) embed.setFooter({ text: cfg.footer.slice(0, 2048) });
  return embed;
}

// ── Carte image (même style que le panneau /protect-settings) ──

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function renderCryptoCard(guildName, cfg, guildId = null) {
  const tiles = [
    ...Object.entries(PRESETS).map(([key, m]) => ({ label: m.tile, on: !!cfg.wallets[key] })),
    ...customKeys(cfg).map(key => {
      const w = cfg.wallets[key];
      return { label: `${w.symbol}${w.network ? ` ${w.network}` : ''}`, on: true };
    })
  ];
  const COLS = 4, PAD = 26, GAP = 10, TILE_H = 58, W = 1240, HEAD = 112;
  const rows = Math.ceil(tiles.length / COLS);
  const H = HEAD + rows * (TILE_H + GAP) - GAP + PAD;
  const canvas = createCanvas(W, H);
  const ctx = themedCtx(canvas.getContext('2d'), guildId);
  const okColor = '#3ddc84';

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#12291c');
  bg.addColorStop(1, '#090e0b');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 24); ctx.fill();

  const active = tiles.filter(t => t.on).length;

  // Pastille ronde + coche
  ctx.fillStyle = okColor;
  ctx.beginPath(); ctx.arc(PAD + 30, 56, 30, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#0a1a10'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(PAD + 17, 57); ctx.lineTo(PAD + 27, 68); ctx.lineTo(PAD + 45, 45); ctx.stroke();

  // Titre + sous-titre
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `40px ${FONT_BOLD}`;
  ctx.fillText(fit(ctx, guildName, 620), PAD + 78, 56);
  ctx.fillStyle = '#8fa398';
  ctx.font = `22px ${FONT}`;
  ctx.fillText(`${active}/${tiles.length} wallets configurés`, PAD + 78, 86);

  // Pastille de statut (publié ou non)
  const published = !!(cfg.channelId && cfg.messageId);
  const status = published ? 'PUBLIÉ' : 'NON PUBLIÉ';
  const sColor = published ? okColor : '#f0b429';
  ctx.font = `20px ${FONT_BOLD}`;
  const pw = ctx.measureText(status).width + 58;
  ctx.fillStyle = sColor + '33';
  roundRect(ctx, W - PAD - pw, 34, pw, 44, 22); ctx.fill();
  ctx.fillStyle = sColor;
  ctx.beginPath(); ctx.arc(W - PAD - pw + 22, 56, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillText(status, W - PAD - pw + 38, 63);

  // Tuiles
  const tileW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  tiles.forEach((t, i) => {
    const x = PAD + (i % COLS) * (tileW + GAP);
    const y = HEAD + Math.floor(i / COLS) * (TILE_H + GAP);
    ctx.fillStyle = t.on ? '#14351f' : '#171c19';
    roundRect(ctx, x, y, tileW, TILE_H, 14); ctx.fill();
    ctx.strokeStyle = t.on ? '#2c7d4d' : '#2a312d';
    ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = t.on ? okColor : '#5a655e';
    ctx.beginPath(); ctx.arc(x + 26, y + TILE_H / 2, 9, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = t.on ? '#ffffff' : '#9aa6a0';
    let size = 27;
    ctx.font = `${size}px ${FONT_BOLD}`;
    while (size > 18 && ctx.measureText(t.label).width > tileW - 62) {
      size -= 1;
      ctx.font = `${size}px ${FONT_BOLD}`;
    }
    ctx.fillText(fit(ctx, t.label, tileW - 62), x + 48, y + TILE_H / 2 + 9);
  });

  return canvas.toBuffer('image/png');
}

// Payload Components V2 : titre + image + infos + composants (barre d'accent blanche)
function alertsSummary(a) {
  const interval = alertsLib.INTERVALS.find(i => i.min === a.intervalMin)?.label || `${a.intervalMin} min`;
  const coins = a.coins.map(k => alertsLib.coinMeta(a, k)).filter(Boolean).map(m => `${m.emoji} ${m.symbol}`).join(' • ') || '*aucune*';
  return [
    `**État :** ${a.enabled ? '🟢 Actives' : '⚪ Désactivées'}`,
    `**Salon :** ${a.channelId ? `<#${a.channelId}>` : '*non défini*'}`,
    `**Fréquence :** toutes les ${interval} • **Devise :** ${alertsLib.CURRENCIES[a.currency].label}`,
    `**Cryptos suivies :** ${coins}`
  ].join('\n');
}

function buildPanelPayload(guild, mode, confirmReset, locked = false) {
  const cfg = getCfg(guild.id);
  const container = new ContainerBuilder().setAccentColor(0xFFFFFF);
  const files = [];

  if (mode === 'alerts') {
    const a = alertsLib.getAlerts(guild.id);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🔔 Alertes de cours'));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${alertsSummary(a)}\n\n-# Le bot poste le cours des cryptos choisies dans le salon, à la fréquence définie (source : CoinGecko).`
    ));
  } else {
    files.push(new AttachmentBuilder(renderCryptoCard(guild.name, cfg, guild.id), { name: 'crypto.png' }));
    const color = `#${(cfg.color ?? DEFAULT_COLOR).toString(16).padStart(6, '0').toUpperCase()}`;
    const published = cfg.channelId && cfg.messageId
      ? `<#${cfg.channelId}> • [voir le message](https://discord.com/channels/${guild.id}/${cfg.channelId}/${cfg.messageId})`
      : '*pas encore publié*';
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🪙 Panneau crypto'));
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://crypto.png'))
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Titre :** ${cfg.title ? cfg.title : '*par défaut*'} • **Couleur :** \`${color}\` • **Publication :** ${published}\n` +
        '-# ⚠️ Adresses publiques uniquement — jamais de clé privée. Choisis une crypto dans le menu pour définir son adresse.'
      )
    );
  }

  if (locked) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# ⏱️ Panneau expiré — relance `/crypto-panel`.'));
  } else {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(...buildComponents(cfg, mode, confirmReset, guild.id));
  }

  return {
    components: [container],
    files,
    attachments: [],
    flags: MessageFlags.IsComponentsV2
  };
}

// ── Composants ──

function buildComponents(cfg, mode, confirmReset, guildId) {
  if (mode === 'publish') {
    return [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('cp_chan')
          .setPlaceholder('Salon où publier le panneau')
          .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cp_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  if (mode === 'alerts') {
    const a = alertsLib.getAlerts(guildId);
    const coinOptions = alertsLib.allCoinOptions(a).map(c => ({
      label: `${c.emoji} ${c.symbol} — ${c.name}`.slice(0, 100),
      value: c.key,
      default: a.coins.includes(c.key)
    }));
    const channelMenu = new ChannelSelectMenuBuilder()
      .setCustomId('ca_chan')
      .setPlaceholder('Salon des alertes')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    if (a.channelId) channelMenu.setDefaultChannels(a.channelId);
    return [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('ca_coins').setPlaceholder('Cryptos à suivre…').setMinValues(0).setMaxValues(coinOptions.length).addOptions(coinOptions)
      ),
      new ActionRowBuilder().addComponents(channelMenu),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('ca_int').setPlaceholder('Fréquence des alertes').addOptions(
          alertsLib.INTERVALS.map(i => ({ label: `Toutes les ${i.label}`, value: String(i.min), default: i.min === a.intervalMin }))
        )
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ca_toggle').setLabel(a.enabled ? 'Désactiver' : 'Activer').setEmoji(a.enabled ? '🔕' : '🔔').setStyle(a.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ca_cur').setLabel(`Devise : ${alertsLib.CURRENCIES[a.currency].label}`).setEmoji('💱').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ca_add').setLabel('Autre crypto').setEmoji('➕').setStyle(ButtonStyle.Secondary).setDisabled(a.custom.length >= alertsLib.MAX_CUSTOM),
        new ButtonBuilder().setCustomId('ca_test').setLabel('Tester').setEmoji('🧪').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cp_back').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  const options = Object.entries(PRESETS).map(([key, m]) => ({
    label: `${m.emoji} ${m.symbol} — ${m.network}`.slice(0, 100),
    value: key,
    description: cfg.wallets[key] ? 'Configuré • modifier / supprimer' : 'Non configuré'
  }));
  for (const key of customKeys(cfg)) {
    const m = metaFor(key, cfg.wallets[key]);
    options.push({ label: `${m.emoji} ${m.symbol} — ${m.network}`.slice(0, 100), value: key, description: 'Personnalisée • modifier / supprimer' });
  }
  if (customKeys(cfg).length < MAX_CUSTOM) {
    options.push({ label: '➕ Autre crypto…', value: '__custom', description: 'Ajouter une crypto non listée' });
  }

  const hasWallets = Object.keys(cfg.wallets).length > 0;
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('cp_coin').setPlaceholder('Configurer un wallet…').addOptions(options)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cp_look').setLabel('Apparence').setEmoji('🎨').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cp_alerts').setLabel('Alertes').setEmoji('🔔').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cp_prev').setLabel('Aperçu').setEmoji('👁️').setStyle(ButtonStyle.Secondary).setDisabled(!hasWallets),
      new ButtonBuilder().setCustomId('cp_pub').setLabel(cfg.messageId ? 'Re-publier' : 'Publier').setEmoji('📢').setStyle(ButtonStyle.Success).setDisabled(!hasWallets),
      new ButtonBuilder().setCustomId('cp_reset').setLabel(confirmReset ? 'Confirmer ?' : 'Tout effacer').setEmoji('🗑️').setStyle(ButtonStyle.Danger).setDisabled(!hasWallets)
    )
  ];
}

function input(id, label, { style = TextInputStyle.Short, required = false, value = null, placeholder = null, max = 100, min = 0 } = {}) {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
  if (min) t.setMinLength(min);
  if (placeholder) t.setPlaceholder(placeholder.slice(0, 100));
  if (value) t.setValue(String(value).slice(0, max));
  return new ActionRowBuilder().addComponents(t);
}

// ── Commande ──

const data = new SlashCommandBuilder()
  .setName('crypto-panel')
  .setDescription('🔒 Admin • Configurer les wallets crypto et publier le panneau')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: '❌ Commande utilisable uniquement sur un serveur.', flags: MessageFlags.Ephemeral });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Il faut la permission **Gérer le serveur**.', flags: MessageFlags.Ephemeral });
  }

  const guildId = interaction.guild.id;
  let mode = 'main';
  let confirmReset = false;

  const render = () => buildPanelPayload(interaction.guild, mode, confirmReset);
  const ephemeral = { flags: MessageFlags.Ephemeral };

  const first = render();
  await interaction.reply({ ...first, flags: first.flags | MessageFlags.Ephemeral });
  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({ time: PANEL_TIMEOUT });

  async function askModal(i, modal) {
    await i.showModal(modal);
    return i.awaitModalSubmit({
      time: 180000,
      filter: m => m.customId === modal.data.custom_id && m.user.id === i.user.id
    }).catch(() => null);
  }

  // Réponse sûre : follow-up si déjà acquittée, sinon reply
  const say = (x, opts) => (x.deferred || x.replied ? x.followUp(opts) : x.reply(opts));

  // Mise à jour sûre du panneau :
  //  • si l'interaction est déjà différée → editReply
  //  • sinon update(), avec repli sur l'interaction d'origine si le délai de 3 s est dépassé (10062)
  async function safeUpdate(x, payload) {
    if (x.deferred || x.replied) return x.editReply(payload);
    try {
      return await x.update(payload);
    } catch (e) {
      if (e?.code === 10062 || e?.code === 40060) {
        return interaction.editReply(payload).catch(() => { });
      }
      throw e;
    }
  }

  // Interactions de navigation : on acquitte tout de suite (rendu canvas / envoi de message = lent)
  const DEFER_IDS = new Set([
    'cp_alerts', 'cp_back', 'cp_pub', 'cp_cancel', 'cp_chan', 'cp_reset',
    'ca_coins', 'ca_int', 'ca_cur', 'ca_chan', 'ca_toggle'
  ]);

  async function handle(i) {
    const id = i.customId;
    if (id !== 'cp_reset') confirmReset = false;
    if (DEFER_IDS.has(id)) await i.deferUpdate();

    // ── Choix d'une crypto → modal adresse ──
    if (id === 'cp_coin') {
      const cfg = getCfg(guildId);
      const picked = i.values[0];
      const isNewCustom = picked === '__custom';
      const existing = isNewCustom ? null : cfg.wallets[picked];
      const meta = isNewCustom ? null : metaFor(picked, existing);
      const modalId = `cp_modal_coin_${i.id}`;

      const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle((isNewCustom ? 'Nouvelle crypto' : `Wallet ${meta.symbol} (${meta.network})`).slice(0, 45));
      if (isNewCustom) {
        modal.addComponents(
          input('sym', 'Symbole (ex : ADA)', { required: true, max: 10, min: 2 }),
          input('net', 'Réseau (ex : Cardano)', { required: false, max: 30 })
        );
      }
      modal.addComponents(
        input('addr', 'Adresse publique du wallet', { required: false, max: 120, value: existing?.address, placeholder: 'Laisse vide pour supprimer • jamais de clé privée' }),
        input('memo', 'Memo / Tag (optionnel)', { required: false, max: 40, value: existing?.memo, placeholder: 'Requis pour certains réseaux (XRP, TON...)' })
      );

      const sub = await askModal(i, modal);
      if (!sub) return;

      const address = sub.fields.getTextInputValue('addr').trim();
      const memo = sub.fields.getTextInputValue('memo').trim();
      let key = picked;

      if (isNewCustom) {
        const sym = sub.fields.getTextInputValue('sym').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        const net = sub.fields.getTextInputValue('net').trim();
        if (sym.length < 2) {
          return say(sub, { content: '❌ Symbole invalide (2 à 10 lettres/chiffres).', ...ephemeral });
        }
        if (!address) {
          return say(sub, { content: '❌ Renseigne une adresse pour ajouter cette crypto.', ...ephemeral });
        }
        const netSlug = net.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        key = `X_${sym}${netSlug ? `_${netSlug}` : ''}`;
        if (cfg.wallets[key]) {
          return say(sub, { content: `❌ **${sym}** existe déjà pour ce réseau : modifie-la depuis le menu.`, ...ephemeral });
        }
        if (customKeys(cfg).length >= MAX_CUSTOM) {
          return say(sub, { content: `❌ Maximum ${MAX_CUSTOM} cryptos personnalisées.`, ...ephemeral });
        }
        const warn = secretWarning(address);
        if (warn) return say(sub, { content: warn, ...ephemeral });
        if (!/^\S{10,120}$/.test(address)) {
          return say(sub, { content: '❌ Adresse invalide (10 à 120 caractères, sans espace).', ...ephemeral });
        }
        cfg.wallets[key] = { symbol: sym, network: net || null, address, memo: memo || null };
        save();
        return safeUpdate(sub, render());
      }

      // Preset ou custom existant
      if (!address) {
        delete cfg.wallets[key];
        save();
        return safeUpdate(sub, render());
      }
      const warn = secretWarning(address);
      if (warn) return say(sub, { content: warn, ...ephemeral });
      if (meta.regex ? !meta.regex.test(address) : !/^\S{10,120}$/.test(address)) {
        return say(sub, {
          content: `❌ Cette adresse n'est pas valide pour **${meta.symbol}** (${meta.network}). Vérifie le réseau et recopie l'adresse en entier.`,
          ...ephemeral
        });
      }
      cfg.wallets[key] = { ...(cfg.wallets[key] || {}), address, memo: memo || null };
      save();
      return safeUpdate(sub, render());
    }

    // ── Apparence ──
    if (id === 'cp_look') {
      const cfg = getCfg(guildId);
      const modalId = `cp_modal_look_${i.id}`;
      const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Apparence du panneau')
        .addComponents(
          input('title', 'Titre', { max: 100, value: cfg.title, placeholder: DEFAULT_TITLE }),
          input('desc', 'Description', { style: TextInputStyle.Paragraph, max: 1000, value: cfg.description, placeholder: 'Vide = description par défaut' }),
          input('footer', 'Footer', { max: 100, value: cfg.footer }),
          input('color', 'Couleur (hex, ex : FFFFFF)', { max: 7, value: cfg.color != null ? cfg.color.toString(16).padStart(6, '0') : null })
        );
      const sub = await askModal(i, modal);
      if (!sub) return;
      const color = parseColor(sub.fields.getTextInputValue('color'));
      if (color.error) {
        return say(sub, { content: '❌ Couleur invalide : utilise un code hexadécimal à 6 caractères (ex : `FFFFFF`).', ...ephemeral });
      }
      cfg.title = sub.fields.getTextInputValue('title').trim() || null;
      cfg.description = sub.fields.getTextInputValue('desc').trim() || null;
      cfg.footer = sub.fields.getTextInputValue('footer').trim() || null;
      cfg.color = color.value;
      save();
      return safeUpdate(sub, render());
    }

    // ── Alertes de cours ──
    if (id === 'cp_alerts') { mode = 'alerts'; return safeUpdate(i, render()); }
    if (id === 'cp_back') { mode = 'main'; return safeUpdate(i, render()); }

    if (id === 'ca_coins') {
      const a = alertsLib.getAlerts(guildId);
      const valid = new Set(alertsLib.allCoinOptions(a).map(c => c.key));
      a.coins = i.values.filter(v => valid.has(v));
      if (!a.coins.length) a.enabled = false;
      save();
      return safeUpdate(i, render());
    }
    if (id === 'ca_int') {
      const a = alertsLib.getAlerts(guildId);
      a.intervalMin = Number(i.values[0]);
      save();
      return safeUpdate(i, render());
    }
    if (id === 'ca_cur') {
      const a = alertsLib.getAlerts(guildId);
      a.currency = a.currency === 'eur' ? 'usd' : 'eur';
      save();
      return safeUpdate(i, render());
    }
    if (id === 'ca_chan') {
      const a = alertsLib.getAlerts(guildId);
      const channel = i.channels.first();
      const perms = channel?.permissionsFor?.(i.guild.members.me);
      if (!channel || !perms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
        return say(i, { content: `❌ Il me manque des permissions dans ${channel || 'ce salon'} (Voir le salon, Envoyer des messages, Intégrer des liens).`, ...ephemeral });
      }
      a.channelId = channel.id;
      save();
      return safeUpdate(i, render());
    }
    if (id === 'ca_toggle') {
      const a = alertsLib.getAlerts(guildId);
      if (!a.enabled && (!a.channelId || !a.coins.length)) {
        return say(i, { content: '❌ Choisis au moins **une crypto** et un **salon** avant d\'activer les alertes.', ...ephemeral });
      }
      a.enabled = !a.enabled;
      if (a.enabled) a.lastSent = 0; // premier rapport dans la minute qui suit
      save();
      return safeUpdate(i, render());
    }
    if (id === 'ca_test') {
      await i.deferReply(ephemeral);
      try {
        const embed = await alertsLib.buildPreview(guildId);
        return i.editReply({ content: '🧪 Aperçu (rien n\'est posté dans le salon) :', embeds: [embed] });
      } catch (e) {
        return i.editReply({ content: `❌ ${e.message}` });
      }
    }
    if (id === 'ca_add') {
      const a = alertsLib.getAlerts(guildId);
      const modal = new ModalBuilder()
        .setCustomId(`ca_modal_add_${i.id}`)
        .setTitle('Suivre une autre crypto')
        .addComponents(
          input('cgid', 'ID CoinGecko (ex : cardano)', { required: true, max: 60, min: 2, placeholder: "« API ID » sur la page de la crypto, coingecko.com" }),
          input('sym', 'Symbole affiché (ex : ADA)', { required: true, max: 10, min: 2 })
        );
      const sub = await askModal(i, modal);
      if (!sub) return;
      await sub.deferUpdate();
      const cgid = sub.fields.getTextInputValue('cgid').trim().toLowerCase();
      const sym = sub.fields.getTextInputValue('sym').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const fail = msg => sub.followUp({ content: msg, ...ephemeral });
      if (!/^[a-z0-9-]{2,60}$/.test(cgid) || sym.length < 2) return fail('❌ ID CoinGecko ou symbole invalide.');
      if (a.custom.some(c => c.id === cgid) || Object.values(alertsLib.COINS).some(c => c.id === cgid)) return fail('❌ Cette crypto est déjà dans la liste.');
      if (a.custom.length >= alertsLib.MAX_CUSTOM) return fail(`❌ Maximum ${alertsLib.MAX_CUSTOM} cryptos personnalisées.`);
      try {
        const prices = await alertsLib.fetchPrices([cgid]);
        if (typeof prices?.[cgid]?.eur !== 'number') return fail('❌ ID CoinGecko introuvable : copie l\'« API ID » exact depuis la page de la crypto sur coingecko.com.');
      } catch (e) {
        return fail(`❌ Vérification impossible : ${e.message}`);
      }
      a.custom.push({ id: cgid, symbol: sym });
      a.coins.push(`cg:${cgid}`);
      save();
      return sub.editReply(render());
    }

    // ── Aperçu ──
    if (id === 'cp_prev') {
      return say(i, { embeds: [buildPublicEmbed(getCfg(guildId))], ...ephemeral });
    }

    // ── Publier : choix du salon ──
    if (id === 'cp_pub') {
      mode = 'publish';
      return safeUpdate(i, render());
    }
    if (id === 'cp_cancel') {
      mode = 'main';
      return safeUpdate(i, render());
    }
    if (id === 'cp_chan') {
      const cfg = getCfg(guildId);
      const channel = i.channels.first();
      const me = i.guild.members.me;
      const perms = channel?.permissionsFor?.(me);
      if (!channel || !perms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
        return say(i, { content: `❌ Il me manque des permissions dans ${channel || 'ce salon'} (Voir le salon, Envoyer des messages, Intégrer des liens).`, ...ephemeral });
      }
      const embed = buildPublicEmbed(cfg);
      let sent = null;
      try {
        if (cfg.messageId && cfg.channelId === channel.id) {
          const old = await channel.messages.fetch(cfg.messageId).catch(() => null);
          if (old && old.author.id === i.client.user.id) {
            await old.edit({ embeds: [embed] });
            sent = old;
          }
        }
        if (!sent) sent = await channel.send({ embeds: [embed] });
      } catch (e) {
        console.error('[CryptoPanel] Publication impossible :', e.message);
        return say(i, { content: `❌ Publication impossible : ${e.message}`, ...ephemeral });
      }
      cfg.channelId = channel.id;
      cfg.messageId = sent.id;
      save();
      mode = 'main';
      await safeUpdate(i, render());
      return i.followUp({ content: `✅ Panneau publié dans ${channel} → ${sent.url}`, ...ephemeral });
    }

    // ── Tout effacer (double clic) ──
    if (id === 'cp_reset') {
      if (!confirmReset) {
        confirmReset = true;
        return safeUpdate(i, render());
      }
      confirmReset = false;
      getCfg(guildId).wallets = {};
      save();
      return safeUpdate(i, render());
    }
  }

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: "❌ Ce panneau n'est pas le tien. Lance `/crypto-panel` pour ouvrir le tien.", ...ephemeral }).catch(() => { });
    }
    try {
      await handle(i);
    } catch (e) {
      console.error('[CryptoPanel]', e);
      if (!i.replied && !i.deferred) i.reply({ content: '❌ Erreur inattendue.', ...ephemeral }).catch(() => { });
    }
  });
  collector.on('end', async () => {
    try { await interaction.editReply(buildPanelPayload(interaction.guild, 'main', false, true)); } catch { }
  });
}

module.exports = { data, execute };