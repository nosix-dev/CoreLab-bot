"use strict";
/**
 * Compteur d'usage des commandes, persiste sur disque (survit aux
 * redemarrages du bot sur Katabump/Wispbyte).
 *
 * Branchement : dans le point central ou tu executes une commande
 * (probablement au coeur de ton makeCommand() ou juste avant/apres
 * command.execute(...)), ajoute :
 *
 *   const { track } = require("./core/commandStats");
 *   track(interaction.commandName);
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FILE = path.join(DATA_DIR, "command_stats.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let stats = {};
try {
  if (fs.existsSync(FILE)) stats = JSON.parse(fs.readFileSync(FILE, "utf-8"));
} catch (e) {
  stats = {};
}

let dirty = false;

function track(commandName) {
  if (!commandName) return;
  stats[commandName] = (stats[commandName] || 0) + 1;
  dirty = true;
}

function getStats() {
  return { ...stats };
}

// Sauvegarde seulement si quelque chose a change, toutes les 60s.
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  fs.writeFileSync(FILE, JSON.stringify(stats, null, 2), "utf-8");
}, 60_000);

// ── Regroupement en "modules" pour le graphique en barres ────────────────
// A ajuster librement : associe des mots-cles (ou des noms exacts de
// commandes) a une categorie affichee dans le dashboard.
const CATEGORY_RULES = [
  { name: "Moderation", match: /^(warn|ban|kick|mute|timeout|purge|unban|unmute)/i },
  { name: "XP / Niveaux", match: /^(rank|leaderboard|xp-)/i },
  { name: "Tickets", match: /^ticket/i },
  { name: "Notifications", match: /^(notif|youtube|medal|blog)/i },
  { name: "Config", match: /^config/i },
  { name: "Rappels", match: /^(rappel|planifier)/i },
  { name: "Reglement", match: /^reglement/i },
];

function getModuleUsage() {
  const totals = {};
  for (const rule of CATEGORY_RULES) totals[rule.name] = 0;
  totals["Autres"] = 0;

  for (const [cmd, count] of Object.entries(stats)) {
    const rule = CATEGORY_RULES.find((r) => r.match.test(cmd));
    const bucket = rule ? rule.name : "Autres";
    totals[bucket] += count;
  }

  const max = Math.max(1, ...Object.values(totals));
  return Object.entries(totals)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, pct: Math.round((count / max) * 100), count }))
    .sort((a, b) => b.count - a.count);
}

module.exports = { track, getStats, getModuleUsage };