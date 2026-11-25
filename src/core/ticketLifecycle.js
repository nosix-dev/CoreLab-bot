'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Cycle de vie d'un ticket ouvert : fermeture (manuelle, avec raison, ou
// automatique pour inactivité) et escalade (« Faire remonter »).
// ─────────────────────────────────────────────────────────────────────────

const { ChannelType } = require('discord.js');
const { getGuildConfig } = require('./config');
const { persist } = require('./data');
const { getTicketSettings, globalStaffRoleIds } = require('./ticketSettings');

const closing = new Set(); // évite une double fermeture du même salon

function ticketPanelOf(cfg, channel) {
  const meta = cfg.ticket_meta?.[channel.id] || {};
  const panelId = meta.panelId || channel.topic?.match(/(?:^|\|\s*)Panneau:\s*([^|]+)/)?.[1]?.trim();
  return cfg.ticket_panels?.[panelId] || null;
}

// Rôles staff d'un ticket : ceux du panneau + les rôles staff globaux
function ticketStaffRoleIds(cfg, channel) {
  const panel = ticketPanelOf(cfg, channel);
  return [...new Set([...(panel?.staffRoleIds || []), ...globalStaffRoleIds(getTicketSettings(cfg))])];
}

function isTicketStaff(member, cfg, channel) {
  if (!member) return false;
  if (member.permissions?.has('ManageGuild') || member.permissions?.has('ManageChannels')) return true;
  const settings = getTicketSettings(cfg);
  const roles = [...ticketStaffRoleIds(cfg, channel), settings.escalationRoleId].filter(Boolean);
  return roles.some(id => member.roles?.cache?.has(id));
}

// Ferme un ticket : transcript + log + MP, puis suppression du salon après `delayMs`.
async function closeTicket(channel, { closer, reason = null, delayMs = 5000 } = {}) {
  if (!channel || closing.has(channel.id)) return false;
  closing.add(channel.id);
  const cfg = getGuildConfig(channel.guild.id);
  cfg.ticket_open_count = Math.max(0, (cfg.ticket_open_count || 1) - 1);
  persist('config');
  try {
    require('./dashboardEvents').pushEvent({
      icon: '🎫',
      tag: 'tag-sys',
      text: `Ticket fermé par ${closer?.tag || closer?.username || 'CoreLab'}${reason ? ` (${reason})` : ''}`,
      server: channel.guild.name
    });
  } catch { /* facultatif */ }

  setTimeout(async () => {
    try {
      await require('./ticketTranscript').sendTicketClosedLog({ channel, closer, cfg, reason });
    } catch (e) {
      console.error('[Ticket] Échec de la transcription :', e);
    }
    try {
      if (cfg.ticket_meta?.[channel.id]) {
        delete cfg.ticket_meta[channel.id];
        persist('config');
      }
    } catch { }
    try { await channel.delete(reason ? `Ticket fermé : ${reason}`.slice(0, 500) : 'Ticket fermé'); } catch { }
    closing.delete(channel.id);
  }, delayMs);
  return true;
}

// Fait remonter un ticket vers le rôle d'escalade
async function escalateTicket(channel, member) {
  const cfg = getGuildConfig(channel.guild.id);
  const settings = getTicketSettings(cfg);
  const guild = channel.guild;
  const role = settings.escalationRoleId && guild.roles.cache.get(settings.escalationRoleId);
  if (!role) return { error: '❌ Aucun rôle d’escalade n’est configuré (dashboard → Tickets).' };
  const meta = cfg.ticket_meta?.[channel.id];
  if (meta?.escalated) return { error: '❌ Ce ticket a déjà été remonté.' };

  await channel.permissionOverwrites.edit(role.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, { reason: `Ticket remonté par ${member.user.tag}` });

  if (settings.escalationCategoryId) {
    const category = guild.channels.cache.get(settings.escalationCategoryId);
    if (category?.type === ChannelType.GuildCategory) {
      await channel.setParent(category.id, { lockPermissions: false, reason: 'Ticket remonté' }).catch(e => console.warn('[Ticket] Déplacement impossible :', e.message));
    }
  }

  if (settings.hideEscalated) {
    for (const roleId of ticketStaffRoleIds(cfg, channel)) {
      if (roleId === role.id) continue;
      await channel.permissionOverwrites.edit(roleId, { ViewChannel: false }, { reason: 'Ticket remonté : caché au staff' }).catch(() => {});
    }
  }

  if (meta) {
    meta.escalated = { by: member.id, at: Date.now() };
    persist('config');
  }
  return { role };
}

// Fermeture automatique des tickets sans message depuis X heures
async function autoCloseInactiveTickets(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = getGuildConfig(guild.id);
    const hours = getTicketSettings(cfg).autoCloseHours;
    if (!hours || !cfg.ticket_meta) continue;
    const limit = Date.now() - hours * 3600 * 1000;
    for (const [channelId, meta] of Object.entries(cfg.ticket_meta)) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel?.isTextBased()) continue;
      try {
        let last = meta.openedAt || channel.createdTimestamp;
        const msgs = await channel.messages.fetch({ limit: 1 });
        const lastMsg = msgs.first();
        if (lastMsg) last = Math.max(last, lastMsg.createdTimestamp);
        if (last > limit) continue;
        await channel.send(`⏱️ Ticket fermé automatiquement : aucun message depuis ${hours} h.`).catch(() => {});
        await closeTicket(channel, { closer: client.user, reason: `Inactivité (${hours} h)`, delayMs: 3000 });
      } catch (e) {
        console.warn(`[Ticket] Fermeture auto impossible pour ${channelId} :`, e.message);
      }
    }
  }
}

let autoCloseTimer = null;
function startTicketAutoClose(client) {
  if (autoCloseTimer) return;
  const run = () => autoCloseInactiveTickets(client).catch(e => console.error('[Ticket] fermeture auto :', e.message));
  autoCloseTimer = setInterval(run, 10 * 60 * 1000);
  setTimeout(run, 60 * 1000);
}

module.exports = { ticketStaffRoleIds, isTicketStaff, closeTicket, escalateTicket, autoCloseInactiveTickets, startTicketAutoClose };
