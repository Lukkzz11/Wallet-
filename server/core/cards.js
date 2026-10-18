// Cartões: valor mensal por cartão, quando as parcelas terminam e simulação de nova compra.
// Fonte única: parcelas (entries) das dívidas ligadas a um cartão. Nada é contado em duplicidade.
import { addMonthKey, monthOf, monthStart, monthEnd } from './dates.js';
import { sum, isPrepaid, subscriptionsInRange } from './finance.js';

const monthsBetween = (a, b) => {
  const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
};

export const cardPurchases = (s) => s.debts.filter((d) => d.card_id && d.status !== 'cancelled');

// installments: parcelas das compras de cartão (pagas e pendentes). 9999 = quitação antecipada, não é parcela do plano.
function installmentsOf(s) {
  const byDebt = new Map(cardPurchases(s).map((d) => [d.id, d]));
  const fromPurchases = s.entries.filter((e) => e.debt_id && byDebt.has(e.debt_id) && e.installment_no !== 9999).map((e) => ({ ...e, card_id: byDebt.get(e.debt_id).card_id }));
  // parcelas já em andamento informadas por mês (card_id na própria despesa)
  const base = s.entries.filter((e) => e.card_id && !e.debt_id);
  return [...fromPurchases, ...base];
}

// {porCartão: {id: {mês: valor}}, total: {mês: valor}} para a lista de meses
export function monthlyByCard(s, months, extra = []) {
  const set = new Set(months);
  const card = {}, total = {};
  for (const m of months) total[m] = 0;
  const add = (cardId, m, v) => {
    if (!set.has(m)) return;
    (card[cardId] ||= Object.fromEntries(months.map((x) => [x, 0])))[m] += v;
    total[m] += v;
  };
  for (const e of installmentsOf(s)) add(e.card_id, monthOf(e.due_date), e.amount);
  for (const x of extra) add(x.card_id, x.month, x.amount);
  return { card, total };
}

// Limite usado = parcelas ainda não pagas (todas as faturas futuras) + gastos avulsos informados na fatura aberta.
export function cardUsage(s, card) {
  const pend = sum(installmentsOf(s).filter((e) => e.card_id === card.id && e.status === 'pending'), (e) => e.amount);
  const used = pend + (card.used_extra || 0);
  const limit = card.credit_limit || 0;
  return { limit, installments: pend, extra: card.used_extra || 0, used, available: limit > 0 ? limit - used : null, pct: limit > 0 ? Math.round((used / limit) * 1000) / 10 : null };
}

