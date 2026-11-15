'use strict';
/**
 * Personnalisation des notifications (YouTube, Twitch, TikTok, Instagram, Medal, Blog).
 * Chaque entrée suivie peut avoir :
 *   enabled : false  → la notification est en pause (absent = actif)
 *   custom  : { content, title, description, color, footer, showImage, showThumb,
 *               button, buttonLabel, mention }
 * Variables utilisables dans les textes : {auteur} {titre} {url} {plateforme} (+ {viewers} {abonnes} sur Twitch)
 */
const { EmbedBuilder } = require('discord.js');

const LIMITES = { content: 600, title: 256, description: 1500, footer: 200, buttonLabel: 80 };
const HEX = /^#[0-9a-f]{6}$/i;

const actif = entry => !entry || entry.enabled !== false;

function remplir(modele, vars) {
  return String(modele).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

/** Nettoie un objet "custom" reçu du dashboard (valeurs inconnues ou trop longues ignorées). */
function nettoyerCustom(brut) {
  const c = {};
  if (!brut || typeof brut !== 'object') return c;
  for (const k of ['content', 'title', 'description', 'footer', 'buttonLabel']) {
    if (typeof brut[k] === 'string' && brut[k].trim()) c[k] = brut[k].trim().slice(0, LIMITES[k]);
  }
  if (typeof brut.color === 'string' && HEX.test(brut.color)) c.color = brut.color.toLowerCase();
  for (const k of ['showImage', 'showThumb', 'button']) {
    if (brut[k] === false) c[k] = false;
  }
  if (typeof brut.mention === 'string' && (brut.mention === 'everyone' || brut.mention === 'here' || /^\d{15,25}$/.test(brut.mention))) {
    c.mention = brut.mention;
  }
  return c;
}

/**
 * Applique la personnalisation d'une entrée à un payload { content, embeds, components }.
 * À appeler juste avant toCV2Payload() / channel.send().
 */
function personnaliser(entry, payload, vars = {}) {
  const c = entry && entry.custom;
  if (!c || typeof c !== 'object' || !Object.keys(c).length) return payload;
  const out = { ...payload };

  let content = typeof c.content === 'string' && c.content ? remplir(c.content, vars) : payload.content;
  if (c.mention) {
    const ping = c.mention === 'everyone' ? '@everyone' : c.mention === 'here' ? '@here' : `<@&${c.mention}>`;
    content = content ? `${ping} ${content}` : ping;
  }
  if (content !== undefined) out.content = String(content).slice(0, 2000);

  if (Array.isArray(payload.embeds) && payload.embeds[0]) {
    const base = payload.embeds[0];
    const e = new EmbedBuilder(typeof base.toJSON === 'function' ? base.toJSON() : base);
    if (c.title) e.setTitle(remplir(c.title, vars).slice(0, 256));
    if (c.description) e.setDescription(remplir(c.description, vars).slice(0, 4000));
    if (c.color && HEX.test(c.color)) e.setColor(parseInt(c.color.slice(1), 16));
    if (c.footer) {
      const ancien = e.data.footer || {};
      e.setFooter({ text: remplir(c.footer, vars).slice(0, 2048), iconURL: ancien.icon_url });
    }
    if (c.showImage === false) delete e.data.image;
    if (c.showThumb === false) delete e.data.thumbnail;
    out.embeds = [e, ...payload.embeds.slice(1)];
  }

  if (c.button === false) out.components = [];
  else if (c.buttonLabel && Array.isArray(payload.components)) {
    const premier = payload.components[0] && payload.components[0].components && payload.components[0].components[0];
    if (premier && typeof premier.setLabel === 'function') premier.setLabel(remplir(c.buttonLabel, vars).slice(0, 80));
  }
  return out;
}

module.exports = { actif, personnaliser, nettoyerCustom, remplir, LIMITES };
