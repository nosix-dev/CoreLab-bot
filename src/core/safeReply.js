// ────────────────────────────────────────────────
// safeReply : wrapper pour catcher proprement les erreurs
// réseau/DNS (EAI_AGAIN, timeout, Unknown interaction 10062...)
// lors d'un interaction.reply() ou interaction.editReply().
//
// Objectif : éviter que ces erreurs remontent comme des
// exceptions non gérées / stack traces complètes dans les logs,
// tout en gardant une trace claire de ce qui s'est passé.
// ────────────────────────────────────────────────

const NETWORK_ERROR_CODES = ['EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'];
const DISCORD_UNKNOWN_INTERACTION = 10062;

function isNetworkOrExpiredError(err) {
    if (!err) return false;
    if (NETWORK_ERROR_CODES.includes(err.code)) return true;
    if (err.code === DISCORD_UNKNOWN_INTERACTION) return true;
    return false;
}

/**
 * Répond à une interaction de façon sécurisée.
 * @param {import('discord.js').Interaction} interaction
 * @param {object} payload - le contenu à envoyer (content, embeds, components, flags...)
 * @returns {Promise<boolean>} true si la réponse a réussi, false sinon
 */
async function safeReply(interaction, payload) {
    try {
        if (interaction.deferred) {
            await interaction.editReply(payload);
        } else if (interaction.replied) {
            await interaction.followUp(payload);
        } else {
            await interaction.reply(payload);
        }
        return true;
    } catch (err) {
        if (isNetworkOrExpiredError(err)) {
            console.error(`[safeReply] ⚠️ Réponse impossible (réseau/interaction expirée) : ${err.message}`);
        } else {
            console.error('[safeReply] ❌ Erreur inattendue lors de la réponse :', err);
        }
        return false;
    }
}

/**
 * Modifie une réponse déjà envoyée (editReply) de façon sécurisée.
 */
async function safeEditReply(interaction, payload) {
    try {
        await interaction.editReply(payload);
        return true;
    } catch (err) {
        if (isNetworkOrExpiredError(err)) {
            console.error(`[safeReply] ⚠️ editReply impossible (réseau/interaction expirée) : ${err.message}`);
        } else {
            console.error('[safeReply] ❌ Erreur inattendue lors de editReply :', err);
        }
        return false;
    }
}

/**
 * Met à jour un message via un composant (bouton/select) de façon sécurisée.
 * Si l'interaction a déjà été deferred (ex: filet de sécurité auto-defer
 * déclenché parce que l'event loop était occupée), on passe par editReply()
 * au lieu de update() pour éviter l'erreur "InteractionAlreadyReplied".
 */
async function safeComponentUpdate(interaction, payload) {
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.update(payload);
        }
        return true;
    } catch (err) {
        if (isNetworkOrExpiredError(err)) {
            console.error(`[safeReply] ⚠️ update impossible (réseau/interaction expirée) : ${err.message}`);
        } else {
            console.error('[safeReply] ❌ Erreur inattendue lors de update :', err);
        }
        return false;
    }
}

module.exports = { safeReply, safeEditReply, safeComponentUpdate, isNetworkOrExpiredError };