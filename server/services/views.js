// Leitura agregada: snapshot, dashboard, calendário e relatórios.
import { all, getSettings } from '../db.js';
import { addDays, addMonthKey, monthOf, monthStart, monthEnd, monthRange } from '../core/dates.js';
import {
  consolidate, sum, entryStatus, monthlyEquivalent, annualEquivalent, subscriptionCharges, goalProgress,
  monthlySeries, balanceAt, savingsAt, debtSummary, debtCommitment, reserveTotals, isPrepaid,
} from '../core/finance.js';
import { computeScenario, SCENARIOS } from '../core/withdrawal.js';

// Cada despesa pertence a UM grupo (evita contar duas vezes): cartões > assinaturas > casa > outras.
export function commitmentKind(s, e, debtsById = new Map(s.debts.map((x) => [x.id, x]))) {
  const d = e.debt_id ? debtsById.get(e.debt_id) : null;
  if (e.card_id || d?.card_id) return 'cards';
  if (e.subscription_id) return 'subs';
  if (d?.kind === 'casa') return 'house';
  return 'other';
}

// Compromissos que VENCEM no mês (não inclui parcelas de outros meses): despesas pagas e pendentes,
// mais cobranças de assinaturas previstas no mês que ainda não foram registradas como despesa.
export function monthCommitments(s, month) {
  const [from, to] = [monthStart(month), monthEnd(month)];
  const byId = new Map(s.debts.map((x) => [x.id, x]));
  const zero = () => ({ total: 0, paid: 0, pending: 0, count: 0, pendingCount: 0 });
  const g = { cards: zero(), subs: zero(), house: zero(), other: zero() };
  for (const e of s.entries) {
    if (e.type !== 'expense' || e.due_date < from || e.due_date > to) continue;
    const x = g[commitmentKind(s, e, byId)];
    x.total += e.amount; x.count++;
    if (e.status === 'paid') x.paid += e.amount; else { x.pending += e.amount; x.pendingCount++; }
  }
  // assinaturas ativas com cobrança prevista no mês e ainda não registrada (registrar avança a próxima data, então não duplica)
  let projected = 0;
  for (const sub of s.subscriptions) for (const c of subscriptionCharges(sub, from, to)) { projected += c.amount; g.subs.total += c.amount; g.subs.pending += c.amount; g.subs.count++; g.subs.pendingCount++; }
  const all = Object.values(g);
  return {
    month, ...g, subsProjected: projected,
    total: sum(all, (x) => x.total), paid: sum(all, (x) => x.paid), pending: sum(all, (x) => x.pending),
    pendingInstallments: g.cards.pendingCount, paidInstallments: g.cards.count - g.cards.pendingCount,
  };
}

export function loadSnapshot(db) {
  return {
    settings: getSettings(db),
    accounts: all(db, 'SELECT * FROM accounts WHERE archived=0'),
    allAccounts: all(db, 'SELECT * FROM accounts'),
    categories: all(db, 'SELECT * FROM categories'),
    movements: all(db, 'SELECT * FROM movements'),
    entries: all(db, 'SELECT * FROM entries'),
    subscriptions: all(db, 'SELECT * FROM subscriptions'),
    debts: all(db, 'SELECT * FROM debts'),
    cards: all(db, 'SELECT * FROM cards'),
    reserves: all(db, 'SELECT * FROM reserves'),
    reserveMovs: all(db, 'SELECT * FROM reserve_movements'),
    goals: all(db, 'SELECT * FROM goals'),
  };
}

