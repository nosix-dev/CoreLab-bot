const fs = require('fs');
const path = require('path');

function loadCommands(client) {
    const dir = path.join(__dirname, '..', 'commands');
    console.log(`[DEBUG] Dossier des commandes : ${dir}`);
    if (!fs.existsSync(dir)) {
        console.log('[DEBUG] ❌ Dossier introuvable !');
        return;
    }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    console.log(`[DEBUG] Fichiers trouvés (${files.length}) :`, files);

    for (const file of files) {
        try {
            const mod = require(path.join(dir, file));
            const list = Array.isArray(mod) ? mod : (mod.commands ? mod.commands : (mod.data ? [mod] : []));
            let added = 0;
            const names = [];
            for (const cmd of list) {
                if (cmd?.data?.name && cmd?.execute) {
                    client.commands.set(cmd.data.name, cmd);
                    added++;
                    names.push(cmd.data.name);
                }
            }
            console.log(`[DEBUG] ${file} → ${list.length} exportées, ${added} ajoutées : ${names.join(', ')}`);
            if (mod.prefixCommands) {
                client.prefixCommands = { ...(client.prefixCommands || {}), ...mod.prefixCommands };
            }
        } catch (e) {
            console.error(`[DEBUG] ❌ ERREUR lors du chargement de ${file} :`, e.message);
            console.error(e.stack);
        }
    }
    console.log(`[DEBUG] TOTAL FINAL client.commands.size = ${client.commands.size}`);
}

module.exports = { loadCommands };
