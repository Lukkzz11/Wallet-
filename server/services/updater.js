import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { get, run } from '../db.js';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))); // raiz do app (onde está o package.json)
let pkgVersion = '1.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version) pkgVersion = pkg.version;
} catch {
  // fallback padrão
}

export function getCurrentVersion() {
  return pkgVersion;
}

export function getRepo(db) {
  if (process.env.WALLET_GITHUB_REPO) return process.env.WALLET_GITHUB_REPO;
  try {
    if (db) {
      const row = get(db, 'SELECT value FROM settings WHERE key = ?', 'github_repo');
      if (row?.value) return row.value;
    }
  } catch {
    // fallback
  }
  return 'Lukkzz11/Wallet-';
}

export function setRepo(db, newRepo) {
  const clean = String(newRepo || '').trim();
  if (!clean || !/^[\w.-]+\/[\w.-]+$/.test(clean)) {
    throw new Error('Formato do repositório inválido. Use "usuario/repositorio".');
  }
  run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'github_repo', clean);
  return clean;
}

export function compareVersions(a, b) {
  const cleanA = String(a || '').replace(/^[vV]/, '').split('-')[0];
  const cleanB = String(b || '').replace(/^[vV]/, '').split('-')[0];
  const pa = cleanA.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = cleanB.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export function getDataDir(ctx) {
  return ctx?.dataDir || process.env.WALLET_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'WalletLucas');
}

const state = {
  checking: false,
  downloading: false,
  downloadProgress: 0,
  readyToInstall: false,
  lastCheck: null,
  updateInfo: null,
  downloadedFile: null,
  error: null,
};

export async function checkUpdate(ctx, { repo: customRepo, silent = false } = {}) {
  const repo = customRepo || getRepo(ctx?.db);
  const current = getCurrentVersion();
  state.checking = true;
  state.error = null;

  try {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'WalletLucas-App',
        'Accept': 'application/vnd.github.v3+json',
      },
      signal: AbortSignal.timeout(7000),
    });

    state.lastCheck = new Date().toISOString();

    if (res.status === 404) {
      state.checking = false;
      state.updateInfo = null;
      return {
        ok: true,
        hasUpdate: false,
        currentVersion: current,
        latestVersion: current,
        checkedAt: state.lastCheck,
        message: 'Nenhum release publicado encontrado no repositório.',
      };
    }

    if (!res.ok) {
      throw new Error(`GitHub API retornou status ${res.status}: ${res.statusText}`);
    }

    const release = await res.json();
    const rawTag = release.tag_name || release.name || '';
    const latestVersion = rawTag.replace(/^[vV]/, '');
    const hasUpdate = compareVersions(latestVersion, current) > 0;

    const asset = (release.assets || []).find((a) => a.name.endsWith('.exe')) || null;

    const info = {
      ok: true,
      hasUpdate,
      currentVersion: current,
      latestVersion,
      tagName: rawTag,
      name: release.name || rawTag,
      body: release.body || '',
      publishedAt: release.published_at,
      asset: asset ? {
        name: asset.name,
        size: asset.size,
        downloadUrl: asset.browser_download_url,
      } : null,
      checkedAt: state.lastCheck,
    };

    state.updateInfo = info;
    state.checking = false;

    const updateDir = path.join(getDataDir(ctx), 'updates');
    const exePath = path.join(updateDir, 'WalletSetup.exe');
    if (hasUpdate && fs.existsSync(exePath)) {
      const stats = fs.statSync(exePath);
      if (!asset || stats.size === asset.size || stats.size > 10 * 1024 * 1024) {
        state.readyToInstall = true;
        state.downloadedFile = exePath;
      }
    }

    return info;
  } catch (err) {
    state.checking = false;
    state.error = err.message;
    if (!silent) {
      return {
        ok: false,
        hasUpdate: false,
        currentVersion: current,
        error: err.message,
        checkedAt: new Date().toISOString(),
      };
    }
    return { ok: false, error: err.message };
  }
}

export async function downloadUpdate(ctx, { url: customUrl, targetVersion } = {}) {
  const downloadUrl = customUrl || state.updateInfo?.asset?.downloadUrl;
  if (!downloadUrl) {
    throw new Error('Nenhum link de download de executável disponível para atualização.');
  }

  const updateDir = path.join(getDataDir(ctx), 'updates');
  fs.mkdirSync(updateDir, { recursive: true });

  const destFile = path.join(updateDir, 'WalletSetup.exe');
  const tempFile = path.join(updateDir, 'WalletSetup.exe.part');

  state.downloading = true;
  state.downloadProgress = 0;
  state.error = null;

  try {
    const res = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'WalletLucas-App' },
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) throw new Error(`Falha no download (${res.status}): ${res.statusText}`);

    const totalBytes = Number(res.headers.get('content-length') || 0);
    let receivedBytes = 0;

    const fileStream = fs.createWriteStream(tempFile);
    const reader = res.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(value);
      receivedBytes += value.length;
      if (totalBytes > 0) {
        state.downloadProgress = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
      }
    }

    await new Promise((resolve, reject) => {
      fileStream.end();
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });

    if (fs.existsSync(destFile)) {
      try { fs.unlinkSync(destFile); } catch {}
    }
    fs.renameSync(tempFile, destFile);

    state.downloading = false;
    state.downloadProgress = 100;
    state.readyToInstall = true;
    state.downloadedFile = destFile;

    return {
      ok: true,
      readyToInstall: true,
      path: destFile,
      size: receivedBytes,
      version: targetVersion || state.updateInfo?.latestVersion,
    };
  } catch (err) {
    state.downloading = false;
    state.error = err.message;
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch {}
    }
    throw err;
  }
}

export function applyUpdate(ctx) {
  const updateDir = path.join(getDataDir(ctx), 'updates');
  const destFile = path.join(updateDir, 'WalletSetup.exe');

  if (!fs.existsSync(destFile)) {
    throw new Error('Arquivo de atualização não encontrado. Faça o download antes de aplicar.');
  }

  const cmd = `timeout /t 2 /nobreak >nul & start "" "${destFile}"`;
  const child = spawn('cmd.exe', ['/c', cmd], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();

  setTimeout(() => {
    try { if (ctx?.db) ctx.db.close(); } catch {}
    process.exit(0);
  }, 500);

  return { ok: true, applying: true, message: 'Aplicativo reiniciando para instalar a atualização...' };
}

export function getStatus(ctx) {
  const repo = getRepo(ctx?.db);
  const current = getCurrentVersion();
  const updateDir = path.join(getDataDir(ctx), 'updates');
  const destFile = path.join(updateDir, 'WalletSetup.exe');
  const fileExists = fs.existsSync(destFile);

  return {
    ...state,
    readyToInstall: state.readyToInstall || (fileExists && state.updateInfo?.hasUpdate),
    downloadedFile: fileExists ? destFile : null,
    currentVersion: current,
    repo,
  };
}

export function startAutoUpdater(ctx) {
  setTimeout(async () => {
    try {
      const res = await checkUpdate(ctx, { silent: true });
      if (res?.hasUpdate && res.asset?.downloadUrl) {
        console.log(`[Auto-Updater] Nova versão encontrada: v${res.latestVersion}. Baixando atualização em segundo plano...`);
        await downloadUpdate(ctx, { url: res.asset.downloadUrl, targetVersion: res.latestVersion });
        console.log(`[Auto-Updater] Atualização v${res.latestVersion} baixada com sucesso. Pronta para instalar.`);
      }
    } catch (e) {
      console.log('[Auto-Updater] Verificação de rotina:', e.message);
    }
  }, 4000);
}
