// Assinaturas, reservas, metas, categorias e configurações.
import { all, get, run, tx, audit, getSettings } from '../db.js';
import { bad, notFound, conflict, str, cents, int, date, oneOf, bool, nowIso } from '../util.js';
import { addMonths, addDays, parse, PERIODS } from '../core/dates.js';
import { insertEntry } from './ledger.js';
import { reserveTotals } from '../core/finance.js';

/* ---------- assinaturas ---------- */
function subInput(b) {
  const next = date(b.next_date, { name: 'Próxima cobrança' });
  return {
    name: str(b.name, { name: 'Nome do serviço', required: true, max: 80 }),
    amount: cents(b.amount),
    period: oneOf(b.period, PERIODS, { name: 'Periodicidade' }),
    next_date: next,
    anchor_day: parse(next).d,
    start_date: date(b.start_date, { name: 'Data de início', required: false }) || next,
    end_date: b.continuous ? null : date(b.end_date, { name: 'Data final', required: false }),
    payment_method: str(b.payment_method, { max: 40 }),
    account_id: b.account_id ? int(b.account_id, { min: 1 }) : null,
    category_id: b.category_id ? int(b.category_id, { min: 1 }) : null,
    status: oneOf(b.status, ['active', 'paused', 'cancelled'], { def: 'active' }),
    notes: str(b.notes, { max: 500 }),
  };
}
function checkRange(s) {
  if (s.end_date && s.end_date < s.start_date) throw bad('A data final não pode ser anterior à data de início.');
}
export function createSubscription(db, b) {
  const s = subInput(b);
  checkRange(s);
  const r = run(db, 'INSERT INTO subscriptions(name,amount,period,next_date,anchor_day,payment_method,account_id,category_id,status,notes,start_date,end_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    s.name, s.amount, s.period, s.next_date, s.anchor_day, s.payment_method, s.account_id, s.category_id, s.status, s.notes, s.start_date, s.end_date, nowIso());
  return { id: Number(r.lastInsertRowid) };
}
export function updateSubscription(db, id, b) {
  if (!get(db, 'SELECT id FROM subscriptions WHERE id=?', id)) throw notFound();
  const s = subInput(b);
  checkRange(s);
  // o histórico já pago/registrado (entries) não é tocado; só as cobranças futuras previstas mudam
  run(db, 'UPDATE subscriptions SET name=?,amount=?,period=?,next_date=?,anchor_day=?,payment_method=?,account_id=?,category_id=?,status=?,notes=?,start_date=?,end_date=? WHERE id=?',
    s.name, s.amount, s.period, s.next_date, s.anchor_day, s.payment_method, s.account_id, s.category_id, s.status, s.notes, s.start_date, s.end_date, id);
}
export function deleteSubscription(db, id) {
  const s = get(db, 'SELECT * FROM subscriptions WHERE id=?', id);
  if (!s) throw notFound();
  return tx(db, () => {
    const existing = get(db, 'SELECT COUNT(*) n FROM entries WHERE subscription_id=?', id).n;
    if (existing > 0) {
      // Converte cobranças existentes em despesas avulsas
      run(db, 'UPDATE entries SET subscription_id=NULL WHERE subscription_id=?', id);
    } else {
      // Se não havia cobrança gerada, cria o lançamento em despesas
      const catId = s.category_id ?? get(db, "SELECT id FROM categories WHERE kind='expense' AND name='Assinaturas'")?.id ?? null;
      insertEntry(db, {
        type: 'expense',
        description: s.name,
        amount: s.amount,
        due_date: s.next_date,
        status: 'pending',
        category_id: catId,
        account_id: s.account_id,
        payment_method: s.payment_method,
        nature: 'fixa',
      });
    }
    run(db, 'DELETE FROM subscriptions WHERE id=?', id);
    return { ok: true, converted: true };
  });
}

export function resetSubscriptions(db) {
  return tx(db, () => {
    run(db, 'UPDATE entries SET subscription_id=NULL WHERE subscription_id IS NOT NULL');
    run(db, 'DELETE FROM subscriptions');
    return { ok: true };
  });
}
// Registro EXPLÍCITO da cobrança do ciclo atual. Cria um lançamento de despesa e avança a próxima data.
export function chargeSubscription(db, id, b) {
  const s = get(db, 'SELECT * FROM subscriptions WHERE id=?', id);
  if (!s) throw notFound();
  if (s.status !== 'active') throw conflict('Só é possível registrar cobrança de assinatura ativa.');
  if (s.end_date && s.next_date > s.end_date) throw conflict(`Esta assinatura terminou em ${s.end_date.split('-').reverse().join('/')}; não há mais cobranças.`);
  const isPrepaid = b.mode === 'prepaid' || b.prepaid;
  const paid = b.mode === 'paid' || isPrepaid;
  const accountId = b.account_id ? int(b.account_id, { min: 1 }) : s.account_id;
  if (b.mode === 'paid' && !accountId) throw bad('Informe a conta usada no pagamento.');
  const paidDate = paid ? date(b.paid_date || s.next_date, { name: 'Data de pagamento' }) : null;
  const catId = s.category_id ?? get(db, "SELECT id FROM categories WHERE kind='expense' AND name='Assinaturas'")?.id ?? null;
  return tx(db, () => {
    if (get(db, 'SELECT id FROM entries WHERE subscription_id=? AND due_date=?', id, s.next_date)) throw conflict('A cobrança deste ciclo já foi registrada.');
    const eid = insertEntry(db, {
      type: 'expense', description: s.name, amount: s.amount, due_date: s.next_date, paid_date: paidDate, status: paid ? 'paid' : 'pending',
      category_id: catId, account_id: accountId, payment_method: s.payment_method, nature: 'fixa', subscription_id: id,
      external_id: isPrepaid ? `prepaid:sub:${id}:${s.next_date}` : null,
    });
    const step = s.period === 'weekly' ? addDays(s.next_date, 7) : addMonths(s.next_date, { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 }[s.period], s.anchor_day);
    run(db, 'UPDATE subscriptions SET next_date=? WHERE id=?', step, id);
    return { entry_id: eid, next_date: step };
  });
}

/* ---------- reservas ---------- */
function reserveInput(b) {
  return {
    name: str(b.name, { name: 'Nome', required: true, max: 80 }),
    kind: oneOf(b.kind, ['reserva', 'investimento'], { def: 'reserva' }),
    target: cents(b.target ?? 0, { name: 'Valor desejado', positive: false }),
    account_id: b.account_id ? int(b.account_id, { min: 1 }) : null,
    purpose: str(b.purpose, { max: 200 }),
    deadline: date(b.deadline, { required: false }),
    notes: str(b.notes, { max: 500 }),
    status: oneOf(b.status, ['active', 'archived'], { def: 'active' }),
  };
}
export function createReserve(db, b, today) {
  const r = reserveInput(b);
  const initial = cents(b.initial_amount ?? 0, { name: 'Valor acumulado', positive: false });
  return tx(db, () => {
    const res = run(db, 'INSERT INTO reserves(name,kind,target,account_id,purpose,deadline,notes,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      r.name, r.kind, r.target, r.account_id, r.purpose, r.deadline, r.notes, r.status, nowIso());
    const id = Number(res.lastInsertRowid);
    if (initial > 0) run(db, "INSERT INTO reserve_movements(reserve_id,amount,date,kind,note,created_at) VALUES (?,?,?,'aporte','Valor acumulado inicial',?)", id, initial, today, nowIso());
    return { id };
  });
}
export function updateReserve(db, id, b) {
  if (!get(db, 'SELECT id FROM reserves WHERE id=?', id)) throw notFound();
  const r = reserveInput(b);
  run(db, 'UPDATE reserves SET name=?,kind=?,target=?,account_id=?,purpose=?,deadline=?,notes=?,status=? WHERE id=?',
    r.name, r.kind, r.target, r.account_id, r.purpose, r.deadline, r.notes, r.status, id);
}
export function deleteReserve(db, id) {
  const n = get(db, 'SELECT COUNT(*) n FROM reserve_movements WHERE reserve_id=?', id).n;
  const g = get(db, 'SELECT COUNT(*) n FROM goals WHERE reserve_id=?', id).n;
  if (g) throw conflict('Há metas associadas a esta reserva. Desassocie-as primeiro.');
  tx(db, () => { if (n) audit(db, 'reserve', id, 'delete', get(db, 'SELECT * FROM reserves WHERE id=?', id), all(db, 'SELECT * FROM reserve_movements WHERE reserve_id=?', id)); run(db, 'DELETE FROM reserve_movements WHERE reserve_id=?', id); run(db, 'DELETE FROM reserves WHERE id=?', id); });
}
export function reserveMove(db, id, b, accountBalanceFn) {
  const r = get(db, 'SELECT * FROM reserves WHERE id=?', id);
  if (!r) throw notFound();
  const kind = oneOf(b.kind, ['aporte', 'retirada', 'ajuste'], { name: 'Tipo' });
  const v = cents(b.amount);
  const amount = kind === 'retirada' ? -v : kind === 'ajuste' && b.direction === 'out' ? -v : v;
  const movs = all(db, 'SELECT * FROM reserve_movements WHERE reserve_id=?', id);
  const tot = reserveTotals(r, movs);
  if (kind === 'retirada' && v > tot.earmarked) throw bad('A retirada excede o valor guardado nesta reserva.');
  if (kind === 'ajuste' && tot.accumulated + amount < 0) throw bad('O ajuste deixaria o valor da reserva negativo.');
  if (kind === 'aporte') {
    const free = accountBalanceFn(r);
    if (free != null && v > free) throw bad('Saldo livre insuficiente na conta de origem para reservar este valor.');
  }
  run(db, 'INSERT INTO reserve_movements(reserve_id,amount,date,kind,note,created_at) VALUES (?,?,?,?,?,?)',
    id, amount, date(b.date), kind, str(b.note, { max: 200 }), nowIso());
}

/* ---------- metas ---------- */
function goalInput(b) {
  return {
    name: str(b.name, { name: 'Nome', required: true, max: 80 }),
    target: cents(b.target, { name: 'Valor desejado' }),
    saved_manual: cents(b.saved_manual ?? 0, { name: 'Valor acumulado', positive: false }),
    deadline: date(b.deadline, { required: false }),
    priority: oneOf(b.priority, ['alta', 'media', 'baixa'], { def: 'media' }),
    reserve_id: b.reserve_id ? int(b.reserve_id, { min: 1 }) : null,
    notes: str(b.notes, { max: 500 }),
    status: oneOf(b.status, ['active', 'archived'], { def: 'active' }),
  };
}
export function createGoal(db, b) {
  const g = goalInput(b);
  const r = run(db, 'INSERT INTO goals(name,target,saved_manual,deadline,priority,reserve_id,notes,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    g.name, g.target, g.saved_manual, g.deadline, g.priority, g.reserve_id, g.notes, g.status, nowIso());
  return { id: Number(r.lastInsertRowid) };
}
export function updateGoal(db, id, b) {
  if (!get(db, 'SELECT id FROM goals WHERE id=?', id)) throw notFound();
  const g = goalInput(b);
  run(db, 'UPDATE goals SET name=?,target=?,saved_manual=?,deadline=?,priority=?,reserve_id=?,notes=?,status=? WHERE id=?',
    g.name, g.target, g.saved_manual, g.deadline, g.priority, g.reserve_id, g.notes, g.status, id);
}
export function deleteGoal(db, id) { run(db, 'DELETE FROM goals WHERE id=?', id); }

/* ---------- categorias ---------- */
export function createCategory(db, b) {
  const name = str(b.name, { name: 'Nome', required: true, max: 50 });
  const kind = oneOf(b.kind, ['income', 'expense'], { name: 'Tipo' });
  if (get(db, 'SELECT id FROM categories WHERE name=? AND kind=?', name, kind)) throw conflict('Já existe uma categoria com este nome.');
  return { id: Number(run(db, 'INSERT INTO categories(name,kind) VALUES (?,?)', name, kind).lastInsertRowid) };
}
export function renameCategory(db, id, b) {
  const c = get(db, 'SELECT * FROM categories WHERE id=?', id);
  if (!c) throw notFound();
  const name = str(b.name, { name: 'Nome', required: true, max: 50 });
  if (get(db, 'SELECT id FROM categories WHERE name=? AND kind=? AND id<>?', name, c.kind, id)) throw conflict('Já existe uma categoria com este nome.');
  run(db, 'UPDATE categories SET name=? WHERE id=?', name, id);
}
export function deleteCategory(db, id, reassign) {
  const c = get(db, 'SELECT * FROM categories WHERE id=?', id);
  if (!c) throw notFound();
  const used = get(db, `SELECT (SELECT COUNT(*) FROM entries WHERE category_id=?)+(SELECT COUNT(*) FROM recurrences WHERE category_id=?)
    +(SELECT COUNT(*) FROM subscriptions WHERE category_id=?)+(SELECT COUNT(*) FROM debts WHERE category_id=?) n`, id, id, id, id).n;
  if (used && !reassign) throw conflict(`Categoria usada em ${used} registro(s). Escolha outra categoria para reatribuí-los.`);
  tx(db, () => {
    if (used) {
      const t = get(db, 'SELECT id FROM categories WHERE id=? AND kind=? AND id<>?', reassign, c.kind, id);
      if (!t) throw bad('Categoria de destino inválida.');
      for (const tb of ['entries', 'recurrences', 'subscriptions', 'debts']) run(db, `UPDATE ${tb} SET category_id=? WHERE category_id=?`, reassign, id);
    }
    run(db, 'DELETE FROM categories WHERE id=?', id);
  });
}

/* ---------- configurações ---------- */
const MONEY_KEYS = ['min_reserve', 'monthly_savings_goal'];
export function updateSettings(db, b) {
  const cur = getSettings(db);
  const next = {};
  for (const k of MONEY_KEYS) if (k in b) next[k] = String(cents(b[k], { name: k, positive: false }));
  if ('user_name' in b) next.user_name = str(b.user_name, { name: 'Nome', required: true, max: 40 });
  if ('default_report_period' in b) next.default_report_period = oneOf(b.default_report_period, ['month', 'quarter', 'year'], { name: 'Período' });
  if ('chart_months' in b) next.chart_months = String(oneOf(Number(b.chart_months), [3, 6, 12], { name: 'Meses dos gráficos' }));
  if ('alert_days' in b) next.alert_days = String(int(b.alert_days, { name: 'Dias de alerta', min: 1, max: 60 }));
  if ('withdrawal_horizon' in b) next.withdrawal_horizon = String(int(b.withdrawal_horizon, { name: 'Período de planejamento', min: 7, max: 365 }));
  if ('backup_dir' in b) next.backup_dir = str(b.backup_dir, { max: 300 }) ?? '';
  tx(db, () => {
    for (const [k, v] of Object.entries(next)) run(db, 'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v);
    audit(db, 'settings', null, 'update', Object.fromEntries(Object.keys(next).map((k) => [k, cur[k]])), next);
  });
}
