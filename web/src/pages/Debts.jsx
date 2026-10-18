import { useState, Fragment } from 'react';
import { get, post, put, del } from '../api.js';
import { useApp, useFetch, Card, Stat, PageHead, Badge, Empty, ErrorBox, Loading, FormModal, useForm, Txt, Num, Money, Sel, Area, Progress, accountOptions, categoryOptions } from '../ui.jsx';
import { BarChart, COLORS } from '../charts.jsx';
import { brl, dateBR, monthShort } from '../fmt.js';
import { PayModal } from './Entries.jsx';

function DebtForm({ debt, onClose }) {
  const { accounts, categories, today, refresh, notify } = useApp();
  const f = useForm(debt || { description: '', creditor: '', kind: 'compra', installment_amount: 0, installments_total: 12, first_due_date: today, total_amount: 0, paid_installments: 0, interest_rate: '', account_id: '', category_id: '', notes: '' });
  const n = Number(f.v.installments_total) || 0;
  const sumInst = f.v.installment_amount * n;
  return (
    <FormModal title={debt ? 'Editar dívida' : 'Nova dívida ou parcelamento'} wide onClose={onClose}
      onSubmit={async () => {
        const b = { ...f.v, account_id: f.v.account_id || null, category_id: f.v.category_id || null, total_amount: f.v.total_amount || undefined, installments_total: n };
        debt ? await put(`/api/debts/${debt.id}`, b) : await post('/api/debts', b);
        notify('Dívida salva.'); refresh();
      }}>
      <Txt f={f} name="description" label="Descrição" className="full" maxLength={120} required />
      <Txt f={f} name="creditor" label="Credor" maxLength={80} />
      {!debt && <Sel f={f} name="kind" label="Tipo" options={[{ value: 'compra', label: 'Compra parcelada' }, { value: 'emprestimo', label: 'Empréstimo / financiamento' }, { value: 'outro', label: 'Outra dívida' }]} />}
      {!debt && <>
        <Money f={f} name="installment_amount" label="Valor da parcela" required />
        <Num f={f} name="installments_total" label="Quantidade de parcelas" min="1" max="480" required />
        <Txt f={f} name="first_due_date" type="date" label="Primeiro vencimento" required />
        <Num f={f} name="paid_installments" label="Parcelas já pagas antes do cadastro" min="0" hint="Marcadas como pagas sem alterar nenhum saldo." />
        <Money f={f} name="total_amount" label="Valor total (opcional)" hint={`Se vazio: ${brl(sumInst)} (parcela × quantidade).`} />
        <Sel f={f} name="account_id" label="Conta de pagamento" options={accountOptions(accounts)} empty="Definir ao pagar" />
        <Sel f={f} name="category_id" label="Categoria" options={categoryOptions(categories, 'expense')} empty="Dívidas (padrão)" />
      </>}
      <Txt f={f} name="interest_rate" label="Juros informados (opcional)" hint="Apenas para consulta; o sistema não calcula nem inventa taxas." maxLength={30} />
      {debt && <Sel f={f} name="status" label="Situação" options={[{ value: 'active', label: 'Ativa' }, { value: 'paid', label: 'Quitada' }, { value: 'cancelled', label: 'Cancelada' }]} />}
      <Area f={f} name="notes" label="Observações" />
    </FormModal>
  );
}

function PayoffModal({ debt, onClose }) {
  const { accounts, today, refresh, notify } = useApp();
  const f = useForm({ offer: debt.owed, account_id: accounts.find((a) => !a.archived)?.id || '', paid_date: today });
  const [sim, setSim] = useState(null);
  const run = async () => setSim(await post(`/api/debts/${debt.id}/simulate`, { offer: f.v.offer }));
  return (
    <FormModal title={`Quitar — ${debt.description}`} onClose={onClose} submitLabel="Quitar agora" danger
      onSubmit={async () => { await post(`/api/debts/${debt.id}/payoff`, { amount: f.v.offer, account_id: f.v.account_id, paid_date: f.v.paid_date }); notify('Dívida quitada.'); refresh(); }}>
      <div className="full kv"><span>Ainda devido ({debt.pendingCount} parcelas)</span><span>{brl(debt.owed)}</span></div>
      <Money f={f} name="offer" label="Valor da quitação" hint="Informe o valor real proposto pelo credor (com desconto, se houver)." required />
      <Sel f={f} name="account_id" label="Pagar com a conta" options={accountOptions(accounts)} empty="Selecione…" required />
      <Txt f={f} name="paid_date" type="date" label="Data" required />
      <div className="full"><button type="button" className="btn" onClick={run}>Simular efeito</button></div>
      {sim && <div className="full alert">
        Economia sobre o devido: <strong>{brl(sim.saving)}</strong><br />Disponível para gastar: {brl(sim.availableBefore)} → <strong className={sim.availableAfter < 0 ? 'neg' : ''}>{brl(sim.availableAfter)}</strong>
        <br /><small>{sim.note}</small>
      </div>}
      <div className="full muted">Ao confirmar, as parcelas pendentes são substituídas por um único pagamento e o saldo da conta é reduzido.</div>
    </FormModal>
  );
}

