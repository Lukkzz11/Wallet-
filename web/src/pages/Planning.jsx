import { useState, useEffect } from 'react';
import { get, post, put, del } from '../api.js';
import { useApp, useFetch, Card, Stat, PageHead, Badge, Empty, ErrorBox, Loading, FormModal, useForm, Txt, Money, Sel, Area, Progress, Tabs, Field, MoneyInput } from '../ui.jsx';
import { LineChart, BarChart, COLORS } from '../charts.jsx';
import { brl, dateBR, monthShort } from '../fmt.js';

function GoalForm({ goal, onClose }) {
  const { refresh, notify } = useApp();
  const { data: res } = useFetch(() => get('/api/reserves'), []);
  const f = useForm(goal || { name: '', target: 0, saved_manual: 0, deadline: '', priority: 'media', reserve_id: '', notes: '' });
  const reserves = (res?.items || []).filter((r) => r.status === 'active');
  return (
    <FormModal title={goal ? 'Editar meta' : 'Nova meta'} onClose={onClose}
      onSubmit={async () => { const b = { ...f.v, reserve_id: f.v.reserve_id || null, deadline: f.v.deadline || null }; goal ? await put(`/api/goals/${goal.id}`, b) : await post('/api/goals', b); notify('Meta salva.'); refresh(); }}>
      <Txt f={f} name="name" label="Nome" className="full" maxLength={80} required />
      <Money f={f} name="target" label="Valor desejado" required />
      <Txt f={f} name="deadline" type="date" label="Prazo" />
      <Sel f={f} name="priority" label="Prioridade" options={[{ value: 'alta', label: 'Alta' }, { value: 'media', label: 'Média' }, { value: 'baixa', label: 'Baixa' }]} />
      <Sel f={f} name="reserve_id" label="Reserva associada" options={reserves.map((r) => ({ value: r.id, label: `${r.name} (${brl(r.accumulated)})` }))} empty="Nenhuma (valor manual)" hint="Com reserva associada, o acumulado e o ritmo vêm dela." />
      {!f.v.reserve_id && <Money f={f} name="saved_manual" label="Valor já acumulado" />}
      {goal && <Sel f={f} name="status" label="Situação" options={[{ value: 'active', label: 'Ativa' }, { value: 'archived', label: 'Arquivada' }]} />}
      <Area f={f} name="notes" label="Observações" />
    </FormModal>
  );
}

