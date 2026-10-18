import { useState } from 'react';
import { get, post, put, del } from '../api.js';
import {
  useApp, useFetch, Card, Stat, PageHead, Badge, Empty, ErrorBox, Loading, FormModal, MonthPicker, StatusBadge, Tabs,
  useForm, Txt, Money, Sel, Area, Chk, Num, accountOptions, categoryOptions,
} from '../ui.jsx';
import { brl, dateBR, PAYMENT_METHODS, PERIOD_LABEL, monthEnd } from '../fmt.js';

const T = {
  income: { list: '/api/incomes/list', title: 'Receitas', one: 'receita', new: 'Nova receita', done: 'Recebida', doAction: 'Receber', paidDate: 'Data de recebimento', dueLabel: 'Data prevista / de recebimento', origin: 'Origem', total: 'Recebido', open: 'A receber' },
  expense: { list: '/api/expenses/list', title: 'Despesas', one: 'despesa', new: 'Nova despesa', done: 'Paga', doAction: 'Pagar', paidDate: 'Data de pagamento', dueLabel: 'Data de vencimento', origin: 'Credor / local', total: 'Pago', open: 'Em aberto' },
};

export function PayModal({ entry, onClose }) {
  const { accounts, today, refresh, notify } = useApp();
  const income = entry.type === 'income';
  const f = useForm({ account_id: entry.account_id || accounts.find((a) => !a.archived)?.id || '', paid_date: today, already_paid: false });
  return (
    <FormModal title={income ? 'Confirmar recebimento' : 'Confirmar pagamento'} onClose={onClose} submitLabel={income ? 'Confirmar recebimento' : 'Confirmar pagamento'}
      onSubmit={async () => {
        if (!income && f.v.already_paid) {
          await post(`/api/entries/${entry.id}/mark-prepaid`, { paid_date: f.v.paid_date });
          notify('Marcado como já pago (sem debitar da conta).');
        } else {
          await post(`/api/entries/${entry.id}/pay`, { account_id: f.v.account_id, paid_date: f.v.paid_date });
          notify('Saldo atualizado.');
        }
        refresh();
      }}>
      <div className="full alert">
        <strong>{entry.description}</strong> — {brl(entry.amount)}<br />
        {f.v.already_paid ? 'O lançamento será marcado como quitado sem descontar do seu saldo disponível.' : `Ao confirmar, será criada uma movimentação de ${income ? 'entrada' : 'saída'} na conta escolhida. Isso acontece uma única vez.`}
      </div>
      {!income && (
        <div className="full" style={{ marginBottom: 8 }}>
          <Chk f={f} name="already_paid" label="Já foi pago anteriormente (não debitar do saldo atual)" hint="Marque caso esta despesa já tenha sido quitada antes/fora da conta." />
        </div>
      )}
      {(!f.v.already_paid || income) && (
        <Sel f={f} name="account_id" label={income ? 'Conta de destino' : 'Conta utilizada'} options={accountOptions(accounts)} empty="Selecione…" required={!f.v.already_paid} />
      )}
      <Txt f={f} name="paid_date" type="date" label={income ? 'Data de recebimento' : 'Data de pagamento'} required />
    </FormModal>
  );
}

export function isFinanciamentoExpense(e) {
  if (!e || e.type !== 'expense') return false;
  if (e.nature === 'financiamento') return true;
  const d = (e.description || '').toLowerCase();
  const c = (e.category_name || '').toLowerCase();
  const o = (e.origin || '').toLowerCase();
  const n = (e.notes || '').toLowerCase();
  if (c.includes('financiamento')) return true;
  if (d.includes('financiamento') || d.includes('parcela da casa') || d.includes('parcela casa') || d.includes('caixa habitação') || d.includes('habitacional')) return true;
  if (o.includes('financiamento') || o.includes('habitação') || o.includes('caixa')) return true;
  if (n.includes('financiamento') || n.includes('casa')) return true;
  return false;
}