export function cardsOverview(s, today, nMonths = 12, { month, year } = {}) {
  const cur = monthOf(today);
  const selMonth = month || cur;
  const selYear = year || Number(selMonth.slice(0, 4));
  const months = Array.from({ length: nMonths }, (_, i) => addMonthKey(cur, i));
  const { card, total } = monthlyByCard(s, months);
  const inst = installmentsOf(s);
  const cards = s.cards.filter((c) => !c.archived).map((c) => {
    const monthly = card[c.id] || Object.fromEntries(months.map((m) => [m, 0]));
    const purchases = cardPurchases(s).filter((d) => d.card_id === c.id).map((d) => {
      const list = inst.filter((e) => e.debt_id === d.id).sort((a, b) => a.due_date.localeCompare(b.due_date));
      const pending = list.filter((e) => e.status === 'pending');
      const last = list.at(-1);
      return {
        id: d.id, description: d.description.replace(/\s*\(quitação.*$/, ''), installment: d.installment_amount, total: d.installments_total,
        paid: list.filter((e) => e.status === 'paid').length, remaining: pending.length,
        startMonth: list[0] ? monthOf(list[0].due_date) : null, endMonth: last ? monthOf(last.due_date) : null,
        next: pending[0] ? { id: pending[0].id, due_date: pending[0].due_date, amount: pending[0].amount } : null,
        totalAmount: d.total_amount, remainingAmount: sum(pending, (e) => e.amount), done: pending.length === 0, notes: d.notes,
      };
    });
    // Quando o valor mensal diminui: mês seguinte ao da última parcela de cada compra ainda ativa
    const relief = {};
    for (const p of purchases) {
      if (p.done || !p.endMonth) continue;
      const m = addMonthKey(p.endMonth, 1);
      (relief[m] ||= { month: m, amount: 0, purchases: [] });
      relief[m].amount += p.installment;
      relief[m].purchases.push(p.description);
    }
    // grade do ano escolhido: parcelas já em andamento informadas por mês
    const yearBase = Array.from({ length: 12 }, (_, i) => {
      const m = `${selYear}-${String(i + 1).padStart(2, '0')}`;
      const e = s.entries.find((x) => x.card_id === c.id && !x.debt_id && monthOf(x.due_date) === m);
      return { month: m, amount: e?.amount ?? 0, paid: e?.status === 'paid', locked: m < cur };
    });
    // tudo o que vence neste cartão no mês escolhido (grade + parcelas de compras), com situação
    const items = inst.filter((e) => e.card_id === c.id && monthOf(e.due_date) === selMonth)
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id)
      .map((e) => ({ entry_id: e.id, description: e.debt_id ? e.description : 'Parcelas em andamento', amount: e.amount, due_date: e.due_date, paid_date: e.paid_date, status: e.status, kind: e.debt_id ? 'purchase' : 'base', account_id: e.account_id }));
    const usage = cardUsage(s, c);
    const mine = inst.filter((e) => e.card_id === c.id);
    const strip = (d) => d.replace(/\s*\(\d+\/\d+\)\s*$/, '');
    // compromissos futuros: o que forma o valor de cada mês
    const breakdown = Object.fromEntries(months.map((m) => [m, mine.filter((e) => monthOf(e.due_date) === m).map((e) => ({ description: e.debt_id ? strip(e.description) : 'Parcelas em andamento', amount: e.amount, status: e.status }))]));
    // pagamentos realmente registrados (parcelas marcadas como pagas no cadastro não são pagamentos)
    const payments = mine.filter((e) => e.status === 'paid' && !isPrepaid(e)).sort((a, b) => (b.paid_date || '').localeCompare(a.paid_date || '')).slice(0, 15)
      .map((e) => ({ entry_id: e.id, description: e.description, amount: e.amount, due_date: e.due_date, paid_date: e.paid_date }));
    const pend = mine.filter((e) => e.status === 'pending');
    // próximas faturas: total, pago, pendente e situação (uma fatura só é "paga" se nada estiver pendente)
    const invoices = months.map((m) => {
      const l = mine.filter((e) => monthOf(e.due_date) === m);
      const total = sum(l, (e) => e.amount), paid = sum(l.filter((e) => e.status === 'paid'), (e) => e.amount);
      return { month: m, due_date: l.map((e) => e.due_date).sort()[0] || null, total, paid, pending: total - paid, status: !total ? 'vazia' : total === paid ? 'paga' : paid > 0 ? 'parcial' : 'pendente' };
    }).filter((i) => i.total > 0);
    const future = pend.filter((e) => monthOf(e.due_date) > selMonth);
    return {
      ...c, usage, breakdown, payments, invoices, futureAmount: sum(future, (e) => e.amount), futureCount: future.length, pendingCount: pend.length, pendingAmount: sum(pend, (e) => e.amount), yearBase, items, monthTotal: sum(items, (i) => i.amount), monthPaid: sum(items.filter((i) => i.status === 'paid'), (i) => i.amount), monthPending: sum(items.filter((i) => i.status !== 'paid'), (i) => i.amount), monthPaidCount: items.filter((i) => i.status === 'paid').length, monthPendingCount: items.filter((i) => i.status !== 'paid').length, monthly, currentMonth: monthly[cur], nextMonth: monthly[months[1]],
      purchases, relief: Object.values(relief).sort((a, b) => a.month.localeCompare(b.month)),
    };
  });
  const reliefAll = {};
  for (const c of cards) for (const r of c.relief) {
    (reliefAll[r.month] ||= { month: r.month, amount: 0, items: [] });
    reliefAll[r.month].amount += r.amount;
    reliefAll[r.month].items.push(...r.purchases.map((p) => `${p} (${c.name})`));
  }
  const active = cards.flatMap((c) => c.purchases).filter((p) => !p.done);
  return {
    today, months, month: selMonth, year: selYear, cards, total,
    upcoming: inst.filter((e) => e.status === 'pending').sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id).slice(0, 8)
      .map((e) => ({ entry_id: e.id, card: s.cards.find((c) => c.id === e.card_id)?.name ?? '', description: e.description, amount: e.amount, due_date: e.due_date })),
    selected: { month: selMonth, total: sum(cards, (k) => k.monthTotal), paid: sum(cards, (k) => k.monthPaid), pending: sum(cards, (k) => k.monthPending), paidCount: sum(cards, (k) => k.monthPaidCount), pendingCount: sum(cards, (k) => k.monthPendingCount) },
    totals: { currentMonth: total[cur], nextMonth: total[months[1]], pendingAmount: sum(inst.filter((e) => e.status === 'pending'), (e) => e.amount), activePurchases: active.length, pendingInstallments: inst.filter((e) => e.status === 'pending').length,
      // parcelas pendentes de meses POSTERIORES ao mês escolhido (não inclui o mês em exibição)
      futureAmount: sum(inst.filter((e) => e.status === 'pending' && monthOf(e.due_date) > selMonth), (e) => e.amount), futureCount: inst.filter((e) => e.status === 'pending' && monthOf(e.due_date) > selMonth).length },
    relief: Object.values(reliefAll).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

// Divide o total em n parcelas em centavos (sobras nas primeiras); ou n parcelas iguais se o valor foi informado.
export function splitInstallments(total, n, fixed = null) {
  if (fixed) return Array(n).fill(fixed);
  const base = Math.floor(total / n), rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

// Simulação 100% em memória: não grava nada.
export function simulateCardPurchase(s, today, { card_id, total, installments, firstMonth, installment_amount = null, showAll = true, compare = [1, 2, 3, 4, 6, 10, 12, 18, 24] }) {
  const card = s.cards.find((c) => c.id === card_id);
  if (!card) throw new Error('Cartão não encontrado.');
  const cur = monthOf(today);
  const first = firstMonth || addMonthKey(cur, 1);
  const horizon = Math.max(12, monthsBetween(cur, first) + Math.max(installments, ...compare.filter((n) => n <= 24)) + 1);
  const months = Array.from({ length: horizon }, (_, i) => addMonthKey(cur, i));
  const base = monthlyByCard(s, months);
  const baseCard = base.card[card_id] || Object.fromEntries(months.map((m) => [m, 0]));

  const scenario = (n, fixed) => {
    const parts = splitInstallments(total, n, fixed);
    const extra = parts.map((amount, i) => ({ card_id, month: addMonthKey(first, i), amount }));
    const sim = monthlyByCard(s, months, extra);
    const cardAfter = sim.card[card_id] || baseCard;
    const lastMonth = addMonthKey(first, n - 1);
    return {
      n, installment: parts[0], installments: parts, totalPaid: sum(parts), lastMonth,
      cardFirstMonth: cardAfter[first] ?? null, allFirstMonth: sim.total[first] ?? null,
      cardPeak: Math.max(...months.filter((m) => m >= first && m <= lastMonth).map((m) => cardAfter[m])),
      allPeak: Math.max(...months.filter((m) => m >= first && m <= lastMonth).map((m) => sim.total[m])),
      rows: months.map((m) => ({ month: m, cardBefore: baseCard[m], cardAfter: cardAfter[m], allBefore: base.total[m], allAfter: sim.total[m] })),
    };
  };
  const chosen = scenario(installments, installment_amount);
  const comparison = [...new Set([...compare, installments])].sort((a, b) => a - b).map((n) => {
    const r = scenario(n, n === installments ? installment_amount : null);
    const { rows, installments: _p, ...rest } = r; // eslint-disable-line no-unused-vars
    return rest;
  });
  // planilha: cada mês até a última parcela relevante, por cartão, com assinaturas separadas (não somadas aos cartões)
  const all = installmentsOf(s);
  const shown = s.cards.filter((c) => !c.archived && (showAll || c.id === card_id));
  const extra = new Map(chosen.installments.map((amt, i) => [addMonthKey(first, i), amt]));
  let lastRel = chosen.lastMonth;
  for (const e of all) if (shown.some((c) => c.id === e.card_id) && monthOf(e.due_date) > lastRel) lastRel = monthOf(e.due_date);
  const table = [];
  for (let m = cur; m <= lastRel; m = addMonthKey(m, 1)) {
    const cardsRows = shown.map((c) => {
      const l = all.filter((e) => e.card_id === c.id && monthOf(e.due_date) === m);
      const committed = sum(l, (e) => e.amount), paid = sum(l.filter((e) => e.status === 'paid'), (e) => e.amount);
      const add = c.id === card_id ? extra.get(m) || 0 : 0;
      return { card_id: c.id, name: c.bank || c.name, card_name: c.name, committed, paid, pending: committed - paid, extra: add, projected: committed + add };
    });
    const subs = subscriptionsInRange(s, monthStart(m), monthEnd(m));
    const cardsCommitted = sum(cardsRows, (r) => r.committed), cardsExtra = sum(cardsRows, (r) => r.extra);
    table.push({ month: m, cards: cardsRows, subs: subs.total, subsPaid: subs.paid, cardsCommitted, cardsPaid: sum(cardsRows, (r) => r.paid), cardsPending: sum(cardsRows, (r) => r.pending), extra: cardsExtra, total: cardsCommitted + cardsExtra + subs.total });
  }
  const { rows, ...summary } = chosen;
  const totalCardsPaidConsolidated = sum(all.filter((e) => e.status === 'paid'), (e) => e.amount);
  const totalSubscriptionsPaid = sum(s.entries.filter((e) => e.type === 'expense' && e.subscription_id && e.status === 'paid'), (e) => e.amount);
  return {
    card: { id: card.id, name: card.bank || card.name }, firstMonth: first, total,
    ...summary,
    totalCardsPaidConsolidated,
    totalSubscriptionsPaid,
    cardCurrentMonth: baseCard[cur], cardBeforeFirstMonth: baseCard[first] ?? 0, allCurrentMonth: base.total[cur], allBeforeFirstMonth: base.total[first] ?? 0,
    limit: (() => { const u = cardUsage(s, card); return { ...u, availableAfter: u.available == null ? null : u.available - sum(chosen.installments), exceeds: u.available != null && sum(chosen.installments) > u.available }; })(),
    rows, comparison, table, showAll,
    note: installment_amount ? 'Parcela informada por você (pode incluir juros). O total pago usa esse valor.' : 'Parcelas sem juros: o simulador não inventa taxas. Se o cartão cobrar juros, informe o valor real da parcela.',
  };
}
