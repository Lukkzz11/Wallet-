// Projeções e análises transparentes, baseadas apenas nos dados cadastrados.
import { addMonthKey, monthOf, monthEnd, daysInMonth, parse, addDays } from './dates.js';
import { consolidate, isPrepaid, sum, subscriptionCharges, monthlyEquivalent, monthlySeries, debtCommitment } from './finance.js';

export const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Média mensal de gastos avulsos (sem vínculo com recorrência, assinatura ou dívida) nos últimos 3 meses completos.
export function variableAverage(s, today) {
  const cur = monthOf(today);
  const from = addMonthKey(cur, -3);
  const adhoc = s.entries.filter((e) => e.type === 'expense' && e.status === 'paid' && !e.recurrence_id && !e.subscription_id && !e.debt_id
    && monthOf(e.paid_date) >= from && monthOf(e.paid_date) < cur);
  if (!adhoc.length) return { value: 0, months: 0 };
  const firstPaid = s.entries.filter((e) => e.type === 'expense' && e.status === 'paid').map((e) => monthOf(e.paid_date)).sort()[0];
  const [fy, fm] = firstPaid.split('-').map(Number);
  const [cy, cm] = cur.split('-').map(Number);
  const months = Math.max(1, Math.min(3, (cy - fy) * 12 + (cm - fm)));
  return { value: Math.round(sum(adhoc, (e) => e.amount) / months), months };
}

export function project(s, today, opts = {}) {
  const {
    months = 6, incomeDeltaPct = 0, expenseDeltaPct = 0, subsDelta = 0, monthlyWithdrawal = 0,
    includeUncertain = false, extraEvents = [],
  } = opts;
  const cons = consolidate(s);
  const va = variableAverage(s, today);
  const variable = opts.variableMonthly ?? va.value;
  const cur = monthOf(today);
  let closing = cons.spendable;
  const rows = [];
  for (let i = 0; i < months; i++) {
    const k = addMonthKey(cur, i);
    const end = monthEnd(k);
    const prevEnd = i === 0 ? null : monthEnd(addMonthKey(k, -1));
    const inWin = (d) => d <= end && (prevEnd === null || d > prevEnd);
    const incomes = s.entries.filter((e) => e.type === 'income' && e.status === 'pending' && inWin(e.due_date));
    const certain = sum(incomes.filter((e) => e.certain), (e) => e.amount);
    const uncertain = sum(incomes.filter((e) => !e.certain), (e) => e.amount);
    const scheduled = sum(s.entries.filter((e) => e.type === 'expense' && e.status === 'pending' && inWin(e.due_date)), (e) => e.amount);
    const subs = sum(s.subscriptions.flatMap((sub) => subscriptionCharges(sub, prevEnd ? addDays(prevEnd, 1) : null, end)), (c) => c.amount);
    const dim = daysInMonth(...Object.values(parse(`${k}-01`)).slice(0, 2));
    const remainingDays = i === 0 ? dim - parse(today).d + 1 : dim;
    const varM = Math.round((variable * remainingDays) / dim);
    const extra = sum(extraEvents.filter((x) => inWin(x.date)), (x) => x.amount);
    const incomeTotal = Math.round((certain + (includeUncertain ? uncertain : 0)) * (1 + incomeDeltaPct / 100));
    const expTotal = Math.round((scheduled + subs + varM) * (1 + expenseDeltaPct / 100)) + subsDelta + extra;
    const net = incomeTotal - expTotal - monthlyWithdrawal;
    closing += net;
    rows.push({
      month: k, income: incomeTotal, incomeUncertain: uncertain,
      scheduled, subscriptions: subs, variable: varM, extra, expenses: expTotal,
      withdrawal: monthlyWithdrawal, net, closing, closingFree: closing - cons.reservedFromSpendable,
    });
  }
  const negative = rows.filter((r) => r.closing < 0).map((r) => r.month);
  const minReserve = Number(s.settings.min_reserve || 0);
  const belowMin = rows.filter((r) => r.closingFree < minReserve).map((r) => r.month);
  return {
    opening: cons.spendable, reserved: cons.reservedFromSpendable, months: rows,
    summary: { endClosing: rows.at(-1)?.closing ?? cons.spendable, minClosing: rows.length ? Math.min(...rows.map((r) => r.closing)) : cons.spendable, negativeMonths: negative, belowMinimumMonths: belowMin },
    premises: [
      `Saldo inicial: contas gastáveis (${brl(cons.spendable)}); reservas (${brl(cons.reservedFromSpendable)}) seguem separadas.`,
      'Receitas: apenas lançamentos futuros pendentes marcados como garantidos' + (includeUncertain ? ', mais as incertas (incluídas por sua escolha).' : '; receitas incertas não são contadas.'),
      'Despesas: contas pendentes cadastradas (inclui recorrências já geradas e parcelas) e cobranças de assinaturas ativas.',
      va.months > 0
        ? `Gastos variáveis: média de ${brl(variable)}/mês (${opts.variableMonthly != null ? 'valor informado por você' : `média de ${va.months} mês(es) de gastos avulsos pagos`}).`
        : `Gastos variáveis: ${brl(variable)}/mês — ainda não há histórico de gastos avulsos pagos para estimar.`,
      `Ajustes simulados: receitas ${incomeDeltaPct >= 0 ? '+' : ''}${incomeDeltaPct}%, despesas ${expenseDeltaPct >= 0 ? '+' : ''}${expenseDeltaPct}%, assinaturas ${brl(subsDelta)}/mês, retirada ${brl(monthlyWithdrawal)}/mês.`,
      'É uma projeção matemática com os dados cadastrados, não uma garantia.',
    ],
  };
}

