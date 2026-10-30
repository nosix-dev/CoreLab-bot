// Restaure les données du bot depuis la dernière sauvegarde Discord (voir src/core/discordBackup.js).
// Lancé automatiquement par index.js avant le chargement des fichiers. Ne fait jamais planter le bot.
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); dns.setDefaultResultOrder('ipv4first'); } catch { /* ignoré */ }
try { require('dotenv').config(); } catch { /* ignoré */ }
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CHANNEL_ID = process.env.BACKUP_CHANNEL_ID;
const TOKEN = process.env.TOKEN;
const NOM_RE = /^corelab-backup-(data|images)-(\d+)-(\d+)of(\d+)\.json\.gz$/;

async function main() {
    if (!CHANNEL_ID || !TOKEN) return console.log('[Restore] BACKUP_CHANNEL_ID/TOKEN absent : rien à restaurer.');
    if (process.env.SKIP_RESTORE === '1') return console.log('[Restore] SKIP_RESTORE=1 : restauration ignorée.');
    const { appliquer, DATA_DIR } = require('./src/core/backupBundle');
    // Avec un disque persistant, on ne restaure qu'au tout premier démarrage (le disque fait foi ensuite)
    const marqueur = DATA_DIR ? path.join(DATA_DIR, '.backup_restored') : null;
    if (marqueur && fs.existsSync(marqueur)) return console.log('[Restore] disque déjà initialisé : rien à restaurer.');

    const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=100`, {
        headers: { Authorization: `Bot ${TOKEN}` }, signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return console.error(`[Restore] lecture du salon impossible (HTTP ${res.status}).`);
    const messages = await res.json();

    // groupes[kind][ts] = { total, parties: [url] }
    const groupes = { data: {}, images: {} };
    for (const m of messages) for (const a of m.attachments || []) {
        const r = NOM_RE.exec(a.filename || '');
        if (!r) continue;
        const g = (groupes[r[1]][r[2]] ||= { total: Number(r[4]), urls: {} });
        g.urls[r[3]] = a.url;
    }

    let ecrits = 0;
    for (const kind of ['data', 'images']) {
        const complet = Object.entries(groupes[kind])
            .filter(([, g]) => Object.keys(g.urls).length === g.total)
            .sort((a, b) => Number(b[0]) - Number(a[0]))[0];
        if (!complet) { console.log(`[Restore] aucune sauvegarde "${kind}" trouvée.`); continue; }
        for (const url of Object.values(complet[1].urls)) {
            const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
            if (!r.ok) { console.error(`[Restore] téléchargement impossible (HTTP ${r.status}).`); continue; }
            const bundle = JSON.parse(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8'));
            ecrits += appliquer(bundle.files);
        }
        console.log(`[Restore] "${kind}" restauré depuis la sauvegarde du ${new Date(Number(complet[0])).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}.`);
    }
    if (marqueur) { try { fs.writeFileSync(marqueur, new Date().toISOString()); } catch { /* ignoré */ } }
    console.log(`[Restore] terminé : ${ecrits} fichier(s) restauré(s).`);
}

main().catch(e => console.error('[Restore] ignoré :', e.message));
