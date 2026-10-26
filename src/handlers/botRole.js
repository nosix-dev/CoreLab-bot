// ────────────────────────────────────────────────
// botRole.js — Rôle dédié au bot, créé automatiquement
// Crée (une seule fois par serveur) un rôle "🛡️〢CoreLab" avec la permission
// Administrateur et la couleur noire (000000), puis le place tout en haut
// de la hiérarchie que le bot est autorisé à gérer (juste sous son propre
// rôle le plus haut — Discord interdit à un membre de placer un rôle à une
// position égale ou supérieure à son propre rôle le plus haut).
// ────────────────────────────────────────────────

const { PermissionFlagsBits } = require('discord.js');

const BOT_ROLE_NAME = '🛡️〢CoreLab';
// Ancien nom du rôle (avant le renommage en CoreLab) : sert à renommer le rôle existant
// au lieu d'en créer un second sur les serveurs où ScaraBot était déjà installé.
const ANCIEN_BOT_ROLE_NAME = '🛡️〢ScaraBot';
const BOT_ROLE_COLOR = 0xFFFFFF;

// Crée (si besoin) et repositionne le rôle du bot sur un serveur donné.
// Idempotent : ne recrée rien si le rôle existe déjà.
async function ensureBotRole(guild) {
    try {
        const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        if (!me) return;

        if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
            console.warn(`Permission "Gérer les rôles" manquante sur ${guild.name} (${guild.id}), rôle ${BOT_ROLE_NAME} non créé.`);
            return;
        }

        let role = guild.roles.cache.find(r => r.name === BOT_ROLE_NAME);
        if (!role) {
            // Serveur où l'ancien rôle « ScaraBot » existe encore : on le renomme en CoreLab
            const ancienRole = guild.roles.cache.find(r => r.name === ANCIEN_BOT_ROLE_NAME);
            if (ancienRole) {
                role = await ancienRole.setName(BOT_ROLE_NAME, 'Renommage du bot : ScaraBot → CoreLab').catch(() => ancienRole);
            }
        }
        if (!role) {
            role = await guild.roles.create({
                name: BOT_ROLE_NAME,
                color: BOT_ROLE_COLOR,
                permissions: [PermissionFlagsBits.Administrator],
                hoist: false,
                mentionable: false,
                reason: 'Rôle du bot créé automatiquement (CoreLab)',
            });
        } else {
            // Rôle déjà existant (ex. : bot kické puis réinvité) — on s'assure
            // qu'il garde bien la couleur et la permission attendues.
            const misesAJour = {};
            if (role.color !== BOT_ROLE_COLOR) misesAJour.color = BOT_ROLE_COLOR;
            if (!role.permissions.has(PermissionFlagsBits.Administrator)) misesAJour.permissions = [PermissionFlagsBits.Administrator];
            if (Object.keys(misesAJour).length) {
                role = await role.edit(misesAJour).catch(() => role);
            }
        }

        if (!me.roles.cache.has(role.id)) {
            await me.roles.add(role, 'Attribution automatique du rôle du bot').catch(() => { });
        }

        // Retire du bot tous ses anciens rôles (sauf @everyone, le rôle "managed"
        // que Discord crée automatiquement à l'invitation — impossible à retirer —,
        // et tout rôle positionné au même rang ou au-dessus du rôle le plus haut
        // du bot, que Discord refuse aussi de toucher), pour que le bot ne
        // conserve que le rôle ${BOT_ROLE_NAME}.
        const botHighestAvantNettoyage = me.roles.highest;
        const anciensRoles = me.roles.cache.filter(r =>
            r.id !== role.id &&
            r.id !== guild.id &&
            !r.managed &&
            (!botHighestAvantNettoyage || r.position < botHighestAvantNettoyage.position)
        );
        const rolesHorsDePortee = me.roles.cache.filter(r =>
            r.id !== role.id &&
            r.id !== guild.id &&
            !r.managed &&
            botHighestAvantNettoyage && r.position >= botHighestAvantNettoyage.position
        );
        if (anciensRoles.size) {
            await me.roles.remove(anciensRoles, 'Nettoyage des anciens rôles du bot').catch(e => {
                console.warn(`Impossible de retirer les anciens rôles du bot sur ${guild.name} :`, e.message);
            });
        }
        if (rolesHorsDePortee.size) {
            console.warn(`Rôle(s) trop haut placé(s) pour être retiré(s) automatiquement sur ${guild.name} : ${rolesHorsDePortee.map(r => r.name).join(', ')} — à retirer manuellement ou à redescendre dans la hiérarchie du serveur.`);
        }

        // Replace le rôle tout en haut de la hiérarchie gérable par le bot
        // (juste sous son rôle le plus haut, qui fixe la limite imposée par Discord :
        // impossible d'aller plus haut sans qu'un humain déplace manuellement
        // le rôle managé du bot, ou lui donne un rôle plus haut placé).
        const botHighest = me.roles.highest;
        const positionCible = botHighest && botHighest.id !== role.id ? botHighest.position - 1 : role.position;
        if (positionCible >= 1 && role.position !== positionCible) {
            await role.setPosition(positionCible).catch(e => {
                console.warn(`Impossible de repositionner le rôle ${BOT_ROLE_NAME} sur ${guild.name} :`, e.message);
            });
        }

        // Avertit si d'autres rôles (hors @everyone) restent au-dessus de ${BOT_ROLE_NAME}
        // dans la hiérarchie du serveur — cas normal si le rôle managé du bot n'a
        // jamais été remonté manuellement ; seul un humain peut corriger ça.
        const roleFinal = guild.roles.cache.get(role.id) ?? role;
        const rolesAuDessus = guild.roles.cache.filter(r => r.id !== guild.id && r.position > roleFinal.position);
        if (rolesAuDessus.size) {
            console.warn(`${rolesAuDessus.size} rôle(s) restent au-dessus de ${BOT_ROLE_NAME} sur ${guild.name} (limite imposée par Discord — le rôle managé du bot doit être remonté manuellement par un admin pour aller plus haut) : ${rolesAuDessus.map(r => r.name).join(', ')}`);
        }
    } catch (e) {
        console.error(`Erreur lors de la création du rôle ${BOT_ROLE_NAME} sur ${guild.name} :`, e.message);
    }
}

// À appeler une fois au démarrage (event 'ready') pour rattraper les serveurs
// où le rôle n'existe pas encore (installation de ce système sur un bot déjà en ligne).
async function synchroniserRoleAuDemarrage(client) {
    for (const guild of client.guilds.cache.values()) {
        await ensureBotRole(guild);
        // Petite pause pour éviter de déclencher un rate limit Discord si le bot
        // est présent sur beaucoup de serveurs.
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.log(`✅  Rôle ${BOT_ROLE_NAME} synchronisé sur tous les serveurs.`);
}

function registerBotRoleHandler(client) {
    client.on('guildCreate', guild => {
        ensureBotRole(guild);
    });

    console.log(`✅  Système de rôle automatique du bot (${BOT_ROLE_NAME}) initialisé.`);
}

module.exports = { registerBotRoleHandler, synchroniserRoleAuDemarrage, ensureBotRole, BOT_ROLE_NAME };