export default function Debts() {
  const { refresh, notify, confirm } = useApp();
  const [modal, setModal] = useState(null);
  const [open, setOpen] = useState(null);
  const { data, error } = useFetch(() => get('/api/debts'), []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const remove = async (d) => {
    if (!(await confirm({ title: 'Excluir dívida', message: `Excluir "${d.description}" e suas parcelas pendentes?`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/debts/${d.id}`); notify('Excluída.'); refresh(); } catch (x) { notify(x.message, true); }
  };
  const unpay = async (id) => { try { await post(`/api/entries/${id}/unpay`); notify('Pagamento desfeito.'); refresh(); } catch (x) { notify(x.message, true); } };
  const commit = data.commitment.slice(0, 6);
  const share = (v) => (data.avgIncome ? `${Math.round((v / data.avgIncome) * 1000) / 10}% da renda média` : 'sem renda média para comparar');
  return (
    <div className="stack">
      <PageHead title="Dívidas e parcelamentos" sub="Compras parceladas, empréstimos e outras dívidas. Cada parcela é uma despesa pendente até você pagá-la.">
        <button className="btn primary" onClick={() => setModal({ t: 'form' })}>Nova dívida</button>
      </PageHead>
      <div className="grid-stats">
        <Stat label="Total ainda devido" value={brl(data.totals.owed)} />
        <Stat label="Parcelas pendentes" value={data.totals.pendingCount} />
        <Stat label="Comprometimento este mês" value={brl(commit[0]?.amount || 0)} sub={share(commit[0]?.amount || 0)} />
      </div>
      <Card title="Comprometimento dos próximos meses">
        <BarChart data={commit.map((c) => ({ label: monthShort(c.month), values: [c.amount] }))} series={[{ name: 'Parcelas a pagar', color: COLORS.slate }]} height={180} />
      </Card>
      {data.items.length === 0 ? <Card><Empty>Nenhuma dívida cadastrada.</Empty></Card> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Descrição</th><th>Credor</th><th className="num">Parcela</th><th>Progresso</th><th className="num">Devido</th><th>Próxima</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data.items.map((d) => (
              <Fragment key={d.id}>
                <tr>
                  <td>{d.description}{d.interest_rate && <span className="sub">juros informados: {d.interest_rate}</span>}{d.difference !== 0 && <span className="sub" title="Diferença entre soma das parcelas e valor total informado. Pode ser juros/encargos; o sistema não calcula taxa.">Parcelas somam {brl(d.installment_amount * d.installments_total)} · total informado {brl(d.total_amount)}</span>}</td>
                  <td>{d.creditor || '—'}{d.card_name && <span className="sub">cartão {d.card_name}</span>}</td><td className="num">{brl(d.installment_amount)}</td>
                  <td style={{ minWidth: 130 }}>{d.paidCount}/{d.installments_total}<Progress pct={(d.paidCount / d.installments_total) * 100} /></td>
                  <td className="num">{brl(d.owed)}</td><td>{d.next ? dateBR(d.next.due_date) : '—'}</td>
                  <td><Badge tone={d.status === 'paid' ? 'ok' : d.status === 'cancelled' ? 'neutral' : 'warn'}>{{ active: 'Ativa', paid: 'Quitada', cancelled: 'Cancelada' }[d.status]}</Badge></td>
                  <td className="row-actions">
                    {d.pendingCount > 0 && <button className="btn sm" onClick={() => setModal({ t: 'payoff', d })}>Quitar / simular</button>}
                    <button className="btn sm ghost" onClick={() => setOpen(open === d.id ? null : d.id)}>Parcelas</button>
                    <button className="btn sm ghost" onClick={() => setModal({ t: 'form', d })}>Editar</button>
                    <button className="btn sm ghost" onClick={() => remove(d)}>Excluir</button>
                  </td>
                </tr>
                {open === d.id && (
                  <tr><td colSpan={8} style={{ background: 'var(--panel)' }}>
                    <table className="tbl"><thead><tr><th>Parcela</th><th>Vencimento</th><th>Pagamento</th><th className="num">Valor</th><th></th></tr></thead>
                      <tbody>{d.installments.map((i) => (
                        <tr key={i.id}><td>{i.no === 9999 ? 'Quitação' : i.no}</td><td>{dateBR(i.due_date)}</td><td>{dateBR(i.paid_date)}</td><td className="num">{brl(i.amount)}</td>
                          <td className="row-actions">{i.status === 'paid' ? <button className="btn sm ghost" onClick={() => unpay(i.id)}>Desfazer</button> : <button className="btn sm" onClick={() => setModal({ t: 'pay', e: { id: i.id, type: 'expense', description: `${d.description} (${i.no}/${d.installments_total})`, amount: i.amount, account_id: d.account_id } })}>Pagar (inclui antecipado)</button>}</td></tr>
                      ))}</tbody></table>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table></div>
      )}
      {modal?.t === 'form' && <DebtForm debt={modal.d} onClose={() => setModal(null)} />}
      {modal?.t === 'payoff' && <PayoffModal debt={modal.d} onClose={() => setModal(null)} />}
      {modal?.t === 'pay' && <PayModal entry={modal.e} onClose={() => setModal(null)} />}
    </div>
  );
}
