'use strict';
/**
 * Documentation vivante pour le site : GET /docs  (alias /commands)
 *
 * Le contenu est généré à la volée à partir des commandes RÉELLEMENT chargées par le bot
 * (les mêmes que celles envoyées à Discord) : toute commande, sous-commande, option, description
 * ou permission ajoutée / modifiée / retirée apparaît donc sur le site sans rien toucher d'autre.
 * On y trouve aussi les modules de protection, la version actuelle et le dernier changelog.
 */
const fs = require('fs');
const path = require('path');
const { PermissionsBitField } = require('discord.js');
const { localizeCommandMetadata } = require('./commandLocalizations');
const { HELP_CATEGORIES } = require('./helpCategories');

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=60'
};

// Types d'options Discord -> libellé lisible
const OPTION_TYPES = { 3: 'texte', 4: 'entier', 5: 'booléen', 6: 'membre', 7: 'salon', 8: 'rôle', 9: 'mention', 10: 'nombre', 11: 'fichier' };

function permsOf(bits) {
  if (!bits) return [];
  try { return new PermissionsBitField(BigInt(bits)).toArray(); } catch { return []; }
}

function mapOptions(options = []) {
  return options.filter(o => o.type > 2).map(o => ({
    name: o.name,
    description: o.description || '',
    type: OPTION_TYPES[o.type] || 'texte',
    required: !!o.required
  }));
}

function mapSub(node) {
  // sous-commande (type 1) ou groupe de sous-commandes (type 2)
  const subs = (node.options || []).filter(o => o.type === 1 || o.type === 2);
  return {
    name: node.name,
    description: node.description || '',
    options: mapOptions(node.options),
    subcommands: subs.map(mapSub)
  };
}

function categoryOf(internalName) {
  const cat = HELP_CATEGORIES.find(c => c.commands.includes(internalName));
  return cat ? { key: cat.key, label: cat.label, emoji: cat.emoji } : { key: 'autres', label: 'Autres', emoji: '📦' };
}

function readUpdate() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'update.json'), 'utf8')); } catch { return null; }
}

function buildDocs(client) {
  const entries = [...(client.commands?.values?.() || [])];
  const json = localizeCommandMetadata(entries.map(c => c.data.toJSON()));
  const commands = json.map((j, i) => {
    const subs = (j.options || []).filter(o => o.type === 1 || o.type === 2);
    return {
      name: j.name,
      description: j.description || '',
      category: categoryOf(entries[i]?.data?.name),
      permissions: permsOf(j.default_member_permissions),
      options: mapOptions(j.options),
      subcommands: subs.map(mapSub)
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  let modules = [];
  try { modules = require('./protectCard').MODULES.map(m => ({ key: m.key, label: m.label, type: m.kind === 'toggle' ? 'activable' : 'configurable' })); } catch { /* sans modules */ }

  const up = readUpdate();
  const categories = [...new Map(commands.map(c => [c.category.key, c.category])).values()]
    .map(cat => ({ ...cat, count: commands.filter(c => c.category.key === cat.key).length }));

  return {
    generatedAt: new Date().toISOString(),
    version: up?.version || null,
    totalCommands: commands.length,
    categories,
    commands,
    protectionModules: modules,
    lastUpdate: up ? { version: up.version, date: up.date, titre: up.titre, intro: up.intro, modifications: up.modifications } : null
  };
}

let cache = { at: 0, body: null };

/** @returns {boolean} true si la requête a été traitée */
function handle(req, res, { client }) {
  const url = req.url.split('?')[0];
  if (url !== '/docs' && url !== '/commands') return false;
  if (req.method === 'OPTIONS') { res.writeHead(204, HEADERS); res.end(); return true; }
  try {
    if (!cache.body || Date.now() - cache.at > 30000) cache = { at: Date.now(), body: JSON.stringify(buildDocs(client)) };
    res.writeHead(200, HEADERS);
    res.end(cache.body);
  } catch (e) {
    console.error('[Docs] :', e.message);
    res.writeHead(500, HEADERS);
    res.end(JSON.stringify({ commands: [] }));
  }
  return true;
}

module.exports = { handle, buildDocs };