/* ---------- análises ---------- */
export function analyze(s, today, nMonths = 6) {
  const cur = monthOf(today);
  const fromKey = addMonthKey(cur, -(nMonths - 1));
  const series = monthlySeries(s, fromKey, cur);
  const paidExp = s.entries.filter((e) => e.type === 'expense' && e.status === 'paid' && !isPrepaid(e));
  const catName = (id) => s.categories.find((c) => c.id === id)?.name ?? 'Sem categoria';
  const byCat = new Map();
  for (const e of paidExp) {
    const k = monthOf(e.paid_date);
    if (k < fromKey || k > cur) continue;
    const name = catName(e.category_id);
    if (!byCat.has(name)) byCat.set(name, {});
    byCat.get(name)[k] = (byCat.get(name)[k] || 0) + e.amount;
  }
  const categories = [...byCat.entries()].map(([name, m]) => {
    const total = sum(Object.values(m));
    const last = m[cur] || 0;
    const prevKey = addMonthKey(cur, -1);
    const prev = m[prevKey] || 0;
    return { name, total, share: 0, current: last, previous: prev, change: last - prev, changePct: prev ? Math.round(((last - prev) / prev) * 1000) / 10 : null, monthly: m };
  }).sort((a, b) => b.total - a.total);
  const totalSpent = sum(categories, (c) => c.total);
  categories.forEach((c) => { c.share = totalSpent ? Math.round((c.total / totalSpent) * 1000) / 10 : 0; });

  const completed = series.filter((r) => r.month < cur);
  const avgIncome = completed.length ? Math.round(sum(completed, (r) => r.income) / completed.length) : 0;
  const avgExpense = completed.length ? Math.round(sum(completed, (r) => r.expense) / completed.length) : 0;
  const avgSaved = completed.length ? Math.round(sum(completed, (r) => r.saved) / completed.length) : 0;
  const leftoverPct = avgIncome ? Math.round(((avgIncome - avgExpense) / avgIncome) * 1000) / 10 : null;

  const subs = s.subscriptions.filter((x) => x.status === 'active').map((x) => ({ name: x.name, monthly: monthlyEquivalent(x.amount, x.period) })).sort((a, b) => b.monthly - a.monthly);
  const subsMonthly = sum(subs, (x) => x.monthly);
  const debtNext = debtCommitment(s, today, 6);
  const debtMonthly = debtNext[0]?.amount ?? 0;

  const proj = project(s, today, { months: 12 });
  const insufficient = proj.summary.negativeMonths;

  const recs = [];
  if (avgIncome > 0) {
    const sp = Math.round((subsMonthly / avgIncome) * 1000) / 10;
    if (sp >= 10) recs.push(`Assinaturas custam ${brl(subsMonthly)}/mês (${sp}% da renda média de ${brl(avgIncome)}). Limite de alerta usado: 10%.`);
    const dp = Math.round((debtMonthly / avgIncome) * 1000) / 10;
    if (dp >= 30) recs.push(`Parcelas deste mês somam ${brl(debtMonthly)} (${dp}% da renda média). Limite de alerta usado: 30%.`);
    if (leftoverPct !== null && leftoverPct < 10) recs.push(`Sobra média de ${leftoverPct}% da renda (${brl(avgIncome - avgExpense)}). Limite de alerta usado: 10%.`);
  }
  const grew = categories.filter((c) => c.previous > 0 && c.changePct !== null && c.changePct >= 20 && c.change >= 5000);
  grew.slice(0, 3).forEach((c) => recs.push(`${c.name} subiu ${c.changePct}% sobre o mês anterior (de ${brl(c.previous)} para ${brl(c.current)}).`));
  if (insufficient.length) recs.push(`Pela projeção, o saldo fica negativo em: ${insufficient.join(', ')}.`);

  return {
    months: nMonths, series, categories, totalSpent,
    averages: { income: avgIncome, expense: avgExpense, saved: avgSaved, leftover: avgIncome - avgExpense, leftoverPct, basedOnMonths: completed.length },
    subscriptions: { items: subs, monthly: subsMonthly, shareOfIncomePct: avgIncome ? Math.round((subsMonthly / avgIncome) * 1000) / 10 : null },
    debts: { monthly: debtMonthly, shareOfIncomePct: avgIncome ? Math.round((debtMonthly / avgIncome) * 1000) / 10 : null, next: debtNext },
    insufficientMonths: insufficient,
    recommendations: recs,
    dataNote: completed.length === 0 ? 'Ainda não há meses completos com dados pagos; médias e tendências aparecerão conforme você registrar.' : null,
  };
}

