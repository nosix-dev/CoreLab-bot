'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Annonce des mises à jour du bot dans un salon Discord.
//
// Au démarrage du bot (donc après chaque déploiement), on lit `update.json`
// à la racine du projet. L'annonce est postée dans le salon `channelId`
// UNIQUEMENT si update.json a été modifié depuis la dernière annonce
// (n'importe quelle modification du contenu, pas seulement la version).
//
// Redéployer sans toucher à update.json = aucun message.
// Modifier update.json + commit + déployer = nouveau message.
//
// Anti-doublon : une empreinte du fichier est cachée dans le message envoyé
// (texte alternatif du logo) ; au démarrage le bot la cherche dans les derniers
// messages du salon, donc ça marche même si l'hébergeur efface les fichiers locaux.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const UPDATE_FILE = path.join(REPO_ROOT, 'update.json');
// Si DATA_DIR est défini (disque persistant, comme core/data.js), l'état de la dernière annonce y est gardé
// et survit aux redéploiements. Sinon on retombe sur la vérification dans l'historique du salon.
const STATE_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : REPO_ROOT;
if (process.env.DATA_DIR) {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch (e) { console.error('[Update] DATA_DIR inutilisable :', e.message); }
}
const STATE_FILE = path.join(STATE_DIR, 'update_state.json');
const HISTORY_PAGE = 100;      // messages récupérés par requête (max Discord)
const HISTORY_PAGES = 5;       // 5 × 100 = 500 derniers messages du salon vérifiés (anti-doublon)
const MAX_CHARS = 3500;        // Discord : 4000 caractères de texte max par message (Components V2)

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[Update] Lecture de ${path.basename(file)} impossible :`, e.message);
    return null;
  }
}

function lastSentHash() {
  return String(readJson(STATE_FILE)?.hash ?? '');
}

function saveSentHash(hash, version) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ hash, version, sentAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch (e) {
    console.error('[Update] Sauvegarde de l\'état impossible :', e.message);
  }
}

/** Empreinte du contenu de update.json (indépendante des espaces / retours à la ligne). */
function hashOf(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

const HASH_PREFIX = 'update:';
const hashNeedle = hash => `"description":"${HASH_PREFIX}${hash}"`;

// Ligne « Version : x » du message : sert aussi de marqueur pour retrouver l'annonce dans le salon.
const versionLine = version => `**Version :** ${version}\n`;

/** Texte échappé tel qu'il apparaît dans le JSON d'un message (pour la détection anti-doublon). */
const markerNeedle = version => JSON.stringify(versionLine(version)).slice(1, -1);

const tagOf = line => (String(line).match(/^\[(.)\]/) || [])[1] || null;

/**
 * `modifications` : objet { "✨ Nouveautés": ["[+] ...", "[~] ...", "[!] ..."], "🛟 Serveur support": [...] }
 * (ou simple liste de textes). Les lignes qui commencent par [+] [~] [!] [i] sont gardées telles quelles ;
 * une ligne vide est ajoutée automatiquement quand le type de ligne change, comme dans les anciennes annonces.
 * Retourne une liste de sections { titre, lignes[] }.
 */
function buildSections(modifs) {
  const clean = items => (Array.isArray(items) ? items : [items])
    .map(x => String(x ?? '').trim()).filter(Boolean)
    .map(x => (x.startsWith('[') ? x : `• ${x}`));
  if (Array.isArray(modifs)) return [{ titre: null, lignes: clean(modifs) }];
  if (modifs && typeof modifs === 'object') {
    return Object.entries(modifs).map(([titre, items]) => ({ titre, lignes: clean(items) })).filter(s => s.lignes.length);
  }
  return [];
}

function joinLines(lignes) {
  let out = '';
  let prev = null;
  for (const l of lignes) {
    const t = tagOf(l);
    out += (out ? (prev !== null && t !== prev ? '\n\n' : '\n') : '') + l;
    prev = t;
  }
  return out;
}

/** Découpe en blocs de texte ≤ MAX_CHARS : un bloc par section (coupé aux sauts de ligne si trop long). */
function buildBlocks(sections) {
  const blocks = [];
  for (const sec of sections) {
    const head = sec.titre ? `## ${sec.titre}\n` : '';
    let cur = [];
    let first = true;
    const flush = () => {
      if (!cur.length) return;
      blocks.push((first ? head : '') + joinLines(cur));
      first = false;
      cur = [];
    };
    for (const l of sec.lignes) {
      if (cur.length && (head.length + joinLines([...cur, l]).length) > MAX_CHARS) flush();
      cur.push(l.slice(0, MAX_CHARS - head.length - 10));
    }
    flush();
  }
  return blocks;
}

function frDate(input) {
  const d = input ? new Date(input) : new Date();
  const date = isNaN(d) ? new Date() : d;
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(date);
  return parts.map(p => (p.type === 'month' ? p.value.charAt(0).toUpperCase() + p.value.slice(1) : p.value)).join('');
}

