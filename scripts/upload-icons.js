'use strict';
// Upload des icônes Lucide (SVG) comme emojis d'application Discord.
// Usage : node scripts/upload-icons.js [dossier_icons]   (défaut : ./icons)
// Reprenable : les icônes déjà uploadées sont ignorées.
// Variables .env optionnelles : ICON_COLOR (défaut #ffffff), ICON_SIZE (défaut 128)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || '1403513450273177772';
const ICONS_DIR = path.resolve(process.argv[2] || path.join(__dirname, '..', 'icons'));
const MAP_FILE = path.join(__dirname, '..', 'src', 'data', 'icons-map.json');
const COLOR = process.env.ICON_COLOR || '#ffffff';
const SIZE = parseInt(process.env.ICON_SIZE || '128', 10);
const MAX_EMOJIS = 2000;

if (!TOKEN) { console.error('❌ Token introuvable dans le .env'); process.exit(1); }

// Nom Discord : a-z A-Z 0-9 _ , 2 à 32 caractères
function toEmojiName(file) {
  let n = file.replace(/\.svg$/, '').replace(/[^a-zA-Z0-9]/g, '_');
  if (n.length < 2) n += '_i';
  return n.slice(0, 32);
}

async function svgToPng(svgPath) {
  let svg = fs.readFileSync(svgPath, 'utf8')
    .replace(/currentColor/g, COLOR)
    .replace(/width="24"/, `width="${SIZE}"`)
    .replace(/height="24"/, `height="${SIZE}"`);
  const img = await loadImage(Buffer.from(svg));
  const canvas = createCanvas(SIZE, SIZE);
  canvas.getContext('2d').drawImage(img, 0, 0, SIZE, SIZE);
  return canvas.toBuffer('image/png');
}

(async () => {
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  const res = await rest.get(Routes.applicationEmojis(CLIENT_ID));
  const existing = res.items || res;
  const map = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) : {};
  const known = new Map(existing.map(e => [e.name, e]));
  let total = existing.length;
  console.log(`ℹ️  ${total}/${MAX_EMOJIS} emojis déjà présents.`);

  const files = fs.readdirSync(ICONS_DIR).filter(f => f.endsWith('.svg')).sort();
  const used = new Set();
  let ok = 0, skipped = 0, failed = 0;

  for (const file of files) {
    let name = toEmojiName(file);
    // évite les collisions après troncature
    let i = 1;
    while (used.has(name)) name = name.slice(0, 29) + '_' + (i++);
    used.add(name);

    const key = file.replace(/\.svg$/, '');
    const found = known.get(name);
    if (found) {
      map[key] = `<${found.animated ? 'a' : ''}:${found.name}:${found.id}>`;
      skipped++;
      continue;
    }
    if (total >= MAX_EMOJIS) {
      console.warn(`⚠️  Limite de ${MAX_EMOJIS} atteinte, arrêt à "${key}".`);
      break;
    }
    try {
      const png = await svgToPng(path.join(ICONS_DIR, file));
      const e = await rest.post(Routes.applicationEmojis(CLIENT_ID), {
        body: { name, image: `data:image/png;base64,${png.toString('base64')}` },
      });
      map[key] = `<:${e.name}:${e.id}>`;
      total++; ok++;
      if (ok % 25 === 0) {
        fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 1));
        console.log(`… ${ok} uploadés (${total}/${MAX_EMOJIS})`);
      }
    } catch (err) {
      failed++;
      console.error(`❌ ${key} : ${err.message}`);
    }
  }

  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 1));
  console.log(`\n✅ ${ok} uploadés, ${skipped} déjà présents, ${failed} erreurs.`);
  console.log(`📄 Mapping : ${MAP_FILE}`);
})();
