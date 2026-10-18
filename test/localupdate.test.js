import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localStatus, applyLocal } from '../server/services/localupdate.js';

const mk = (dir, version) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version })); };

test('atualização local: compara a versão instalada com a da pasta de origem', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-lu-'));
  const inst = path.join(base, 'instalado'), src = path.join(base, 'origem');
  mk(inst, '1.1.2'); mk(src, '1.1.3');
  // sem origem.json: não sabe onde procurar
  assert.deepEqual(localStatus({ installRoot: inst }), { installed: '1.1.2', source: null, sourceFound: false, available: null, hasUpdate: false, sameFolder: false });
  fs.mkdirSync(path.join(inst, 'launcher'));
  fs.writeFileSync(path.join(inst, 'launcher', 'origem.json'), JSON.stringify({ source: src }));
  const st = localStatus({ installRoot: inst });
  assert.deepEqual([st.installed, st.available, st.hasUpdate, st.sourceFound], ['1.1.2', '1.1.3', true, true]);
  // mesma versão ou mais antiga: sem atualização
  mk(src, '1.1.2');
  assert.equal(localStatus({ installRoot: inst }).hasUpdate, false);
  mk(src, '1.0.9');
  assert.equal(localStatus({ installRoot: inst }).hasUpdate, false);
  // origem que não existe mais
  fs.writeFileSync(path.join(inst, 'launcher', 'origem.json'), JSON.stringify({ source: path.join(base, 'sumiu') }));
  assert.deepEqual([localStatus({ installRoot: inst }).sourceFound, localStatus({ installRoot: inst }).hasUpdate], [false, false]);
});

test('atualização local: abre só o Atualizar Wallet.vbs da origem registrada', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-lu-'));
  const inst = path.join(base, 'instalado'), src = path.join(base, 'origem');
  mk(inst, '1.1.2'); mk(src, '1.1.3');
  fs.mkdirSync(path.join(inst, 'launcher'));
  fs.writeFileSync(path.join(inst, 'launcher', 'origem.json'), JSON.stringify({ source: src }));
  assert.throws(() => applyLocal({ installRoot: inst, spawnFn: () => assert.fail('não deveria abrir') }), /Atualizar Wallet\.vbs/);
  fs.writeFileSync(path.join(src, 'Atualizar Wallet.vbs'), "' teste");
  const calls = [];
  const r = applyLocal({ installRoot: inst, spawnFn: (exe, args) => { calls.push([exe, args]); return { unref() {} }; } });
  assert.equal(r.started, true);
  assert.deepEqual(calls, [['wscript.exe', [path.join(src, 'Atualizar Wallet.vbs')]]]);
  // sem origem registrada
  const vazio = path.join(base, 'vazio'); mk(vazio, '1.0.0');
  assert.throws(() => applyLocal({ installRoot: vazio }), /Não sei onde/);
});

test('a versão lida pelo atualizador é a do package.json (antes caía sempre em 1.0.0)', async () => {
  const { getCurrentVersion } = await import('../server/services/updater.js');
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(getCurrentVersion(), pkg.version);
});
