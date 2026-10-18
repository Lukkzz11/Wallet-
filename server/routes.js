import { all, get, getSettings } from './db.js';
import { bad, notFound, cents, int, date } from './util.js';
import { todayStr, addDays, monthOf, monthStart, monthEnd } from './core/dates.js';
import { consolidate, goalProgress, debtSummary, debtCommitment, reserveTotals, accountBalance } from './core/finance.js';
import { computeWithdrawal, simulateWithdrawal, SCENARIOS } from './core/withdrawal.js';
import { project, analyze, savingsFromCuts, purchaseImpact, variableAverage } from './core/projection.js';
import * as L from './services/ledger.js';
import * as P from './services/planning.js';
import * as V from './services/views.js';
import * as B from './services/backup.js';
import * as A from './services/auth.js';

const idOf = (v) => int(v, { name: 'Id', min: 1 });
const today = () => todayStr();
const snap = (ctx) => V.loadSnapshot(ctx.db);
const publicSettings = (db) => { const { password_hash, integration_key, ...rest } = getSettings(db); return rest; };

// [método, caminho, handler(ctx, {params, query, body})]
export const routes = [];
const on = (m, p, h) => routes.push([m, new RegExp(`^${p.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), h]);

on('GET', '/api/health', () => ({ ok: true }));

/* auth */
on('GET', '/api/auth/status', (c, r) => ({ locked: A.hasPassword(c.db), authed: A.isAuthed(c.db, r.token) }));
on('POST', '/api/auth/login', (c, r) => ({ token: A.login(c.db, r.body.password) }));
on('POST', '/api/auth/logout', (c, r) => { A.logout(r.token); return { ok: true }; });
on('POST', '/api/auth/password', (c, r) => { A.setPassword(c.db, r.body.current, r.body.password); return { ok: true }; });
on('POST', '/api/auth/remove', (c, r) => { A.removePassword(c.db, r.body.current); return { ok: true }; });

/* bootstrap / configurações / categorias */
on('GET', '/api/bootstrap', (c) => {
  L.materializeRecurrences(c.db, today());
  return { today: today(), settings: publicSettings(c.db), locked: A.hasPassword(c.db), categories: all(c.db, 'SELECT * FROM categories ORDER BY name'), accounts: L.listAccounts(c.db) };
});
on('PUT', '/api/settings', (c, r) => { P.updateSettings(c.db, r.body); return publicSettings(c.db); });
on('POST', '/api/categories', (c, r) => P.createCategory(c.db, r.body));
on('PUT', '/api/categories/:id', (c, r) => { P.renameCategory(c.db, idOf(r.params.id), r.body); return { ok: true }; });
on('DELETE', '/api/categories/:id', (c, r) => { P.deleteCategory(c.db, idOf(r.params.id), r.query.reassign ? idOf(r.query.reassign) : null); return { ok: true }; });

/* contas e movimentações */
on('GET', '/api/accounts', (c) => L.listAccounts(c.db));
on('POST', '/api/accounts', (c, r) => L.createAccount(c.db, r.body));
on('PUT', '/api/accounts/:id', (c, r) => { L.updateAccount(c.db, idOf(r.params.id), r.body); return { ok: true }; });
on('DELETE', '/api/accounts/:id', (c, r) => { L.deleteAccount(c.db, idOf(r.params.id)); return { ok: true }; });
on('GET', '/api/accounts/:id/movements', (c, r) => L.listMovements(c.db, idOf(r.params.id)));
on('POST', '/api/accounts/:id/movements', (c, r) => L.addManualMovement(c.db, idOf(r.params.id), r.body));
on('PUT', '/api/movements/:id', (c, r) => { L.correctMovement(c.db, idOf(r.params.id), r.body); return { ok: true }; });
on('DELETE', '/api/movements/:id', (c, r) => { L.deleteMovement(c.db, idOf(r.params.id)); return { ok: true }; });
on('POST', '/api/transfers', (c, r) => L.transfer(c.db, r.body));
on('DELETE', '/api/transfers/:tid', (c, r) => { L.deleteTransfer(c.db, r.params.tid); return { ok: true }; });
on('GET', '/api/audit', (c) => all(c.db, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT 200'));

/* lançamentos */
const entryType = (t) => (t === 'incomes' ? 'income' : t === 'expenses' ? 'expense' : null);
on('GET', '/api/:t/list', (c, r) => {
  const t = entryType(r.params.t); if (!t) throw notFound();
  L.materializeRecurrences(c.db, today());
  return L.listEntries(c.db, t, { ...r.query, today: today() });
});
on('POST', '/api/:t/list', (c, r) => { const t = entryType(r.params.t); if (!t) throw notFound(); return L.createEntry(c.db, t, r.body, today()); });
on('PUT', '/api/entries/:id', (c, r) => { L.updateEntry(c.db, idOf(r.params.id), r.body); return { ok: true }; });
on('POST', '/api/entries/:id/pay', (c, r) => { L.payEntry(c.db, idOf(r.params.id), r.body); return { ok: true }; });
on('POST', '/api/entries/:id/mark-prepaid', (c, r) => { L.markPrepaid(c.db, idOf(r.params.id), r.body); return { ok: true }; });
on('POST', '/api/entries/:id/unpay', (c, r) => { L.unpayEntry(c.db, idOf(r.params.id)); return { ok: true }; });
on('DELETE', '/api/entries/:id', (c, r) => { L.deleteEntry(c.db, idOf(r.params.id), r.query.scope); return { ok: true }; });

/* assinaturas */
on('GET', '/api/subscriptions', (c) => V.subscriptionsView(snap(c), today()));
on('POST', '/api/subscriptions', (c, r) => P.createSubscription(c.db, r.body));
on('POST', '/api/subscriptions/reset', (c) => P.resetSubscriptions(c.db));
on('PUT', '/api/subscriptions/:id', (c, r) => { P.updateSubscription(c.db, idOf(r.params.id), r.body); return { ok: true }; });
on('DELETE', '/api/subscriptions/:id', (c, r) => { P.deleteSubscription(c.db, idOf(r.params.id)); return { ok: true }; });
on('POST', '/api/subscriptions/:id/charge', (c, r) => P.chargeSubscription(c.db, idOf(r.params.id), r.body));

/* reservas */
function reservesView(c) {
  const s = snap(c);
  const cons = consolidate(s);
  return {
    items: all(c.db, 'SELECT * FROM reserves ORDER BY status, name').map((r) => {
      const t = reserveTotals(r, s.reserveMovs);
      const movements = s.reserveMovs.filter((m) => m.reserve_id === r.id).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      return { ...r, ...t, pct: r.target ? Math.min(100, Math.round((t.accumulated / r.target) * 1000) / 10) : null, movements, account_name: s.allAccounts.find((a) => a.id === r.account_id)?.name ?? null };
    }),
    totals: { accumulated: cons.reservedTotal, earmarked: cons.reservedFromSpendable, available: cons.available },
  };
}
on('GET', '/api/reserves', (c) => reservesView(c));
on('POST', '/api/reserves', (c, r) => P.createReserve(c.db, r.body, today()));
on('PUT', '/api/reserves/:id', (c, r) => { P.updateReserve(c.db, idOf(r.params.id), r.body); return { ok: true }; });
on('DELETE', '/api/reserves/:id', (c, r) => { P.deleteReserve(c.db, idOf(r.params.id)); return { ok: true }; });
on('POST', '/api/reserves/:id/movements', (c, r) => {
  P.reserveMove(c.db, idOf(r.params.id), r.body, (res) => {
    if (!res.account_id) return null;
    const s = snap(c); const cons = consolidate(s);
    const acc = s.accounts.find((a) => a.id === res.account_id);
    if (!acc) return null;
    const others = cons.reserves.filter((x) => x.account_id === acc.id && x.id !== res.id).reduce((t, x) => t + x.earmarked, 0);
    const own = cons.reserves.find((x) => x.id === res.id)?.earmarked ?? 0;
    return cons.bal.get(acc.id) - others - own;
  });
  return { ok: true };
});

/* metas */
on('GET', '/api/goals', (c) => {
  const s = snap(c);
  const items = all(c.db, 'SELECT * FROM goals ORDER BY status, deadline IS NULL, deadline').map((g) => ({ ...g, ...goalProgress(g, s, today()) }));
  const active = items.filter((g) => g.status === 'active');
  return { items, totals: { monthlyNeeded: active.reduce((t, g) => t + (g.monthlyNeeded || 0), 0), saved: active.reduce((t, g) => t + g.saved, 0), target: active.reduce((t, g) => t + g.target, 0) } };
});
on('POST', '/api/goals', (c, r) => P.createGoal(c.db, r.body));
on('PUT', '/api/goals/:id', (c, r) => { P.updateGoal(c.db, idOf(r.params.id), r.body); return { ok: true }; });
on('DELETE', '/api/goals/:id', (c, r) => { P.deleteGoal(c.db, idOf(r.params.id)); return { ok: true }; });

/* dívidas */
on('GET', '/api/debts', (c) => {
  const s = snap(c);
  const items = s.debts.map((d) => ({ ...d, card_name: s.cards.find((x) => x.id === d.card_id)?.name ?? null, ...debtSummary(d, s.entries), installments: s.entries.filter((e) => e.debt_id === d.id).sort((a, b) => a.due_date.localeCompare(b.due_date)).map((e) => ({ id: e.id, no: e.installment_no, due_date: e.due_date, paid_date: e.paid_date, amount: e.amount, status: e.status })) }));
  const active = items.filter((d) => d.status === 'active');
  const avgIncome = analyze(s, today(), 6).averages.income;
  const commit = debtCommitment(s, today(), 12);
  return { items, totals: { owed: active.reduce((t, d) => t + d.owed, 0), pendingCount: active.reduce((t, d) => t + d.pendingCount, 0) }, commitment: commit, avgIncome };
});
on('POST', '/api/debts', (c, r) => L.createDebt(c.db, r.body));
on('PUT', '/api/debts/:id', (c, r) => { L.updateDebt(c.db, idOf(r.params.id), r.body); return { ok: true }; });
on('DELETE', '/api/debts/:id', (c, r) => { L.deleteDebt(c.db, idOf(r.params.id)); return { ok: true }; });
on('POST', '/api/debts/:id/payoff', (c, r) => { L.payoffDebt(c.db, idOf(r.params.id), r.body); return { ok: true }; });
on('POST', '/api/debts/:id/simulate', (c, r) => {
  const id = idOf(r.params.id);
  const s = snap(c);
  const d = s.debts.find((x) => x.id === id); if (!d) throw notFound();
  const sm = debtSummary(d, s.entries);
  const offered = r.body.offer == null || r.body.offer === '' ? sm.owed : cents(r.body.offer, { name: 'Valor da quitação' });
  const cons = consolidate(s);
  return {
    owed: sm.owed, offered, saving: sm.owed - offered, remainingInstallments: sm.pendingCount,
    availableAfter: cons.available - offered, availableBefore: cons.available,
    note: 'Cálculo apenas com os valores cadastrados. Nenhuma taxa de juros é estimada; informe no campo "valor da quitação" a proposta real do credor para ver a economia.',
  };
});

/* retirada */
const horizonOf = (c, q) => int(q.horizon ?? getSettings(c.db).withdrawal_horizon ?? 30, { name: 'Período', min: 7, max: 365 });
on('GET', '/api/withdrawal', (c, r) => computeWithdrawal(snap(c), today(), horizonOf(c, r.query)));
on('POST', '/api/withdrawal/simulate', (c, r) => simulateWithdrawal(snap(c), today(), horizonOf(c, r.body), cents(r.body.amount), r.body.scenario in SCENARIOS ? r.body.scenario : 'equilibrado'));
on('POST', '/api/withdrawal/confirm', (c, r) => L.recordWithdrawal(c.db, r.body));
on('GET', '/api/withdrawal/history', (c) => all(c.db, "SELECT m.*, a.name account_name FROM movements m JOIN accounts a ON a.id=m.account_id WHERE kind='withdrawal' ORDER BY date DESC, m.id DESC LIMIT 100"));

/* planejamento / análises */
on('POST', '/api/projection', (c, r) => {
  const b = r.body, s = snap(c);
  const num = (v, d = 0) => (v == null || v === '' ? d : Number(v));
  return project(s, today(), {
    months: [3, 6, 12].includes(Number(b.months)) ? Number(b.months) : 6,
    incomeDeltaPct: num(b.incomeDeltaPct), expenseDeltaPct: num(b.expenseDeltaPct), subsDelta: Math.round(num(b.subsDelta)),
    monthlyWithdrawal: Math.round(num(b.monthlyWithdrawal)), includeUncertain: !!b.includeUncertain,
    variableMonthly: b.variableMonthly == null || b.variableMonthly === '' ? undefined : Math.round(Number(b.variableMonthly)),
  });
});
on('GET', '/api/variable-average', (c) => variableAverage(snap(c), today()));
on('GET', '/api/analysis', (c, r) => analyze(snap(c), today(), [3, 6, 12].includes(Number(r.query.months)) ? Number(r.query.months) : 6));
on('POST', '/api/analysis/cuts', (c, r) => savingsFromCuts(snap(c), today(), r.body.cuts || {}));
on('POST', '/api/analysis/purchase', (c, r) => purchaseImpact(snap(c), today(), {
  amount: cents(r.body.amount), installments: int(r.body.installments ?? 1, { name: 'Parcelas', min: 1, max: 120 }), firstDate: date(r.body.first_date, { name: 'Primeira data' }), months: 6,
}));
on('GET', '/api/calendar', (c, r) => {
  L.materializeRecurrences(c.db, today());
  return V.calendar(snap(c), today(), date(r.query.from, { name: 'Início' }), date(r.query.to, { name: 'Fim' }));
});
on('GET', '/api/dashboard', (c, r) => {
  L.materializeRecurrences(c.db, today());
  const month = /^\d{4}-\d{2}$/.test(r.query.month || '') ? r.query.month : monthOf(today());
  return V.dashboard(snap(c), today(), month);
});
on('GET', '/api/reports/:type', (c, r) => {
  const out = V.report(snap(c), r.params.type, r.query, today());
  if (!out) throw notFound('Relatório inexistente.');
  return out;
});

/* backup */
on('GET', '/api/backups', (c) => B.listBackups(c));
on('POST', '/api/backups', (c) => B.createBackup(c));
on('POST', '/api/backups/verify', (c, r) => B.verifyBackup(require_file(c, r.body)));
on('POST', '/api/backups/restore', (c, r) => B.restoreBackup(c, r.body.file || r.body.name));
on('GET', '/api/export', (c) => ({ __download: `Wallet_export_${B.stamp()}.json`, body: B.exportJson(c.db) }));
on('POST', '/api/import', (c, r) => B.importJson(c, r.body));

function require_file(c, b) {
  const f = b.file || b.name;
  if (!f) throw bad('Informe o backup.');
  return f.includes(':') || f.startsWith('/') || f.startsWith('\\') ? f : `${B.backupDir(c)}/${f.replace(/[\\/]/g, '')}`;
}
export { addDays, monthStart, monthEnd, accountBalance };

/* cartões e simulador (a simulação nunca grava nada) */
import * as K from './services/cards.js';
import { cardsOverview, simulateCardPurchase } from './core/cards.js';
on('GET', '/api/cards', (c, r) => cardsOverview(snap(c), today(), 12, { month: /^\d{4}-\d{2}$/.test(r.query.month || '') ? r.query.month : undefined, year: /^\d{4}$/.test(r.query.year || '') ? Number(r.query.year) : undefined }));
on('POST', '/api/cards', (c, r) => K.createCard(c.db, r.body));
on('PUT', '/api/cards/:id', (c, r) => { K.updateCard(c.db, idOf(r.params.id), r.body); return { ok: true }; });
on('DELETE', '/api/cards/:id', (c, r) => { K.deleteCard(c.db, idOf(r.params.id)); return { ok: true }; });
on('POST', '/api/cards/purchases', (c, r) => K.createCardPurchase(c.db, r.body, today()));
on('POST', '/api/cards/simulate', (c, r) => simulateCardPurchase(snap(c), today(), {
  card_id: idOf(r.body.card_id), total: cents(r.body.total, { name: 'Valor total' }), installments: int(r.body.installments, { name: 'Parcelas', min: 1, max: 48 }),
  firstMonth: /^\d{4}-\d{2}$/.test(r.body.first_month || '') ? r.body.first_month : null,
  installment_amount: r.body.installment_amount ? cents(r.body.installment_amount, { name: 'Parcela informada' }) : null,
  showAll: r.body.show_all !== false,
}));

/* simples: saldo de hoje, investir, importação e API aberta */
import * as X from './services/connect.js';
import { simulateInvestment } from './core/invest.js';
on('POST', '/api/accounts/:id/set-balance', (c, r) => X.setBalance(c.db, idOf(r.params.id), r.body, today()));
on('POST', '/api/invest/simulate', (c, r) => simulateInvestment(snap(c), today(), {
  lump: r.body.lump ? cents(r.body.lump, { name: 'Valor à vista' }) : 0, monthly: r.body.monthly ? cents(r.body.monthly, { name: 'Aporte mensal' }) : 0,
  months: int(r.body.months ?? 12, { name: 'Prazo (meses)', min: 1, max: 600 }), annualRatePct: Math.max(0, Math.min(100, Number(r.body.annual_rate_pct) || 0)),
}));
on('POST', '/api/import/transactions', (c, r) => X.importTransactions(c.db, r.body));
on('POST', '/api/open/transactions', (c, r) => X.importTransactions(c.db, r.body));
on('GET', '/api/integration', (c) => ({ key: X.getKey(c.db) }));
on('POST', '/api/integration/key', (c) => ({ key: X.newKey(c.db) }));

on('PUT', '/api/cards/:id/base', (c, r) => K.setCardBase(c.db, idOf(r.params.id), r.body.months, today()));

/* financiamento da casa e edição de compras de cartão */
import * as H from './services/house.js';
on('GET', '/api/house-loans', (c) => H.listLoans(c.db));
on('POST', '/api/house-loans', (c, r) => H.createLoan(c.db, r.body, today()));
on('PUT', '/api/house-loans/:id', (c, r) => { H.updateLoan(c.db, idOf(r.params.id), r.body, today()); return { ok: true }; });
on('DELETE', '/api/house-loans/:id', (c, r) => { H.deleteLoan(c.db, idOf(r.params.id)); return { ok: true }; });
on('PUT', '/api/cards/purchases/:id', (c, r) => { K.updateCardPurchase(c.db, idOf(r.params.id), r.body); return { ok: true }; });

/* limpar sistema (exige a frase de confirmação; backup opcional antes) */
import { clearSystem } from './services/system.js';
on('POST', '/api/system/clear', (c, r) => clearSystem(c, r.body));

/* importação de arquivos: 1) pré-verificação de duplicidades, 2) gravação após a revisão */
on('POST', '/api/import/check', (c, r) => ({ results: X.checkImport(c.db, r.body) }));
on('POST', '/api/import/card', (c, r) => X.importCardPurchases(c.db, r.body, today()));

on('GET', '/api/dashboard/annual', (c, r) => {
  L.materializeRecurrences(c.db, today());
  return V.annual(snap(c), today(), /^\d{4}$/.test(r.query.year || '') ? Number(r.query.year) : Number(today().slice(0, 4)));
});

/* Compra nova: análise de link de produto (bloqueia endereços locais/privados) */
import { analyzeProduct } from './services/product.js';
on('POST', '/api/product/analyze', async (c, r) => analyzeProduct(String(r.body.url ?? ''), { browser: !!r.body.browser }));

/* Sistema de Auto-Update (GitHub Releases) */
import * as U from './services/updater.js';
on('GET', '/api/updater/status', (c) => U.getStatus(c));
on('POST', '/api/updater/check', async (c, r) => U.checkUpdate(c, { repo: r.body?.repo }));
on('POST', '/api/updater/download', async (c, r) => U.downloadUpdate(c, { url: r.body?.url, targetVersion: r.body?.targetVersion }));
on('POST', '/api/updater/apply', (c) => U.applyUpdate(c));
on('PUT', '/api/updater/repo', (c, r) => ({ ok: true, repo: U.setRepo(c.db, r.body?.repo) }));
import * as LU from './services/localupdate.js';
on('GET', '/api/local-update/status', () => LU.localStatus());
on('POST', '/api/local-update/apply', () => LU.applyLocal());

