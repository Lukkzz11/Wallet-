import { useState } from 'react';
import { get, post, put, del } from '../api.js';
import { useApp, useFetch, Card, Stat, PageHead, Badge, Empty, ErrorBox, Loading, FormModal, useForm, Txt, Money, Sel, Chk, accountOptions } from '../ui.jsx';
import { brl, dateBR, ACCOUNT_TYPES } from '../fmt.js';

function AccountForm({ account, onClose }) {
  const { today, refresh, notify } = useApp();
  const f = useForm(account ? { ...account, spendable: !!account.spendable, archived: !!account.archived } : { name: '', type: 'conta', initial_balance: 0, ref_date: today, spendable: true, archived: false });
  const changed = (e) => { f.set('type', e.target.value); f.set('spendable', !['poupanca', 'reserva'].includes(e.target.value)); };
  return (
    <FormModal title={account ? 'Editar conta' : 'Nova conta'} onClose={onClose}
      onSubmit={async () => { const b = { ...f.v }; account ? await put(`/api/accounts/${account.id}`, b) : await post('/api/accounts', b); notify('Conta salva.'); refresh(); }}>
      <Txt f={f} name="name" label="Nome" className="full" maxLength={60} required />
      <label className="field"><span>Tipo</span><select value={f.v.type} onChange={changed}>{ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
      <Money f={f} name="initial_balance" label="Saldo inicial" hint="Saldo real nesta data de referência." />
      <Txt f={f} name="ref_date" type="date" label="Data de referência" hint="Movimentações anteriores a esta data não alteram o saldo." required />
      <Chk f={f} name="spendable" label="Dinheiro livre para gastar" hint="Desmarque para poupança/reserva: o saldo aparece no total, mas não conta como disponível." />
      {account && <Chk f={f} name="archived" label="Arquivada (oculta das listas e somas)" />}
    </FormModal>
  );
}

function MovementForm({ account, onClose, movement }) {
  const { today, refresh, notify } = useApp();
  const f = useForm(movement ? { amount: Math.abs(movement.amount), date: movement.date, description: movement.description || '' } : { direction: 'in', amount: 0, date: today, description: '' });
  return (
    <FormModal title={movement ? 'Corrigir movimentação' : `Registrar movimentação — ${account.name}`} onClose={onClose}
      onSubmit={async () => { movement ? await put(`/api/movements/${movement.id}`, f.v) : await post(`/api/accounts/${account.id}/movements`, f.v); notify('Movimentação salva.'); refresh(); }}>
      {!movement && <Sel f={f} name="direction" label="Tipo" options={[{ value: 'in', label: 'Entrada' }, { value: 'out', label: 'Saída' }]} />}
      <Money f={f} name="amount" label="Valor" required />
      <Txt f={f} name="date" type="date" label="Data" required />
      <Txt f={f} name="description" label="Descrição" className="full" required />
      <div className="full muted">Entradas e saídas avulsas ajustam o saldo da conta, mas não entram em receitas nem despesas. Para isso, use os módulos Receitas e Despesas.{movement && ' A correção fica registrada no histórico de alterações.'}</div>
    </FormModal>
  );
}

function TransferForm({ onClose, from }) {
  const { accounts, today, refresh, notify } = useApp();
  const opts = accountOptions(accounts);
  const f = useForm({ from_account_id: from || opts[0]?.value || '', to_account_id: '', amount: 0, date: today, description: '' });
  return (
    <FormModal title="Transferir entre contas" onClose={onClose}
      onSubmit={async () => { await post('/api/transfers', f.v); notify('Transferência registrada.'); refresh(); }}>
      <Sel f={f} name="from_account_id" label="Conta de origem" options={opts} required />
      <Sel f={f} name="to_account_id" label="Conta de destino" options={opts.filter((o) => String(o.value) !== String(f.v.from_account_id))} empty="Selecione…" required />
      <Money f={f} name="amount" label="Valor" required />
      <Txt f={f} name="date" type="date" label="Data" required />
      <Txt f={f} name="description" label="Descrição (opcional)" className="full" />
      <div className="full muted">Transferências entre suas contas não são receitas nem despesas.</div>
    </FormModal>
  );
}

const KIND = { entry: 'Lançamento', manual: 'Avulsa', transfer: 'Transferência', withdrawal: 'Retirada' };

export default function Accounts() {
  const { accounts, refresh, notify, confirm } = useApp();
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  const { data: dash } = useFetch(() => get('/api/dashboard'), []);
  const active = accounts.filter((a) => !a.archived);
  const account = accounts.find((a) => a.id === sel) || active[0];
  const { data: movs, error } = useFetch(() => (account ? get(`/api/accounts/${account.id}/movements`) : Promise.resolve([])), [account?.id]);

  const delMov = async (m) => {
    const isT = m.kind === 'transfer';
    if (!(await confirm({ title: 'Excluir movimentação', message: `${isT ? 'Excluir esta transferência (as duas pontas)?' : `Excluir "${m.description}"?`} O saldo será ajustado.`, danger: true, okLabel: 'Excluir' }))) return;
    try { isT ? await del(`/api/transfers/${m.transfer_id}`) : await del(`/api/movements/${m.id}`); notify('Excluída.'); refresh(); } catch (x) { notify(x.message, true); }
  };
  const delAcc = async (a) => {
    if (!(await confirm({ title: 'Excluir conta', message: `Excluir a conta "${a.name}"? Só é possível se ela não tiver histórico.`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/accounts/${a.id}`); notify('Conta excluída.'); setSel(null); refresh(); } catch (x) { notify(x.message, true); }
  };
  let running = account ? account.balance : 0;
  return (
    <div>
      <PageHead title="Contas e movimentações" sub="Cada conta tem seu saldo. Saldo bancário, dinheiro reservado e dinheiro livre são coisas diferentes.">
        <button className="btn" onClick={() => setModal({ t: 'transfer' })} disabled={active.length < 2}>Transferir</button>
        <button className="btn primary" onClick={() => setModal({ t: 'account' })}>Nova conta</button>
      </PageHead>
      {dash && (
        <div className="grid-stats">
          <Stat label="Saldo consolidado" value={brl(dash.totalBalance)} sub="Soma de todas as contas ativas" />
          <Stat label="Em contas gastáveis" value={brl(dash.spendable)} />
          <Stat label="Reservado (marcado)" value={brl(dash.reserved)} sub="Continua dentro das contas" />
          <Stat label="Livre para gastar" value={brl(dash.available)} tone={dash.available < 0 ? 'neg' : ''} />
        </div>
      )}
      {active.length === 0 ? (
        <Card><Empty action={<button className="btn primary" onClick={() => setModal({ t: 'account' })}>Cadastrar conta</button>}>Nenhuma conta cadastrada. Informe o saldo real de cada lugar onde você guarda dinheiro.</Empty></Card>
      ) : (
        <>
          <div className="acct-grid">
            {active.map((a) => (
              <button key={a.id} className={`acct${account?.id === a.id ? ' on' : ''}`} onClick={() => setSel(a.id)}>
                <div className="name">{a.name}</div>
                <div className="muted">{ACCOUNT_TYPES.find((t) => t.value === a.type)?.label}{!a.spendable && ' · não gastável'}</div>
                <div className={`bal ${a.balance < 0 ? 'neg' : ''}`}>{brl(a.balance)}</div>
              </button>
            ))}
          </div>
          {account && (
            <Card title={`Histórico — ${account.name}`} action={
              <div className="actions">
                <button className="btn sm" onClick={() => setModal({ t: 'mov' })}>Entrada/saída avulsa</button>
                <button className="btn sm" onClick={() => setModal({ t: 'account', account })}>Editar conta</button>
                <button className="btn sm ghost" onClick={() => delAcc(account)}>Excluir</button>
              </div>}>
              <p className="muted" style={{ marginBottom: 10 }}>Saldo inicial {brl(account.initial_balance)} em {dateBR(account.ref_date)}.</p>
              <ErrorBox error={error} />
              {!movs ? <Loading /> : movs.length === 0 ? <Empty>Sem movimentações. Elas surgem ao confirmar pagamentos/recebimentos, transferir ou registrar entradas e saídas.</Empty> : (
                <div className="tbl-wrap"><table className="tbl">
                  <thead><tr><th>Data</th><th>Descrição</th><th>Origem</th><th className="num">Valor</th><th className="num">Saldo após</th><th></th></tr></thead>
                  <tbody>
                    {movs.map((m) => {
                      const after = running; running -= m.date >= account.ref_date ? m.amount : 0;
                      return (
                        <tr key={m.id}>
                          <td>{dateBR(m.date)}{m.date < account.ref_date && <span className="sub">antes da referência: não altera saldo</span>}</td>
                          <td>{m.description || m.entry_description}</td><td><Badge>{KIND[m.kind]}</Badge></td>
                          <td className={`num ${m.amount > 0 ? 'pos' : ''}`}>{m.amount > 0 ? '+' : ''}{brl(m.amount)}</td><td className="num">{brl(after)}</td>
                          <td className="row-actions">
                            {(m.kind === 'manual' || m.kind === 'withdrawal') && <button className="btn sm ghost" onClick={() => setModal({ t: 'mov', movement: m })}>Corrigir</button>}
                            {m.kind !== 'entry' && <button className="btn sm ghost" onClick={() => delMov(m)}>Excluir</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              )}
            </Card>
          )}
        </>
      )}
      {modal?.t === 'account' && <AccountForm account={modal.account} onClose={() => setModal(null)} />}
      {modal?.t === 'mov' && <MovementForm account={account} movement={modal.movement} onClose={() => setModal(null)} />}
      {modal?.t === 'transfer' && <TransferForm from={account?.id} onClose={() => setModal(null)} />}
    </div>
  );
}
