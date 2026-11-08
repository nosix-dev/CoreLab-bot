'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Rankup (/rankup) : des rôles donnés automatiquement selon l'activité
//   /rankup setup      → panneau de configuration (réservé « Gérer les rôles ») :
//                        ajouter / retirer des paliers (rôle + messages + temps vocal),
//                        activer le module, choisir la condition, le salon d'annonce
//   /rankup progress   → voir ses compteurs (ou ceux d'un membre) et les paliers restants
//
// Le bot compte pour chaque membre :
//   • les messages envoyés (1 message maximum toutes les 2 secondes, bots exclus)
//   • le temps passé en vocal (1 tick par minute ; salon AFK et casque coupé non comptés)
// Quand un palier est atteint, le rôle est donné automatiquement (et annoncé si un salon est choisi).
// Un palier a un nombre de messages et/ou un temps vocal. Si les deux sont renseignés, la condition
// du serveur s'applique : « les deux » (par défaut) ou « l'un des deux ».
// Le rôle n'est donné qu'une fois : si un membre perd le rôle à la main, le bot ne le redonne pas.
//
// Données :
//   rankup.json        { [guildId]: { enabled, mode, channelId, ranks: [{ roleId, messages, minutes }] } }
//   rankup_stats.json  { [guildId]: { [userId]: { m: messages, v: minutes vocal, g: [rôles déjà donnés] } } }
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const {
  SlashCommandBuilder,
  PermissionFlagsBits: P,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  MessageFlags
} = require('discord.js');
const { chargerDonnees, sauvegarderDonnees } = require('../core/data');
const { fichierPersistant } = require('../core/persistentPath');
const { roleProblem } = require('./roleMenu');

const FICHIER = 'rankup.json';
const FICHIER_STATS = fichierPersistant('rankup_stats.json');
const COULEUR = 0xE8510D; // barre d'accent orange CoreLab
const MAX_PALIERS = 25;
const MSG_MIN_INTERVAL_MS = 2000; // anti-spam : 1 message compté toutes les 2 s par membre
const VOICE_TICK_MS = 60 * 1000;
const SAVE_DELAY_MS = 20 * 1000;
const MAX_MESSAGES = 10_000_000;
const MAX_MINUTES = 100_000 * 60;

// ── Configuration (rankup.json) ─────────────────────────────
const donnees = chargerDonnees(FICHIER, {});
const sauver = () => sauvegarderDonnees(FICHIER, donnees);

function cfgOf(guildId, create = false) {
  const g = String(guildId);
  if (!donnees[g]) {
    if (!create) return null;
    donnees[g] = { enabled: true, mode: 'all', channelId: null, ranks: [] };
    sauver();
  }
  const c = donnees[g];
  if (!Array.isArray(c.ranks)) c.ranks = [];
  if (c.enabled === undefined) c.enabled = true;
  if (c.mode !== 'any') c.mode = 'all';
  return c;
}

// Paliers triés du plus facile au plus difficile
function sortedRanks(cfg) {
  return [...cfg.ranks].sort((a, b) => (a.messages - b.messages) || (a.minutes - b.minutes));
}

// ── Compteurs (rankup_stats.json) ───────────────────────────
let stats = {};
try {
  if (fs.existsSync(FICHIER_STATS)) stats = JSON.parse(fs.readFileSync(FICHIER_STATS, 'utf8'));
} catch (e) {
  console.error('[Rankup] lecture des compteurs impossible, nouveau fichier :', e.message);
}
if (!stats || typeof stats !== 'object') stats = {};

let dirty = false;
let saveTimer = null;
let saving = false;

