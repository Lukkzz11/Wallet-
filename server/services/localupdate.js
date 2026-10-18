// Atualização local (sem internet): compara a versão instalada com a da pasta de origem, onde fica o código-fonte.
// O caminho da origem é gravado em launcher/origem.json por launcher/atualizar.js a cada atualização.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bad } from '../util.js';
import { compareVersions, getCurrentVersion } from './updater.js';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

export function originOf(installRoot = root) {
  const o = readJson(path.join(installRoot, 'launcher', 'origem.json'));
  return o && typeof o.source === 'string' && o.source ? o.source : null;
}

export function localStatus({ installRoot = root } = {}) {
  const installed = readJson(path.join(installRoot, 'package.json'))?.version || getCurrentVersion();
  const source = originOf(installRoot);
  const available = (source && readJson(path.join(source, 'package.json'))?.version) || null;
  const sameFolder = !!source && path.resolve(source).toLowerCase() === path.resolve(installRoot).toLowerCase();
  return { installed, source, sourceFound: !!available, available, hasUpdate: !!available && !sameFolder && compareVersions(available, installed) > 0, sameFolder };
}

// Abre o "Atualizar Wallet.vbs" da pasta de origem (ele pede confirmação, faz backup, troca os arquivos e reabre o app).
export function applyLocal({ installRoot = root, spawnFn = spawn } = {}) {
  const st = localStatus({ installRoot });
  if (!st.source || !st.sourceFound) throw bad('Não sei onde está a pasta com a versão nova. Use uma vez o atalho "Atualizar Wallet".');
  if (st.sameFolder) throw bad('A pasta de origem é a própria pasta instalada.');
  const vbs = path.join(st.source, 'Atualizar Wallet.vbs');
  if (!fs.existsSync(vbs)) throw bad('Não encontrei o "Atualizar Wallet.vbs" na pasta de origem.');
  spawnFn('wscript.exe', [vbs], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true, started: true };
}
