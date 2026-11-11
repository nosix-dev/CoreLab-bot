// src/core/webDashboard.js : API du dashboard web CoreLab (version minimale)
// Fonctionne avec le serveur http natif de index.js (pas besoin d'Express).
// Routes : /panel/auth/login, /panel/auth/callback, /panel/api/...
// Variables Render : DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, DASHBOARD_URL
//   (DISCORD_CLIENT_ID est facultatif : 1403513450273177772 par défaut)

const crypto = require('crypto');

const DISCORD = 'https://discord.com/api/v10';
const ADMIN = 0x8n;
const MANAGE_GUILD = 0x20n;
const TEXT_CHANNEL_TYPES = [0, 5];

/* ============================================================
   À ADAPTER : modules affichés dans le dashboard.
   bucket = nom du bucket lu par le bot (getGuildBucket(guildId, bucket, def))
   key    = nom exact de la clé dans ce bucket
   Types : bool | text | longtext | number | channel | role
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

const sessions = new Map(); // token -> { user, guilds, exp }
const states = new Map();   // state -> timestamp
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (s.exp < now) sessions.delete(k);
  for (const [k, t] of states) if (now - t > 600000) states.delete(k);
}, 300000).unref();

const hasAccess = (perms, owner) => {
  if (owner) return true;
  try { const p = BigInt(perms || '0'); return (p & ADMIN) === ADMIN || (p & MANAGE_GUILD) === MANAGE_GUILD; }
  catch { return false; }
};
const publicField = f => ({ key: f.key, label: f.label, type: f.type, hint: f.hint, min: f.min, max: f.max });

function readBody(req, limit = 20000) {
  return new Promise((ok, ko) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > limit) { ko(new Error('trop gros')); req.destroy(); } });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { ko(e); } });
    req.on('error', ko);
  });
}

// Retourne true si la requête concerne /panel (elle est alors traitée ici)
exports.handle = function (req, res, ctx) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/panel' && !url.pathname.startsWith('/panel/')) return false;
  route(req, res, ctx, url).catch(e => {
    console.error('[WebDashboard] :', e.message);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"server"}'); }
  });
  return true;
};

async function route(req, res, { client, get, set }, url) {
  const env = process.env;
  const CLIENT_ID = env.DISCORD_CLIENT_ID || '1403513450273177772';
  const SECRET = env.DISCORD_CLIENT_SECRET, REDIRECT = env.DISCORD_REDIRECT_URI, SITE = env.DASHBOARD_URL;
  const cors = origin => ({
    'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS', 'Cache-Control': 'no-store'
  });
  if (!SECRET || !REDIRECT || !SITE) {
    res.writeHead(503, { 'Content-Type': 'application/json', ...cors('*') });
    return res.end('{"error":"not_configured"}');
  }
  const ORIGIN = new URL(SITE).origin;
  const S = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...cors(ORIGIN) }); res.end(JSON.stringify(obj)); };
  const go = loc => { res.writeHead(302, { Location: loc }); res.end(); };

  if (req.method === 'OPTIONS') { res.writeHead(204, cors(ORIGIN)); return res.end(); }
  const p = url.pathname.slice('/panel'.length) || '/';

  /* ---------- Connexion Discord ---------- */
  if (p === '/auth/login') {
    const state = crypto.randomBytes(16).toString('hex');
    states.set(state, Date.now());
    const q = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', scope: 'identify guilds', redirect_uri: REDIRECT, state, prompt: 'none' });
    return go(`https://discord.com/oauth2/authorize?${q}`);
  }
  if (p === '/auth/callback') {
    const code = url.searchParams.get('code'), state = url.searchParams.get('state');
    if (!code || !state || !states.has(state)) return go(`${SITE}#error=state`);
    states.delete(state);
    try {
      const tk = await fetch(`${DISCORD}/oauth2/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT })
      }).then(x => x.json());
      if (!tk.access_token) throw new Error('jeton refusé par Discord');
      const headers = { Authorization: `Bearer ${tk.access_token}` };
      const [user, guilds] = await Promise.all([
        fetch(`${DISCORD}/users/@me`, { headers }).then(x => x.json()),
        fetch(`${DISCORD}/users/@me/guilds`, { headers }).then(x => x.json())
      ]);
      if (!user.id || !Array.isArray(guilds)) throw new Error('profil illisible');
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, {
        user: { id: user.id, username: user.global_name || user.username, avatar: user.avatar },
        guilds: guilds.filter(g => hasAccess(g.permissions, g.owner)).map(g => ({ id: g.id, name: g.name, icon: g.icon })),
        exp: Date.now() + 6 * 3600 * 1000
      });
      return go(`${SITE}#token=${token}`);
    } catch (e) {
      console.error('[WebDashboard] connexion :', e.message);
      return go(`${SITE}#error=login`);
    }
  }

  /* ---------- Session ---------- */
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  const sess = sessions.get(tok);
  if (!sess || sess.exp < Date.now()) return S(401, { error: 'unauthorized' });

  const readValues = async (guildId, m) => {
    const data = (await get(guildId, m.bucket, {})) || {};
    const out = {};
    for (const f of m.fields) out[f.key] = data[f.key] !== undefined ? data[f.key] : f.def;
    return out;
  };

  if (p === '/api/me' && req.method === 'GET') {
    return S(200, { user: sess.user, guilds: sess.guilds.map(g => ({ ...g, botIn: client.guilds.cache.has(g.id) })) });
  }
  if (p === '/api/logout' && req.method === 'POST') { sessions.delete(tok); return S(200, { ok: true }); }

  const m = p.match(/^\/api\/guilds\/(\d+)(?:\/(meta)|\/modules\/(\w+))?$/);
  if (!m) return S(404, { error: 'not_found' });
  const [, guildId, isMeta, modId] = m;
  if (!sess.guilds.some(g => g.id === guildId)) return S(403, { error: 'forbidden' });
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return S(404, { error: 'bot_absent' });

  if (!isMeta && !modId && req.method === 'GET') {
    const modules = [];
    for (const mod of MODULES) {
      const v = await readValues(guildId, mod);
      modules.push({ id: mod.id, name: mod.name, group: mod.group, desc: mod.desc, enabled: !!v[mod.toggle] });
    }
    return S(200, { id: guild.id, name: guild.name, icon: guild.icon, members: guild.memberCount, channels: guild.channels.cache.size, roles: guild.roles.cache.size, modules });
  }

  if (isMeta && req.method === 'GET') {
    return S(200, {
      channels: guild.channels.cache.filter(c => TEXT_CHANNEL_TYPES.includes(c.type)).map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
      roles: guild.roles.cache.filter(r => r.id !== guild.id && !r.managed).map(r => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name))
    });
  }

  if (modId) {
    const mod = MODULES.find(x => x.id === modId);
    if (!mod) return S(404, { error: 'module' });

    if (req.method === 'GET') {
      return S(200, { module: { id: mod.id, name: mod.name, desc: mod.desc, fields: mod.fields.map(publicField) }, values: await readValues(guildId, mod) });
    }

    if (req.method === 'PUT') {
      let body;
      try { body = await readBody(req); } catch { return S(400, { error: 'invalid' }); }
      const chanIds = new Set(guild.channels.cache.filter(c => TEXT_CHANNEL_TYPES.includes(c.type)).map(c => c.id));
      const roleIds = new Set(guild.roles.cache.map(r => r.id));
      const clean = {};
      for (const f of mod.fields) {
        if (!(f.key in body)) continue;
        const v = body[f.key];
        if (f.type === 'bool') clean[f.key] = v === true;
        else if (f.type === 'text' || f.type === 'longtext') clean[f.key] = String(v ?? '').slice(0, f.max || 200);
        else if (f.type === 'number') {
          const n = Number(v);
          if (!Number.isFinite(n)) return S(400, { error: 'invalid', field: f.key });
          clean[f.key] = Math.min(f.max ?? 1e9, Math.max(f.min ?? -1e9, Math.round(n)));
        } else if (f.type === 'channel') {
          if (v && !chanIds.has(String(v))) return S(400, { error: 'invalid', field: f.key });
          clean[f.key] = v ? String(v) : '';
        } else if (f.type === 'role') {
          if (v && !roleIds.has(String(v))) return S(400, { error: 'invalid', field: f.key });
          clean[f.key] = v ? String(v) : '';
        }
      }
      const current = (await get(guildId, mod.bucket, {})) || {};
      await set(guildId, mod.bucket, { ...current, ...clean });
      console.log(`[WebDashboard] ${sess.user.username} a modifié « ${mod.id} » sur ${guild.name}`);
      return S(200, { ok: true, values: await readValues(guildId, mod) });
    }
  }
  return S(405, { error: 'method' });
}