// Economia estimada reduzindo categorias: pct por categoria sobre a média mensal dos últimos 3 meses completos.
export function savingsFromCuts(s, today, cuts) {
  const cur = monthOf(today);
  const from = addMonthKey(cur, -3);
  const out = [];
  for (const [catId, pct] of Object.entries(cuts)) {
    const entries = s.entries.filter((e) => e.type === 'expense' && e.status === 'paid' && e.category_id === Number(catId) && monthOf(e.paid_date) >= from && monthOf(e.paid_date) < cur);
    const avg = Math.round(sum(entries, (e) => e.amount) / 3);
    out.push({ category_id: Number(catId), name: s.categories.find((c) => c.id === Number(catId))?.name, averageMonthly: avg, pct, monthlySaving: Math.round((avg * pct) / 100) });
  }
  return { items: out, monthly: sum(out, (x) => x.monthlySaving), yearly: sum(out, (x) => x.monthlySaving) * 12 };
}

// Impacto de uma compra nova (à vista ou parcelada) nos próximos meses.
export function purchaseImpact(s, today, { amount, installments = 1, firstDate, months = 6 }) {
  const extra = [];
  const per = Math.floor(amount / installments);
  for (let i = 0; i < installments; i++) {
    const [y, m, d] = firstDate.split('-').map(Number);
    const idx = y * 12 + (m - 1) + i;
    const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
    const dim = daysInMonth(ny, nm);
    const date = `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`;
    extra.push({ date, amount: i === installments - 1 ? amount - per * (installments - 1) : per });
  }
  const before = project(s, today, { months });
  const after = project(s, today, { months, extraEvents: extra });
  return { before, after, installments: extra };
}