async function saveAsync() {
  if (saving || !dirty) return;
  saving = true;
  dirty = false;
  try {
    const tmp = `${FICHIER_STATS}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(stats), 'utf8');
    await fs.promises.rename(tmp, FICHIER_STATS);
  } catch (e) {
    dirty = true;
    console.error('[Rankup] sauvegarde des compteurs impossible :', e.message);
  } finally {
    saving = false;
  }
}

function saveSync() {
  if (!dirty) return;
  try {
    fs.writeFileSync(FICHIER_STATS, JSON.stringify(stats), 'utf8');
    dirty = false;
  } catch (e) {
    console.error('[Rankup] sauvegarde finale impossible :', e.message);
  }
}

function markDirty() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveAsync(); }, SAVE_DELAY_MS);
  saveTimer.unref?.();
}

function userStats(guildId, userId, create = false) {
  const g = String(guildId);
  const u = String(userId);
  if (!stats[g]) { if (!create) return null; stats[g] = {}; }
  let s = stats[g][u];
  if (!s) { if (!create) return null; s = stats[g][u] = { m: 0, v: 0, g: [] }; }
  if (!Array.isArray(s.g)) s.g = [];
  return s;
}

// ── Formats ─────────────────────────────────────────────────
function fmtMinutes(min) {
  min = Math.max(0, Math.floor(min));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

// Saisie : « 5 » (= 5 heures), « 1.5 » (= 1 h 30), « 2h », « 1h30 », « 90m », « 1h 30m »
function parseDuration(input) {
  const t = String(input || '').trim().toLowerCase().replace(',', '.');
  if (!t) return 0;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 60);
  const compact = t.match(/^(\d+)\s*h\s*(\d{1,2})$/);
  if (compact) return parseInt(compact[1], 10) * 60 + parseInt(compact[2], 10);
  let total = 0;
  let matched = '';
  const re = /(\d+(?:\.\d+)?)\s*(heures?|h|minutes?|min|m)(?![a-z])/g;
  let m;
  while ((m = re.exec(t))) {
    const v = parseFloat(m[1]);
    total += m[2].startsWith('h') ? v * 60 : v;
    matched += m[0];
  }
  if (!matched || matched.replace(/\s/g, '') !== t.replace(/\s/g, '')) return null;
  return Math.round(total);
}

// Valeur pré-remplie dans le champ « vocal » du modal (relue ensuite par parseDuration)
function durationInput(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h${String(m).padStart(2, '0')}`;
  return h ? `${h}h` : `${m}m`;
}

function fmtMessages(n) {
  return `${new Intl.NumberFormat('fr-FR').format(n)} message${n > 1 ? 's' : ''}`;
}

function rankReq(r) {
  const parts = [];
  if (r.messages > 0) parts.push(`💬 ${fmtMessages(r.messages)}`);
  if (r.minutes > 0) parts.push(`🎙️ ${fmtMinutes(r.minutes)}`);
  return parts.join(' · ');
}

function rankReqPlain(r) {
  const parts = [];
  if (r.messages > 0) parts.push(fmtMessages(r.messages));
  if (r.minutes > 0) parts.push(`${fmtMinutes(r.minutes)} en vocal`);
  return parts.join(' · ');
}

// ── Évaluation d'un palier ──────────────────────────────────
function meets(cfg, rank, st) {
  const needM = rank.messages > 0;
  const needV = rank.minutes > 0;
  const okM = st.m >= rank.messages;
  const okV = st.v >= rank.minutes;
  if (needM && needV) return cfg.mode === 'any' ? (okM || okV) : (okM && okV);
  if (needM) return okM;
  if (needV) return okV;
  return false;
}

const busy = new Set();
const badRoles = new Map(); // roleId → timestamp jusqu'auquel on n'essaie plus (rôle inutilisable)

// Donne les rôles dont les conditions viennent d'être remplies
async function evaluate(guild, userId, member = null) {
  const cfg = cfgOf(guild.id);
  if (!cfg?.enabled || !cfg.ranks.length) return;
  const st = userStats(guild.id, userId);
  if (!st) return;
  const ranks = sortedRanks(cfg);
  const pending = ranks.filter(r => !st.g.includes(r.roleId) && meets(cfg, r, st));
  if (!pending.length) return;

  const key = `${guild.id}:${userId}`;
  if (busy.has(key)) return;
  busy.add(key);
  try {
    member = member || guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot) return;

    let announced = null;
    for (const r of pending) {
      const role = guild.roles.cache.get(r.roleId);
      if (!role) continue;
      if ((badRoles.get(r.roleId) || 0) > Date.now()) continue;
      const problem = roleProblem(guild, role); // re-vérifié à chaque attribution
      if (problem) { badRoles.set(r.roleId, Date.now() + 10 * 60 * 1000); console.error(`[Rankup] ${guild.name} : rôle ${role.name} inutilisable (${problem})`); continue; }
      try {
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, 'Rankup : palier atteint');
          announced = r; // si plusieurs paliers d'un coup, on annonce le dernier (le plus haut)
        }
        st.g.push(r.roleId);
        markDirty();
      } catch (e) {
        badRoles.set(r.roleId, Date.now() + 10 * 60 * 1000);
        console.error(`[Rankup] ${guild.name} : impossible de donner ${role.name} :`, e.message);
      }
    }

    if (announced && cfg.channelId) {
      const channel = guild.channels.cache.get(cfg.channelId);
      if (channel?.isTextBased?.()) {
        await channel.send({
          content: `🏆 ${member} vient d'obtenir <@&${announced.roleId}> !\n-# ${rankReq(announced)}`,
          allowedMentions: { users: [member.id], roles: [] }
        }).catch(() => {});
      }
    }
  } finally {
    busy.delete(key);
  }
}

