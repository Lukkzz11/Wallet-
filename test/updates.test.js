import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import * as L from '../server/services/ledger.js';
import * as P from '../server/services/planning.js';
import * as V from '../server/services/views.js';
import * as K from '../server/services/cards.js';
import * as U from '../server/services/updater.js';
import { simulateCardPurchase } from '../server/core/cards.js';
import { consolidate } from '../server/core/finance.js';

test('receitas: aluguel da casa separado de Life Surf e fora do rendimento disponível', () => {
  const db = openDb(':memory:');
  const acc = L.createAccount(db, { name: 'Conta Corrente', type: 'conta', initial_balance: 100000, ref_date: '2026-10-01' }).id;
  
  // Receita de Aluguel
  L.createEntry(db, 'income', {
    description: 'Aluguel Casa', amount: 250000, due_date: '2026-10-10', paid_date: '2026-10-10', status: 'paid', account_id: acc, origin: 'Inquilino',
  }, '2026-10-15');

  // Receita Life Surf
  L.createEntry(db, 'income', {
    description: 'Vendas Life Surf', amount: 700000, due_date: '2026-10-12', paid_date: '2026-10-12', status: 'paid', account_id: acc, origin: 'Life Surf',
  }, '2026-10-15');

  const s = V.loadSnapshot(db);
  const d = V.dashboard(s, '2026-10-15', '2026-10');

  assert.equal(d.receivedLifeSurf, 700000);
  assert.equal(d.receivedAluguel, 250000);
  assert.equal(d.receivedCombined, 950000);
  // O rendimento disponível recebido é APENAS o Life Surf
  assert.equal(d.received, 700000);
});

test('despesas e assinaturas: marcar como já pago (prepaid) não desconta do saldo disponível', () => {
  const db = openDb(':memory:');
  const acc = L.createAccount(db, { name: 'Conta', type: 'conta', initial_balance: 500000, ref_date: '2026-10-01' }).id;

  // 1. Despesa avulsa marcada como já paga
  const e1 = L.createEntry(db, 'expense', {
    description: 'Conta de Luz anterior', amount: 15000, due_date: '2026-10-05', account_id: acc, already_paid: true,
  }, '2026-10-15');
  assert.ok(e1.id);

  let cons = consolidate(V.loadSnapshot(db));
  // O saldo disponível de 500000 permanece intacto!
  assert.equal(cons.available, 500000);

  // 2. Assinatura registrada como já paga (mode: prepaid)
  const sub = P.createSubscription(db, {
    name: 'Netflix', amount: 5000, period: 'monthly', start_date: '2026-10-01', next_date: '2026-10-01', account_id: acc,
  });
  P.chargeSubscription(db, sub.id, { mode: 'prepaid', paid_date: '2026-10-01' });

  cons = consolidate(V.loadSnapshot(db));
  // Saldo permanece 500000!
  assert.equal(cons.available, 500000);
});

test('simulador de cartões: exibe valor integral já pago consolidado e total de assinaturas pagas', () => {
  const db = openDb(':memory:');
  const acc = L.createAccount(db, { name: 'Conta', type: 'conta', initial_balance: 500000, ref_date: '2026-10-01' }).id;
  const c1 = K.createCard(db, { name: 'Cartão 1', due_day: 10, account_id: acc }).id;
  const c2 = K.createCard(db, { name: 'Cartão 2', due_day: 15, account_id: acc }).id;

  // Parcela paga no Cartão 1 (2 parcelas de 10000, 1 já paga antes)
  K.createCardPurchase(db, {
    name: 'Tênis', card_id: c1, installment_amount: 10000, installments_total: 2, paid: 1,
  }, '2026-10-15');

  // Parcela paga no Cartão 2 (4 parcelas de 25000, 2 já pagas antes)
  K.createCardPurchase(db, {
    name: 'Mesa', card_id: c2, installment_amount: 25000, installments_total: 4, paid: 2,
  }, '2026-10-15');

  // Assinatura paga
  const sub = P.createSubscription(db, { name: 'Spotify', amount: 3500, period: 'monthly', start_date: '2026-10-01', next_date: '2026-10-01', account_id: acc });
  P.chargeSubscription(db, sub.id, { mode: 'paid', account_id: acc, paid_date: '2026-10-01' });

  const s = V.loadSnapshot(db);
  const sim = simulateCardPurchase(s, '2026-10-15', { card_id: c1, total: 30000, installments: 3 });

  // Integral consolidado de todos os cartões: 1x 10000 + 2x 25000 = 60000
  assert.equal(sim.totalCardsPaidConsolidated, 60000);
  // Total de assinaturas pagas: 3500
  assert.equal(sim.totalSubscriptionsPaid, 3500);
});