export function EntryForm({ kind, entry, onClose }) {
  const { accounts, categories, today, refresh, notify } = useApp();
  const t = T[kind];
  const editing = !!entry;
  const defaultGroup = entry ? (isFinanciamentoExpense(entry) ? 'financiamento' : 'pf') : 'pf';
  const f = useForm(entry ? { ...entry, certain: !!entry.certain, already_paid: !!(entry.external_id?.startsWith('prepaid:')), group: defaultGroup } : {
    description: '', amount: 0, due_date: today, status: 'pending', paid_date: today, category_id: '', account_id: accounts.find((a) => !a.archived)?.id || '',
    payment_method: '', origin: '', nature: kind === 'expense' ? 'variavel' : '', certain: kind === 'income' ? false : true, notes: '', recurrence: '', recurrence_end: '', installments: 1, total_amount: 0, already_paid: false, group: defaultGroup,
  });
  const v = f.v;
  const paidNow = !editing && v.status === 'paid';
  const parcelado = kind === 'expense' && Number(v.installments) > 1;
  return (
    <FormModal title={editing ? `Editar ${t.one}` : t.new} wide onClose={onClose}
      onSubmit={async () => {
        let nature = v.nature;
        let catId = v.category_id || null;
        if (kind === 'expense') {
          if (v.group === 'financiamento') {
            nature = 'financiamento';
            if (!catId) {
              const finCat = categories.find((c) => c.kind === 'expense' && c.name.toLowerCase().includes('financiamento'));
              if (finCat) catId = finCat.id;
            }
          } else if (nature === 'financiamento') {
            nature = 'variavel';
          }
        }
        const body = {
          ...v,
          nature,
          certain: v.certain,
          category_id: catId,
          account_id: v.account_id || null,
          installments: Number(v.installments) || 1,
          recurrence: v.recurrence || null,
          recurrence_end: v.recurrence_end || null,
          already_paid: v.already_paid,
        };
        if (editing) await put(`/api/entries/${entry.id}`, body);
        else await post(t.list, body);
        notify(editing ? 'Alterações salvas.' : 'Lançamento criado.');
        refresh();
      }}>
      <Txt f={f} name="description" label="Descrição" className="full" maxLength={120} required />
      <Money f={f} name="amount" label={parcelado ? 'Valor de cada parcela' : 'Valor'} required />
      <Txt f={f} name="due_date" type="date" label={t.dueLabel} required />
      {kind === 'expense' && (
        <Sel
          f={f}
          name="group"
          label="Estrutura da despesa"
          options={[
            { value: 'pf', label: 'Pessoa Física (Gastos pessoais, contas, assinaturas)' },
            { value: 'financiamento', label: 'Financiamento (Casa / Habitação)' },
          ]}
        />
      )}
      <Sel f={f} name="category_id" label="Categoria" options={categoryOptions(categories, kind)} empty="Sem categoria" />
      <Sel f={f} name="account_id" label={kind === 'income' ? 'Conta de destino' : 'Conta utilizada'} options={accountOptions(accounts)} empty="Definir ao pagar" />
      <Txt f={f} name="origin" label={t.origin} maxLength={80} />
      {kind === 'expense' && <Sel f={f} name="payment_method" label="Forma de pagamento" options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} empty="—" />}
      {kind === 'expense' && <Sel f={f} name="nature" label="Tipo de despesa" options={[{ value: 'fixa', label: 'Fixa' }, { value: 'variavel', label: 'Variável' }, { value: 'avista', label: 'À vista' }, { value: 'financiamento', label: 'Financiamento' }]} />}
      {!editing && (
        <Sel f={f} name="status" label="Situação" options={[{ value: 'pending', label: kind === 'income' ? 'Prevista (ainda não recebi)' : 'Pendente (ainda não paguei)' }, { value: 'paid', label: kind === 'income' ? 'Já recebida' : 'Já paga' }]} />
      )}
      {(paidNow || (editing && entry.status === 'paid')) && <Txt f={f} name="paid_date" type="date" label={t.paidDate} required />}
      {kind === 'expense' && (paidNow || (editing && entry.status === 'paid')) && (
        <Chk f={f} name="already_paid" label="Já foi pago anteriormente (não debitar do saldo disponível)" hint="Marque se já foi quitado antes e não deve retirar do dinheiro atual." />
      )}
      {kind === 'income' && (editing ? entry.status !== 'paid' : v.status !== 'paid') && (
        <Chk f={f} name="certain" label="Receita garantida" hint="Só receitas garantidas entram nos cálculos de retirada e projeção." />
      )}
      {!editing && !parcelado && (
        <>
          <Sel f={f} name="recurrence" label="Recorrência" options={Object.entries(PERIOD_LABEL).map(([value, label]) => ({ value, label }))} empty="Não se repete" hint={v.recurrence ? 'Gera lançamentos pendentes para os próximos 12 meses.' : undefined} />
          {v.recurrence && <Txt f={f} name="recurrence_end" type="date" label="Repetir até (opcional)" />}
        </>
      )}
      {!editing && kind === 'expense' && !v.recurrence && (
        <>
          <Num f={f} name="installments" label="Parcelas" min="1" max="480" hint={parcelado ? 'Cria um parcelamento em Dívidas e parcelas, com a 1ª parcela no vencimento informado.' : '1 = à vista'} />
          {parcelado && <Money f={f} name="total_amount" label="Valor total (opcional)" hint="Se vazio, usa parcela × quantidade." />}
        </>
      )}
      <Area f={f} name="notes" label="Observações" />
    </FormModal>
  );
}

