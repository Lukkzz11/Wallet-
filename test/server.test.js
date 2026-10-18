import test from 'node:test';
import net from 'node:net';
import http from 'node:http';
import assert from 'node:assert/strict';
import { openDb, get } from '../server/db.js';
import { createServer } from '../server/index.js';

async function boot() {
  const ctx = { db: openDb(':memory:'), file: ':memory:' };
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const real = createServer(ctx, { port });
  await new Promise((r) => real.listen(port, '127.0.0.1', r));
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const raw = (method, path, headers) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  return { ctx, call, raw, close: () => { real.closeAllConnections(); real.close(); }, port };
}

test('API: só aceita Host local e origem local; escuta apenas em 127.0.0.1', async () => {
  const s = await boot();
  assert.equal((await s.call('GET', '/api/health')).status, 200);
  assert.equal(await s.raw('GET', '/api/health', { Host: 'evil.example' }), 403);
  assert.equal(await s.raw('POST', '/api/accounts', { Origin: 'http://evil.example' }), 403);
  s.close();
});

test('senha: hash scrypt no banco, API bloqueada sem token', async () => {
  const s = await boot();
  assert.equal((await s.call('POST', '/api/auth/password', { password: '1234' })).status, 200);
  const stored = get(s.ctx.db, "SELECT value FROM settings WHERE key='password_hash'").value;
  assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.ok(!stored.includes('1234'));
  assert.equal((await s.call('GET', '/api/bootstrap')).status, 401);
  assert.equal((await s.call('POST', '/api/auth/login', { password: 'errada' })).status, 401);
  const { body } = await s.call('POST', '/api/auth/login', { password: '1234' });
  const boot2 = await s.call('GET', '/api/bootstrap', null, { 'X-Wallet-Token': body.token });
  assert.equal(boot2.status, 200);
  assert.equal(boot2.body.settings.password_hash, undefined, 'hash nunca vai para a interface');
  s.close();
});

test('API: valores são validados e o banco começa neutro', async () => {
  const s = await boot();
  const b = await s.call('GET', '/api/bootstrap');
  assert.equal(b.body.accounts.length, 0);
  assert.equal(b.body.settings.user_name, 'Lucas');
  const bad = await s.call('POST', '/api/accounts', { name: 'A', type: 'conta', initial_balance: 12.5, ref_date: '2026-10-01' });
  assert.equal(bad.status, 400, 'centavos devem ser inteiros');
  const d = await s.call('GET', '/api/dashboard');
  assert.equal(d.body.totalBalance, 0);
  assert.equal(d.body.hasData, false);
  s.close();
});

test('API de cartões respeita o mês escolhido (mês, não só o atual)', async () => {
  const s = await boot();
  const post = (p, b) => s.call('POST', p, b);
  await post('/api/accounts', { name: 'Banco', type: 'conta', initial_balance: 0, ref_date: '2026-01-01' });
  const card = (await post('/api/cards', { name: 'Cartão', bank: 'Nubank' })).body.id;
  await post('/api/cards/purchases', { name: 'TV', card_id: card, installment_amount: 10000, installments_total: 2, start_month: '2026-11' });
  const nov = (await s.call('GET', '/api/cards?month=2026-11')).body;
  assert.equal(nov.month, '2026-11');
  assert.equal(nov.selected.total, 10000);
  assert.equal(nov.cards[0].items.length, 1);
  const dez = (await s.call('GET', '/api/cards?month=2026-12')).body;
  assert.equal(dez.month, '2026-12');
  assert.equal(dez.selected.total, 10000);
  assert.equal((await s.call('GET', '/api/cards?month=2027-05')).body.selected.total, 0);
  assert.equal((await s.call('GET', '/api/cards?year=2027')).body.cards[0].yearBase[0].month, '2027-01');
  s.close();
});
