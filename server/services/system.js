// Limpar sistema: apaga SOMENTE dados financeiros. Mantém configurações, categorias, senha, estrutura do banco e backups.
import { get, run, tx, audit } from '../db.js';
import { bad } from '../util.js';
import { createBackup } from './backup.js';

export const CONFIRM_PHRASE = 'ZERAR SISTEMA';
// ordem respeita as chaves estrangeiras (dependentes primeiro)
const TABLES = [
  'house_loan_updates', 'house_loans', 'goals', 'reserve_movements', 'reserves', 'movements', 'entries',
  'recurrence_skips', 'recurrences', 'debts', 'subscriptions', 'cards', 'accounts', 'audit_log',
];

export function clearSystem(ctx, body) {
  if (body?.confirm !== CONFIRM_PHRASE) throw bad(`Para confirmar, digite exatamente ${CONFIRM_PHRASE}.`);
  // backup ANTES de qualquer exclusão (e verificado); se falhar, nada é apagado
  const backup = body.backup ? createBackup(ctx, 'antes-de-limpar').name : null;
  const counts = {};
  tx(ctx.db, () => {
    for (const t of TABLES) {
      counts[t] = get(ctx.db, `SELECT COUNT(*) n FROM ${t}`).n;
      run(ctx.db, `DELETE FROM ${t}`);
      run(ctx.db, 'DELETE FROM sqlite_sequence WHERE name=?', t);
    }
    audit(ctx.db, 'system', null, 'clear', counts, { backup });
  });
  return { cleared: true, backup, counts };
}