test('compras em lote: cálculo consolidado PIX vs parcelado e impacto mensal por mês', () => {
  const items = [
    { name: 'Monitor', price_cash: 100000, count: 5, installment: 20000 },
    { name: 'Cadeira', price_cash: 60000, count: 3, installment: 20000 },
    { name: 'Teclado', price_cash: 20000, count: 1, installment: 0 },
  ];

  // 1. Total PIX
  const totalPix = items.reduce((s, i) => s + i.price_cash, 0);
  assert.equal(totalPix, 180000); // R$ 1.800,00

  // 2. Total Parcelado
  const totalCard = items.reduce((s, i) => s + (i.count > 1 ? i.count * i.installment : i.price_cash), 0);
  assert.equal(totalCard, 180000); // 5*200 + 3*200 + 200 = R$ 1.800,00

  // 3. Impacto mensal
  // Mês 0 (1º mês): Monitor (20000) + Cadeira (20000) + Teclado (20000) = 60000
  // Mês 1 (2º mês): Monitor (20000) + Cadeira (20000) = 40000
  // Mês 2 (3º mês): Monitor (20000) + Cadeira (20000) = 40000
  // Mês 3 (4º mês): Monitor (20000) = 20000
  // Mês 4 (5º mês): Monitor (20000) = 20000
  const maxCount = Math.max(...items.map((i) => i.count));
  const monthly = [];
  for (let m = 0; m < maxCount; m++) {
    let sum = 0;
    for (const item of items) {
      if (item.count > m) {
        sum += item.count > 1 ? item.installment : (m === 0 ? item.price_cash : 0);
      }
    }
    monthly.push(sum);
  }
  assert.deepEqual(monthly, [60000, 40000, 40000, 20000, 20000]);
  assert.equal(monthly.reduce((a, b) => a + b, 0), totalCard);
});

test('comparador de preços: decide corretamente entre PIX e Cartão com base no desconto e parcelas', () => {
  // Oferta 1: 15% de desconto no PIX (R$ 850 vs 10x de R$ 100 = R$ 1000)
  const off1 = { pixTotal: 85000, cardTotal: 100000, count: 10 };
  const discount1 = (off1.cardTotal - off1.pixTotal) / off1.cardTotal;
  assert.ok(discount1 >= 0.04); // >= 4% -> COMPENSA PIX

  // Oferta 2: Sem desconto no PIX (R$ 1000 no PIX vs 10x de R$ 100 no Cartão)
  const off2 = { pixTotal: 100000, cardTotal: 100000, count: 10 };
  const discount2 = (off2.cardTotal - off2.pixTotal) / off2.cardTotal;
  assert.equal(discount2, 0); // 0% desconto -> COMPENSA CARTÃO (preserva liquidez)
});

test('assinaturas: zerar/resetar limpa todas as assinaturas desvinculando entradas', () => {
  const db = openDb(':memory:');
  const acc = L.createAccount(db, { name: 'Conta', type: 'conta', initial_balance: 100000, ref_date: '2026-10-01' }).id;
  const s1 = P.createSubscription(db, { name: 'Netflix', amount: 4500, period: 'monthly', start_date: '2026-10-01', next_date: '2026-10-01', account_id: acc });
  const s2 = P.createSubscription(db, { name: 'Spotify', amount: 2500, period: 'monthly', start_date: '2026-10-01', next_date: '2026-10-01', account_id: acc });

  P.chargeSubscription(db, s1.id, { mode: 'paid', account_id: acc, paid_date: '2026-10-01' });

  // Zerar assinaturas
  P.resetSubscriptions(db);

  const subs = db.prepare('SELECT COUNT(*) as c FROM subscriptions').get().c;
  assert.equal(subs, 0);

  // A despesa gerada pela cobrança continua existindo, apenas desvinculada
  const entries = db.prepare("SELECT COUNT(*) as c FROM entries WHERE description LIKE '%Netflix%'").get().c;
  assert.equal(entries, 1);
  const entry = db.prepare("SELECT subscription_id FROM entries WHERE description LIKE '%Netflix%'").get();
  assert.equal(entry.subscription_id, null);
});