export function subscriptionsView(s, today) {
  const alertDays = Number(s.settings.alert_days || 7);
  const items = s.subscriptions.map((x) => {
    const history = s.entries.filter((e) => e.subscription_id === x.id).sort((a, b) => b.due_date.localeCompare(a.due_date));
    const days = Math.round((Date.parse(x.next_date) - Date.parse(today)) / 86400000);
    return {
      ...x, monthly: monthlyEquivalent(x.amount, x.period), yearly: annualEquivalent(x.amount, x.period),
      ended: !!x.end_date && x.next_date > x.end_date,
      days_to_charge: days, alert: x.status === 'active' && !(x.end_date && x.next_date > x.end_date) && days <= alertDays, late: x.status === 'active' && !(x.end_date && x.next_date > x.end_date) && days < 0,
      history: history.map((h) => ({ id: h.id, due_date: h.due_date, paid_date: h.paid_date, amount: h.amount, status: h.status })),
      paid_total: sum(history.filter((h) => h.status === 'paid'), (h) => h.amount),
    };
  });
  const active = items.filter((i) => i.status === 'active' && !i.ended);
  return {
    items,
    totals: {
      activeCount: active.length, monthly: sum(active, (i) => i.monthly), yearly: sum(active, (i) => i.yearly),
      next30: sum(active.flatMap((i) => subscriptionCharges(i, null, addDays(today, 30))), (c) => c.amount),
    },
  };
}