// ── Compteurs : messages + vocal ────────────────────────────
const lastMessage = new Map();

function onMessage(message) {
  if (!message.guild || message.author?.bot || message.webhookId || message.system) return;
  const cfg = cfgOf(message.guild.id);
  if (!cfg?.enabled) return;
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  if (now - (lastMessage.get(key) || 0) < MSG_MIN_INTERVAL_MS) return;
  lastMessage.set(key, now);
  if (lastMessage.size > 5000) {
    for (const [k, t] of lastMessage) if (now - t > 60 * 1000) lastMessage.delete(k);
  }
  const st = userStats(message.guild.id, message.author.id, true);
  st.m = Math.min(st.m + 1, MAX_MESSAGES);
  markDirty();
  evaluate(message.guild, message.author.id, message.member).catch(e => console.error('[Rankup] attribution :', e.message));
}

async function voiceTick(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const cfg = cfgOf(guild.id);
      if (!cfg?.enabled) continue;
      for (const state of guild.voiceStates.cache.values()) {
        const member = state.member;
        if (!member || member.user.bot || !state.channelId) continue;
        if (state.channelId === guild.afkChannelId) continue;
        if (state.selfDeaf || state.serverDeaf) continue;
        const st = userStats(guild.id, member.id, true);
        st.v = Math.min(st.v + 1, MAX_MINUTES);
        markDirty();
        await evaluate(guild, member.id, member).catch(e => console.error('[Rankup] attribution vocal :', e.message));
      }
    } catch (e) {
      console.error('[Rankup] tick vocal :', e.message);
    }
  }
}

// ── Panneau /rankup setup ───────────────────────────────────
const sep = (divider = true) => new SeparatorBuilder().setDivider(divider).setSpacing(SeparatorSpacingSize.Small);
const txt = content => new TextDisplayBuilder().setContent(String(content).slice(0, 1800));

function panel(guild, notice = null) {
  const cfg = cfgOf(guild.id, true);
  const ranks = sortedRanks(cfg);
  const c = new ContainerBuilder().setAccentColor(COULEUR);
  c.addTextDisplayComponents(txt('## 🏆 Rankup — rôles automatiques\nLes membres gagnent des rôles selon leurs **messages** et leur **temps en vocal**.'));
  if (notice) c.addTextDisplayComponents(txt(`> ${notice}`));
  c.addSeparatorComponents(sep());

  const lignes = [
    `**État :** ${cfg.enabled ? '✅ activé' : '⛔ désactivé'}`,
    `**Si un palier a messages ET vocal :** ${cfg.mode === 'any' ? "l'un des deux suffit" : 'les deux sont requis'}`,
    `**Annonce :** ${cfg.channelId ? `<#${cfg.channelId}>` : 'aucune'}`
  ];
  c.addTextDisplayComponents(txt(lignes.join('\n')));
  c.addSeparatorComponents(sep());

  const liste = ranks.length
    ? ranks.map((r, i) => `**${i + 1}.** ${guild.roles.cache.has(r.roleId) ? `<@&${r.roleId}>` : '*(rôle supprimé)*'} — ${rankReq(r)}`).join('\n')
    : '*Aucun palier pour le moment. Clique sur « Ajouter un palier ».*';
  c.addTextDisplayComponents(txt(`### Paliers (${ranks.length}/${MAX_PALIERS})\n${liste}`));
  c.addSeparatorComponents(sep(false));

  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rankup:add').setLabel('Ajouter / modifier un palier').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rankup:rm').setLabel('Retirer un palier').setEmoji('🗑️').setStyle(ButtonStyle.Danger).setDisabled(!ranks.length)
  ));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rankup:t:enabled').setLabel(cfg.enabled ? 'Désactiver' : 'Activer').setEmoji(cfg.enabled ? '⛔' : '✅').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rankup:t:mode').setLabel(cfg.mode === 'any' ? 'Condition : un des deux' : 'Condition : les deux').setEmoji('🔀').setStyle(ButtonStyle.Secondary)
  ));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('rankup:chan')
      .setPlaceholder("Salon d'annonce (optionnel — vide pour désactiver)")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(1)
  ));
  c.addSeparatorComponents(sep(false));
  c.addTextDisplayComponents(txt("-# Vocal compté hors salon AFK et casque coupé • 1 message compté toutes les 2 s • un rôle n'est donné qu'une fois"));
  return c;
}

