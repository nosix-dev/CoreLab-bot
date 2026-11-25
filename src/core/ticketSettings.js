'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Réglages généraux des tickets (communs à tous les panneaux du serveur).
// Stockés dans cfg.ticket_settings, modifiés depuis le dashboard
// (/api/guilds/:id/ticket-settings).
//
//   enabled          : false = plus personne ne peut ouvrir de ticket (réglages gardés)
//   ratingEnabled    : MP de note 1★ → 5★ à la fermeture
//   channelName      : modèle du nom de salon ({number}, {user}, {type})
//   autoCloseHours   : fermeture auto après X heures sans message (0 = jamais)
//   closeReasons     : raisons proposées au staff à la fermeture (25 max)
//   staffRoleId      : rôle staff principal (voit tous les tickets)
//   extraStaffRoleIds: autres rôles staff (20 max)
//   escalationRoleId : rôle qui reçoit les tickets « remontés »
//   escalationCategoryId : catégorie où déplacer les tickets remontés
//   hideEscalated    : retirer l'accès du staff aux tickets remontés
//   blacklist        : membres qui ne peuvent pas ouvrir de ticket (500 max)
// ─────────────────────────────────────────────────────────────────────────

const LIMITS = { closeReasons: 25, reasonLength: 100, extraStaff: 20, blacklist: 500, autoCloseHours: 8760, channelName: 90 };

const DEFAULTS = Object.freeze({
  enabled: true,
  ratingEnabled: true,
  channelName: '',
  autoCloseHours: 0,
  closeReasons: [],
  staffRoleId: '',
  extraStaffRoleIds: [],
  escalationRoleId: '',
  escalationCategoryId: '',
  hideEscalated: false,
  blacklist: []
});

function getTicketSettings(cfg) {
  const s = cfg && typeof cfg.ticket_settings === 'object' && !Array.isArray(cfg.ticket_settings) ? cfg.ticket_settings : {};
  return {
    ...DEFAULTS,
    ...s,
    closeReasons: Array.isArray(s.closeReasons) ? s.closeReasons : [],
    extraStaffRoleIds: Array.isArray(s.extraStaffRoleIds) ? s.extraStaffRoleIds : [],
    blacklist: Array.isArray(s.blacklist) ? s.blacklist : []
  };
}

const isId = v => /^\d{17,20}$/.test(String(v || ''));

// Valide et nettoie ce qui arrive du dashboard. Retourne { settings } ou { error }.
function normalizeTicketSettings(input, guild) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Réglages invalides.' };
  const hours = Number(input.autoCloseHours);
  if (!Number.isFinite(hours) || hours < 0 || hours > LIMITS.autoCloseHours) {
    return { error: `La fermeture automatique doit être entre 0 et ${LIMITS.autoCloseHours} heures.` };
  }
  const closeReasons = (Array.isArray(input.closeReasons) ? input.closeReasons : String(input.closeReasons || '').split('\n'))
    .map(r => String(r || '').trim().slice(0, LIMITS.reasonLength))
    .filter(Boolean);
  if (closeReasons.length > LIMITS.closeReasons) return { error: `${LIMITS.closeReasons} raisons de fermeture maximum.` };

  const blacklist = [];
  for (const entry of Array.isArray(input.blacklist) ? input.blacklist : []) {
    const id = String(entry && typeof entry === 'object' ? entry.id : entry || '').trim();
    if (!isId(id)) return { error: `Identifiant de membre invalide dans la blacklist : ${id || '(vide)'}` };
    if (blacklist.some(b => b.id === id)) continue;
    blacklist.push({
      id,
      tag: String(entry?.tag || '').slice(0, 64),
      reason: String(entry?.reason || '').trim().slice(0, 200),
      addedAt: Number(entry?.addedAt) || Date.now()
    });
  }
  if (blacklist.length > LIMITS.blacklist) return { error: `${LIMITS.blacklist} membres maximum dans la blacklist.` };

  const settings = {
    enabled: input.enabled !== false,
    ratingEnabled: input.ratingEnabled !== false,
    channelName: String(input.channelName || '').trim().slice(0, LIMITS.channelName),
    autoCloseHours: Math.floor(hours),
    closeReasons,
    staffRoleId: String(input.staffRoleId || '').trim(),
    extraStaffRoleIds: [...new Set((Array.isArray(input.extraStaffRoleIds) ? input.extraStaffRoleIds : []).map(String))].slice(0, LIMITS.extraStaff),
    escalationRoleId: String(input.escalationRoleId || '').trim(),
    escalationCategoryId: String(input.escalationCategoryId || '').trim(),
    hideEscalated: input.hideEscalated === true,
    blacklist
  };

  if (guild) {
    const roleIds = new Set(guild.roles.cache.filter(r => r.id !== guild.id).map(r => r.id));
    const roles = [settings.staffRoleId, settings.escalationRoleId, ...settings.extraStaffRoleIds].filter(Boolean);
    if (roles.some(id => !roleIds.has(id))) return { error: 'Un des rôles sélectionnés n’existe plus sur ce serveur.' };
    if (settings.escalationCategoryId) {
      const cat = guild.channels.cache.get(settings.escalationCategoryId);
      if (!cat || cat.type !== 4) return { error: 'La catégorie des tickets remontés est introuvable.' };
    }
  }
  if (settings.hideEscalated && !settings.escalationRoleId) {
    return { error: 'Choisis un rôle d’escalade pour pouvoir cacher les tickets remontés au staff.' };
  }
  return { settings };
}

// Tous les rôles staff « globaux » (rôle principal + autres rôles)
function globalStaffRoleIds(settings) {
  return [...new Set([settings.staffRoleId, ...settings.extraStaffRoleIds].filter(Boolean))];
}

function isBlacklisted(settings, userId) {
  return settings.blacklist.some(b => b.id === String(userId));
}

// Nom du salon d'après le modèle. Vide → ticket-{number}
function buildTicketChannelName(settings, { number, user, type }) {
  const template = settings.channelName || 'ticket-{number}';
  const raw = template
    .replace(/\{number\}/gi, String(number).padStart(4, '0'))
    .replace(/\{user\}/gi, user?.username || 'membre')
    .replace(/\{type\}/gi, type || 'ticket');
  const name = raw
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
  return name || `ticket-${number}`;
}

module.exports = {
  LIMITS,
  DEFAULTS,
  getTicketSettings,
  normalizeTicketSettings,
  globalStaffRoleIds,
  isBlacklisted,
  buildTicketChannelName
};
