// dashboard-api.js : API du dashboard CoreLab (version minimale)
// Placer ce fichier dans le dossier du bot (ex. src/dashboard-api.js).
// Variables d'environnement (Render) :
//   DISCORD_CLIENT_ID      (par défaut : 1403513450273177772)
//   DISCORD_CLIENT_SECRET  (Discord Developer Portal > OAuth2)
//   DISCORD_REDIRECT_URI   ex. https://corelab-bot.onrender.com/dashboard/auth/callback
//   DASHBOARD_URL          ex. https://corelab-4cn.pages.dev/dashboard.html

const crypto = require('crypto');
const express = require('express');

const DISCORD = 'https://discord.com/api/v10';
const ADMIN = 0x8n;
const MANAGE_GUILD = 0x20n;

/* ============================================================
   À ADAPTER : les modules affichés dans le dashboard.
   - bucket : nom du bucket utilisé par le bot (getGuildBucket(guildId, bucket, def))
   - key    : nom exact de la clé dans ce bucket
   Tant que bucket/key ne correspondent pas à ce que lit ton bot,
   le dashboard enregistre bien, mais le bot n'en tient pas compte.
   Types de champs : bool | text | longtext | number | channel | role
   ============================================================ */
const MODULES = [
  {
    id: 'welcome', name: 'Bienvenue & départs', group: 'Membres',
    desc: 'Accueillir les nouveaux membres et annoncer les départs.',
    bucket: 'welcome', toggle: 'enabled',
    fields: [
      { key: 'enabled', label: 'Activer le module', type: 'bool', def: false },
      { key: 'channelId', label: 'Salon de bienvenue', type: 'channel', def: '' },
      { key: 'message', label: 'Message de bienvenue', type: 'longtext', max: 500, def: 'Bienvenue {membre} !', hint: 'Variables : {membre}, {serveur}' }
    ]
  },
  {
    id: 'levels', name: 'Niveaux & XP', group: 'Animation',
    desc: 'Les messages donnent de l’XP et des rôles de récompense.',
    bucket: 'levels', toggle: 'enabled',
    fields: [
      { key: 'enabled', label: 'Activer le module', type: 'bool', def: true },
      { key: 'announceChannelId', label: 'Salon des annonces de niveau', type: 'channel', def: '' },
      { key: 'xpPerMessage', label: 'XP par message', type: 'number', min: 1, max: 100, def: 5 }
    ]
  },
  {
    id: 'rankup', name: 'Rankup', group: 'Animation',
    desc: 'Des rôles automatiques selon les messages et le temps en vocal.',
    bucket: 'rankup', toggle: 'enabled',
    fields: [
      { key: 'enabled', label: 'Activer le module', type: 'bool', def: false },
      { key: 'announceChannelId', label: 'Salon d’annonce (optionnel)', type: 'channel', def: '' }
    ]
  },
  {
    id: 'protection', name: 'Protection', group: 'Protection',
    desc: 'Anti-scam, HoneyPot et salon de logs.',
    bucket: 'protection', toggle: 'antiScam',
    fields: [
      { key: 'antiScam', label: 'Anti-scam', type: 'bool', def: true },
      { key: 'honeypot', label: 'HoneyPot', type: 'bool', def: false },
      { key: 'logChannelId', label: 'Salon des logs', type: 'channel', def: '' }
    ]
  }
];
/* ============================================================ */

const TEXT_CHANNEL_TYPES = [0, 5]; // texte + annonces

function hasAccess(perms, owner) {
  if (owner) return true;
  try { const p = BigInt(perms || '0'); return (p & ADMIN) === ADMIN || (p & MANAGE_GUILD) === MANAGE_GUILD; }
  catch { return false; }
}

