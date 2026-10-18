import { useState } from 'react';
import { get, post, del } from '../api.js';
import { useApp, useFetch, Card, Stat, PageHead, Badge, Empty, ErrorBox, Field, MoneyInput, Tabs } from '../ui.jsx';
import { BarChart, COLORS } from '../charts.jsx';
import { brl, dateBR, addDaysStr, addMonthKey, monthEnd, monthShort, weekdayOf } from '../fmt.js';
import { PayModal, EntryForm } from './Entries.jsx';
import { QuickExpense, House } from './MoneyExtra.jsx';

const DOW = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const monday = (d) => addDaysStr(d, -((weekdayOf(d) + 6) % 7));
const sum = (l, f = () => true) => l.filter(f).reduce((t, r) => t + r.amount, 0);

function AccountRow({ a }) {
  const { refresh, notify } = useApp();
  const [v, setV] = useState(a.balance);
  const save = async () => { try { await post(`/api/accounts/${a.id}/set-balance`, { balance: v }); notify('Saldo atualizado.'); refresh(); } catch (x) { notify(x.message, true); } };
  return (
    <div className="filters" style={{ marginBottom: 8 }}>
      <strong style={{ minWidth: 150 }}>{a.name}</strong>
      <MoneyInput value={v} onChange={setV} />
      <button className="btn" disabled={v === a.balance} onClick={save}>Salvar</button>
    </div>
  );
}

function Today() {
  const { accounts, today, refresh, notify } = useApp();
  const list = accounts.filter((a) => !a.archived && a.type !== 'fgts');
  const [name, setName] = useState(list.length ? '' : 'Minha conta');
  const [bal, setBal] = useState(0);
  const [adding, setAdding] = useState(list.length === 0);
  const add = async () => {
    try { await post('/api/accounts', { name, type: 'conta', initial_balance: bal, ref_date: today }); setName(''); setBal(0); setAdding(false); notify('Conta criada.'); refresh(); } catch (x) { notify(x.message, true); }
  };
  const total = list.reduce((t, a) => t + a.balance, 0);
  return (
    <Card title="Quanto eu tenho hoje" action={list.length > 1 ? <strong>{brl(total)}</strong> : null}>
      <p className="muted" style={{ marginBottom: 12 }}>Digite o valor que está em cada conta agora. Para atualizar depois, é só mudar o número e salvar.</p>
      {list.map((a) => <AccountRow key={`${a.id}-${a.balance}`} a={a} />)}
      {adding ? (
        <div className="filters">
          <Field label="Nome (ex.: Nubank, Carteira)"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Quanto tem hoje"><MoneyInput value={bal} onChange={setBal} /></Field>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={!name.trim()} onClick={add}>Adicionar conta</button>
        </div>
      ) : <button className="btn" onClick={() => setAdding(true)}>+ Outra conta</button>}
    </Card>
  );
}

function Fgts() {
  const { accounts, today, refresh, notify } = useApp();
  const acc = accounts.find((a) => a.type === 'fgts' && !a.archived);
  const [v, setV] = useState(acc?.balance || 0);
  const save = async () => {
    try {
      if (acc) await post(`/api/accounts/${acc.id}/set-balance`, { balance: v });
      else await post('/api/accounts', { name: 'FGTS', type: 'fgts', initial_balance: v, ref_date: today, spendable: false });
      notify('FGTS atualizado.'); refresh();
    } catch (x) { notify(x.message, true); }
  };
  return (
    <Card title="FGTS">
      <p className="muted" style={{ marginBottom: 12 }}>Quanto você tem no FGTS. É um dinheiro seu, mas travado: aparece como patrimônio e <strong>não conta como dinheiro livre</strong> para gastar, retirar ou investir.</p>
      <div className="filters">
        <Field label="Saldo do FGTS"><MoneyInput value={v} onChange={setV} /></Field>
        <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={acc ? v === acc.balance : !v} onClick={save}>{acc ? 'Salvar' : 'Cadastrar FGTS'}</button>
      </div>
    </Card>
  );
}

