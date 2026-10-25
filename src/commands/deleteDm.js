// !deletedm — à utiliser en DM avec le bot.
// Supprime tous les messages que LE BOT a envoyés dans ce DM (Discord ne
// permet pas à un bot de supprimer les messages de l'utilisateur dans un
// DM, uniquement les siens). Réservé au propriétaire du bot.

async function deleteDm(message, client) {
    if (message.author.id !== client.BOT_OWNER_ID) {
        return message.channel.send('❌ Vous n\'êtes pas autorisé.');
    }

    const statut = await message.channel.send('🗑️ Suppression en cours...');

    let supprimes = 0;
    let avantId = undefined;

    try {
        while (true) {
            const options = { limit: 100 };
            if (avantId) options.before = avantId;

            const lot = await message.channel.messages.fetch(options);
            if (lot.size === 0) break;

            avantId = lot.last().id;

            const messagesBot = lot.filter(m => m.author.id === client.user.id);
            for (const m of messagesBot.values()) {
                try {
                    await m.delete();
                    supprimes++;
                } catch (e) {
                    console.error('[!deletedm] Impossible de supprimer un message DM :', e.message);
                }
                // Petite pause pour rester sous la limite de rate-limit Discord
                await new Promise(r => setTimeout(r, 300));
            }

            if (lot.size < 100) break;
        }
    } catch (e) {
        console.error('[!deletedm] Erreur pendant la suppression :', e.message);
        return statut.edit(`⚠️ Erreur pendant la suppression (${supprimes} message(s) supprimé(s) avant l'erreur).`).catch(() => {});
    }

    await statut.edit(`✅ ${supprimes} message(s) du bot supprimé(s) dans ce DM.`).catch(() => {});
    setTimeout(() => statut.delete().catch(() => {}), 5000);
}

module.exports = { deleteDm };