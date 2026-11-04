'use strict';

// ─────────────────────────────────────────────────────────────────────────
// DISCON : niveau de danger du serveur (5 = tout va bien → 1 = catastrophe)
//   5 Tout va bien : rien de changé
//   4 Vigilance    : vérification élevée
//   3 Alerte       : vérification maximale + blocage des MP
//   2 Critique     : vérification maximale + blocage des MP
//   1 Catastrophe  : idem + verrouillage des salons (plus personne ne peut écrire ni réagir)
// Au passage vers 5, le niveau de vérification d'origine est restauré et les salons déverrouillés.
// Données : discon.json → { [guildId]: { level, panelChannelId, panelMessageId, statusChannelId,
//                                         previousVerification, locked: { [channelId]: 'deny'|'allow'|'neutral' } } }
// ─────────────────────────────────────────────────────────────────────────

const {
  ChannelType,
  GuildVerificationLevel,
  PermissionFlagsBits,
  Routes,
} = require('discord.js');
const { chargerDonnees, sauvegarderDonnees } = require('./data');

const FICHIER = 'discon.json';
const MAX_BLOCAGE_MP_MS = 24 * 60 * 60 * 1000; // limite Discord : 24 h, renouvelé toutes les 12 h

const NIVEAUX = {
  5: { nom: 'Tout va bien', couleur: 0x3498DB, pastille: '🔵', effet: 'aucune restriction' },
  4: { nom: 'Vigilance', couleur: 0x2ECC71, pastille: '🟢', effet: 'vérification élevée' },
  3: { nom: 'Alerte', couleur: 0xF1C40F, pastille: '🟡', effet: 'vérification maximale, blocage des MP' },
  2: { nom: 'Critique', couleur: 0xE74C3C, pastille: '🔴', effet: 'vérification maximale, blocage des MP' },
  1: { nom: 'Catastrophe', couleur: 0xFFFFFF, pastille: '⚪', effet: 'vérification maximale, blocage des MP, verrouillage, plus personne ne peut écrire ni réagir' },
};

let donnees = chargerDonnees(FICHIER, {});
let timer = null;
function planifierSauvegarde() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; sauvegarderDonnees(FICHIER, donnees); }, 1500);
  timer.unref?.();
}
function etat(guildId) {
  const g = String(guildId);
  if (!donnees[g]) donnees[g] = { level: 5, panelChannelId: null, panelMessageId: null, statusChannelId: null, previousVerification: null, locked: {} };
  return donnees[g];
}
function niveauActuel(guildId) { return etat(guildId).level || 5; }

// ── Blocage des MP / invitations (Discord : incident actions) ──────────────
async function definirBlocageMp(guild, actif) {
  const until = actif ? new Date(Date.now() + MAX_BLOCAGE_MP_MS).toISOString() : null;
  try {
    await guild.client.rest.put(Routes.guild(guild.id) + '/incident-actions', {
      body: { dms_disabled_until: until },
    });
  } catch (e) {
    console.error(`[DISCON] blocage MP (${guild.id}) :`, e.message);
  }
}

// ── Verrouillage des salons (réutilise le principe du Cadenas) ─────────────
async function verrouiller(guild, s) {
  const everyone = guild.roles.everyone.id;
  s.locked = s.locked || {};
  for (const c of guild.channels.cache.values()) {
    if (!c.permissionOverwrites || c.isThread?.()) continue;
    if (c.id in s.locked) continue;
    try {
      const ow = c.permissionOverwrites.cache.get(everyone);
      s.locked[c.id] = ow?.deny?.has(PermissionFlagsBits.SendMessages) ? 'deny'
        : ow?.allow?.has(PermissionFlagsBits.SendMessages) ? 'allow' : 'neutral';
      await c.permissionOverwrites.edit(everyone, { SendMessages: false, AddReactions: false, SendMessagesInThreads: false, CreatePublicThreads: false }, { reason: 'DISCON 1 — catastrophe' });
    } catch (e) { delete s.locked[c.id]; console.error(`[DISCON] verrouillage ${c.id} :`, e.message); }
  }
}
async function deverrouiller(guild, s) {
  const everyone = guild.roles.everyone.id;
  for (const [id, avant] of Object.entries(s.locked || {})) {
    const c = guild.channels.cache.get(id);
    if (!c) continue;
    try {
      const v = avant === 'deny' ? false : avant === 'allow' ? true : null;
      await c.permissionOverwrites.edit(everyone, { SendMessages: v, AddReactions: null, SendMessagesInThreads: null, CreatePublicThreads: null }, { reason: 'Fin du DISCON' });
    } catch (e) { console.error(`[DISCON] déverrouillage ${id} :`, e.message); }
  }
  s.locked = {};
}