function Goals() {
  const { refresh, notify, confirm, settings } = useApp();
  const [modal, setModal] = useState(null);
  const { data, error } = useFetch(() => get('/api/goals'), []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const remove = async (g) => {
    if (!(await confirm({ title: 'Excluir meta', message: `Excluir a meta "${g.name}"?`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/goals/${g.id}`); refresh(); } catch (x) { notify(x.message, true); }
  };
  const monthlyGoal = Number(settings.monthly_savings_goal || 0);
  return (
    <div className="stack">
      <div className="grid-stats">
        <Stat label="Total das metas ativas" value={brl(data.totals.target)} sub={`Acumulado: ${brl(data.totals.saved)}`} />
        <Stat label="Necessário por mês (todas)" value={brl(data.totals.monthlyNeeded)} sub="Impacto no dinheiro disponível mensal" />
        <Stat label="Meta de economia mensal" value={brl(monthlyGoal)} sub={monthlyGoal >= data.totals.monthlyNeeded ? 'Cobre as metas' : 'Menor que o necessário'} tone={monthlyGoal < data.totals.monthlyNeeded && data.totals.monthlyNeeded > 0 ? 'neg' : ''} />
      </div>
      <div><button className="btn primary" onClick={() => setModal({})}>Nova meta</button></div>
      {data.items.length === 0 ? <Card><Empty>Nenhuma meta cadastrada.</Empty></Card> : (
        <div className="cols-2">
          {data.items.map((g) => (
            <Card key={g.id} title={<>{g.name} <Badge tone={g.priority === 'alta' ? 'warn' : 'neutral'}>{{ alta: 'Prioridade alta', media: 'Média', baixa: 'Baixa' }[g.priority]}</Badge> {g.status === 'archived' && <Badge>arquivada</Badge>}</>}>
              <div className="stat-value">{brl(g.saved)}<span className="muted" style={{ fontSize: 14, fontWeight: 400 }}> de {brl(g.target)}</span></div>
              <div style={{ margin: '8px 0' }}><Progress pct={g.pct} tone={g.overdue ? 'danger' : ''} /></div>
              <div className="kv"><span>Percentual concluído</span><span>{g.pct}%</span></div>
              <div className="kv"><span>Falta</span><span>{brl(g.remaining)}</span></div>
              <div className="kv"><span>Prazo</span><span>{g.deadline ? `${dateBR(g.deadline)}${g.overdue ? ' (vencido)' : ''}` : 'sem prazo'}</span></div>
              <div className="kv"><span>Preciso guardar por mês</span><span>{g.monthlyNeeded == null ? 'defina um prazo' : brl(g.monthlyNeeded)}</span></div>
              <div className="kv"><span>Ritmo atual (média 3 meses)</span><span>{g.pace == null ? 'sem reserva associada' : brl(g.pace)}</span></div>
              <div className="kv"><span>No ritmo necessário?</span><span>{g.done ? <Badge tone="ok">Concluída</Badge> : g.onTrack == null ? '—' : g.onTrack ? <Badge tone="ok">Sim</Badge> : <Badge tone="danger">Abaixo do necessário</Badge>}</span></div>
              <div className="actions" style={{ marginTop: 10 }}>
                <button className="btn sm" onClick={() => setModal(g)}>Editar</button>
                <button className="btn sm ghost" onClick={() => remove(g)}>Excluir</button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {modal && <GoalForm goal={modal.id ? modal : null} onClose={() => setModal(null)} />}
    </div>
  );
}

function Projection() {
  const { notify } = useApp();
  const { version } = useApp();
  const [months, setMonths] = useState(6);
  const [adj, setAdj] = useState({ incomeDeltaPct: 0, expenseDeltaPct: 0, subsDelta: 0, monthlyWithdrawal: 0, includeUncertain: false, variableMonthly: null });
  const { data: va } = useFetch(() => get('/api/variable-average'), []);
  const [res, setRes] = useState(null);
  useEffect(() => {
    post('/api/projection', { months, ...adj }).then(setRes).catch((e) => notify(e.message, true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, adj, version]);
  const set = (k, v) => setAdj((a) => ({ ...a, [k]: v }));
  if (!res) return <Loading />;
  return (
    <div className="stack">
      <Tabs value={months} onChange={setMonths} items={[{ value: 3, label: '3 meses' }, { value: 6, label: '6 meses' }, { value: 12, label: '12 meses' }]} />
      <Card title="Simular mudanças (nada é gravado)">
        <div className="filters">
          <Field label="Receitas (%)"><input type="number" value={adj.incomeDeltaPct} onChange={(e) => set('incomeDeltaPct', Number(e.target.value))} style={{ width: 100 }} /></Field>
          <Field label="Despesas (%)"><input type="number" value={adj.expenseDeltaPct} onChange={(e) => set('expenseDeltaPct', Number(e.target.value))} style={{ width: 100 }} /></Field>
          <Field label="Assinaturas (±R$/mês)"><MoneyInput value={Math.abs(adj.subsDelta)} onChange={(v) => set('subsDelta', adj.subsDelta < 0 ? -v : v)} /></Field>
          <Field label="Sinal"><select value={adj.subsDelta < 0 ? 'neg' : 'pos'} onChange={(e) => set('subsDelta', (e.target.value === 'neg' ? -1 : 1) * Math.abs(adj.subsDelta))}><option value="pos">Aumentar</option><option value="neg">Reduzir</option></select></Field>
          <Field label="Retirada mensal (R$)"><MoneyInput value={adj.monthlyWithdrawal} onChange={(v) => set('monthlyWithdrawal', v)} /></Field>
          <Field label="Gasto variável/mês" hint={va?.months ? `Média calculada: ${brl(va.value)}` : 'Sem histórico: informe uma estimativa'}><MoneyInput value={adj.variableMonthly ?? va?.value ?? 0} onChange={(v) => set('variableMonthly', v)} /></Field>
          <label className="check"><input type="checkbox" checked={adj.includeUncertain} onChange={(e) => set('includeUncertain', e.target.checked)} /><span>Incluir receitas incertas</span></label>
          <button className="btn" onClick={() => setAdj({ incomeDeltaPct: 0, expenseDeltaPct: 0, subsDelta: 0, monthlyWithdrawal: 0, includeUncertain: false, variableMonthly: null })}>Limpar</button>
        </div>
      </Card>
      {res.summary.negativeMonths.length > 0 && <div className="alert danger">Saldo projetado negativo em: {res.summary.negativeMonths.map(monthShort).join(', ')}.</div>}
      {res.summary.negativeMonths.length === 0 && res.summary.belowMinimumMonths.length > 0 && <div className="alert warn">Disponível abaixo da reserva mínima em: {res.summary.belowMinimumMonths.map(monthShort).join(', ')}.</div>}
      <div className="cols-2">
        <Card title="Saldo projetado ao fim de cada mês">
          <LineChart labels={res.months.map((m) => monthShort(m.month))} lines={[{ name: 'Saldo projetado (contas gastáveis)', color: COLORS.ink, values: res.months.map((m) => m.closing) }, { name: 'Livre após reservas', color: COLORS.green, values: res.months.map((m) => m.closingFree) }]} />
        </Card>
        <Card title="Entradas e saídas previstas">
          <BarChart data={res.months.map((m) => ({ label: monthShort(m.month), values: [m.income, m.expenses + m.withdrawal] }))} series={[{ name: 'Receitas', color: COLORS.green }, { name: 'Despesas + retirada', color: COLORS.slate }]} />
        </Card>
      </div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Mês</th><th className="num">Receitas</th><th className="num">Contas cadastradas</th><th className="num">Assinaturas</th><th className="num">Variável</th><th className="num">Retirada</th><th className="num">Resultado</th><th className="num">Saldo final</th></tr></thead>
        <tbody>{res.months.map((m) => (
          <tr key={m.month}><td>{monthShort(m.month)}</td><td className="num">{brl(m.income)}{m.incomeUncertain > 0 && <span className="sub">+{brl(m.incomeUncertain)} incerta</span>}</td><td className="num">{brl(m.scheduled)}</td><td className="num">{brl(m.subscriptions)}</td><td className="num">{brl(m.variable)}</td><td className="num">{brl(m.withdrawal)}</td><td className={`num ${m.net < 0 ? 'neg' : 'pos'}`}>{brl(m.net)}</td><td className={`num ${m.closing < 0 ? 'neg' : ''}`}>{brl(m.closing)}</td></tr>
        ))}</tbody>
      </table></div>
      <Card title="Premissas adotadas"><ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>{res.premises.map((p) => <li key={p}>{p}</li>)}</ul></Card>
    </div>
  );
}

export default function Planning({ only }) {
  const [tab, setTab] = useState(only || 'goals');
  const proj = tab === 'proj';
  return (
    <div>
      <PageHead title={only ? (proj ? 'Projeção' : 'Metas') : 'Metas e projeções'} sub={proj ? 'Estimativa do saldo futuro com base nas receitas e despesas registradas. Não é garantia.' : 'Objetivos financeiros com valor desejado, valor acumulado e prazo.'} />
      {!only && <Tabs value={tab} onChange={setTab} items={[{ value: 'goals', label: 'Metas' }, { value: 'proj', label: 'Projeções' }]} />}
      {proj ? <Projection /> : <Goals />}
    </div>
  );
}
