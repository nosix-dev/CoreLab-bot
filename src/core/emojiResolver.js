'use strict';

// ────────────────────────────────────────────────
// Conversion automatique des :nom: en emojis personnalisés.
//
// Discord ne convertit pas ":nom:" dans les messages envoyés par un bot
// (ni dans les modals). Ce module s'accroche à MessagePayload.resolveBody
// de discord.js : TOUT message sortant (send, reply, edit, update, followUp,
// webhooks, panels Components V2, embeds…) passe par là. On y remplace
// ":nom:" par "<:nom:id>" (ou "<a:nom:id>" pour les animés).
//
// Ordre de recherche :
//   1. emojis du serveur où le message est envoyé
//   2. emojis d'application (Developer Portal) — fonctionnent partout
//   3. icons-map.json (icônes Lucide ; "_" et "-" équivalents)
//   4. emojis de tous les autres serveurs du bot
// Un ":nom:" inconnu reste tel quel. Le code (`...` et ```...```) est ignoré.
// ────────────────────────────────────────────────

const { MessagePayload } = require('discord.js');
const { map: iconsMap } = require('./emojis');

const SHORTCODE = /(?<![<\w:/]):([A-Za-z0-9_-]{2,32}):(?!\w)/g;
const CODE_SEGMENT = /```[\s\S]*?```|`[^`\n]*`/g;

// Type Components V2 : TextDisplay
const TEXT_DISPLAY = 10;

function norm(s) {
  return String(s).toLowerCase().replace(/-/g, '_');
}

function findEmoji(name, guild, client) {
  const n = norm(name);
  const same = e => e && e.name && norm(e.name) === n && e.available !== false;

  const g = guild?.emojis?.cache?.find(same);
  if (g) return g.toString();

  const app = client?.application?.emojis?.cache?.find(same);
  if (app) return app.toString();

  const icons = iconsMap();
  const fromMap = icons[name] || icons[name.replace(/_/g, '-')] || icons[name.replace(/-/g, '_')];
  if (fromMap) return fromMap;

  const any = client?.emojis?.cache?.find(same);
  if (any) return any.toString();

  return null;
}

function convertText(text, guild, client) {
  if (typeof text !== 'string' || !text.includes(':')) return text;
  const convertPart = part => part.replace(SHORTCODE, (match, name) => findEmoji(name, guild, client) || match);

  let out = '';
  let last = 0;
  for (const m of text.matchAll(CODE_SEGMENT)) {
    out += convertPart(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + convertPart(text.slice(last));
}

function walkComponents(list, ctx) {
  if (!Array.isArray(list)) return;
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    if (c.type === TEXT_DISPLAY && typeof c.content === 'string') {
      c.content = convertText(c.content, ctx.guild, ctx.client);
    }
    if (Array.isArray(c.components)) walkComponents(c.components, ctx);
    if (c.accessory && typeof c.accessory === 'object') walkComponents([c.accessory], ctx);
  }
}

function transformBody(body, ctx) {
  if (!body || typeof body !== 'object') return;
  const conv = t => convertText(t, ctx.guild, ctx.client);

  if (typeof body.content === 'string') body.content = conv(body.content);

  if (Array.isArray(body.embeds)) {
    for (const e of body.embeds) {
      if (!e || typeof e !== 'object') continue;
      if (e.title) e.title = conv(e.title);
      if (e.description) e.description = conv(e.description);
      if (e.author?.name) e.author.name = conv(e.author.name);
      if (e.footer?.text) e.footer.text = conv(e.footer.text);
      if (Array.isArray(e.fields)) {
        for (const f of e.fields) {
          if (f?.name) f.name = conv(f.name);
          if (f?.value) f.value = conv(f.value);
        }
      }
    }
  }

  walkComponents(body.components, ctx);
}

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const original = MessagePayload.prototype.resolveBody;
  MessagePayload.prototype.resolveBody = function patchedResolveBody(...args) {
    const result = original.apply(this, args);
    try {
      const target = this.target;
      const client = target?.client || null;
      const guild = target?.guild || target?.channel?.guild || null;
      transformBody(this.body, { guild, client });
    } catch (e) {
      console.error('emojiResolver :', e.message);
    }
    return result;
  };
}

// À appeler au clientReady : charge les emojis d'application dans le cache.
async function loadApplicationEmojis(client) {
  try {
    await client.application.emojis.fetch();
    console.log(`Emojis d'application chargés : ${client.application.emojis.cache.size}`);
  } catch (e) {
    console.error('Impossible de charger les emojis d\'application :', e.message);
  }
}

install();

module.exports = { install, convertText, loadApplicationEmojis };