const panelReply = (guild, notice) => ({ components: [panel(guild, notice)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const panelUpdate = (guild, notice) => ({ components: [panel(guild, notice)], allowedMentions: { parse: [] } });

function stepContainer(content, rows) {
  const c = new ContainerBuilder().setAccentColor(COULEUR);
  c.addTextDisplayComponents(txt(content));
  c.addSeparatorComponents(sep(false));
  for (const row of rows) c.addActionRowComponents(row);
  return { components: [c], allowedMentions: { parse: [] } };
}

const backRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('rankup:back').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
);

// ── Commande ────────────────────────────────────────────────
const rankup = {
  data: new SlashCommandBuilder()
    .setName('rankup')
    .setDescription('🏆 Rôles automatiques selon les messages et le temps passé en vocal')
    .setDMPermission(false)
    .addSubcommand(s => s.setName('setup').setDescription('Configurer les paliers de rôles (rôles, messages, temps en vocal)'))
    .addSubcommand(s => s.setName('progress').setDescription('Voir ses messages, son temps en vocal et les paliers à atteindre')
      .addUserOption(o => o.setName('membre').setDescription('Membre à consulter (par défaut : toi)'))),

  async execute(interaction) {
    const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    if (!guild) return reply('❌ Cette commande fonctionne uniquement dans un serveur.');
    const sub = interaction.options.getSubcommand();

    if (sub === 'setup') {
      if (!canManage(interaction)) return reply('❌ Réservé aux personnes ayant la permission « Gérer les rôles ».');
      return interaction.reply(panelReply(guild));
    }

    if (sub === 'progress') {
      const cfg = cfgOf(guild.id);
      if (!cfg?.ranks.length) return reply("Aucun palier n'est configuré sur ce serveur. Un administrateur peut le faire avec `/rankup setup`.");
      const user = interaction.options.getUser('membre') || interaction.user;
      if (user.bot) return reply('❌ Les bots ne sont pas comptés.');
      const st = userStats(guild.id, user.id) || { m: 0, v: 0, g: [] };
      const member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null);
      const ranks = sortedRanks(cfg);
      const lignes = ranks.slice(0, 15).map(r => {
        const role = guild.roles.cache.has(r.roleId) ? `<@&${r.roleId}>` : '*(rôle supprimé)*';
        if (st.g.includes(r.roleId) || member?.roles.cache.has(r.roleId)) return `✅ ${role}`;
        const reste = [];
        if (r.messages > 0) reste.push(`💬 ${new Intl.NumberFormat('fr-FR').format(st.m)}/${new Intl.NumberFormat('fr-FR').format(r.messages)}`);
        if (r.minutes > 0) reste.push(`🎙️ ${fmtMinutes(st.v)}/${fmtMinutes(r.minutes)}`);
        return `▫️ ${role} — ${reste.join(' · ')}`;
      });
      const c = new ContainerBuilder().setAccentColor(COULEUR);
      c.addTextDisplayComponents(txt(`## 🏆 Progression de ${user.displayName || user.username}\n💬 **${fmtMessages(st.m)}** · 🎙️ **${fmtMinutes(st.v)}** en vocal`));
      c.addSeparatorComponents(sep());
      c.addTextDisplayComponents(txt(lignes.join('\n') + (ranks.length > 15 ? `\n*… et ${ranks.length - 15} autre(s)*` : '')));
      if (!cfg.enabled) {
        c.addSeparatorComponents(sep(false));
        c.addTextDisplayComponents(txt('-# ⛔ Le module est désactivé : les compteurs sont à l\'arrêt.'));
      }
      return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
  }
};

function canManage(interaction) {
  const perms = interaction.memberPermissions;
  return !!(perms?.has(P.ManageRoles) || perms?.has(P.Administrator));
}

// ── Interactions du panneau ─────────────────────────────────
async function handleComponent(interaction) {
  const guild = interaction.guild;
  if (!guild) return;
  if (!canManage(interaction)) {
    return interaction.reply({ content: '❌ Réservé aux personnes ayant la permission « Gérer les rôles ».', flags: MessageFlags.Ephemeral });
  }
  const id = interaction.customId;
  const cfg = cfgOf(guild.id, true);

  if (id === 'rankup:back') return interaction.update(panelUpdate(guild));

  if (id === 'rankup:t:enabled') { cfg.enabled = !cfg.enabled; sauver(); return interaction.update(panelUpdate(guild, cfg.enabled ? '✅ Module activé : le décompte reprend.' : '⛔ Module désactivé : le décompte est à l\'arrêt.')); }
  if (id === 'rankup:t:mode') { cfg.mode = cfg.mode === 'any' ? 'all' : 'any'; sauver(); return interaction.update(panelUpdate(guild, 'Condition mise à jour.')); }

  if (id === 'rankup:chan') {
    const channelId = interaction.values?.[0] || null;
    if (channelId) {
      const channel = guild.channels.cache.get(channelId);
      const perms = channel?.permissionsFor(guild.members.me);
      if (!perms?.has(P.ViewChannel) || !perms?.has(P.SendMessages)) {
        return interaction.update(panelUpdate(guild, `❌ Je ne peux pas écrire dans <#${channelId}>.`));
      }
    }
    cfg.channelId = channelId;
    sauver();
    return interaction.update(panelUpdate(guild, channelId ? `Annonces dans <#${channelId}>.` : 'Annonces désactivées.'));
  }

  if (id === 'rankup:add') {
    if (cfg.ranks.length >= MAX_PALIERS) return interaction.update(panelUpdate(guild, `❌ Maximum ${MAX_PALIERS} paliers par serveur.`));
    const select = new RoleSelectMenuBuilder().setCustomId('rankup:pick').setPlaceholder('Choisis le rôle à donner…').setMinValues(1).setMaxValues(1);
    return interaction.update(stepContainer(
      '### ➕ Ajouter / modifier un palier\nChoisis le **rôle** à donner. Tu règleras ensuite le nombre de messages et le temps en vocal.\n-# Choisir un rôle déjà dans la liste modifie son palier.',
      [new ActionRowBuilder().addComponents(select), backRow()]
    ));
  }

  if (id === 'rankup:pick') {
    const roleId = interaction.values?.[0];
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    const problem = roleProblem(guild, role, interaction.member);
    if (problem) return interaction.update(panelUpdate(guild, `❌ ${role ? `<@&${role.id}>` : 'Ce rôle'} : ${problem}.`));
    const existing = cfg.ranks.find(r => r.roleId === role.id);
    const modal = new ModalBuilder().setCustomId(`rankup:modal:${role.id}`).setTitle(`Palier : ${role.name}`.slice(0, 45));
    const fMsg = new TextInputBuilder()
      .setCustomId('messages').setLabel('Messages requis (0 = ignoré)').setStyle(TextInputStyle.Short)
      .setPlaceholder('ex : 500').setRequired(false).setMaxLength(8);
    const fVoc = new TextInputBuilder()
      .setCustomId('vocal').setLabel('Temps en vocal requis (0 = ignoré)').setStyle(TextInputStyle.Short)
      .setPlaceholder('ex : 10h, 1h30, 90m ou 5 (= 5 heures)').setRequired(false).setMaxLength(16);
    if (existing?.messages) fMsg.setValue(String(existing.messages));
    if (existing?.minutes) fVoc.setValue(durationInput(existing.minutes));
    modal.addComponents(new ActionRowBuilder().addComponents(fMsg), new ActionRowBuilder().addComponents(fVoc));
    return interaction.showModal(modal);
  }

  if (id === 'rankup:rm') {
    if (!cfg.ranks.length) return interaction.update(panelUpdate(guild, 'Aucun palier à retirer.'));
    const select = new StringSelectMenuBuilder().setCustomId('rankup:rmpick').setPlaceholder('Quel palier retirer ?').setMinValues(1).setMaxValues(1)
      .addOptions(sortedRanks(cfg).slice(0, 25).map(r => ({
        label: (guild.roles.cache.get(r.roleId)?.name || 'Rôle supprimé').slice(0, 100),
        description: rankReqPlain(r).slice(0, 100) || undefined,
        value: r.roleId
      })));
    return interaction.update(stepContainer('### 🗑️ Retirer un palier\nLe rôle reste chez les membres qui l\'ont déjà : seul le palier automatique est supprimé.', [new ActionRowBuilder().addComponents(select), backRow()]));
  }

  if (id === 'rankup:rmpick') {
    const roleId = interaction.values?.[0];
    cfg.ranks = cfg.ranks.filter(r => r.roleId !== roleId);
    sauver();
    return interaction.update(panelUpdate(guild, `🗑️ Palier <@&${roleId}> retiré.`));
  }
}

async function handleModal(interaction) {
  const guild = interaction.guild;
  if (!guild) return;
  if (!canManage(interaction)) {
    return interaction.reply({ content: '❌ Réservé aux personnes ayant la permission « Gérer les rôles ».', flags: MessageFlags.Ephemeral });
  }
  const roleId = interaction.customId.split(':')[2];
  const cfg = cfgOf(guild.id, true);
  const answer = notice => (interaction.isFromMessage?.() ? interaction.update(panelUpdate(guild, notice)) : interaction.reply({ ...panelReply(guild, notice) }));

  const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
  const problem = roleProblem(guild, role, interaction.member);
  if (problem) return answer(`❌ ${role ? `<@&${role.id}>` : 'Ce rôle'} : ${problem}.`);

  const rawMsg = interaction.fields.getTextInputValue('messages').trim().replace(/\s/g, '');
  const messages = rawMsg === '' ? 0 : (/^\d+$/.test(rawMsg) ? parseInt(rawMsg, 10) : null);
  if (messages === null || messages > MAX_MESSAGES) return answer(`❌ Nombre de messages invalide (entier entre 0 et ${MAX_MESSAGES.toLocaleString('fr-FR')}).`);
  const minutes = parseDuration(interaction.fields.getTextInputValue('vocal'));
  if (minutes === null || minutes > MAX_MINUTES) return answer('❌ Temps en vocal invalide. Exemples : `10h`, `1h30`, `90m` ou `5` (= 5 heures).');
  if (messages <= 0 && minutes <= 0) return answer('❌ Renseigne au moins un nombre de messages ou un temps en vocal.');

  const existing = cfg.ranks.find(r => r.roleId === role.id);
  if (existing) { existing.messages = messages; existing.minutes = minutes; }
  else {
    if (cfg.ranks.length >= MAX_PALIERS) return answer(`❌ Maximum ${MAX_PALIERS} paliers par serveur.`);
    cfg.ranks.push({ roleId: role.id, messages, minutes });
  }
  sauver();
  return answer(`✅ ${existing ? 'Palier modifié' : 'Palier ajouté'} : <@&${role.id}> — ${rankReq({ messages, minutes })}.`);
}

function registerRankup(client) {
  client.on('interactionCreate', interaction => {
    try {
      const id = interaction.customId;
      if (typeof id !== 'string' || !id.startsWith('rankup:')) return;
      const run = interaction.isModalSubmit() ? handleModal : (interaction.isMessageComponent() ? handleComponent : null);
      if (!run) return;
      run(interaction).catch(e => {
        if (e?.code !== 10062 && e?.code !== 40060) console.error('[Rankup] interaction :', e.message);
      });
    } catch (e) { console.error('[Rankup] interaction :', e.message); }
  });

  client.on('messageCreate', message => {
    try { onMessage(message); } catch (e) { console.error('[Rankup] message :', e.message); }
  });

  // Rôle supprimé : on retire son palier
  client.on('roleDelete', role => {
    try {
      const cfg = cfgOf(role.guild.id);
      if (!cfg || !cfg.ranks.some(r => r.roleId === role.id)) return;
      cfg.ranks = cfg.ranks.filter(r => r.roleId !== role.id);
      sauver();
    } catch (e) { console.error('[Rankup] roleDelete :', e.message); }
  });

  setInterval(() => {
    voiceTick(client).catch(e => console.error('[Rankup] tick vocal :', e.message));
  }, VOICE_TICK_MS);

  process.once('SIGTERM', saveSync);
  process.once('SIGINT', saveSync);
  process.once('beforeExit', saveSync);
  console.log('✅ Rankup initialisé (messages + vocal).');
}

module.exports = { commands: [rankup], registerRankup, _test: { parseDuration, fmtMinutes, meets, sortedRanks, voiceTick, evaluate, userStats, cfgOf } };