// ── Application d'un niveau ────────────────────────────────────────────────
async function appliquerNiveau(guild, niveau, raison = 'DISCON') {
  const s = etat(guild.id);
  const ancien = s.level || 5;
  if (ancien === 5 && niveau !== 5 && s.previousVerification == null) s.previousVerification = guild.verificationLevel;

  let verif = null;
  if (niveau === 5) verif = s.previousVerification ?? null;
  else if (niveau === 4) verif = GuildVerificationLevel.High;
  else verif = GuildVerificationLevel.VeryHigh;

  // Ne jamais baisser la vérification en dessous de ce que le serveur avait déjà
  if (niveau !== 5 && s.previousVerification != null && verif < s.previousVerification) verif = s.previousVerification;

  try { if (verif != null && guild.verificationLevel !== verif) await guild.setVerificationLevel(verif, `${raison} ${niveau}`); }
  catch (e) { console.error(`[DISCON] vérification (${guild.id}) :`, e.message); }

  await definirBlocageMp(guild, niveau <= 3);

  if (niveau === 1) await verrouiller(guild, s);
  else if (Object.keys(s.locked || {}).length) await deverrouiller(guild, s);

  if (niveau === 5) s.previousVerification = null;
  s.level = niveau;
  planifierSauvegarde();
  await majSalonStatut(guild).catch(() => {});
  return { ancien, niveau };
}

// ── Salon vocal de statut (premium) : le nom reflète le niveau ────────────
function nomSalonStatut(niveau) {
  const n = NIVEAUX[niveau];
  return `${n.pastille} DISCON ${niveau} • ${n.nom}`.slice(0, 100);
}
async function majSalonStatut(guild) {
  const s = etat(guild.id);
  if (!s.statusChannelId) return;
  const c = guild.channels.cache.get(s.statusChannelId) || await guild.channels.fetch(s.statusChannelId).catch(() => null);
  if (!c) { s.statusChannelId = null; planifierSauvegarde(); return; }
  const nom = nomSalonStatut(s.level || 5);
  if (c.name !== nom) await c.setName(nom, 'DISCON — mise à jour du statut');
}
async function creerSalonStatut(guild) {
  const s = etat(guild.id);
  const c = await guild.channels.create({
    name: nomSalonStatut(s.level || 5),
    type: ChannelType.GuildVoice,
    permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect], allow: [PermissionFlagsBits.ViewChannel] }],
    reason: 'DISCON — salon vocal de statut',
  });
  s.statusChannelId = c.id;
  planifierSauvegarde();
  return c;
}

// ── Renouvellement du blocage des MP (24 h max côté Discord) ───────────────
function demarrerRenouvellement(client) {
  const t = setInterval(() => {
    for (const [gid, s] of Object.entries(donnees)) {
      if ((s.level || 5) > 3) continue;
      const g = client.guilds.cache.get(gid);
      if (g) definirBlocageMp(g, true);
    }
  }, 12 * 60 * 60 * 1000);
  t.unref?.();
}

module.exports = {
  NIVEAUX, etat, niveauActuel, appliquerNiveau, creerSalonStatut, majSalonStatut,
  nomSalonStatut, demarrerRenouvellement, planifierSauvegarde,
};
