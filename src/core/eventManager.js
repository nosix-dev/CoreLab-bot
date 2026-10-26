// src/core/eventManager.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventEntityType,
  GuildScheduledEventStatus
} = require('discord.js');
const { store, persist } = require('./data');
const { getGuildConfig } = require('./config');

const TICK_MS = 60 * 1000;
const PRUNE_AFTER_MS = 62 * 24 * 60 * 60 * 1000; // garde ~2 mois d'historique pour /agenda

// ── Stockage : réutilise le bucket 'events' (les anciennes entrées {name,date} sont ignorées) ──
function guildEvents(gid) {
  if (!store.events) store.events = {};
  if (!Array.isArray(store.events[gid])) store.events[gid] = [];
  return store.events[gid];
}
const isNew = e => e && e.id && e.startAt;
function activeEvents(gid) {
  return guildEvents(gid)
    .filter(e => isNew(e) && (e.status === 'scheduled' || e.status === 'started'))
    .sort((a, b) => a.startAt - b.startAt);
}

// ── Types d'événement (couleur dans /agenda) ──
const EVENT_TYPES = {
  convoi: { label: 'Convoi', emoji: '🟢', titleEmoji: '🚛' },
  reunion: { label: 'Réunion', emoji: '🔵', titleEmoji: '🤝' },
  event: { label: 'Événement', emoji: '🟠', titleEmoji: '📅' }
};
const typeOf = ev => (EVENT_TYPES[ev?.type] ? ev.type : 'event');

// ── Date Europe/Paris → timestamp UTC (sans librairie) ──
function tzOffset(ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(ts));
  const o = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const asUTC = Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second);
  return asUTC - Math.floor(ts / 1000) * 1000;
}
// Date locale Europe/Paris (y, mo 1-12, d, h, mi) → timestamp UTC (ms)
function parisTimestamp(y, mo, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffset(guess);
  let ts = guess - off1;
  const off2 = tzOffset(ts);
  if (off2 !== off1) ts = guess - off2;
  return ts;
}
function parseDateParis(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[h:](\d{2})$/i);
  if (!m) return null;
  const [d, mo, y, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const check = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1) return null;
  return parisTimestamp(y, mo, d, h, mi);
}
// Composantes de date/heure Europe/Paris d'un timestamp
function parisParts(ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(ts));
  const o = Object.fromEntries(parts.map(p => [p.type, Number(p.value)]));
  return { y: o.year, m: o.month, d: o.day, hh: o.hour, mm: o.minute };
}
// Événements non annulés dont le début est dans [fromTs, toTs[
function eventsInRange(gid, fromTs, toTs) {
  return guildEvents(gid)
    .filter(e => isNew(e) && e.status !== 'cancelled' && e.startAt >= fromTs && e.startAt < toTs)
    .sort((a, b) => a.startAt - b.startAt);
}

// ── Rendu ──
const fmtList = arr => arr.length
  ? arr.slice(0, 15).map(id => `<@${id}>`).join('\n') + (arr.length > 15 ? `\n+${arr.length - 15}…` : '')
  : '—';

function buildEventEmbed(ev) {
  const ts = Math.floor(ev.startAt / 1000);
  const prefix = { cancelled: '❌ ANNULÉ — ', ended: '✔️ TERMINÉ — ', started: '🔴 EN COURS — ' }[ev.status] || '';
  const lieu = ev.voiceId ? `<#${ev.voiceId}>` : (ev.location || 'À définir');
  return new EmbedBuilder()
    .setTitle(`${EVENT_TYPES[typeOf(ev)].titleEmoji} ${prefix}${ev.name}`.slice(0, 256))
    .setColor(ev.status === 'cancelled' ? 0xE74C3C : 0xFFFFFF)
    .setDescription(`${ev.description ? ev.description + '\n\n' : ''}🕒 <t:${ts}:F> (<t:${ts}:R>)\n📍 ${lieu}`)
    .addFields(
      { name: `✅ Participent (${ev.yes.length}${ev.maxPlaces ? `/${ev.maxPlaces}` : ''})`, value: fmtList(ev.yes), inline: true },
      { name: `❓ Peut-être (${ev.maybe.length})`, value: fmtList(ev.maybe), inline: true },
      { name: `❌ Absents (${ev.no.length})`, value: fmtList(ev.no), inline: true }
    )
    .setFooter({ text: `Organisé par ${ev.hostTag}` });
}
function buildRow(ev) {
  const off = ev.status !== 'scheduled';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`evt_yes_${ev.id}`).setLabel('Je participe').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(off),
    new ButtonBuilder().setCustomId(`evt_maybe_${ev.id}`).setLabel('Peut-être').setEmoji('❓').setStyle(ButtonStyle.Secondary).setDisabled(off),
    new ButtonBuilder().setCustomId(`evt_no_${ev.id}`).setLabel('Absent').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(off)
  );
}
async function refreshMessage(client, ev) {
  const ch = await client.channels.fetch(ev.channelId).catch(() => null);
  const msg = ch ? await ch.messages.fetch(ev.messageId).catch(() => null) : null;
  if (msg) await msg.edit({ embeds: [buildEventEmbed(ev)], components: [buildRow(ev)] }).catch(() => { });
}
async function getDiscordEvent(guild, ev) {
  if (!ev.discordEventId) return null;
  return guild.scheduledEvents.fetch(ev.discordEventId).catch(() => null);
}