// Primeira data a partir de hoje para a frequência escolhida.
function nextDate(f, today) {
  if (f.freq === 'once') return f.date;
  if (f.freq === 'weekly') return addDaysStr(today, (f.weekday - weekdayOf(today) + 7) % 7);
  const [y, m] = today.split('-').map(Number);
  const clamp = (yy, mm) => Math.min(Number(f.day) || 1, new Date(Date.UTC(yy, mm, 0)).getUTCDate());
  const cand = `${y}-${String(m).padStart(2, '0')}-${String(clamp(y, m)).padStart(2, '0')}`;
  if (cand >= today) return cand;
  const k = addMonthKey(`${y}-${String(m).padStart(2, '0')}`, 1);
  const [ny, nm] = k.split('-').map(Number);
  return `${k}-${String(clamp(ny, nm)).padStart(2, '0')}`;
}

function Receive() {
  const { accounts, today, refresh, notify, confirm } = useApp();
  const [f, setF] = useState({ origin: '', amount: 0, freq: 'monthly', day: Number(today.slice(8)), weekday: 5, date: today, certain: true });
  const [pay, setPay] = useState(null);
  const [edit, setEdit] = useState(null);
  const [view, setView] = useState('week');
  const { data: rows, error } = useFetch(() => get('/api/incomes/list'), []);
  const first = accounts.find((a) => !a.archived && a.type !== 'fgts');
  const start = nextDate(f, today);
  const add = async () => {
    try {
      await post('/api/incomes/list', { description: f.origin, origin: f.origin, amount: f.amount, due_date: start, certain: f.certain, account_id: first?.id || null, recurrence: f.freq === 'once' ? null : f.freq });
      setF({ ...f, origin: '', amount: 0 }); notify('Adicionado.'); refresh();
    } catch (x) { notify(x.message, true); }
  };
  const remove = async (r) => {
    if (!(await confirm({ title: 'Excluir', message: `Excluir "${r.description}"${r.recurrence_id ? ' e todos os recebimentos seguintes' : ''}?`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/entries/${r.id}`, { scope: r.recurrence_id ? 'future' : 'one' }); refresh(); } catch (x) { notify(x.message, true); }
  };
  const all = rows || [];
  const pending = all.filter((r) => r.status === 'pending');
  const late = pending.filter((r) => r.due_date < today);
  // fontes: só a próxima ocorrência de cada recorrência
  const seen = new Set();
  const sources = pending.slice().sort((a, b) => a.due_date.localeCompare(b.due_date)).filter((r) => {
    if (!r.recurrence_id) return true;
    if (seen.has(r.recurrence_id)) return false;
    seen.add(r.recurrence_id);
    return true;
  });
  const freqOf = (r) => {
    if (!r.recurrence_id) return 'uma vez';
    const n = all.filter((x) => x.recurrence_id === r.recurrence_id).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const weekly = n.length > 1 && Math.round((Date.parse(n[1].due_date) - Date.parse(n[0].due_date)) / 864e5) <= 7;
    return weekly ? `toda ${DOW[weekdayOf(r.due_date)]}` : `todo dia ${Number(r.due_date.slice(8))}`;
  };
  // semana atual (segunda a domingo)
  const wStart = monday(today), wEnd = addDaysStr(wStart, 6);
  const week = all.filter((r) => r.due_date >= wStart && r.due_date <= wEnd).sort((a, b) => a.due_date.localeCompare(b.due_date));
  // previsão por semana ou por mês (atrasados entram no 1º período)
  const periods = view === 'week'
    ? Array.from({ length: 8 }, (_, i) => { const s = addDaysStr(wStart, i * 7); return { label: `${dateBR(s).slice(0, 5)} a ${dateBR(addDaysStr(s, 6)).slice(0, 5)}`, s, e: addDaysStr(s, 6) }; })
    : Array.from({ length: 6 }, (_, i) => { const k = addMonthKey(today.slice(0, 7), i); return { label: monthShort(k), s: `${k}-01`, e: monthEnd(k) }; });
  const fc = periods.map((p, i) => {
    const inP = all.filter((r) => (r.due_date >= p.s && r.due_date <= p.e) || (i === 0 && r.status === 'pending' && r.due_date < p.s));
    return { ...p, received: sum(inP, (r) => r.status === 'paid'), sure: sum(inP, (r) => r.status === 'pending' && r.certain), maybe: sum(inP, (r) => r.status === 'pending' && !r.certain), late: i === 0 && late.length > 0 };
  });
  const tot = (k) => fc.reduce((t, p) => t + p[k], 0);
  return (
    <>
      <Card title="Quanto eu recebo">
        <p className="muted" style={{ marginBottom: 12 }}>Só entra no seu saldo quando você clicar em "Recebi". Valores futuros nunca contam como dinheiro de hoje.</p>
        <div className="filters">
          <Field label="De onde / de quem"><input value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} placeholder="Ex.: Salário, Cliente João" /></Field>
          <Field label="Valor"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Field label="Quando"><select value={f.freq} onChange={(e) => setF({ ...f, freq: e.target.value })}><option value="monthly">Todo mês</option><option value="weekly">Toda semana</option><option value="once">Só uma vez</option></select></Field>
          {f.freq === 'monthly' && <Field label="Que dia do mês"><input type="number" min="1" max="31" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} style={{ width: 80 }} /></Field>}
          {f.freq === 'weekly' && <Field label="Que dia da semana"><select value={f.weekday} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>{DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>}
          {f.freq === 'once' && <Field label="Data"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>}
          <label className="check" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}><input type="checkbox" checked={f.certain} onChange={(e) => setF({ ...f, certain: e.target.checked })} /><span>Certo</span></label>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={!f.origin.trim() || !f.amount || !first} onClick={add}>Adicionar</button>
        </div>
        <p className="muted">{f.freq === 'once' ? 'Receberá' : 'Primeiro recebimento'} em <strong>{dateBR(start)}</strong> ({DOW[weekdayOf(start)]}){f.freq === 'weekly' && ` e depois toda ${DOW[f.weekday]}`}{f.freq === 'monthly' && ' e depois todo mês nesse dia'}. Os próximos 12 meses ficam previstos.</p>
        {!first && <div className="alert warn">Informe primeiro quanto você tem hoje (acima) para escolher onde o dinheiro vai cair.</div>}
        <ErrorBox error={error} />
        {rows && sources.length > 0 && (
          <div className="tbl-wrap" style={{ marginTop: 12 }}><table className="tbl"><tbody>
            {sources.map((r) => {
              const isAlug = (r.category_name || '').toLowerCase().includes('aluguel') || (r.description || '').toLowerCase().includes('aluguel') || (r.origin || '').toLowerCase().includes('aluguel');
              return (
                <tr key={r.id}>
                  <td>
                    {r.origin || r.description}
                    <span className="sub">
                      {freqOf(r)} · {isAlug ? '🏠 Aluguel da Casa' : '🏄 Life Surf / PF'}
                    </span>
                  </td>
                  <td>{r.due_date < today ? <Badge tone="danger">Passou da data</Badge> : <Badge>Próximo: {dateBR(r.due_date)}</Badge>}{!r.certain && <> <Badge tone="warn">incerto</Badge></>}</td>
                  <td className="num pos">{brl(r.amount)}</td>
                  <td className="row-actions"><button className="btn sm primary" onClick={() => setPay(r)}>Recebi</button><button className="btn sm" onClick={() => setEdit(r)}>Editar</button><button className="btn sm ghost" onClick={() => remove(r)}>Excluir</button></td>
                </tr>
              );
            })}
          </tbody></table></div>
        )}
        {rows && sources.length === 0 && <Empty>Nada a receber cadastrado.</Empty>}
      </Card>

      {rows && (
        <Card title={`Esta semana (${dateBR(wStart).slice(0, 5)} a ${dateBR(wEnd).slice(0, 5)})`} action={<span className="muted">A receber: <strong>{brl(sum(week, (r) => r.status === 'pending'))}</strong> · Já recebido: <strong>{brl(sum(week, (r) => r.status === 'paid'))}</strong></span>}>
          {late.length > 0 && <div className="alert warn" style={{ marginBottom: 10 }}>{late.length} recebimento(s) passaram da data sem você marcar como recebido ({brl(sum(late))}). Clique em "Recebi" quando o dinheiro entrar na conta.</div>}
          {week.length === 0 ? <Empty>Nenhum recebimento previsto nesta semana.</Empty> : (
            <div className="tbl-wrap"><table className="tbl"><tbody>
              {week.map((r) => {
                const isAlug = (r.category_name || '').toLowerCase().includes('aluguel') || (r.description || '').toLowerCase().includes('aluguel') || (r.origin || '').toLowerCase().includes('aluguel');
                return (
                  <tr key={r.id}>
                    <td>{DOW[weekdayOf(r.due_date)]} {dateBR(r.due_date).slice(0, 5)}{r.due_date === today && <> <Badge tone="ok">hoje</Badge></>}</td>
                    <td>
                      {r.origin || r.description}
                      <span className="sub">{isAlug ? '🏠 Aluguel (Casa)' : '🏄 Life Surf / PF'}</span>
                    </td>
                    <td>{r.status === 'paid' ? <Badge tone="ok">Recebido</Badge> : r.due_date < today ? <Badge tone="danger">Passou da data</Badge> : <Badge>Previsto</Badge>}{r.status !== 'paid' && !r.certain && <> <Badge tone="warn">incerto</Badge></>}</td>
                    <td className="num pos">{brl(r.amount)}</td>
                    <td className="row-actions">{r.status !== 'paid' && <button className="btn sm primary" onClick={() => setPay(r)}>Recebi</button>}<button className="btn sm ghost" onClick={() => setEdit(r)}>Editar</button></td>
                  </tr>
                );
              })}
            </tbody></table></div>
          )}
        </Card>
      )}

      {rows && (
        <Card title="Previsão de quanto vou receber" action={<Tabs value={view} onChange={setView} items={[{ value: 'week', label: 'Por semana' }, { value: 'month', label: 'Por mês' }]} />}>
          <BarChart data={fc.map((p) => ({ label: p.label, values: [p.sure, p.maybe] }))} series={[{ name: 'A receber (certo)', color: COLORS.green }, { name: 'A receber (incerto)', color: COLORS.slate }]} height={190} />
          <div className="tbl-wrap" style={{ marginTop: 10 }}><table className="tbl">
            <thead><tr><th>{view === 'week' ? 'Semana' : 'Mês'}</th><th className="num">Já recebido</th><th className="num">A receber (certo)</th><th className="num">A receber (incerto)</th></tr></thead>
            <tbody>{fc.map((p) => <tr key={p.s}><td>{p.label}{p.late && <span className="sub">inclui atrasados</span>}</td><td className="num">{brl(p.received)}</td><td className="num pos">{brl(p.sure)}</td><td className="num">{brl(p.maybe)}</td></tr>)}</tbody>
            <tfoot><tr><td>Total do período</td><td className="num">{brl(tot('received'))}</td><td className="num">{brl(tot('sure'))}</td><td className="num">{brl(tot('maybe'))}</td></tr></tfoot>
          </table></div>
          <p className="muted" style={{ marginTop: 8 }}>Previsão feita só com o que você cadastrou. Valores marcados como "incertos" não entram nos cálculos de retirada e de investimento.</p>
        </Card>
      )}
      {pay && <PayModal entry={pay} onClose={() => setPay(null)} />}
      {edit && <EntryForm kind="income" entry={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function MoneyOverview({ dash, loans }) {
  if (!dash) return null;
  const housePayment = dash.commitments?.house?.total || (loans?.[0]?.payment ?? 0);
  const housePaid = dash.commitments?.house?.paid ?? 0;
  const housePending = dash.commitments?.house?.pending ?? 0;
  const aluguelRec = dash.receivedAluguel ?? 0;
  const diffHouse = aluguelRec - housePayment;
  const hasLoan = housePayment > 0 || (loans && loans.length > 0);

  const pfSpent = (dash.paid ?? 0) - housePaid;
  const pfPending = (dash.commitments?.cards?.pending ?? 0) + (dash.commitments?.subs?.pending ?? 0) + (dash.commitments?.other?.pending ?? 0);
  const lifeSurfRec = dash.receivedLifeSurf ?? 0;
  const availablePF = dash.available ?? 0;

  return (
    <Card title="Estrutura Financeira: Pessoa Física vs. Financiamento da Casa">
      <div className="cols-2" style={{ marginBottom: 0 }}>
        {/* Bloco 1: Pessoa Física */}
        <div style={{ background: 'var(--panel)', padding: 14, borderRadius: 8, border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: 14 }}>👤 Pessoa Física (Vida Pessoal & Life Surf)</strong>
            <Badge tone="ok">Disponível</Badge>
          </div>
          <div className="grid-stats" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 8 }}>
            <Stat label="Saldo Livre Líquido PF" value={brl(availablePF)} tone={availablePF >= 0 ? 'pos' : 'neg'} sub="Livre para seus gastos" />
            <Stat label="Rendimento Life Surf" value={brl(lifeSurfRec)} tone="pos" sub="Recebido no mês" />
            <Stat label="Despesas PF Pagas" value={brl(pfSpent)} sub="Já debitadas da conta" />
            <Stat label="Compromissos PF a Vencer" value={brl(pfPending)} tone={pfPending > 0 ? 'warn' : undefined} sub="Cartões, assinaturas e contas" />
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Valores exclusivos da sua vida pessoal. O aluguel da casa não entra neste saldo.
          </p>
        </div>

        {/* Bloco 2: Financiamento da Casa */}
        <div style={{ background: 'var(--panel)', padding: 14, borderRadius: 8, border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: 14 }}>🏠 Financiamento da Casa (Aluguel vs. Parcela)</strong>
            {hasLoan && (
              <Badge tone={diffHouse >= 0 ? 'ok' : 'warn'}>
                {diffHouse >= 0 ? '100% Coberto' : 'Aluguel Parcial'}
              </Badge>
            )}
          </div>
          <div className="grid-stats" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 8 }}>
            <Stat label="Aluguel Recebido (Casa)" value={brl(aluguelRec)} tone="pos" sub="Destinado à parcela da casa" />
            <Stat label="Parcela do Financiamento" value={brl(housePayment)} sub={housePaid > 0 ? 'Quitada neste mês' : housePending > 0 ? 'Pendente neste mês' : 'Valor mensal'} />
            <Stat
              label="Balanço do Financiamento"
              value={hasLoan ? (diffHouse >= 0 ? `+${brl(diffHouse)}` : brl(diffHouse)) : 'Sem financiamento'}
              tone={diffHouse >= 0 ? 'pos' : 'neg'}
              sub={diffHouse >= 0 ? 'Sobra reservada para o imóvel' : 'Complementar com outros recursos'}
            />
            <Stat
              label="Saldo Devedor do Contrato"
              value={loans?.[0]?.balance ? brl(loans[0].balance) : '—'}
              sub={loans?.[0]?.remaining_months ? `${loans[0].remaining_months} meses restantes` : 'Consulte na aba Casa'}
            />
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            O aluguel entra unicamente para pagar a parcela da casa e não compõe sua renda disponível.
          </p>
        </div>
      </div>
    </Card>
  );
}

export default function Money() {
  const { params } = useApp();
  const [tab, setTab] = useState(params.tab || 'dia');
  const { data: dash } = useFetch(() => get('/api/dashboard'), []);
  const { data: loans } = useFetch(() => get('/api/house-loans'), []);

  return (
    <div className="stack">
      <PageHead title="Meu dinheiro" sub="Visão completa das suas contas, receitas da Life Surf, despesas pessoais e parcelas da casa." />
      <MoneyOverview dash={dash} loans={loans} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'dia', label: 'Saldos das contas e gastos do dia' },
          { value: 'rec', label: 'Recebimentos (Life Surf & Aluguel)' },
          { value: 'casa', label: 'Financiamento da Casa' },
        ]}
      />
      {tab === 'dia' && <><Today /><QuickExpense /><Fgts /></>}
      {tab === 'rec' && <Receive />}
      {tab === 'casa' && <House />}
    </div>
  );
}