/** `boutons` : liste de { label, emoji?, url } (ou un seul objet `bouton`). 5 boutons maximum. */
function buildButtonRow(list) {
  const buttons = (Array.isArray(list) ? list : [list])
    .filter(b => b && /^https?:\/\//i.test(String(b.url || '')))
    .slice(0, 5)
    .map(b => {
      const btn = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(String(b.url)).setLabel(String(b.label || 'Lien').slice(0, 80));
      if (b.emoji) btn.setEmoji(String(b.emoji));
      return btn;
    });
  return buttons.length ? new ActionRowBuilder().addComponents(buttons) : null;
}

function buildMessages(data, client, hash) {
  const version = String(data.version);
  const nom = data.nom || client.user.username;
  const statut = data.statut || 'En ligne 🟢';
  const tag = data.tag || 'Update';
  const titre = data.titre || `📌 ${nom} - Version ${version} \`${tag}\``;
  const avatar = client.user.displayAvatarURL({ extension: 'png', size: 256 });

  const header =
    `## ${titre}\n` +
    versionLine(version) +
    `**Statut :** ${statut}\n` +
    `**Dernière mise à jour :** ${frDate(data.date)}`;

  let blocks = buildBlocks(buildSections(data.modifications ?? data.changes));
  if (!blocks.length) blocks = ['*Aucun détail fourni.*'];

  // Regroupe les blocs en messages (4000 caractères de texte max chacun, en-tête compris pour le 1er).
  const groups = [[]];
  let size = header.length;
  for (const b of blocks) {
    if (groups[groups.length - 1].length && size + b.length > MAX_CHARS) { groups.push([]); size = 0; }
    groups[groups.length - 1].push(b);
    size += b.length;
  }

  const row = buildButtonRow(data.boutons ?? data.bouton);
  return groups.map((blks, i) => {
    const container = new ContainerBuilder().setAccentColor(0xFFFFFF);
    if (i === 0) {
      const section = new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
      if (avatar) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription(`${HASH_PREFIX}${hash}`));
      container.addSectionComponents(section);
    }
    blks.forEach((b, j) => {
      if (i === 0 || j > 0) container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(b));
    });
    if (row && i === groups.length - 1) container.addActionRowComponents(row);
    return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
  });
}

/**
 * true  : cette version exacte de update.json a déjà été annoncée dans le salon
 * false : jamais annoncée
 * null  : historique illisible (on ne sait pas → on n'envoie rien, par prudence)
 */
async function alreadyPosted(channel, botId, hash, version) {
  const hashN = hashNeedle(hash);
  const legacyN = markerNeedle(version);
  let before;
  for (let page = 0; page < HISTORY_PAGES; page++) {
    let msgs;
    try {
      msgs = await channel.messages.fetch(before ? { limit: HISTORY_PAGE, before } : { limit: HISTORY_PAGE });
    } catch (e) {
      console.error('[Update] Historique du salon illisible (permission « Voir les anciens messages » ?) :', e.message);
      return null;
    }
    if (!msgs.size) break;
    const found = msgs.some(m => {
      if (m.author?.id !== botId) return false;
      let hay = '';
      try { hay += JSON.stringify(m.components ?? []); } catch { /* ignoré */ }
      try { hay += JSON.stringify(m.toJSON?.() ?? {}); } catch { /* ignoré */ }
      if (hay.includes(hashN)) return true;
      // Annonce d'avant l'empreinte (même version, sans empreinte cachée) : considérée comme déjà envoyée.
      return hay.includes(legacyN) && !hay.includes(`"description":"${HASH_PREFIX}`);
    });
    if (found) return true;
    if (msgs.size < HISTORY_PAGE) break;
    before = [...msgs.values()].reduce((a, b) => (BigInt(a.id) < BigInt(b.id) ? a : b)).id; // plus ancien message de la page
  }
  return false;
}

async function notifyUpdate(client) {
  const data = readJson(UPDATE_FILE);
  if (!data) return;

  const version = data.version !== undefined ? String(data.version).trim() : '';
  const channelId = String(data.channelId || process.env.UPDATE_CHANNEL_ID || '').trim();
  if (!version) return console.warn('[Update] update.json : champ "version" manquant, rien envoyé.');
  if (!channelId) return console.warn('[Update] update.json : champ "channelId" manquant, rien envoyé.');
  if (channelId === 'ID_DU_SALON_ICI') return console.warn('[Update] update.json : remplace "ID_DU_SALON_ICI" par l\'ID de ton salon.');

  const hash = hashOf(data);
  if (lastSentHash() === hash) return; // update.json inchangé depuis la dernière annonce

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.send) {
    return console.error(`[Update] Salon ${channelId} introuvable ou inaccessible.`);
  }

  const posted = await alreadyPosted(channel, client.user.id, hash, version);
  if (posted === null) return;
  if (posted) {
    saveSentHash(hash, version);
    return;
  }

  try {
    for (const msg of buildMessages({ ...data, version }, client, hash)) await channel.send(msg);
    saveSentHash(hash, version);
    console.log(`[Update] Annonce de la version ${version} envoyée dans #${channel.name ?? channelId}.`);
  } catch (e) {
    console.error('[Update] Envoi impossible :', e.message);
  }
}

module.exports = { notifyUpdate };