// ── /event create ──
async function createEvent(interaction) {
  const o = interaction.options;
  const guild = interaction.guild;
  const name = o.getString('nom').trim().slice(0, 100);
  const startAt = parseDateParis(o.getString('date'));
  if (!startAt) {
    return interaction.reply({ content: '❌ Date invalide. Format : `JJ/MM/AAAA HH:MM` (ex. `25/12/2026 21:00`, heure de Paris).', flags: MessageFlags.Ephemeral });
  }
  if (startAt < Date.now() + 60 * 1000) {
    return interaction.reply({ content: '❌ La date doit être dans le futur.', flags: MessageFlags.Ephemeral });
  }
  const dureeMin = o.getInteger('duree') || 120;
  const endAt = startAt + dureeMin * 60 * 1000;
  const description = o.getString('description')?.trim().slice(0, 1000) || null;
  const voice = o.getChannel('vocal');
  const location = o.getString('lieu')?.trim().slice(0, 100) || null;
  const role = o.getRole('role');
  const maxPlaces = o.getInteger('places') || null;
  const type = EVENT_TYPES[o.getString('type')] ? o.getString('type') : 'event';
  const cfg = getGuildConfig(guild.id);
  const target = o.getChannel('salon')
    || (cfg.announce_channel_id && guild.channels.cache.get(String(cfg.announce_channel_id)))
    || interaction.channel;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Événement Discord natif
  let discordEventId = null;
  let warn = '';
  try {
    const opts = {
      name,
      scheduledStartTime: new Date(startAt),
      scheduledEndTime: new Date(endAt),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      description: description || undefined
    };
    if (voice) {
      opts.entityType = GuildScheduledEventEntityType.Voice;
      opts.channel = voice.id;
    } else {
      opts.entityType = GuildScheduledEventEntityType.External;
      opts.entityMetadata = { location: location || 'Voir annonce' };
    }
    const de = await guild.scheduledEvents.create(opts);
    discordEventId = de.id;
  } catch (e) {
    console.error('[Event] Création événement Discord :', e.message);
    warn = '\n⚠️ Événement Discord natif non créé (permission **Gérer les événements** manquante ?), l\'annonce a quand même été publiée.';
  }

  const now = Date.now();
  const ev = {
    id: `${now}`,
    name, description, startAt, endAt, type,
    voiceId: voice?.id || null,
    location, roleId: role?.id || null,
    maxPlaces,
    channelId: target.id, messageId: null,
    discordEventId,
    hostId: interaction.user.id,
    hostTag: interaction.user.tag,
    yes: [], maybe: [], no: [],
    status: 'scheduled',
    r24: startAt - now <= 24 * 3600 * 1000,
    r1: startAt - now <= 3600 * 1000
  };

  let msg;
  try {
    msg = await target.send({
      content: role ? `${role}` : undefined,
      embeds: [buildEventEmbed(ev)],
      components: [buildRow(ev)],
      allowedMentions: { roles: role ? [role.id] : [] }
    });
  } catch (e) {
    console.error('[Event] Envoi annonce :', e.message);
    if (discordEventId) await (await getDiscordEvent(guild, ev))?.delete().catch(() => { });
    return interaction.editReply(`❌ Impossible d'envoyer l'annonce dans ${target} (permissions du bot ?).`);
  }
  ev.messageId = msg.id;
  guildEvents(guild.id).push(ev);
  persist('events');
  return interaction.editReply(`✅ Événement **${name}** créé dans ${target}.${warn}`);
}

// ── /event list ──
async function listEvents(interaction) {
  const list = activeEvents(interaction.guild.id);
  const lines = list.length
    ? list.map((e, i) => `\`${i + 1}\` **${e.name}** — <t:${Math.floor(e.startAt / 1000)}:F> (${e.yes.length} inscrit(s))${e.status === 'started' ? ' 🔴' : ''}`).join('\n')
    : 'Aucun événement à venir.';
  return interaction.reply({ content: `📅 Événements :\n${lines}`, flags: MessageFlags.Ephemeral });
}

// ── Annulation (partagée par /event cancel et /agenda remove) ──
async function cancelEventObject(interaction, ev) {
  ev.status = 'cancelled';
  ev.endedAt = Date.now();
  persist('events');
  const de = await getDiscordEvent(interaction.guild, ev);
  await de?.delete().catch(() => { });
  await refreshMessage(interaction.client, ev);
  return interaction.reply({ content: `🗑️ Événement **${ev.name}** annulé.`, flags: MessageFlags.Ephemeral });
}
// ── /event cancel ──
async function cancelEvent(interaction) {
  const n = interaction.options.getInteger('numero');
  const ev = activeEvents(interaction.guild.id)[n - 1];
  if (!ev) return interaction.reply({ content: '❌ Événement introuvable (voir `/event list`).', flags: MessageFlags.Ephemeral });
  return cancelEventObject(interaction, ev);
}
// ── /agenda remove (par id, via autocomplétion) ──
async function cancelEventById(interaction, id) {
  const ev = activeEvents(interaction.guild.id).find(e => e.id === String(id));
  if (!ev) return interaction.reply({ content: '❌ Événement introuvable (ou déjà terminé).', flags: MessageFlags.Ephemeral });
  return cancelEventObject(interaction, ev);
}