export function dashboard(s, today, month) {
  const cons = consolidate(s);
  const [mStart, mEnd] = [monthStart(month), monthEnd(month)];
  const inMonth = (d) => d >= mStart && d <= mEnd;
  const isAluguel = (e) => {
    const cat = (s.categories.find((c) => c.id === e.category_id)?.name || '').toLowerCase();
    const d = (e.description || '').toLowerCase();
    const o = (e.origin || '').toLowerCase();
    return cat.includes('aluguel') || d.includes('aluguel') || o.includes('aluguel');
  };
  const paidIncomes = s.entries.filter((e) => e.type === 'income' && e.status === 'paid' && !isPrepaid(e) && inMonth(e.paid_date));
  const receivedAluguel = sum(paidIncomes.filter(isAluguel), (e) => e.amount);
  const receivedLifeSurf = sum(paidIncomes.filter((e) => !isAluguel(e)), (e) => e.amount);
  const receivedCombined = receivedAluguel + receivedLifeSurf;
  const received = receivedLifeSurf; // no cômputo de rendimentos disponíveis: APENAS Life Surf
  const paid = sum(s.entries.filter((e) => e.type === 'expense' && e.status === 'paid' && !isPrepaid(e) && inMonth(e.paid_date)), (e) => e.amount);
  const expectedIncome = sum(s.entries.filter((e) => e.type === 'income' && e.status === 'pending' && inMonth(e.due_date)), (e) => e.amount);
  const pendingBills = s.entries.filter((e) => e.type === 'expense' && e.status === 'pending' && e.due_date <= mEnd);
  const overdue = pendingBills.filter((e) => e.due_date < today);
  const end30 = addDays(today, 30);
  const next30Entries = s.entries.filter((e) => e.type === 'expense' && e.status === 'pending' && e.due_date >= today && e.due_date <= end30);
  const subCharges = s.subscriptions.flatMap((x) => subscriptionCharges(x, today, end30));
  const subs = subscriptionsView(s, today);
  const debts = s.debts.filter((d) => d.status === 'active').map((d) => debtSummary(d, s.entries));
  const alertDays = Number(s.settings.alert_days || 7);
  const alertEnd = addDays(today, alertDays);
  const alerts = [
    ...overdue.map((e) => ({ kind: 'overdue', text: `${e.description} venceu em ${e.due_date}`, amount: e.amount, entry_id: e.id, date: e.due_date })),
    ...s.entries.filter((e) => e.type === 'expense' && e.status === 'pending' && e.due_date >= today && e.due_date <= alertEnd)
      .map((e) => ({ kind: 'soon', text: `${e.description} vence em ${e.due_date}`, amount: e.amount, entry_id: e.id, date: e.due_date })),
    ...subs.items.filter((i) => i.alert).map((i) => ({ kind: i.late ? 'overdue' : 'soon', text: `Assinatura ${i.name}: cobrança em ${i.next_date}${i.late ? ' (a registrar)' : ''}`, amount: i.amount, date: i.next_date })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const n = Number(s.settings.chart_months || 6);
  const series = monthlySeries(s, addMonthKey(month, -(n - 1)), month);
  const evoKeys = monthRange(addMonthKey(month, -11), month);
  const balanceEvolution = evoKeys.map((k) => { const d = monthEnd(k) > today ? today : monthEnd(k); return { month: k, balance: balanceAt(s, d), savings: savingsAt(s, d) }; });
  const catName = (id) => s.categories.find((c) => c.id === id)?.name ?? 'Sem categoria';
  const byCat = (key) => {
    const m = new Map();
    for (const e of s.entries) if (e.type === 'expense' && e.status === 'paid' && !isPrepaid(e) && monthOf(e.paid_date) === key) m.set(catName(e.category_id), (m.get(catName(e.category_id)) || 0) + e.amount);
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };
  const w = computeScenario(s, today, Number(s.settings.withdrawal_horizon || 30), 'equilibrado', cons);
  const goals = s.goals.filter((g) => g.status === 'active').map((g) => ({ id: g.id, name: g.name, target: g.target, ...goalProgress(g, s, today) }));
  const prev = series.at(-2);
  const commitments = monthCommitments(s, month);
  // Aluguel do mês (recebido + previsto certo) abate a parcela da casa: só o que passar da parcela sobra para o resto.
  const rentRows = s.entries.filter((e) => e.type === 'income' && isAluguel(e) && !isPrepaid(e) && inMonth(e.due_date) && (e.status === 'paid' || e.certain));
  const rentExpected = sum(rentRows, (e) => e.amount);
  const rentAmortized = Math.min(rentExpected, commitments.house.total);
  const rentToHouse = { expected: rentExpected, houseTotal: commitments.house.total, amortized: rentAmortized, left: rentExpected - rentAmortized };
  return {
    month, today, rentToHouse,
    hasData: s.accounts.length > 0,
    fgts: sum(s.accounts.filter((a) => a.type === 'fgts'), (a) => cons.bal.get(a.id)),
    totalBalance: cons.total, available: cons.available, spendable: cons.spendable, reserved: cons.reservedTotal,
    received, receivedLifeSurf, receivedAluguel, receivedCombined, paid, expectedIncome,
    income30: sum(s.entries.filter((e) => e.type === 'income' && e.status === 'pending' && e.certain && e.due_date <= end30), (e) => e.amount),
    pending: {
      count: pendingBills.length, amount: sum(pendingBills, (e) => e.amount),
      // as parcelas de cartão e da casa já estão dentro de "contas pendentes"; aqui só separamos para não parecer soma dupla
      breakdown: (() => {
        const byId = new Map(s.debts.map((x) => [x.id, x]));
        const part = { cards: 0, subs: 0, house: 0, other: 0 };
        for (const e of pendingBills) {
          const debt = e.debt_id ? byId.get(e.debt_id) : null;
          part[commitmentKind(s, e, byId)] += e.amount;
        }
        return part;
      })(),
    },
    overdue: { count: overdue.length, amount: sum(overdue, (e) => e.amount) },
    next30: { amount: sum(next30Entries, (e) => e.amount) + sum(subCharges, (c) => c.amount), entries: next30Entries.length, subscriptions: sum(subCharges, (c) => c.amount) },
    subscriptions: { monthly: subs.totals.monthly, count: subs.totals.activeCount },
    debts: { owed: sum(debts, (d) => d.owed), pendingCount: sum(debts, (d) => d.pendingCount) },
    withdrawal: { suggested: w.suggested, risk: w.risk.level },
    commitments,
    nextMonths: [1, 2, 3].map((i) => { const c = monthCommitments(s, addMonthKey(month, i)); return { month: c.month, total: c.total, cards: c.cards.total, subs: c.subs.total, house: c.house.total, other: c.other.total }; }),
    goals, alerts: alerts.slice(0, 12),
    charts: {
      incomeExpense: series, balanceEvolution, categories: byCat(month),
      categoriesPrev: byCat(addMonthKey(month, -1)),
      comparison: { current: series.at(-1), previous: prev ?? null },
    },
  };
}

export function calendar(s, today, from, to) {
  const items = [];
  const cat = (id) => s.categories.find((c) => c.id === id)?.name;
  for (const e of s.entries) {
    if (e.due_date < from || e.due_date > to) continue;
    const st = entryStatus(e, today);
    items.push({
      date: e.due_date, kind: e.subscription_id ? 'subscription' : e.debt_id ? 'installment' : e.type, title: e.description,
      amount: e.amount, status: st, income: e.type === 'income', entry_id: e.id, category: cat(e.category_id), uncertain: e.type === 'income' && !e.certain,
    });
  }
  for (const x of s.subscriptions) {
    for (const c of subscriptionCharges(x, from, to)) {
      items.push({ date: c.date, kind: 'subscription', title: `${x.name} (a registrar)`, amount: x.amount, status: c.date < today ? 'overdue' : 'pending', income: false, projected: true });
    }
  }
  for (const g of s.goals) if (g.status === 'active' && g.deadline && g.deadline >= from && g.deadline <= to) items.push({ date: g.deadline, kind: 'goal', title: `Prazo da meta: ${g.name}`, amount: g.target, status: 'info', income: false });
  for (const r of s.reserves) if (r.status === 'active' && r.deadline && r.deadline >= from && r.deadline <= to) items.push({ date: r.deadline, kind: 'goal', title: `Prazo da reserva: ${r.name}`, amount: r.target, status: 'info', income: false });
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- relatórios ---------- */
const col = (key, label, type = 'text') => ({ key, label, type });
const STATUS_LABEL = { paid: 'Pago', overdue: 'Atrasada', pending: 'Pendente' };

export function report(s, type, q, today) {
  const from = q.from || '0000-01-01', to = q.to || '9999-12-31';
  const catId = q.category_id ? Number(q.category_id) : null, accId = q.account_id ? Number(q.account_id) : null;
  const cat = (id) => s.categories.find((c) => c.id === id)?.name ?? '';
  const acc = (id) => s.allAccounts.find((a) => a.id === id)?.name ?? '';
  const entryRows = (t) => s.entries
    .filter((e) => e.type === t && e.due_date >= from && e.due_date <= to && (!catId || e.category_id === catId) && (!accId || e.account_id === accId))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .map((e) => ({ due_date: e.due_date, paid_date: e.paid_date, description: e.description, category: cat(e.category_id), account: acc(e.account_id), origin: e.origin ?? '', status: t === 'income' ? (e.status === 'paid' ? 'Recebida' : 'Prevista') : STATUS_LABEL[entryStatus(e, today)], amount: e.amount, _paid: e.status === 'paid' }));
  const entryReport = (t, title) => {
    const rows = entryRows(t);
    return {
      title, columns: [col('due_date', 'Vencimento', 'date'), col('paid_date', t === 'income' ? 'Recebimento' : 'Pagamento', 'date'), col('description', 'Descrição'), col('category', 'Categoria'), col('account', 'Conta'), col('origin', t === 'income' ? 'Origem' : 'Credor/Local'), col('status', 'Status'), col('amount', 'Valor', 'money')],
      rows, totals: [{ label: t === 'income' ? 'Recebido' : 'Pago', value: sum(rows.filter((r) => r._paid), (r) => r.amount) }, { label: 'Em aberto', value: sum(rows.filter((r) => !r._paid), (r) => r.amount) }],
    };
  };
  switch (type) {
    case 'income': return entryReport('income', 'Relatório de receitas');
    case 'expenses': return entryReport('expense', 'Relatório de despesas');
    case 'subscriptions': {
      const v = subscriptionsView(s, today);
      const rows = v.items.map((i) => ({ name: i.name, status: { active: 'Ativa', paused: 'Pausada', cancelled: 'Cancelada' }[i.status], period: { weekly: 'Semanal', monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', yearly: 'Anual' }[i.period], amount: i.amount, monthly: i.monthly, yearly: i.yearly, next_date: i.next_date, paid_total: i.paid_total }));
      return { title: 'Relatório de assinaturas', columns: [col('name', 'Serviço'), col('status', 'Status'), col('period', 'Periodicidade'), col('amount', 'Valor da cobrança', 'money'), col('monthly', 'Custo mensal equiv.', 'money'), col('yearly', 'Custo anual equiv.', 'money'), col('next_date', 'Próxima cobrança', 'date'), col('paid_total', 'Total já pago', 'money')], rows, totals: [{ label: 'Mensal equivalente (ativas)', value: v.totals.monthly }, { label: 'Anual equivalente (ativas)', value: v.totals.yearly }] };
    }
    case 'debts': {
      const rows = s.debts.map((d) => { const x = debtSummary(d, s.entries); return { description: d.description, creditor: d.creditor ?? '', status: { active: 'Ativa', paid: 'Quitada', cancelled: 'Cancelada' }[d.status], installment: d.installment_amount, progress: `${x.paidCount}/${d.installments_total}`, paidAmount: x.paidAmount, owed: x.owed, next: x.next?.due_date ?? null }; });
      return { title: 'Relatório de dívidas e parcelamentos', columns: [col('description', 'Descrição'), col('creditor', 'Credor'), col('status', 'Status'), col('installment', 'Parcela', 'money'), col('progress', 'Pagas'), col('paidAmount', 'Total pago', 'money'), col('owed', 'Ainda devido', 'money'), col('next', 'Próx. vencimento', 'date')], rows, totals: [{ label: 'Total devido', value: sum(rows, (r) => r.owed) }] };
    }
    case 'patrimony': {
      const cons = consolidate(s);
      const rows = [
        ...s.accounts.map((a) => ({ group: 'Conta', name: a.name, detail: a.spendable ? 'Gastável' : 'Não gastável', value: cons.bal.get(a.id) })),
        ...cons.reserves.map((r) => ({ group: r.kind === 'investimento' ? 'Investimento' : 'Reserva', name: r.name, detail: r.target ? `Meta ${(r.target / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : '', value: r.accumulated })),
      ];
      return { title: 'Relatório de patrimônio e reservas', columns: [col('group', 'Grupo'), col('name', 'Nome'), col('detail', 'Detalhe'), col('value', 'Valor', 'money')], rows, totals: [{ label: 'Saldo em contas', value: cons.total }, { label: 'Reservado/investido (marcado dentro das contas)', value: cons.reservedTotal }, { label: 'Livre para gastar', value: cons.available }] };
    }
    case 'cashflow': {
      const fromK = monthOf(q.from || addMonthKey(monthOf(today), -5)), toK = monthOf(q.to || today);
      const ser = monthlySeries(s, fromK, toK);
      const pend = (t, k) => sum(s.entries.filter((e) => e.type === t && e.status === 'pending' && monthOf(e.due_date) === k), (e) => e.amount);
      let acum = 0;
      const rows = ser.map((r) => { acum += r.net; return { month: r.month, income: r.income, expense: r.expense, net: r.net, acum, pIncome: pend('income', r.month), pExpense: pend('expense', r.month) }; });
      return { title: 'Relatório de fluxo de caixa', columns: [col('month', 'Mês', 'month'), col('income', 'Entradas realizadas', 'money'), col('expense', 'Saídas realizadas', 'money'), col('net', 'Resultado', 'money'), col('acum', 'Acumulado', 'money'), col('pIncome', 'Entradas previstas', 'money'), col('pExpense', 'Saídas previstas', 'money')], rows, totals: [{ label: 'Entradas', value: sum(rows, (r) => r.income) }, { label: 'Saídas', value: sum(rows, (r) => r.expense) }, { label: 'Resultado', value: sum(rows, (r) => r.net) }] };
    }
    case 'evolution': {
      const toK = monthOf(q.to || today), fromK = monthOf(q.from || addMonthKey(toK, -11));
      const rows = monthRange(fromK, toK).map((k) => { const d = monthEnd(k) > today ? today : monthEnd(k); return { month: k, balance: balanceAt(s, d), savings: savingsAt(s, d) }; });
      return { title: 'Relatório de evolução financeira', columns: [col('month', 'Mês', 'month'), col('balance', 'Saldo total das contas', 'money'), col('savings', 'Total guardado (reservas)', 'money')], rows, totals: [] };
    }
    case 'goals': {
      const rows = s.goals.map((g) => { const p = goalProgress(g, s, today); return { name: g.name, priority: { alta: 'Alta', media: 'Média', baixa: 'Baixa' }[g.priority], deadline: g.deadline, target: g.target, saved: p.saved, remaining: p.remaining, pct: p.pct, monthly: p.monthlyNeeded }; });
      return { title: 'Relatório de metas', columns: [col('name', 'Meta'), col('priority', 'Prioridade'), col('deadline', 'Prazo', 'date'), col('target', 'Valor desejado', 'money'), col('saved', 'Acumulado', 'money'), col('remaining', 'Falta', 'money'), col('pct', '% concluído', 'percent'), col('monthly', 'Necessário/mês', 'money')], rows, totals: [] };
    }
    default: return null;
  }
}

export { debtCommitment, reserveTotals, SCENARIOS };

// Visão anual: realizado (recebido/pago, que mexe no saldo real) separado do previsto (pendente, que NÃO entra no saldo).
export function annual(s, today, year) {
  const cur = monthOf(today);
  const cons = consolidate(s);
  const byId = new Map(s.debts.map((x) => [x.id, x]));
  const kindOf = (e) => { const d = e.debt_id ? byId.get(e.debt_id) : null; return e.card_id || d?.card_id ? 'cards' : d?.kind === 'casa' ? 'house' : 'other'; };
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const rows = months.map((k) => {
    const inM = (d) => d && monthOf(d) === k;
    const received = sum(s.entries.filter((e) => e.type === 'income' && e.status === 'paid' && !isPrepaid(e) && inM(e.paid_date)), (e) => e.amount);
    const paid = sum(s.entries.filter((e) => e.type === 'expense' && e.status === 'paid' && !isPrepaid(e) && inM(e.paid_date)), (e) => e.amount);
    const pendInc = s.entries.filter((e) => e.type === 'income' && e.status === 'pending' && inM(e.due_date));
    const pendExp = s.entries.filter((e) => e.type === 'expense' && e.status === 'pending' && inM(e.due_date));
    const split = { cards: 0, house: 0, other: 0 };
    for (const e of pendExp) split[kindOf(e)] += e.amount;
    const end = monthEnd(k);
    return {
      month: k, future: k > cur, received, paid, result: received - paid,
      toReceive: sum(pendInc, (e) => e.amount), toReceiveSure: sum(pendInc.filter((e) => e.certain), (e) => e.amount),
      toPay: sum(pendExp, (e) => e.amount), toPaySplit: split,
      balance: k <= cur ? balanceAt(s, end > today ? today : end) : null,
    };
  });
  return {
    year, current: cur, balanceNow: cons.total, rows,
    totals: {
      received: sum(rows, (r) => r.received), paid: sum(rows, (r) => r.paid), result: sum(rows, (r) => r.result),
      toReceive: sum(rows, (r) => r.toReceive), toPay: sum(rows, (r) => r.toPay),
    },
  };
}
