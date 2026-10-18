// "Posso investir?": verifica se um aporte cabe no orçamento, sem inventar rentabilidade.
import { consolidate } from './finance.js';
import { project, brl } from './projection.js';
import { computeScenario, cfgOf } from './withdrawal.js';

const okPlan = (p) => p.summary.negativeMonths.length === 0 && p.summary.belowMinimumMonths.length === 0;

// Valor futuro com taxa HIPOTÉTICA informada pelo usuário (0% = só soma dos aportes).
export function futureValue(lump, monthly, months, annualPct) {
  const r = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
  if (!r) return lump + monthly * months;
  const g = Math.pow(1 + r, months);
  return Math.round(lump * g + monthly * ((g - 1) / r));
}

export function simulateInvestment(s, today, { lump = 0, monthly = 0, months = 12, annualRatePct = 0 }) {
  const cons = consolidate(s);
  const cfg = cfgOf(s.settings);
  const pm = Math.min(12, Math.max(3, months));
  const baseline = project(s, today, { months: pm });
  const events = lump ? [{ date: today, amount: lump }] : [];
  const plan = project(s, today, { months: pm, monthlyWithdrawal: monthly, extraEvents: events });
  const safeNow = computeScenario(s, today, 30, 'equilibrado', cons).suggested;

  // maior aporte mensal que mantém o disponível acima da reserva mínima em todos os meses (busca binária)
  let lo = 0, hi = 100_000_000;
  if (!okPlan(project(s, today, { months: pm, extraEvents: events }))) hi = 0;
  while (hi - lo > 100) {
    const mid = Math.floor((lo + hi) / 2);
    if (okPlan(project(s, today, { months: pm, monthlyWithdrawal: mid, extraEvents: events }))) lo = mid; else hi = mid;
  }
  const maxMonthly = hi === 0 ? 0 : Math.floor(lo / 100) * 100;

  const verdict = plan.summary.negativeMonths.length ? 'nao' : plan.summary.belowMinimumMonths.length ? 'atencao' : 'pode';
  const reasons = [];
  if (lump > safeNow) reasons.push(`O valor à vista (${brl(lump)}) é maior que o que você pode tirar com segurança agora (${brl(safeNow)}).`);
  if (monthly > maxMonthly) reasons.push(`O aporte mensal (${brl(monthly)}) passa do máximo seguro calculado (${brl(maxMonthly)}/mês).`);
  if (plan.summary.negativeMonths.length) reasons.push(`O saldo ficaria negativo em: ${plan.summary.negativeMonths.join(', ')}.`);
  else if (plan.summary.belowMinimumMonths.length) reasons.push(`O disponível ficaria abaixo da reserva mínima (${brl(cfg.minReserve)}) em: ${plan.summary.belowMinimumMonths.join(', ')}.`);
  const missing = [];
  if (!s.accounts.length) missing.push('Informe quanto você tem hoje.');
  if (!s.entries.some((e) => e.type === 'income')) missing.push('Cadastre o que você recebe.');
  if (cfg.minReserve === 0) missing.push('Defina a reserva mínima em Configurações (sem ela, qualquer valor parece seguro).');
  const total = lump + monthly * months;
  return {
    available: cons.available, safeNow, maxMonthly, verdict, reasons, missing,
    plan: { months: plan.months, premises: plan.premises, summary: plan.summary }, baseline: { months: baseline.months },
    invested: total, annualRatePct,
    futureValue: futureValue(lump, monthly, months, annualRatePct),
    note: annualRatePct ? `Rendimento de ${annualRatePct}% ao ano é uma hipótese que você informou; o Wallet não conhece retornos reais e não é recomendação de investimento.` : 'Sem rendimento considerado (0%): o valor futuro é só a soma dos aportes. O Wallet não inventa rentabilidade nem recomenda produtos.',
  };
}
