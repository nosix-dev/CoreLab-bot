'use strict';
// Supprime TOUS les emojis d'application (Developer Portal) du bot
// et remet src/data/icons-map.json à zéro.
// Usage : node supprimer-emojis.js          (aperçu, ne supprime rien)
//         node supprimer-emojis.js --confirm (supprime pour de bon)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || '1403513450273177772';
const MAP_FILE = path.join(__dirname, 'src', 'data', 'icons-map.json');
const CONFIRM = process.argv.includes('--confirm');

if (!TOKEN) { console.error('❌ Token introuvable dans le .env'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const res = await rest.get(Routes.applicationEmojis(CLIENT_ID));
  const emojis = res.items || res;

  console.log(`ℹ️  ${emojis.length} emojis d'application trouvés.`);
  if (!CONFIRM) {
    console.log('⚠️  Aperçu uniquement. Relance avec --confirm pour tout supprimer (irréversible).');
    return;
  }

  let ok = 0, failed = 0;
  for (const e of emojis) {
    try {
      await rest.delete(Routes.applicationEmoji(CLIENT_ID, e.id));
      ok++;
      if (ok % 50 === 0) console.log(`🗑️  ${ok}/${emojis.length}`);
    } catch (err) {
      failed++;
      console.error(`❌ ${e.name} : ${err.message}`);
    }
    await sleep(250);
  }

  fs.writeFileSync(MAP_FILE, '{}\n');
  console.log(`✅ ${ok} supprimés, ${failed} échecs. icons-map.json vidé.`);
})();
