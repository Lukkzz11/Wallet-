// Calculadora de retirada pessoal: linha do tempo de caixa + três cenários.
import { addDays } from './dates.js';
import { consolidate, sum, subscriptionCharges, goalProgress, monthlyEquivalent } from './finance.js';
import { monthStart, monthOf } from './dates.js';

// Receitas incertas nunca entram no caixa (peso 0 em todos os cenários); são apenas informadas.
export const SCENARIOS = {
  conservador: { label: 'Conservador', safetyFactor: 1.5, stress: 'safety', buffer: 0.1, incomeWeight: 0.8, savingsWeight: 1,
    desc: 'Margem de 150% da reserva mínima, 10% de folga sobre contas, 80% das receitas confirmadas e cobre as contas mesmo sem receitas futuras.' },
  equilibrado: { label: 'Equilibrado', safetyFactor: 1, stress: 'zero', buffer: 0.05, incomeWeight: 1, savingsWeight: 1,
    desc: 'Mantém a reserva mínima, 5% de folga sobre contas, a meta de economia integral e cobre as contas mesmo sem receitas futuras.' },
  flexivel: { label: 'Flexível', safetyFactor: 0.5, stress: null, buffer: 0, incomeWeight: 1, savingsWeight: 0.5,
    desc: 'Usa metade da reserva mínima, sem folga, reduz a economia pela metade e depende das receitas confirmadas chegarem (risco maior).' },
};

export function buildEvents(s, today, horizonDays, { buffer = 0, incomeWeight = 1 } = {}) {
  const end = addDays(today, horizonDays);
  const ev = [];
  const at = (d) => (d < today ? today : d);
  for (const e of s.entries) {
    if (e.status !== 'pending' || e.due_date > end) continue;
    if (e.type === 'expense') {
      ev.push({ date: at(e.due_date), amount: -Math.round(e.amount * (1 + buffer)), raw: e.amount, label: e.description, kind: e.due_date < today ? 'overdue' : 'bill', due: e.due_date });
    } else if (e.certain) {
      ev.push({ date: at(e.due_date), amount: Math.round(e.amount * incomeWeight), raw: e.amount, label: e.description, kind: 'income', due: e.due_date });
    }
  }
  for (const sub of s.subscriptions) {
    for (const c of subscriptionCharges(sub, null, end)) {
      ev.push({ date: at(c.date), amount: -Math.round(sub.amount * (1 + buffer)), raw: sub.amount, label: `Assinatura: ${sub.name}`, kind: 'subscription', due: c.date });
    }
  }
  // no mesmo dia, as saídas vêm antes das entradas (hipótese prudente)
  ev.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
  return ev;
}

export function runTimeline(start, events, withdrawal = 0) {
  let run = start - withdrawal;
  let min = events.length ? Infinity : run;
  const uncovered = [];
  for (const e of events) {
    run += e.amount;
    if (run < min) min = run;
    if (run < 0 && e.amount < 0) uncovered.push({ label: e.label, date: e.date, amount: e.raw });
  }
  return { end: run, min, uncovered };
}

// Estresse: nenhuma receita futura chega e as contas custam 10% a mais.
function stressRun(free, events, W, stressBuffer = 0.1) {
  const stressEv = events.filter((e) => e.amount < 0).map((e) => ({ ...e, amount: -Math.round(e.raw * (1 + stressBuffer)) }));
  return runTimeline(free, stressEv, W);
}

function riskOf(free, events, W, safety) {
  const stress = stressRun(free, events, W);
  const level = stress.min < 0 ? 'alto' : stress.min < safety ? 'medio' : 'baixo';
  const reason = level === 'alto'
    ? 'Sem receitas futuras e com contas 10% mais caras, o caixa ficaria negativo.'
    : level === 'medio'
      ? 'Mesmo sem receitas futuras o caixa não fica negativo, mas ficaria abaixo da reserva mínima.'
      : 'Mesmo sem receitas futuras e com contas 10% mais caras, o caixa permanece acima da reserva mínima.';
  return { level, reason, stressMin: stress.min };
}

