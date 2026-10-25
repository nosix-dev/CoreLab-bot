'use strict';

// ─────────────────────────────────────────────────────────────────────────
// backup.js — Sauvegarde et restauration de la structure d'un serveur
// (rôles, catégories, salons, permissions) pour /backup.
//
// Une backup est enregistrée par UTILISATEUR (pas par serveur) : elle peut
// donc être créée sur un serveur A puis chargée sur un serveur B, ce qui
// permet de "copier" une structure de serveur vers un autre.
//
// Les permissions par rôle sont retranscrites via le NOM du rôle (les ID
// diffèrent d'un serveur à l'autre) : si un rôle du même nom existe déjà
// sur le serveur cible, il est réutilisé plutôt que dupliqué.
// ─────────────────────────────────────────────────────────────────────────

const { ChannelType } = require('discord.js');
const { stockage, persister } = require('../core/data');

// Délai entre chaque appel à l'API Discord lors d'une restauration, pour
// rester large sous les limites de rate-limit sur la création de rôles/salons.
const DELAI_ENTRE_ETAPES_MS = 350;

const TYPES_SALONS_SAUVEGARDABLES = new Set([
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
]);

function attendre(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function genererIdBackup() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ────────────────────────────────────────────────
// Capture (création d'une backup)
// ────────────────────────────────────────────────

function serialiserPermissions(gestionnaireOverwrites, guild) {
    const overwrites = [];
    for (const ow of gestionnaireOverwrites.cache.values()) {
        if (ow.type !== 0) continue; // 0 = rôle, 1 = membre → les overwrites de membre ne sont pas transposables sur un autre serveur
        const nomRole = ow.id === guild.id ? '@everyone' : (guild.roles.cache.get(ow.id)?.name ?? null);
        if (!nomRole) continue;
        overwrites.push({
            roleName: nomRole,
            allow: ow.allow.bitfield.toString(),
            deny: ow.deny.bitfield.toString(),
        });
    }
    return overwrites;
}

/**
 * Capture l'état actuel d'un serveur (rôles, catégories, salons + permissions).
 * @param {import('discord.js').Guild} guild
 */
function capturerServeur(guild) {
    const roles = guild.roles.cache
        .filter(r => r.id !== guild.id && !r.managed)
        .sort((a, b) => a.position - b.position)
        .map(r => ({
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            mentionable: r.mentionable,
            permissions: r.permissions.bitfield.toString(),
        }));

    const categories = guild.channels.cache
        .filter(c => c.type === ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position)
        .map(c => ({
            name: c.name,
            overwrites: serialiserPermissions(c.permissionOverwrites, guild),
        }));

    const channels = guild.channels.cache
        .filter(c => TYPES_SALONS_SAUVEGARDABLES.has(c.type))
        .sort((a, b) => a.position - b.position)
        .map(c => ({
            name: c.name,
            type: c.type,
            categoryName: c.parent?.name ?? null,
            topic: c.topic || undefined,
            nsfw: c.nsfw || undefined,
            rateLimitPerUser: c.rateLimitPerUser || undefined,
            bitrate: c.bitrate || undefined,
            userLimit: c.userLimit || undefined,
            overwrites: serialiserPermissions(c.permissionOverwrites, guild),
        }));

    return { roles, categories, channels };
}

// ────────────────────────────────────────────────
// Restauration (chargement d'une backup sur un serveur)
// ────────────────────────────────────────────────

function ajouterAuMapRoles(map, nom, id) {
    map.set(nom, id);
    map.set(nom.toLowerCase(), id);
}

function construireOverwritesCibles(overwritesStockees, guild, mapNomVersId) {
    const overwrites = [];
    for (const ow of overwritesStockees || []) {
        const id = ow.roleName === '@everyone'
            ? guild.id
            : (mapNomVersId.get(ow.roleName) || mapNomVersId.get(ow.roleName.toLowerCase()));
        if (!id) continue; // rôle absent du serveur cible (non recréé) → overwrite ignorée
        overwrites.push({ id, allow: BigInt(ow.allow || '0'), deny: BigInt(ow.deny || '0') });
    }
    return overwrites;
}

/**
 * Applique une backup (rôles, catégories, salons) sur un serveur donné.
 * Fonctionne en mode additif : ne supprime rien de ce qui existe déjà.
 * @param {import('discord.js').Guild} guild - serveur cible
 * @param {Object} backup - objet backup (roles/categories/channels)
 */
async function restaurerSurServeur(guild, backup) {
    const stats = { rolesCreated: 0, rolesReused: 0, categoriesCreated: 0, channelsCreated: 0, errors: [] };

    const mapNomVersId = new Map();
    ajouterAuMapRoles(mapNomVersId, '@everyone', guild.id);
    for (const role of guild.roles.cache.values()) {
        if (role.id === guild.id) continue;
        ajouterAuMapRoles(mapNomVersId, role.name, role.id);
    }

    // 1) Rôles — un rôle du même nom déjà présent sur le serveur cible est réutilisé.
    for (const roleData of backup.roles) {
        if (mapNomVersId.has(roleData.name) || mapNomVersId.has(roleData.name.toLowerCase())) {
            stats.rolesReused++;
            continue;
        }
        try {
            const cree = await guild.roles.create({
                name: roleData.name,
                color: roleData.color || null,
                hoist: !!roleData.hoist,
                mentionable: !!roleData.mentionable,
                permissions: BigInt(roleData.permissions || '0'),
                reason: 'Restauration de backup CoreLab',
            });
            ajouterAuMapRoles(mapNomVersId, roleData.name, cree.id);
            stats.rolesCreated++;
        } catch (e) {
            stats.errors.push(`Rôle "${roleData.name}" : ${e.message}`);
        }
        await attendre(DELAI_ENTRE_ETAPES_MS);
    }

    // 2) Catégories
    const mapNomCategorieVersId = new Map();
    for (const catData of backup.categories) {
        try {
            const overwrites = construireOverwritesCibles(catData.overwrites, guild, mapNomVersId);
            const cree = await guild.channels.create({
                name: catData.name,
                type: ChannelType.GuildCategory,
                permissionOverwrites: overwrites,
                reason: 'Restauration de backup CoreLab',
            });
            mapNomCategorieVersId.set(catData.name, cree.id);
            stats.categoriesCreated++;
        } catch (e) {
            stats.errors.push(`Catégorie "${catData.name}" : ${e.message}`);
        }
        await attendre(DELAI_ENTRE_ETAPES_MS);
    }

    // 3) Salons
    for (const chanData of backup.channels) {
        try {
            const overwrites = construireOverwritesCibles(chanData.overwrites, guild, mapNomVersId);
            const payload = {
                name: chanData.name,
                type: chanData.type,
                permissionOverwrites: overwrites,
                reason: 'Restauration de backup CoreLab',
            };
            if (chanData.categoryName && mapNomCategorieVersId.has(chanData.categoryName)) {
                payload.parent = mapNomCategorieVersId.get(chanData.categoryName);
            }
            if (chanData.topic) payload.topic = chanData.topic;
            if (chanData.nsfw) payload.nsfw = true;
            if (chanData.rateLimitPerUser) payload.rateLimitPerUser = chanData.rateLimitPerUser;
            if (chanData.bitrate) payload.bitrate = chanData.bitrate;
            if (chanData.userLimit) payload.userLimit = chanData.userLimit;
            await guild.channels.create(payload);
            stats.channelsCreated++;
        } catch (e) {
            stats.errors.push(`Salon "${chanData.name}" : ${e.message}`);
        }
        await attendre(DELAI_ENTRE_ETAPES_MS);
    }

    return stats;
}

// ────────────────────────────────────────────────
// Stockage (par utilisateur, persisté dans backups.json)
// ────────────────────────────────────────────────

function obtenirBackupsUtilisateur(userId) {
    const id = String(userId);
    if (!Array.isArray(stockage.sauvegardes[id])) stockage.sauvegardes[id] = [];
    return stockage.sauvegardes[id];
}

function obtenirBackup(userId, backupId) {
    return obtenirBackupsUtilisateur(userId).find(b => b.id === backupId) || null;
}

function ajouterBackup(userId, backup) {
    obtenirBackupsUtilisateur(userId).push(backup);
    persister('sauvegardes');
}

function supprimerBackup(userId, backupId) {
    const liste = obtenirBackupsUtilisateur(userId);
    const index = liste.findIndex(b => b.id === backupId);
    if (index === -1) return false;
    liste.splice(index, 1);
    persister('sauvegardes');
    return true;
}

module.exports = {
    genererIdBackup,
    capturerServeur,
    restaurerSurServeur,
    obtenirBackupsUtilisateur,
    obtenirBackup,
    ajouterBackup,
    supprimerBackup,
};
