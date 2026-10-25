// ────────────────────────────────────────────────
// nicknameGuard.js — Anti-changement de pseudo du bot
// Si quelqu'un modifie manuellement le pseudo du bot sur le serveur
// (autrement que via /set-nickname ou /reset-nickname),
// on le restaure automatiquement à la valeur enregistrée dans la config
// (cfg.bot_nickname, null = pas de pseudo custom = pseudo par défaut).
// ────────────────────────────────────────────────

const { getGuildConfig } = require('../core/config');

// Corrige le pseudo du bot sur un serveur s'il ne correspond pas à la valeur attendue.
async function corrigerPseudoSurGuilde(guild) {
    try {
        const me = guild.members.me;
        if (!me) return;
        const cfg = getGuildConfig(guild.id);
        const pseudoAttendu = cfg.bot_nickname || null;
        if ((me.nickname || null) === pseudoAttendu) return;
        await me.setNickname(pseudoAttendu, 'Restauration automatique du pseudo par défaut du bot');
    } catch (e) {
        console.error(`Erreur correction pseudo au démarrage (guilde ${guild.id}) :`, e.message);
    }
}

// À appeler une fois au démarrage (event 'ready') pour rattraper les serveurs où
// le pseudo du bot a déjà été changé avant l'installation de ce système.
async function synchroniserPseudosAuDemarrage(client) {
    for (const guild of client.guilds.cache.values()) {
        await corrigerPseudoSurGuilde(guild);
        // Petite pause pour éviter de déclencher un rate limit Discord si le bot
        // est présent sur beaucoup de serveurs.
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.log('✅  Pseudos du bot synchronisés sur tous les serveurs.');
}

function registerNicknameGuardHandler(client) {
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        try {
            // On ne s'intéresse qu'aux changements sur le bot lui-même
            if (newMember.id !== newMember.guild.members.me?.id) return;
            if (oldMember.nickname === newMember.nickname) return;

            const cfg = getGuildConfig(newMember.guild.id);
            const pseudoAttendu = cfg.bot_nickname || null;

            // Le changement correspond déjà à ce qui est attendu (ex: notre propre
            // /set-nickname ou /reset-nickname vient de s'appliquer) → rien à faire.
            if ((newMember.nickname || null) === pseudoAttendu) return;

            await newMember.setNickname(pseudoAttendu, 'Restauration automatique du pseudo par défaut du bot');
        } catch (e) {
            console.error('Erreur handler nicknameGuard (guildMemberUpdate) :', e);
        }
    });

    console.log('✅ Système de protection du pseudo du bot initialisé.');
}

module.exports = { registerNicknameGuardHandler, synchroniserPseudosAuDemarrage };