module.exports = function mountDashboard(app, client, storage) {
  // storage = { get: (guildId, bucket, def) => value, set: (guildId, bucket, value) => void }
  const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1403513450273177772';
  const SECRET = process.env.DISCORD_CLIENT_SECRET;
  const REDIRECT = process.env.DISCORD_REDIRECT_URI;
  const SITE = process.env.DASHBOARD_URL;
  if (!SECRET || !REDIRECT || !SITE) {
    console.warn('[Dashboard] Variables manquantes (DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, DASHBOARD_URL) : dashboard désactivé.');
    return;
  }
  const ORIGIN = new URL(SITE).origin;
  const sessions = new Map(); // token -> { user, guilds, exp }
  const states = new Map();   // state -> timestamp

  setInterval(() => {
    const now = Date.now();
    for (const [k, s] of sessions) if (s.exp < now) sessions.delete(k);
    for (const [k, t] of states) if (now - t > 600000) states.delete(k);
  }, 300000).unref();

  const r = express.Router();

  // CORS limité au site du dashboard
  r.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', ORIGIN);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  /* ---------- Connexion Discord ---------- */
  r.get('/auth/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    states.set(state, Date.now());
    const q = new URLSearchParams({
      client_id: CLIENT_ID, response_type: 'code', scope: 'identify guilds',
      redirect_uri: REDIRECT, state, prompt: 'none'
    });
    res.redirect(`https://discord.com/oauth2/authorize?${q}`);
  });

  r.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || !states.has(state)) return res.redirect(`${SITE}#error=state`);
    states.delete(state);
    try {
      const tk = await fetch(`${DISCORD}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID, client_secret: SECRET, grant_type: 'authorization_code',
          code: String(code), redirect_uri: REDIRECT
        })
      }).then(x => x.json());
      if (!tk.access_token) throw new Error('token');
      const headers = { Authorization: `Bearer ${tk.access_token}` };
      const [user, guilds] = await Promise.all([
        fetch(`${DISCORD}/users/@me`, { headers }).then(x => x.json()),
        fetch(`${DISCORD}/users/@me/guilds`, { headers }).then(x => x.json())
      ]);
      if (!user.id || !Array.isArray(guilds)) throw new Error('profil');
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, {
        user: { id: user.id, username: user.global_name || user.username, avatar: user.avatar },
        guilds: guilds.filter(g => hasAccess(g.permissions, g.owner)).map(g => ({ id: g.id, name: g.name, icon: g.icon })),
        exp: Date.now() + 6 * 3600 * 1000
      });
      res.redirect(`${SITE}#token=${token}`);
    } catch (e) {
      console.error('[Dashboard] Erreur de connexion :', e.message);
      res.redirect(`${SITE}#error=login`);
    }
  });

  /* ---------- Middlewares ---------- */
  function auth(req, res, next) {
    const t = (req.get('Authorization') || '').replace('Bearer ', '');
    const s = sessions.get(t);
    if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'unauthorized' });
    req.session = s; req.token = t;
    next();
  }
  function guildGuard(req, res, next) {
    const id = req.params.id;
    if (!req.session.guilds.some(g => g.id === id)) return res.status(403).json({ error: 'forbidden' });
    const guild = client.guilds.cache.get(id);
    if (!guild) return res.status(404).json({ error: 'bot_absent' });
    req.guild = guild;
    next();
  }
  function findModule(req, res, next) {
    const m = MODULES.find(x => x.id === req.params.mod);
    if (!m) return res.status(404).json({ error: 'module' });
    req.mod = m;
    next();
  }
  const publicField = f => ({ key: f.key, label: f.label, type: f.type, hint: f.hint, min: f.min, max: f.max });

  async function readValues(guildId, m) {
    const data = (await storage.get(guildId, m.bucket, {})) || {};
    const out = {};
    for (const f of m.fields) out[f.key] = data[f.key] !== undefined ? data[f.key] : f.def;
    return out;
  }

  /* ---------- API ---------- */
  r.get('/api/me', auth, (req, res) => {
    res.json({
      user: req.session.user,
      guilds: req.session.guilds.map(g => ({ ...g, botIn: client.guilds.cache.has(g.id) }))
    });
  });

  r.post('/api/logout', auth, (req, res) => { sessions.delete(req.token); res.json({ ok: true }); });

  r.get('/api/guilds/:id', auth, guildGuard, async (req, res) => {
    const g = req.guild;
    const modules = [];
    for (const m of MODULES) {
      const v = await readValues(g.id, m);
      modules.push({ id: m.id, name: m.name, group: m.group, desc: m.desc, enabled: !!v[m.toggle] });
    }
    res.json({
      id: g.id, name: g.name, icon: g.icon,
      members: g.memberCount, channels: g.channels.cache.size, roles: g.roles.cache.size, modules
    });
  });

  r.get('/api/guilds/:id/meta', auth, guildGuard, (req, res) => {
    const g = req.guild;
    res.json({
      channels: g.channels.cache.filter(c => TEXT_CHANNEL_TYPES.includes(c.type))
        .map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
      roles: g.roles.cache.filter(x => x.id !== g.id && !x.managed)
        .map(x => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name))
    });
  });

  r.get('/api/guilds/:id/modules/:mod', auth, guildGuard, findModule, async (req, res) => {
    res.json({
      module: { id: req.mod.id, name: req.mod.name, desc: req.mod.desc, fields: req.mod.fields.map(publicField) },
      values: await readValues(req.guild.id, req.mod)
    });
  });

  r.put('/api/guilds/:id/modules/:mod', auth, guildGuard, findModule, express.json({ limit: '20kb' }), async (req, res) => {
    const g = req.guild, m = req.mod, body = req.body || {};
    const chanIds = new Set(g.channels.cache.filter(c => TEXT_CHANNEL_TYPES.includes(c.type)).map(c => c.id));
    const roleIds = new Set(g.roles.cache.map(x => x.id));
    const clean = {};
    for (const f of m.fields) {
      if (!(f.key in body)) continue;
      const v = body[f.key];
      if (f.type === 'bool') clean[f.key] = v === true;
      else if (f.type === 'text' || f.type === 'longtext') clean[f.key] = String(v ?? '').slice(0, f.max || 200);
      else if (f.type === 'number') {
        const n = Number(v);
        if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid', field: f.key });
        clean[f.key] = Math.min(f.max ?? 1e9, Math.max(f.min ?? -1e9, Math.round(n)));
      }
      else if (f.type === 'channel') {
        if (v && !chanIds.has(String(v))) return res.status(400).json({ error: 'invalid', field: f.key });
        clean[f.key] = v ? String(v) : '';
      }
      else if (f.type === 'role') {
        if (v && !roleIds.has(String(v))) return res.status(400).json({ error: 'invalid', field: f.key });
        clean[f.key] = v ? String(v) : '';
      }
    }
    const current = (await storage.get(g.id, m.bucket, {})) || {};
    await storage.set(g.id, m.bucket, { ...current, ...clean });
    console.log(`[Dashboard] ${req.session.user.username} a modifié « ${m.id} » sur ${g.name}`);
    res.json({ ok: true, values: await readValues(g.id, m) });
  });

  app.use('/dashboard', r);
  console.log('[Dashboard] API montée sur /dashboard');
};