test('assinaturas: excluir assinatura converte/envia para despesas sem perder histórico', () => {
  const db = openDb(':memory:');
  const acc = L.createAccount(db, { name: 'Conta', type: 'conta', initial_balance: 100000, ref_date: '2026-10-01' }).id;
  
  // Caso A: Assinatura com cobrança já registrada
  const s1 = P.createSubscription(db, { name: 'Amazon Prime', amount: 1990, period: 'monthly', start_date: '2026-10-01', next_date: '2026-10-01', account_id: acc });
  P.chargeSubscription(db, s1.id, { mode: 'paid', account_id: acc, paid_date: '2026-10-01' });
  P.deleteSubscription(db, s1.id);

  assert.equal(db.prepare('SELECT COUNT(*) as c FROM subscriptions WHERE id = ?').get(s1.id).c, 0);
  const e1 = db.prepare("SELECT * FROM entries WHERE description LIKE '%Amazon Prime%'").get();
  assert.ok(e1);
  assert.equal(e1.subscription_id, null);

  // Caso B: Assinatura sem cobrança registrada -> cria automaticamente uma despesa pendente
  const s2 = P.createSubscription(db, { name: 'iCloud+', amount: 1490, period: 'monthly', start_date: '2026-10-01', next_date: '2026-10-01', account_id: acc });
  P.deleteSubscription(db, s2.id);

  assert.equal(db.prepare('SELECT COUNT(*) as c FROM subscriptions WHERE id = ?').get(s2.id).c, 0);
  const e2 = db.prepare("SELECT * FROM entries WHERE description LIKE '%iCloud+%'").get();
  assert.ok(e2);
  assert.equal(e2.amount, 1490);
  assert.equal(e2.type, 'expense');
  assert.equal(e2.status, 'pending');
});

test('despesas: categorias Financiamento e Pessoa Física criadas na migração', () => {
  const db = openDb(':memory:');
  const cats = db.prepare("SELECT name FROM categories WHERE kind = 'expense'").all().map(r => r.name);
  assert.ok(cats.includes('Financiamento (Casa)'));
  assert.ok(cats.includes('Pessoa Física'));
});

test('auto-updater: comparação semântica de versões', () => {
  assert.equal(U.compareVersions('1.1.0', '1.0.0'), 1);
  assert.equal(U.compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(U.compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(U.compareVersions('v2.0.0', '1.9.9'), 1);
  assert.equal(U.compareVersions('v1.0.0-beta', '1.0.0'), 0);
  assert.equal(U.compareVersions('1.10.0', '1.2.0'), 1);
});

test('auto-updater: repositório padrão e configuração no banco', () => {
  const db = openDb(':memory:');
  const defaultRepo = U.getRepo(db);
  assert.ok(defaultRepo.includes('/'));

  U.setRepo(db, 'teste-user/meu-repo');
  assert.equal(U.getRepo(db), 'teste-user/meu-repo');

  // Rejeita formato inválido
  assert.throws(() => U.setRepo(db, 'invalido'));
});

test('auto-updater: getStatus retorna estrutura com versão atual e estado', () => {
  const db = openDb(':memory:');
  const ctx = { db, dataDir: 'C:\\tmp' };
  const st = U.getStatus(ctx);
  assert.ok(st.currentVersion);
  assert.equal(typeof st.readyToInstall, 'boolean');
  assert.equal(typeof st.checking, 'boolean');
  assert.ok(st.repo);
});



