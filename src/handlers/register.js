const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const { loadCommands } = require('./loadCommands');
const { localizeCommandMetadata } = require('../core/commandLocalizations');
async function registerCommands(client) {
    loadCommands(client);
    const body = localizeCommandMetadata([...client.commands.values()].map(c => c.data.toJSON()));
    const rest = new REST({ version: '10' }).setToken(client.token || process.env.TOKEN2 || process.env.TOKEN);
    const appId = client.application?.id || client.user?.id;
    if (!appId) {
        console.error('❌ Impossible de récupérer l\'ID de l\'application, synchronisation annulée.');
        return;
    }
    await rest.put(Routes.applicationCommands(appId), { body });
    console.log(`✅  ${body.length} commandes synchronisées`);
}
module.exports = { registerCommands };