export function missingData(s, cfg) {
  const missing = [];
  if (!s.accounts.length) missing.push('Cadastre ao menos uma conta com o saldo inicial.');
  if (!s.entries.length && !s.subscriptions.length) missing.push('Cadastre suas despesas, contas a pagar e assinaturas previstas.');
  if (!s.entries.some((e) => e.type === 'income')) missing.push('Cadastre suas receitas (recebidas e previstas) e marque quais são garantidas.');
  if (cfg.minReserve === 0) missing.push('Defina a reserva mínima de segurança em Configurações.');
  if (cfg.monthlyGoal === 0) missing.push('Defina a meta de economia mensal em Configurações (opcional).');
  return missing;
}

export function cfgOf(settings) {
  return {
    minReserve: Number(settings.min_reserve || 0),
    monthlyGoal: Number(settings.monthly_savings_goal || 0),
  };
}

export function computeScenario(s, today, horizonDays, key, cons = consolidate(s)) {
  const p = SCENARIOS[key];
  const cfg = cfgOf(s.settings);
  const end = addDays(today, horizonDays);
  const free = cons.available;
  const events = buildEvents(s, today, horizonDays, p);
  const plain = buildEvents(s, today, horizonDays);

  const overdue = sum(plain.filter((e) => e.kind === 'overdue'), (e) => -e.amount);
  const bills = sum(plain.filter((e) => e.kind === 'bill'), (e) => -e.amount);
  const subs = sum(plain.filter((e) => e.kind === 'subscription'), (e) => -e.amount);
  const obligations = overdue + bills + subs;
  const buffer = sum(events.filter((e) => e.amount < 0), (e) => -e.amount) - obligations;
  const confirmedRaw = sum(plain.filter((e) => e.kind === 'income'), (e) => e.amount);
  const confirmed = sum(events.filter((e) => e.kind === 'income'), (e) => e.amount);
  const uncertain = sum(s.entries.filter((e) => e.type === 'income' && e.status === 'pending' && !e.certain && e.due_date <= end), (e) => e.amount);

  const safety = Math.round(cfg.minReserve * p.safetyFactor);
  const monthStartDate = monthStart(monthOf(today));
  const savedThisMonth = sum(s.reserveMovs.filter((m) => m.kind === 'aporte' && m.date >= monthStartDate), (m) => m.amount);
  const savingsGoalPeriod = Math.round((cfg.monthlyGoal * horizonDays) / 30);
  const savingsTarget = Math.round(Math.max(0, savingsGoalPeriod - savedThisMonth) * p.savingsWeight);

  const base = runTimeline(free, events, 0);
  const maxByMin = base.min - safety;
  const maxByEnd = base.end - safety - savingsTarget;
  const stress0 = stressRun(free, events, 0).min;
  const stressCap = p.stress === 'safety' ? stress0 - safety : p.stress === 'zero' ? stress0 : Infinity;
  const suggested = Math.max(0, Math.min(maxByMin, maxByEnd, stressCap));
  const after = runTimeline(free, events, suggested);
  const risk = riskOf(free, events, suggested, safety);

  const goals = s.goals.filter((g) => g.status === 'active').map((g) => goalProgress(g, s, today));
  const goalsNeeded = sum(goals.filter((g) => g.monthlyNeeded), (g) => g.monthlyNeeded);
  const goalsImpact = goals.length === 0 ? 'Nenhuma meta cadastrada.'
    : savingsTarget === 0 && cfg.monthlyGoal > 0 ? 'A meta de economia do período já foi cumprida com aportes feitos neste mês.'
    : p.savingsWeight < 1 ? `Este cenário reduz a economia do período em ${Math.round((1 - p.savingsWeight) * 100)}%; as metas podem atrasar (necessário por mês para as metas: ${(goalsNeeded / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`
    : cfg.monthlyGoal * horizonDays / 30 >= goalsNeeded ? 'A economia preservada cobre o necessário para as metas cadastradas.'
    : 'A economia preservada é menor que o necessário por mês para as metas; revise a meta de economia.';

  const explanation = [
    { label: 'Saldo disponível hoje', value: free, note: `Contas gastáveis (${cons.spendable}) menos o dinheiro reservado (${cons.reservedFromSpendable}).` },
    { label: '(−) Contas vencidas', value: -overdue },
    { label: `(−) Contas e parcelas até ${end}`, value: -bills },
    { label: '(−) Assinaturas previstas no período', value: -subs },
    { label: `(−) Folga de ${Math.round(p.buffer * 100)}% sobre contas`, value: -buffer },
    { label: `(+) Receitas confirmadas (${Math.round(p.incomeWeight * 100)}%)`, value: confirmed, note: 'Somente receitas marcadas como garantidas e que vencem no período.' },
    { label: '(−) Reserva mínima de segurança', value: -safety, note: `${Math.round(p.safetyFactor * 100)}% da reserva mínima configurada.` },
    { label: '(−) Economia do período preservada', value: -savingsTarget, note: 'Meta mensal proporcional ao período, descontados aportes já feitos neste mês.' },
    { label: '= Retirada sugerida', value: suggested, note: 'Também limitada para que o caixa nunca fique abaixo da reserva mínima ao longo do período.' },
  ];

  return {
    key, label: p.label, description: p.desc, suggested,
    remaining: after.end, minBalance: after.min,
    expectedExpenses: obligations + buffer, overdue, bills, subscriptions: subs,
    confirmedIncome: confirmed, confirmedIncomeRaw: confirmedRaw, uncertainIncome: uncertain,
    safety, savingsTarget,
    preserved: { reserves: cons.reservedFromSpendable, safety, savings: savingsTarget, total: cons.reservedFromSpendable + safety + savingsTarget },
    uncovered: after.uncovered, goalsImpact, risk, explanation,
    items: plain.filter((e) => e.amount < 0).map((e) => ({ label: e.label, due: e.due, amount: e.raw, kind: e.kind })),
  };
}

