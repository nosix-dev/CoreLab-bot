'use strict';

// Icônes Lucide (emojis d'application) — généré par scripts/upload-icons.js
// Usage :
//   const { icon } = require('./emojis');
//   icon('rocket')            -> '<:rocket:123456789>'
//   icon('shield-check')      -> '<:shield_check:123456789>'
//   icon('inconnu', '❔')      -> '❔' (fallback)

const fs = require('fs');
const path = require('path');

const MAP_FILE = path.join(__dirname, '..', 'data', 'icons-map.json');
let map = {};

function load() {
  try { map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')); }
  catch { map = {}; }
}
load();

function icon(name, fallback = '') {
  return map[name] || map[String(name).replace(/_/g, '-')] || fallback;
}

// Pour setEmoji() des boutons / menus : { id, name }
function iconObj(name) {
  const m = /^<a?:(\w+):(\d+)>$/.exec(icon(name));
  return m ? { name: m[1], id: m[2] } : undefined;
}

module.exports = { icon, iconObj, reload: load, map: () => map };
