function xpNeeded(level) {
    return 5 * level * level + 50 * level + 100;
}

function getLevelFromXp(xp) {
    let level = 0;
    let remaining = xp;
    while (remaining >= xpNeeded(level)) {
        remaining -= xpNeeded(level);
        level++;
    }
    return { level, currentXp: remaining, neededXp: xpNeeded(level) };
}

function progressBar(current, total, size = 12) {
    const ratio = total > 0 ? Math.min(current / total, 1) : 0;
    const filled = Math.round(ratio * size);
    return '█'.repeat(filled) + '░'.repeat(size - filled);
}

// Plusieurs rôles possibles par niveau (ex. Actif lvl 1 / 2 / 3...).
// Mode 'stack' (défaut) : le membre garde tous les rôles des paliers atteints.
// Mode 'replace' : le membre ne garde que les rôles du palier le plus haut atteint.
async function applyRoleRewards(member, cfg, newLevel) {
    const all = cfg.xp_roles || [];
    const reached = all.filter(r => r.level <= newLevel);
    let toAdd = reached;
    let toRemove = [];
    if (cfg.xp_roles_mode === 'replace' && reached.length) {
        const top = Math.max(...reached.map(r => r.level));
        toAdd = reached.filter(r => r.level === top);
        const keep = new Set(toAdd.map(r => r.roleId));
        toRemove = all.filter(r => !keep.has(r.roleId));
    }
    for (const id of new Set(toAdd.map(r => r.roleId))) {
        if (!member.roles.cache.has(id)) {
            try { await member.roles.add(id); } catch (e) { console.error('Erreur lors de l\'ajout du rôle XP :', e.message); }
        }
    }
    for (const id of new Set(toRemove.map(r => r.roleId))) {
        if (member.roles.cache.has(id)) {
            try { await member.roles.remove(id); } catch (e) { console.error('Erreur lors du retrait du rôle XP :', e.message); }
        }
    }
}

module.exports = { xpNeeded, getLevelFromXp, progressBar, applyRoleRewards };