export function computeWithdrawal(s, today, horizonDays) {
  const cons = consolidate(s);
  const cfg = cfgOf(s.settings);
  const missing = missingData(s, cfg);
  return {
    today, horizon: horizonDays, horizonEnd: addDays(today, horizonDays),
    available: cons.available, spendable: cons.spendable, total: cons.total, reserved: cons.reservedFromSpendable,
    minReserve: cfg.minReserve,
    incomplete: missing.length > 0 && (missing.length > 1 || cfg.minReserve === 0 || !s.accounts.length),
    missing,
    scenarios: Object.fromEntries(Object.keys(SCENARIOS).map((k) => [k, computeScenario(s, today, horizonDays, k, cons)])),
  };
}

// Simula uma retirada sem registrar nada.
export function simulateWithdrawal(s, today, horizonDays, amount, key = 'equilibrado') {
  const cons = consolidate(s);
  const cfg = cfgOf(s.settings);
  const p = SCENARIOS[key];
  const events = buildEvents(s, today, horizonDays, p);
  const safety = Math.round(cfg.minReserve * p.safetyFactor);
  const t = runTimeline(cons.available, events, amount);
  const risk = riskOf(cons.available, events, amount, safety);
  const exceedsAvailable = amount > cons.available;
  return {
    amount, scenario: key, availableBefore: cons.available, remaining: t.end, minBalance: t.min, safety,
    uncovered: t.uncovered, risk, exceedsAvailable,
    belowSafety: t.min < safety,
    message: t.min < 0 ? 'Esta retirada deixaria contas sem cobertura no período.'
      : t.min < safety ? 'Esta retirada deixaria o caixa abaixo da reserva mínima em algum momento.'
      : 'Esta retirada mantém o caixa acima da reserva mínima no período.',
  };
}
export { monthlyEquivalent };
