"use strict";
/**
 * API du dashboard CoreLab.
 *   GET /dashboard          -> public : statut + stats agrégées (aucune donnée personnelle)
 *   GET /dashboard/private  -> protégé : derniers événements + serveurs
 *                              (en-tête  Authorization: Bearer <DASHBOARD_TOKEN>)
 * Sans variable d'environnement DASHBOARD_TOKEN, la partie privée reste fermée (403).
 */
const crypto = require("crypto");
const { getStats, getModuleUsage } = require("./commandStats");
const { getNotifCounts } = require("./notifStats");
const { getEvents } = require("./dashboardEvents");

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization",
  "Cache-Control": "no-store",
};

function send(res, code, body) {
  res.writeHead(code, HEADERS);
  res.end(JSON.stringify(body));
}

function authorized(req) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return null; // fermé
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(token).digest();
  return crypto.timingSafeEqual(a, b);
}

/** @returns {boolean} true si la requête a été traitée */
function handle(req, res, { client, buildStatus }) {
  const url = req.url.split("?")[0];
  if (url !== "/dashboard" && url !== "/dashboard/private") return false;

  if (req.method === "OPTIONS") { res.writeHead(204, HEADERS); res.end(); return true; }

  try {
    if (url === "/dashboard") {
      const stats = getStats();
      const top = Object.entries(stats)
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([name, count]) => ({ name, count }));
      send(res, 200, {
        status: buildStatus(),
        version: require("../../package.json").version,
        total_uses: Object.values(stats).reduce((a, n) => a + n, 0),
        top_commands: top,
        modules: getModuleUsage(),
        notifs: getNotifCounts(),
      });
      return true;
    }

    const ok = authorized(req);
    if (ok === null) { send(res, 403, { error: "DASHBOARD_TOKEN non configuré" }); return true; }
    if (!ok) { send(res, 401, { error: "Token invalide" }); return true; }

    const servers = [...client.guilds.cache.values()]
      .sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0))
      .slice(0, 10)
      .map((g) => ({ name: g.name, members: g.memberCount || 0 }));
    send(res, 200, { events: getEvents(30), servers });
  } catch (e) {
    console.error("[Dashboard]", e.message);
    send(res, 500, { error: "Erreur interne" });
  }
  return true;
}

module.exports = { handle };
