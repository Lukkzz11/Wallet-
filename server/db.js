import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Todos os valores monetários são inteiros em centavos. Datas: 'YYYY-MM-DD'.
const MIGRATIONS = [
  /* v1 */ `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  initial_balance INTEGER NOT NULL DEFAULT 0,
  ref_date TEXT NOT NULL,
  spendable INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  UNIQUE (name, kind)
);
CREATE TABLE recurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  category_id INTEGER REFERENCES categories(id),
  account_id INTEGER REFERENCES accounts(id),
  payment_method TEXT, origin TEXT, nature TEXT, certain INTEGER NOT NULL DEFAULT 1, notes TEXT,
  frequency TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE recurrence_skips (
  recurrence_id INTEGER NOT NULL REFERENCES recurrences(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  PRIMARY KEY (recurrence_id, due_date)
);
CREATE TABLE debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  creditor TEXT,
  kind TEXT NOT NULL DEFAULT 'compra',
  total_amount INTEGER NOT NULL,
  installment_amount INTEGER NOT NULL,
  installments_total INTEGER NOT NULL,
  first_due_date TEXT NOT NULL,
  interest_rate TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid','cancelled')),
  account_id INTEGER REFERENCES accounts(id),
  category_id INTEGER REFERENCES categories(id),
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  period TEXT NOT NULL CHECK (period IN ('weekly','monthly','quarterly','semiannual','yearly')),
  next_date TEXT NOT NULL,
  anchor_day INTEGER NOT NULL,
  payment_method TEXT,
  account_id INTEGER REFERENCES accounts(id),
  category_id INTEGER REFERENCES categories(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  due_date TEXT NOT NULL,
  paid_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  category_id INTEGER REFERENCES categories(id),
  account_id INTEGER REFERENCES accounts(id),
  payment_method TEXT, origin TEXT, nature TEXT,
  certain INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  recurrence_id INTEGER REFERENCES recurrences(id),
  subscription_id INTEGER REFERENCES subscriptions(id),
  debt_id INTEGER REFERENCES debts(id),
  installment_no INTEGER,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_entry_rec ON entries(recurrence_id, due_date) WHERE recurrence_id IS NOT NULL;
CREATE UNIQUE INDEX ux_entry_sub ON entries(subscription_id, due_date) WHERE subscription_id IS NOT NULL;
CREATE UNIQUE INDEX ux_entry_debt ON entries(debt_id, installment_no) WHERE debt_id IS NOT NULL;
CREATE INDEX ix_entry_due ON entries(due_date);
CREATE TABLE movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('entry','transfer','manual','withdrawal')),
  description TEXT,
  entry_id INTEGER UNIQUE REFERENCES entries(id),
  transfer_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_mov_acc ON movements(account_id, date);
CREATE TABLE reserves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'reserva' CHECK (kind IN ('reserva','investimento')),
  target INTEGER NOT NULL DEFAULT 0,
  account_id INTEGER REFERENCES accounts(id),
  purpose TEXT, deadline TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL
);
CREATE TABLE reserve_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reserve_id INTEGER NOT NULL REFERENCES reserves(id),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('aporte','retirada','ajuste')),
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target INTEGER NOT NULL CHECK (target > 0),
  saved_manual INTEGER NOT NULL DEFAULT 0,
  deadline TEXT,
  priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('alta','media','baixa')),
  reserve_id INTEGER REFERENCES reserves(id),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  before TEXT,
  after TEXT
);
`,
  /* v2: cartões; compras parceladas são dívidas ligadas a um cartão */ `
CREATE TABLE cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  due_day INTEGER NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 28),
  account_id INTEGER REFERENCES accounts(id),
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
ALTER TABLE debts ADD COLUMN card_id INTEGER REFERENCES cards(id);
`,
  /* v3: identificador externo (importação de extratos/API) sem duplicar */ `
ALTER TABLE entries ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX ux_entry_external ON entries(external_id) WHERE external_id IS NOT NULL;
`,
  /* v4: parcelas já em andamento informadas por cartão/mês (uma despesa pendente por cartão e mês) */ `
ALTER TABLE entries ADD COLUMN card_id INTEGER;
CREATE UNIQUE INDEX ux_entry_cardbase ON entries(card_id, substr(due_date, 1, 7)) WHERE card_id IS NOT NULL AND debt_id IS NULL;
`,
  /* v5: limite do cartão e gastos avulsos na fatura aberta */ `
ALTER TABLE cards ADD COLUMN credit_limit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cards ADD COLUMN used_extra INTEGER NOT NULL DEFAULT 0;
`,
  /* v6: financiamento da casa (dados informados pelo usuário) e histórico de atualizações */ `
CREATE TABLE house_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id INTEGER NOT NULL REFERENCES debts(id),
  description TEXT NOT NULL,
  financed INTEGER NOT NULL DEFAULT 0,
  balance INTEGER NOT NULL DEFAULT 0,
  balance_date TEXT,
  total_months INTEGER NOT NULL,
  nominal_rate REAL,
  paid_at_update INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE house_loan_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL REFERENCES house_loans(id),
  date TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  remaining_months INTEGER NOT NULL,
  payment INTEGER NOT NULL,
  nominal_rate REAL,
  note TEXT,
  created_at TEXT NOT NULL
);
`,
  /* v7: parcelas quitadas ANTES do cadastro (sem movimentação) ficam marcadas e não contam como gasto do mês */ `
UPDATE entries SET external_id = 'prepaid:' || id
 WHERE status = 'paid' AND debt_id IS NOT NULL AND external_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM movements m WHERE m.entry_id = entries.id);
`,
  /* v8: aparência do cartão (instituição, bandeira, final e cor) */ `
ALTER TABLE cards ADD COLUMN bank TEXT;
ALTER TABLE cards ADD COLUMN brand TEXT;
ALTER TABLE cards ADD COLUMN last4 TEXT;
ALTER TABLE cards ADD COLUMN color TEXT;
`,
  /* v9: assinaturas com data de início e data final opcional (NULL = cobrança contínua) */ `
ALTER TABLE subscriptions ADD COLUMN start_date TEXT;
ALTER TABLE subscriptions ADD COLUMN end_date TEXT;
`,
  /* v10: categorias padrão para Life Surf e Aluguel (Casa) */ `
INSERT OR IGNORE INTO categories(name, kind) VALUES ('Life Surf', 'income');
INSERT OR IGNORE INTO categories(name, kind) VALUES ('Aluguel (Casa)', 'income');
`,
  /* v11: categorias padrão para Financiamento (Casa) e Pessoa Física */ `
INSERT OR IGNORE INTO categories(name, kind) VALUES ('Financiamento (Casa)', 'expense');
INSERT OR IGNORE INTO categories(name, kind) VALUES ('Pessoa Física', 'expense');
`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

const DEFAULT_SETTINGS = {
  user_name: 'Lucas',
  currency: 'BRL',
  min_reserve: '0',
  monthly_savings_goal: '0',
  default_report_period: 'month',
  chart_months: '6',
  alert_days: '7',
  withdrawal_horizon: '30',
  backup_dir: '',
};
const EXPENSE_CATS = ['Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Lazer', 'Tecnologia', 'Educação', 'Assinaturas', 'Compras pessoais', 'Contas e serviços', 'Financiamento (Casa)', 'Pessoa Física', 'Dívidas', 'Outros'];
const INCOME_CATS = ['Life Surf', 'Aluguel (Casa)', 'Salário', 'Trabalho autônomo', 'Comissões', 'Vendas', 'Serviços', 'Rendimentos', 'Receitas extras'];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current > SCHEMA_VERSION) {
    db.close();
    throw new Error(`O banco de dados é de uma versão mais nova (${current}) que este programa (${SCHEMA_VERSION}).`);
  }
  if (current > 0 && current < SCHEMA_VERSION && file !== ':memory:') {
    // Nunca migra dados existentes sem uma cópia de segurança.
    const dest = path.join(path.dirname(file), 'backups', `pre-migracao-v${current}-${Date.now()}.db`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      if (v === 0) seed(db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

function seed(db) {
  const st = db.prepare('INSERT INTO settings(key,value) VALUES (?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) st.run(k, v);
  const ct = db.prepare('INSERT INTO categories(name,kind) VALUES (?,?)');
  EXPENSE_CATS.forEach((n) => ct.run(n, 'expense'));
  INCOME_CATS.forEach((n) => ct.run(n, 'income'));
}

export function tx(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* já finalizada */ }
    throw e;
  }
}

export const all = (db, sql, ...p) => db.prepare(sql).all(...p);
export const get = (db, sql, ...p) => db.prepare(sql).get(...p);
export const run = (db, sql, ...p) => db.prepare(sql).run(...p);
export const audit = (db, entity, entityId, action, before, after) =>
  run(db, 'INSERT INTO audit_log(ts,entity,entity_id,action,before,after) VALUES (?,?,?,?,?,?)',
    new Date().toISOString(), entity, entityId ?? null, action,
    before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after));

export function getSettings(db) {
  const o = {};
  for (const r of all(db, 'SELECT key,value FROM settings')) o[r.key] = r.value;
  return o;
}