// ── Boutons d'inscription (customId : evt_<yes|maybe|no>_<id>) ──
async function handleEventButton(i) {
  const [, action, id] = i.customId.split('_');
  const ev = guildEvents(i.guild.id).find(e => e.id === id);
  if (!ev || ev.status !== 'scheduled') {
    return i.reply({ content: '❌ Cet événement n\'accepte plus d\'inscriptions.', flags: MessageFlags.Ephemeral });
  }
  const uid = i.user.id;
  const dejaInscrit = ev.yes.includes(uid);
  if (action === 'yes' && !dejaInscrit && ev.maxPlaces && ev.yes.length >= ev.maxPlaces) {
    return i.reply({ content: '❌ Événement complet.', flags: MessageFlags.Ephemeral });
  }
  for (const k of ['yes', 'maybe', 'no']) ev[k] = ev[k].filter(x => x !== uid);
  ev[action].push(uid);
  persist('events');
  return i.update({ embeds: [buildEventEmbed(ev)], components: [buildRow(ev)] });
}

// ── Boucle : rappels 24h / 1h, démarrage et fin automatiques ──
async function say(client, ev, content) {
  const ch = await client.channels.fetch(ev.channelId).catch(() => null);
  if (!ch) return;
  const users = ev.yes.slice(0, 50);
  const mentions = users.map(id => `<@${id}>`).join(' ');
  await ch.send({
    content: `${content}${mentions ? `\n${mentions}` : ''}`,
    allowedMentions: { users }
  }).catch(() => { });
}
async function tick(client) {
  const now = Date.now();
  for (const gid of Object.keys(store.events || {})) {
    const list = store.events[gid];
    if (!Array.isArray(list)) continue;
    const guild = client.guilds.cache.get(gid);
    let dirty = false;
    for (const ev of list) {
      if (!isNew(ev)) continue;
      try {
        const ts = Math.floor(ev.startAt / 1000);
        if (ev.status === 'scheduled') {
          const diff = ev.startAt - now;
          if (diff <= 0) {
            ev.status = 'started';
            const lieu = ev.voiceId ? `Rendez-vous dans <#${ev.voiceId}> !` : (ev.location ? `Lieu : ${ev.location}` : '');
            await say(client, ev, `🚀 **${ev.name}** commence maintenant ! ${lieu}`);
            const de = guild ? await getDiscordEvent(guild, ev) : null;
            await de?.setStatus(GuildScheduledEventStatus.Active).catch(() => { });
            await refreshMessage(client, ev);
            dirty = true;
          } else if (diff <= 3600 * 1000 && !ev.r1) {
            ev.r1 = ev.r24 = true;
            await say(client, ev, `⏰ **${ev.name}** commence <t:${ts}:R> !`);
            dirty = true;
          } else if (diff <= 24 * 3600 * 1000 && !ev.r24) {
            ev.r24 = true;
            await say(client, ev, `📅 Rappel : **${ev.name}** a lieu <t:${ts}:F> (<t:${ts}:R>).`);
            dirty = true;
          }
        } else if (ev.status === 'started' && now >= ev.endAt) {
          ev.status = 'ended';
          ev.endedAt = now;
          const de = guild ? await getDiscordEvent(guild, ev) : null;
          await de?.setStatus(GuildScheduledEventStatus.Completed).catch(() => { });
          await refreshMessage(client, ev);
          const ch = await client.channels.fetch(ev.channelId).catch(() => null);
          await ch?.send(`✔️ **${ev.name}** est terminé. Merci aux ${ev.yes.length} inscrit(s) !`).catch(() => { });
          dirty = true;
        }
      } catch (e) {
        console.error('[Event] tick :', e.message);
      }
    }
    // Nettoyage : événements terminés/annulés depuis plus de 62 jours
    const kept = list.filter(e => !isNew(e) || !e.endedAt || now - e.endedAt < PRUNE_AFTER_MS);
    if (kept.length !== list.length) {
      store.events[gid] = kept;
      dirty = true;
    }
    if (dirty) persist('events');
  }
}
function startEventLoop(client) {
  setTimeout(() => tick(client).catch(e => console.error('[Event] tick :', e.message)), 10000);
  setInterval(() => tick(client).catch(e => console.error('[Event] tick :', e.message)), TICK_MS);
}

module.exports = {
  createEvent, listEvents, cancelEvent, cancelEventById,
  handleEventButton, startEventLoop,
  // utilisés par /agenda
  EVENT_TYPES, typeOf, activeEvents, eventsInRange, parisParts, parisTimestamp
};