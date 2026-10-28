'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Annonce des mises à jour du bot dans un salon Discord.
//
// Au démarrage du bot (donc après chaque déploiement), on lit `update.json`
// à la racine du projet. Si la `version` n'a pas encore été annoncée,
// le bot poste la liste des modifications dans le salon `channelId`.
//
// Pour annoncer une nouvelle mise à jour : modifie update.json
// (nouvelle `version` + nouvelles modifications), commit, c'est tout.
// Même version = pas de nouveau message (pas de doublon à chaque redémarrage).
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags
} = require('discord.js');

const UPDATE_FILE = path.join(__dirname, '..', '..', 'update.json');
const STATE_FILE = path.join(__dirname, '..', '..', 'update_state.json');
const HISTORY_LIMIT = 25;      // messages récents du salon vérifiés (anti-doublon)
const MAX_CHARS = 3500;        // Discord : 4000 caractères de texte max par message (Components V2)

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[Update] Lecture de ${path.basename(file)} impossible :`, e.message);
    return null;
  }
}

function lastSentVersion() {
  return String(readJson(STATE_FILE)?.version ?? '');
}

function saveSentVersion(version) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ version, sentAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch (e) {
    console.error('[Update] Sauvegarde de l\'état impossible :', e.message);
  }
}

// Marqueur visible en bas de chaque message : sert aussi à retrouver l'annonce dans le salon.
const marker = version => `Version ${version} ·`;

/** `modifications` peut être une liste de textes, ou un objet { "Titre de section": [textes] }. */
function buildLines(modifs) {
  const lines = [];
  const bullet = t => `• ${String(t).trim()}`;
  if (Array.isArray(modifs)) {
    for (const m of modifs) if (String(m).trim()) lines.push(bullet(m));
  } else if (modifs && typeof modifs === 'object') {
    for (const [section, items] of Object.entries(modifs)) {
      const list = (Array.isArray(items) ? items : [items]).filter(x => String(x ?? '').trim());
      if (!list.length) continue;
      if (lines.length) lines.push('');
      lines.push(`**${section}**`);
      for (const m of list) lines.push(bullet(m));
    }
  }
  return lines;
}

/** Découpe les lignes en blocs de taille acceptable (sans couper une ligne). */
function chunk(lines) {
  const parts = [];
  let cur = '';
  for (const line of lines) {
    if (cur && (cur.length + line.length + 1) > MAX_CHARS) {
      parts.push(cur);
      cur = '';
    }
    cur += (cur ? '\n' : '') + line.slice(0, MAX_CHARS);
  }
  if (cur) parts.push(cur);
  return parts;
}

function frDate(input) {
  const d = input ? new Date(input) : new Date();
  const ok = !isNaN(d);
  return (ok ? d : new Date()).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function buildMessages(data) {
  const version = String(data.version);
  const date = frDate(data.date);
  const title = data.titre || data.title || `Mise à jour ${version}`;
  const parts = chunk(buildLines(data.modifications ?? data.changes));
  if (!parts.length) parts.push('*Aucun détail fourni.*');

  return parts.map((body, i) => {
    const container = new ContainerBuilder().setAccentColor(0xFFFFFF);
    if (i === 0) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🚀 ${title}`));
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    const page = parts.length > 1 ? ` · ${i + 1}/${parts.length}` : '';
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${marker(version)} ${date}${page}`));
    return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
  });
}

/** Vrai si une annonce de cette version existe déjà dans les derniers messages du bot. */
async function alreadyPosted(channel, botId, version) {
  try {
    const msgs = await channel.messages.fetch({ limit: HISTORY_LIMIT });
    const needle = marker(version);
    return msgs.some(m => m.author?.id === botId && JSON.stringify(m.toJSON?.() ?? m.components ?? []).includes(needle));
  } catch (e) {
    console.error('[Update] Historique du salon illisible :', e.message);
    return false;
  }
}

async function notifyUpdate(client) {
  const data = readJson(UPDATE_FILE);
  if (!data) return;

  const version = data.version !== undefined ? String(data.version).trim() : '';
  const channelId = String(data.channelId || process.env.UPDATE_CHANNEL_ID || '').trim();
  if (!version) return console.warn('[Update] update.json : champ "version" manquant, rien envoyé.');
  if (!channelId) return console.warn('[Update] update.json : champ "channelId" manquant, rien envoyé.');

  if (lastSentVersion() === version) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.send) {
    return console.error(`[Update] Salon ${channelId} introuvable ou inaccessible.`);
  }

  if (await alreadyPosted(channel, client.user.id, version)) {
    saveSentVersion(version);
    return;
  }

  try {
    for (const msg of buildMessages({ ...data, version })) await channel.send(msg);
    saveSentVersion(version);
    console.log(`[Update] Annonce de la version ${version} envoyée dans #${channel.name ?? channelId}.`);
  } catch (e) {
    console.error('[Update] Envoi impossible :', e.message);
  }
}

module.exports = { notifyUpdate };
