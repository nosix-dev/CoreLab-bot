"use strict";
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const BIN_PATH = path.join(__dirname, "..", "..", "cloudflared");
const ARCH_MAP = { x64: "amd64", arm64: "arm64" };
const DOWNLOAD_URL = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH_MAP[os.arch()] || "amd64"}`;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function ensureBinary() {
  if (fs.existsSync(BIN_PATH)) return;
  console.log("[tunnel] Téléchargement de cloudflared...");
  await download(DOWNLOAD_URL, BIN_PATH);
  fs.chmodSync(BIN_PATH, 0o755);
  console.log("[tunnel] cloudflared prêt.");
}

function startTunnel(port, onUrl) {
  const proc = spawn(BIN_PATH, ["tunnel", "--url", `http://localhost:${port}`]);
  let found = false;

  const handleOutput = (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !found) {
      found = true;
      console.log(`[tunnel] URL du dashboard : ${match[0]}`);
      if (onUrl) onUrl(match[0]);
    }
  };

  proc.stdout.on("data", handleOutput);
  proc.stderr.on("data", handleOutput); // cloudflared log sur stderr
  proc.on("exit", (code) => console.log(`[tunnel] cloudflared arrêté (code ${code})`));

  return proc;
}

async function startDashboardTunnel(port, onUrl) {
  try {
    await ensureBinary();
    startTunnel(port, onUrl);
  } catch (err) {
    console.error("[tunnel] Erreur:", err.message);
  }
}

module.exports = { startDashboardTunnel };