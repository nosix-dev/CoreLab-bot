// src/core/rpData.js
'use strict';

const { getGuildBucket } = require('./config');
const { persist } = require('./data');

const DEFAULT_RP = { profiles: {}, married: {}, lastActions: {} };

function getRpBucket(guildId) {
  const bucket = getGuildBucket(guildId, 'rpData', { ...DEFAULT_RP });
  if (!bucket.profiles) bucket.profiles = {};
  if (!bucket.married) bucket.married = {};
  if (!bucket.lastActions) bucket.lastActions = {};
  return bucket;
}

function getProfile(guildId, userId) {
  const bucket = getRpBucket(guildId);
  return bucket.profiles[String(userId)] || null;
}

function saveProfile(guildId, userId, fields) {
  const bucket = getRpBucket(guildId);
  const uid = String(userId);
  bucket.profiles[uid] = { ...(bucket.profiles[uid] || {}), ...fields };
  persist('rpData');
  return bucket.profiles[uid];
}

function deleteProfile(guildId, userId) {
  const bucket = getRpBucket(guildId);
  delete bucket.profiles[String(userId)];
  persist('rpData');
}

module.exports = { getRpBucket, getProfile, saveProfile, deleteProfile };