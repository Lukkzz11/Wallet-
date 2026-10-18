import { useState } from 'react';
import { get, post, put, del } from '../api.js';
import { useApp, useFetch, Card, Stat, Badge, Empty, ErrorBox, Loading, Field, MoneyInput, FormModal, useForm, Txt, Num, Money, Area } from '../ui.jsx';
import { brl, dateBR, addDaysStr, addMonthKey, monthShort } from '../fmt.js';
import { PayModal, EntryForm } from './Entries.jsx';

const sum = (l, f = () => true) => l.filter(f).reduce((t, r) => t + r.amount, 0);

/* ---------- calculadora rápida: gastos do dia ---------- */
export function QuickExpense() {
  const { accounts, categories, today, refresh, notify, confirm } = useApp();
  const spend = accounts.filter((a) => !a.archived && a.type !== 'fgts');
  const cats = categories.filter((c) => c.kind === 'expense');
  const [f, setF] = useState({ description: '', amount: 0, category_id: '', date: today, account_id: spend[0]?.id || '' });
  const [all, setAll] = useState(false);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');
  const { data: rows, error } = useFetch(() => get('/api/expenses/list', { from: addDaysStr(today, -45), to: addDaysStr(today, 1), status: 'paid' }), []);
  const { data: dash } = useFetch(() => get('/api/dashboard'), []);
  const save = async (e) => {
    e?.preventDefault();
    setErr('');
    if (!f.account_id) return setErr('Cadastre uma conta em "Quanto eu tenho hoje" para descontar o gasto.');
    try {
      await post('/api/expenses/list', { description: f.description, amount: f.amount, due_date: f.date, status: 'paid', paid_date: f.date, account_id: f.account_id, category_id: f.category_id || null, nature: 'avista' });
      setF({ ...f, description: '', amount: 0 }); notify('Gasto salvo; saldo atualizado.'); refresh();
    } catch (x) { setErr(x.message); }
  };
  const remove = async (r) => {
    if (!(await confirm({ title: 'Excluir gasto', message: `Excluir "${r.description}" (${brl(r.amount)})? O valor volta para o saldo da conta.`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/entries/${r.id}`, { scope: 'one' }); notify('Gasto excluído.'); refresh(); } catch (x) { notify(x.message, true); }
  };
  const list = (rows || []).filter((r) => all || (!r.debt_id && !r.subscription_id && !r.card_id && !r.recurrence_id)).sort((a, b) => (b.paid_date || b.due_date).localeCompare(a.paid_date || a.due_date) || b.id - a.id);
  const todayTotal = sum(rows || [], (r) => r.paid_date === today);
  return (
    <>
      <div className="grid-stats">
        <Stat label="Gastos de hoje" value={brl(todayTotal)} sub="Tudo o que foi pago hoje" />
        <Stat label="Gastos do mês" value={brl(dash?.paid ?? 0)} />
        <Stat label="Saldo livre agora" value={brl(dash?.available ?? 0)} tone={(dash?.available ?? 0) < 0 ? 'neg' : ''} sub="Atualiza ao salvar" />
      </div>
      <Card title="Calculadora rápida: o que gastei">
        <form onSubmit={save} className="filters">
          <Field label="Descrição"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex.: Almoço, Uber" maxLength={120} /></Field>
          <Field label="Valor"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Field label="Categoria"><select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}><option value="">Sem categoria</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Data"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          {spend.length > 1 && <Field label="Pago com"><select value={f.account_id} onChange={(e) => setF({ ...f, account_id: Number(e.target.value) })}>{spend.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
          <button type="submit" className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={!f.description.trim() || !f.amount}>Salvar gasto</button>
        </form>
        <ErrorBox error={err} />
        <p className="muted">O valor sai da conta na data informada. Para corrigir ou apagar, use os botões da lista abaixo.</p>
      </Card>
      <Card title="Meus lançamentos (últimos 45 dias)" action={<label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>Incluir contas, parcelas e assinaturas</span></label>}>
        <ErrorBox error={error} />
        {!rows ? <Loading /> : list.length === 0 ? <Empty>Nenhum gasto registrado nos últimos 45 dias.</Empty> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th className="num">Valor</th><th></th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id}><td>{dateBR(r.paid_date || r.due_date)}</td><td>{r.description}</td><td>{r.category_name || '—'}</td><td>{r.account_name || '—'}</td><td className="num">{brl(r.amount)}</td>
                <td className="row-actions"><button className="btn sm" onClick={() => setEdit(r)}>Editar</button><button className="btn sm ghost" onClick={() => remove(r)}>Excluir</button></td></tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={4}>Total listado</td><td className="num">{brl(sum(list))}</td><td /></tr></tfoot>
          </table></div>
        )}
      </Card>
      {edit && <EntryForm kind="expense" entry={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

/* ---------- Casa: parcelas da casa, separadas das demais despesas ---------- */
function shiftDate(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const k = addMonthKey(`${y}-${String(m).padStart(2, '0')}`, n);
  const [ny, nm] = k.split('-').map(Number);
  return `${k}-${String(Math.min(d, new Date(Date.UTC(ny, nm, 0)).getUTCDate())).padStart(2, '0')}`;
}

function HouseEdit({ house, onClose }) {
  const { refresh, notify } = useApp();
  const f = useForm({ description: house.description, notes: house.notes || '', creditor: house.creditor || '' });
  return (
    <FormModal title="Editar dados da casa" onClose={onClose}
      onSubmit={async () => { await put(`/api/debts/${house.id}`, { ...f.v, status: house.status }); notify('Salvo.'); refresh(); }}>
      <Txt f={f} name="description" label="Descrição" className="full" required />
      <Txt f={f} name="creditor" label="Banco / credor" className="full" />
      <Area f={f} name="notes" label="Observações" />
    </FormModal>
  );
}

function LoanForm({ loan, onClose, inline }) {
  const { today, refresh, notify } = useApp();
  const f = useForm(loan ? {
    description: loan.description, financed: loan.financed, balance: loan.balance, total_months: loan.paid_months + loan.remaining_months, remaining_months: loan.remaining_months,
    nominal_rate: loan.nominal_rate ?? '', payment: loan.payment, next_due: loan.next_due || today, note: '',
  } : { description: 'Financiamento da casa', financed: 0, balance: 0, total_months: 360, remaining_months: 360, nominal_rate: '', payment: 0, next_due: today, note: '' });
  const v = f.v;
  const total = Number(v.total_months) || 0, rest = Math.min(Number(v.remaining_months) || 0, total);
  return (
    <FormModal title={loan ? 'Atualizar dados do financiamento' : 'Cadastrar financiamento da casa'} wide inline={inline} onClose={onClose}
      onSubmit={async () => {
        const body = { ...v, nominal_rate: v.nominal_rate === '' ? null : Number(v.nominal_rate) };
        loan ? await put(`/api/house-loans/${loan.id}`, body) : await post('/api/house-loans', body);
        notify(loan ? 'Financiamento atualizado.' : 'Financiamento cadastrado.'); refresh();
      }}>
      <Txt f={f} name="description" label="Descrição" className="full" maxLength={120} />
      <Money f={f} name="balance" label="Saldo devedor atual" hint="Digite o valor que consta no extrato/app do banco." />
      <Money f={f} name="financed" label="Valor financiado originalmente" />
      <Num f={f} name="total_months" label="Prazo total (meses)" min="1" max="600" />
      <Num f={f} name="remaining_months" label="Meses restantes" min="0" max="600" required />
      <Txt f={f} name="nominal_rate" type="number" step="0.01" min="0" label="Juros nominais vigentes (% ao ano)" hint="Só para consulta. O Wallet não recalcula o saldo com ele." />
      <Money f={f} name="payment" label="Valor da parcela mensal" required />
      <Txt f={f} name="next_due" type="date" label="Vencimento da próxima parcela" required />
      {loan && <Txt f={f} name="note" label="Observação desta atualização (opcional)" className="full" maxLength={200} />}
      <div className="full alert">
        {v.payment > 0 && rest >= 0 ? <>Faltam <strong>{rest}</strong> parcela(s) de <strong>{brl(v.payment)}</strong> (soma {brl(v.payment * rest)}), a partir de {dateBR(v.next_due)}. {!loan && total > rest && `As ${total - rest} primeiras ficam como pagas, sem mexer no saldo das contas.`} {loan && 'As parcelas já pagas são mantidas; só as pendentes são refeitas.'}</> : 'Preencha parcela e meses restantes.'}
      </div>
    </FormModal>
  );
}

function Installments({ h, onPay, onUnpay }) {
  const { today, refresh, notify, confirm } = useApp();
  const already = async (i) => {
    if (!(await confirm({ title: 'Já estava paga', message: `Marcar a parcela ${i.no} (${brl(i.amount)}, vence ${dateBR(i.due_date)}) como paga SEM mexer no saldo das contas. Use quando o pagamento já foi feito e o saldo informado já reflete isso.`, okLabel: 'Marcar como paga' }))) return;
    try { await post(`/api/entries/${i.id}/mark-prepaid`, { paid_date: i.due_date }); notify('Parcela marcada como paga.'); refresh(); } catch (x) { notify(x.message, true); }
  };
  const [all, setAll] = useState(false);
  const pending = h.installments.filter((i) => i.status === 'pending');
  const done = h.installments.filter((i) => i.status === 'paid');
  const shown = all ? pending : pending.slice(0, 6);
  const status = (i) => (i.due_date < today ? ['danger', 'Pendente (atrasada)'] : ['neutral', 'Pendente']);
  return (
    <>
      <h3 style={{ margin: '14px 0 8px' }}>Próximos vencimentos</h3>
      {shown.length === 0 ? <Empty>Nenhuma parcela pendente.</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><tbody>{shown.map((i) => (
          <tr key={i.id}><td>Parcela {i.no}</td><td>{dateBR(i.due_date)}</td><td className="num">{brl(i.amount)}</td><td><Badge tone={status(i)[0]}>{status(i)[1]}</Badge></td>
            <td className="row-actions"><button className="btn sm primary" onClick={() => onPay(i)}>Marcar como paga</button><button className="btn sm" title="Marca como paga sem alterar o saldo das contas" onClick={() => already(i)}>Já estava paga</button></td></tr>
        ))}</tbody></table></div>
      )}
      {pending.length > 6 && <button className="link" onClick={() => setAll(!all)}>{all ? 'Mostrar menos' : `Ver todas as ${pending.length} pendentes`}</button>}
      <h3 style={{ margin: '14px 0 8px' }}>Histórico de pagamentos ({done.length})</h3>
      {done.length === 0 ? <p className="muted">Nenhuma parcela paga ainda.</p> : (
        <div className="tbl-wrap" style={{ maxHeight: 240, overflow: 'auto' }}><table className="tbl"><tbody>{done.slice().reverse().map((i) => (
          <tr key={i.id}><td>Parcela {i.no}</td><td>Venc. {dateBR(i.due_date)}</td><td>Paga em {dateBR(i.paid_date)}</td><td className="num">{brl(i.amount)}</td><td><Badge tone="ok">Paga</Badge></td>
            <td className="row-actions"><button className="btn sm ghost" onClick={() => onUnpay(i.id)}>Desfazer</button></td></tr>
        ))}</tbody></table></div>
      )}
    </>
  );
}

export function House() {
  const { refresh, notify, confirm } = useApp();
  const { data: debts, error } = useFetch(() => get('/api/debts'), []);
  const { data: loans, error: e2 } = useFetch(() => get('/api/house-loans'), []);
  const [k, setK] = useState(0);
  const [pay, setPay] = useState(null);
  const [edit, setEdit] = useState(null);
  const [loanEdit, setLoanEdit] = useState(null);
  if (error || e2) return <ErrorBox error={error || e2} />;
  if (!debts || !loans) return <Loading />;
  const linked = new Set(loans.map((l) => l.debt_id));
  const legacy = debts.items.filter((d) => d.kind === 'casa' && !linked.has(d.id));
  const unpay = async (id) => {
    if (!(await confirm({ title: 'Desfazer pagamento', message: 'A parcela volta para pendente e o valor volta para a conta.', okLabel: 'Desfazer' }))) return;
    try { await post(`/api/entries/${id}/unpay`); refresh(); } catch (x) { notify(x.message, true); }
  };
  const removeLoan = async (l) => {
    if (!(await confirm({ title: 'Excluir financiamento', message: `Excluir "${l.description}" e suas parcelas? Só é possível se nenhuma parcela tiver sido paga pelo Wallet.`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/house-loans/${l.id}`); notify('Excluído.'); refresh(); } catch (x) { notify(x.message, true); }
  };
  const removeDebt = async (h) => {
    if (!(await confirm({ title: 'Excluir parcelas da casa', message: `Excluir "${h.description}" e todas as parcelas?`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/debts/${h.id}`); notify('Excluído.'); refresh(); } catch (x) { notify(x.message, true); }
  };
  const payFor = (h) => (i) => setPay({ id: i.id, type: 'expense', description: `${h.description} (${i.no}/${h.installments_total})`, amount: i.amount, account_id: h.account_id });
  return (
    <>
      {loans.length === 0 && legacy.length === 0 && <Card><p className="muted">Cadastre o financiamento da casa com os dados do contrato. Você atualiza depois, conforme for pagando.</p></Card>}
      {loans.map((l) => {
        const h = debts.items.find((d) => d.id === l.debt_id);
        return (
          <Card key={l.id} title={<>{l.description} {l.remaining_months === 0 && <Badge tone="ok">Quitado</Badge>}</>} action={<div className="actions"><button className="btn sm primary" onClick={() => setLoanEdit(l)}>Atualizar dados</button><button className="btn sm ghost" onClick={() => removeLoan(l)}>Excluir</button></div>}>
            <div className="grid-stats">
              <Stat label="Saldo devedor (informado)" value={l.balance ? brl(l.balance) : '—'} sub={l.balance ? `Atualizado em ${dateBR(l.balance_date)}` : 'Não informado'} />
              <Stat label="Valor mensal" value={brl(l.payment)} sub={l.next_due ? `Próxima em ${dateBR(l.next_due)}` : undefined} />
              <Stat label="Prazo restante" value={`${l.remaining_months} meses`} sub={l.end_date ? `Termina em ${monthShort(l.end_date.slice(0, 7))} · ${l.paid_months} pagas de ${l.paid_months + l.remaining_months}` : undefined} />
              <Stat label="Juros nominais" value={l.nominal_rate != null ? `${String(l.nominal_rate).replace('.', ',')}% ao ano` : '—'} sub="Informado por você" />
              <Stat label="Valor financiado" value={l.financed ? brl(l.financed) : '—'} sub={l.amortized_pct != null ? `≈ ${String(l.amortized_pct).replace('.', ',')}% já amortizado (estimativa)` : undefined} />
            </div>
            {l.paid_since_update > 0 && <div className="alert warn" style={{ marginBottom: 10 }}>Você marcou {l.paid_since_update} parcela(s) como paga(s) desde a última atualização. O saldo devedor acima ainda é o antigo: use <strong>Atualizar dados</strong> com o valor do extrato do banco.</div>}
            <p className="muted">O saldo devedor é o valor que você informou; o Wallet <strong>não</strong> o calcula com os juros nominais, pois isso depende do contrato e do sistema de amortização. As parcelas restantes somam {brl(l.remaining_sum)}{l.remaining_vs_balance != null && <> ({l.remaining_vs_balance >= 0 ? `${brl(l.remaining_vs_balance)} acima do saldo devedor` : `${brl(-l.remaining_vs_balance)} abaixo do saldo devedor`}: <em>estimativa</em> de juros, seguros e taxas ainda a pagar, ou de reajustes — não é um cálculo do contrato)</>}.</p>
            {h && <Installments h={h} onPay={payFor(h)} onUnpay={unpay} />}
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer' }}>Histórico de atualizações ({l.history.length})</summary>
              <div className="tbl-wrap" style={{ marginTop: 8 }}><table className="tbl">
                <thead><tr><th>Data</th><th className="num">Saldo devedor</th><th className="num">Meses restantes</th><th className="num">Parcela</th><th>Juros a.a.</th><th>Obs.</th></tr></thead>
                <tbody>{l.history.map((u) => <tr key={u.id}><td>{dateBR(u.date)}</td><td className="num">{u.balance ? brl(u.balance) : '—'}</td><td className="num">{u.remaining_months}</td><td className="num">{brl(u.payment)}</td><td>{u.nominal_rate != null ? `${String(u.nominal_rate).replace('.', ',')}%` : '—'}</td><td>{u.note || ''}</td></tr>)}</tbody>
              </table></div>
            </details>
          </Card>
        );
      })}
      {legacy.map((h) => (
        <Card key={h.id} title={<>{h.description} <Badge>parcelas simples</Badge></>} action={<div className="actions"><button className="btn sm" onClick={() => setEdit(h)}>Editar</button><button className="btn sm ghost" onClick={() => removeDebt(h)}>Excluir</button></div>}>
          <div className="grid-stats">
            <Stat label="Valor da parcela" value={brl(h.installment_amount)} />
            <Stat label="Pagas / restantes" value={`${h.paidCount} / ${h.pendingCount}`} sub={`de ${h.installments_total} parcelas`} />
            <Stat label="Ainda a pagar" value={brl(h.owed)} />
            <Stat label="Próximo vencimento" value={h.next ? dateBR(h.next.due_date) : '—'} />
          </div>
          <Installments h={h} onPay={payFor(h)} onUnpay={unpay} />
        </Card>
      ))}
      <LoanForm key={k} inline onClose={() => setK(k + 1)} />
      {pay && <PayModal entry={pay} onClose={() => setPay(null)} />}
      {edit && <HouseEdit house={edit} onClose={() => setEdit(null)} />}
      {loanEdit && <LoanForm loan={loanEdit} onClose={() => setLoanEdit(null)} />}
    </>
  );
}