export default function Entries({ kind }) {
  const { today, params, accounts, categories, refresh, notify, confirm } = useApp();
  const t = T[kind];
  const [month, setMonth] = useState(params.from ? params.from.slice(0, 7) : today.slice(0, 7));
  const [all, setAll] = useState(!!params.status && !params.from);
  const [status, setStatus] = useState(params.status || '');
  const [category, setCategory] = useState('');
  const [account, setAccount] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [pay, setPay] = useState(null);
  const [expenseScope, setExpenseScope] = useState('pf'); // 'pf' | 'financiamento' | 'combinado'
  const query = { from: all ? '' : `${month}-01`, to: all ? '' : monthEnd(month), status, category_id: category, account_id: account, q };
  const { data: rows, error, loading } = useFetch(() => get(t.list, query), [kind, month, all, status, category, account, q]);

  const remove = async (e) => {
    let scope = 'one';
    if (e.recurrence_id) {
      scope = await confirm({ title: 'Excluir lançamento recorrente', message: `"${e.description}" faz parte de uma recorrência. O que deseja excluir?`, options: [{ label: 'Só este', value: 'one', danger: true }, { label: 'Este e os próximos pendentes', value: 'future', danger: true }] });
      if (!scope) return;
    } else if (!(await confirm({ title: `Excluir ${t.one}`, message: `Excluir "${e.description}" (${brl(e.amount)})?${e.status === 'paid' ? ' O pagamento será desfeito e o saldo da conta ajustado.' : ''}`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/entries/${e.id}`, { scope }); notify('Lançamento excluído.'); refresh(); } catch (x) { notify(x.message, true); }
  };
  const unpay = async (e) => {
    if (!(await confirm({ title: 'Desfazer', message: `Desfazer ${kind === 'income' ? 'o recebimento' : 'o pagamento'} de "${e.description}"? A movimentação será removida e o saldo ajustado.`, okLabel: 'Desfazer' }))) return;
    try { await post(`/api/entries/${e.id}/unpay`); notify('Desfeito.'); refresh(); } catch (x) { notify(x.message, true); }
  };
  const markPrepaid = async (e) => {
    if (!(await confirm({
      title: 'Marcar como já pago',
      message: `Marcar "${e.description}" (${brl(e.amount)}) como quitado anteriormente? O valor não será debitado do seu saldo atual disponível.`,
      okLabel: 'Marcar já pago'
    }))) return;
    try {
      await post(`/api/entries/${e.id}/mark-prepaid`, { paid_date: e.due_date <= today ? e.due_date : today });
      notify('Marcado como já pago (sem debitar da conta).');
      refresh();
    } catch (x) { notify(x.message, true); }
  };

  const isAluguelEntry = (e) => {
    const cat = (e.category_name || '').toLowerCase();
    const d = (e.description || '').toLowerCase();
    const o = (e.origin || '').toLowerCase();
    return cat.includes('aluguel') || d.includes('aluguel') || o.includes('aluguel');
  };
  const isLifeSurfEntry = (e) => {
    const cat = (e.category_name || '').toLowerCase();
    const d = (e.description || '').toLowerCase();
    const o = (e.origin || '').toLowerCase();
    return cat.includes('life surf') || d.includes('life surf') || o.includes('life surf') || (!isAluguelEntry(e));
  };

  const allRows = rows || [];
  const finRows = allRows.filter(isFinanciamentoExpense);
  const pfRows = allRows.filter((e) => !isFinanciamentoExpense(e));

  const status_of = (e) => (e.status === 'paid' ? 'paid' : e.due_date < today ? 'overdue' : 'pending');
  const doneSum = allRows.filter((e) => e.status === 'paid').reduce((s, e) => s + e.amount, 0);
  const openSum = allRows.filter((e) => e.status !== 'paid').reduce((s, e) => s + e.amount, 0);
  const doneAluguel = allRows.filter((e) => e.status === 'paid' && isAluguelEntry(e)).reduce((s, e) => s + e.amount, 0);
  const doneLifeSurf = allRows.filter((e) => e.status === 'paid' && isLifeSurfEntry(e)).reduce((s, e) => s + e.amount, 0);
  const openAluguel = allRows.filter((e) => e.status !== 'paid' && isAluguelEntry(e)).reduce((s, e) => s + e.amount, 0);
  const openLifeSurf = allRows.filter((e) => e.status !== 'paid' && isLifeSurfEntry(e)).reduce((s, e) => s + e.amount, 0);

  const pfDone = pfRows.filter((e) => e.status === 'paid').reduce((s, e) => s + e.amount, 0);
  const pfOpen = pfRows.filter((e) => e.status !== 'paid').reduce((s, e) => s + e.amount, 0);
  const finDone = finRows.filter((e) => e.status === 'paid').reduce((s, e) => s + e.amount, 0);
  const finOpen = finRows.filter((e) => e.status !== 'paid').reduce((s, e) => s + e.amount, 0);

  const renderTable = (list, subtitle, emptyMsg) => {
    const paidT = list.filter((e) => e.status === 'paid').reduce((s, e) => s + e.amount, 0);
    const openT = list.filter((e) => e.status !== 'paid').reduce((s, e) => s + e.amount, 0);
    if (list.length === 0) return <Card><Empty>{emptyMsg || 'Nenhum lançamento encontrado neste período.'}</Empty></Card>;
    return (
      <div className="tbl-wrap" style={{ opacity: loading ? 0.6 : 1, marginBottom: 16 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Vencimento</th>
              <th>Descrição</th>
              <th>Categoria</th>
              <th>Conta</th>
              <th>Status</th>
              <th className="num">Valor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((e) => {
              const isFin = isFinanciamentoExpense(e);
              return (
                <tr key={e.id}>
                  <td>
                    {dateBR(e.due_date)}
                    {e.paid_date && e.paid_date !== e.due_date && <span className="sub">{kind === 'income' ? 'recebida' : 'paga'} {dateBR(e.paid_date)}</span>}
                  </td>
                  <td>
                    {e.description}
                    {e.recurrence_id && <span className="sub">recorrente</span>}
                    {e.debt_id && <span className="sub">parcela {e.installment_no === 9999 ? '(quitação)' : e.installment_no}</span>}
                    {e.subscription_id && <span className="sub">assinatura</span>}
                  </td>
                  <td>
                    {e.category_name || '—'}
                    {kind === 'expense' && (
                      <span className="sub">
                        {isFin ? 'Financiamento (Casa)' : 'Pessoa Física'}
                      </span>
                    )}
                  </td>
                  <td>{e.account_name || '—'}</td>
                  <td>
                    <StatusBadge status={status_of(e)} income={kind === 'income'} />
                    {e.status === 'paid' && typeof e.external_id === 'string' && e.external_id.startsWith('prepaid:') && <> <Badge tone="neutral">já quitado</Badge></>}
                    {kind === 'income' && e.status !== 'paid' && !e.certain && <> <Badge tone="warn">incerta</Badge></>}
                  </td>
                  <td className={`num ${kind === 'income' ? 'pos' : ''}`}>{brl(e.amount)}</td>
                  <td className="row-actions">
                    {e.status === 'paid' ? (
                      <button className="btn sm ghost" onClick={() => unpay(e)}>Desfazer</button>
                    ) : (
                      <>
                        <button className="btn sm" onClick={() => setPay(e)}>{t.doAction}</button>
                        {kind === 'expense' && (
                          <button className="btn sm ghost" title="Marcar como já pago sem debitar da conta" onClick={() => markPrepaid(e)}>Já foi pago</button>
                        )}
                      </>
                    )}
                    <button className="btn sm ghost" onClick={() => setForm(e)}>Editar</button>
                    <button className="btn sm ghost" onClick={() => remove(e)}>Excluir</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>
                <strong>{subtitle || 'Subtotal'}:</strong> Pago {brl(paidT)} · Em aberto {brl(openT)}
              </td>
              <td className="num"><strong>{brl(paidT + openT)}</strong></td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  return (
    <div>
      <PageHead title={t.title} sub={kind === 'income' ? 'Dinheiro recebido e previsto. Só vira saldo quando você confirma o recebimento.' : 'Contas pagas e a pagar. Separe despesas de Pessoa Física do Financiamento da casa.'}>
        <button className="btn primary" onClick={() => setForm({})}>{t.new}</button>
      </PageHead>

      {kind === 'expense' && (
        <div style={{ marginBottom: 14 }}>
          <Tabs
            value={expenseScope}
            onChange={setExpenseScope}
            items={[
              { value: 'pf', label: `Pessoa Física (${pfRows.length})` },
              { value: 'financiamento', label: `Financiamento (${finRows.length})` },
              { value: 'combinado', label: `Juntar Financiamento e Pessoa Física (${allRows.length})` },
            ]}
          />
        </div>
      )}

      {kind === 'income' && allRows.length > 0 && (
        <div className="grid-stats" style={{ marginBottom: 14 }}>
          <Stat label="Total Combinado (Recebido)" value={brl(doneSum)} sub={`A receber: ${brl(openSum)} · Total: ${brl(doneSum + openSum)}`} tone="pos" />
          <Stat label="Faturamento Life Surf (Recebido)" value={brl(doneLifeSurf)} sub={`A receber: ${brl(openLifeSurf)}`} tone="pos" />
          <Stat label="Aluguel da Casa (Recebido)" value={brl(doneAluguel)} sub={`Destinado à parcela da casa · A receber: ${brl(openAluguel)}`} />
        </div>
      )}

      {kind === 'expense' && allRows.length > 0 && (
        <div className="grid-stats" style={{ marginBottom: 14 }}>
          {expenseScope === 'pf' && (
            <>
              <Stat label="Total Pessoa Física (Pago)" value={brl(pfDone)} sub={`A pagar: ${brl(pfOpen)} · Total: ${brl(pfDone + pfOpen)}`} />
              <Stat label="Pessoa Física a Pagar" value={brl(pfOpen)} tone={pfOpen > 0 ? 'warn' : undefined} sub={`${pfRows.filter((e) => e.status !== 'paid').length} conta(s) pendente(s)`} />
              <Stat label="Qtd. Despesas Pessoa Física" value={pfRows.length} sub="Gastos pessoais e do dia a dia" />
            </>
          )}
          {expenseScope === 'financiamento' && (
            <>
              <Stat label="Total Financiamento (Pago)" value={brl(finDone)} sub={`A pagar: ${brl(finOpen)} · Total: ${brl(finDone + finOpen)}`} />
              <Stat label="Parcela da Casa a Pagar" value={brl(finOpen)} tone={finOpen > 0 ? 'warn' : undefined} sub={`${finRows.filter((e) => e.status !== 'paid').length} parcela(s) pendente(s)`} />
              <Stat label="Qtd. Financiamentos" value={finRows.length} sub="Custeadas com o aluguel recebido" />
            </>
          )}
          {expenseScope === 'combinado' && (
            <>
              <Stat label="Total Geral Combinado" value={brl(doneSum)} sub={`A pagar: ${brl(openSum)} · Total: ${brl(doneSum + openSum)}`} />
              <Stat label="Total Pessoa Física" value={brl(pfDone + pfOpen)} sub={`Pago: ${brl(pfDone)} · A pagar: ${brl(pfOpen)}`} />
              <Stat label="Total Financiamento (Casa)" value={brl(finDone + finOpen)} sub={`Pago: ${brl(finDone)} · A pagar: ${brl(finOpen)}`} />
            </>
          )}
        </div>
      )}

      <div className="filters">
        {!all && <MonthPicker value={month} onChange={setMonth} />}
        <button className="btn" onClick={() => setAll(!all)}>{all ? 'Filtrar por mês' : 'Ver todos os meses'}</button>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Todos os status</option>
          <option value="pending">{kind === 'income' ? 'Previstas' : 'Pendentes'}</option>
          <option value="paid">{t.done}s</option>
          {kind === 'expense' && <option value="overdue">Atrasadas</option>}
          {kind === 'income' && <option value="overdue">Previstas vencidas</option>}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {categoryOptions(categories, kind).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Conta">
          <option value="">Todas as contas</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input type="search" placeholder="Pesquisar…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <ErrorBox error={error} />

      {!rows ? (
        <Loading />
      ) : allRows.length === 0 ? (
        <Card>
          <Empty action={<button className="btn primary" onClick={() => setForm({})}>{t.new}</button>}>
            Nenhum lançamento encontrado com estes filtros.
          </Empty>
        </Card>
      ) : kind === 'income' ? (
        renderTable(allRows, 'Total Receitas')
      ) : expenseScope === 'pf' ? (
        renderTable(pfRows, 'Total Pessoa Física', 'Nenhuma despesa de Pessoa Física neste período.')
      ) : expenseScope === 'financiamento' ? (
        renderTable(finRows, 'Total Financiamento (Casa)', 'Nenhuma despesa de Financiamento da Casa neste período.')
      ) : (
        <div className="stack">
          <Card title="Despesas — Pessoa Física">
            {renderTable(pfRows, 'Subtotal Pessoa Física', 'Nenhuma despesa de Pessoa Física neste período.')}
          </Card>
          <Card title="Despesas — Financiamento da Casa">
            {renderTable(finRows, 'Subtotal Financiamento (Casa)', 'Nenhuma despesa de Financiamento da Casa neste período.')}
          </Card>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700, fontSize: 15 }}>
              <span>Total Combinado (Pessoa Física + Financiamento):</span>
              <span>{brl(doneSum + openSum)} (Pago: {brl(doneSum)} · A pagar: {brl(openSum)})</span>
            </div>
          </Card>
        </div>
      )}

      {form && <EntryForm kind={kind} entry={form.id ? form : null} onClose={() => setForm(null)} />}
      {pay && <PayModal entry={pay} onClose={() => setPay(null)} />}
    </div>
  );
}
