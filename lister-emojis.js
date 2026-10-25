// lister-emojis.js
// ────────────────────────────────────────────────
// Lance ce script une seule fois pour voir la liste de tes emojis
// d'application actuels (ceux déjà uploadés sur le Developer Portal).
//
// Utilisation :
//   node lister-emojis.js
//
// Colle le résultat affiché dans le chat pour que je puisse aligner
// automatiquement src/core/emojis.js sur tes noms existants.
// ────────────────────────────────────────────────

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
const CLIENT_ID = '1403513450273177772';

if (!TOKEN) {
  console.error('❌ Aucun token trouvé dans le .env (variable TOKEN / DISCORD_TOKEN / BOT_TOKEN attendue).');
  process.exit(1);
}

(async () => {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    const emojis = await rest.get(Routes.applicationEmojis(CLIENT_ID));
    const liste = emojis.items || emojis; // selon version de discord.js/@discordjs/rest

    if (!liste.length) {
      console.log('Aucun emoji d\'application trouvé sur ce compte.');
      return;
    }

    console.log(`\n${liste.length} emoji(s) d'application trouvé(s) :\n`);
    for (const e of liste) {
      console.log(`- name: "${e.name}"  id: ${e.id}  animated: ${!!e.animated}`);
    }
    console.log('\nCopie tout ce bloc et colle-le dans le chat.');
  } catch (err) {
    console.error('❌ Erreur lors de la récupération des emojis :', err.message);
  }
})();
