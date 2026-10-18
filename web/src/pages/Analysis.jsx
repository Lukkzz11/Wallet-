import { useState } from 'react';
import { get, post } from '../api.js';
import { useApp, useFetch, Card, Stat, PageHead, Empty, ErrorBox, Loading, Tabs, Field, MoneyInput } from '../ui.jsx';
import { BarChart, LineChart, HBars, COLORS } from '../charts.jsx';
import { brl, monthShort, dateBR } from '../fmt.js';

function Cuts({ categories }) {
  const [cuts, setCuts] = useState({});
  const [res, setRes] = useState(null);
  const calc = async (next) => {
    setCuts(next);
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v > 0));
    setRes(Object.keys(clean).length ? await post('/api/analysis/cuts', { cuts: clean }) : null);
  };
  const { categories: all } = useApp();
  const idOf = (name) => all.find((c) => c.kind === 'expense' && c.name === name)?.id;
  const rows = categories.filter((c) => idOf(c.name));
  return (
    <Card title="Quanto posso economizar reduzindo despesas?">
      {rows.length === 0 ? <Empty>Sem gastos pagos nos últimos meses para simular.</Empty> : (
        <>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Categoria</th><th className="num">Média mensal (3 meses)</th><th className="num">Reduzir em (%)</th></tr></thead>
            <tbody>{rows.slice(0, 8).map((c) => {
              const id = idOf(c.name);
              const avg = res?.items.find((i) => i.category_id === id)?.averageMonthly;
              return <tr key={c.name}><td>{c.name}</td><td className="num">{avg != null ? brl(avg) : '—'}</td><td className="num"><input type="number" min="0" max="100" style={{ width: 80 }} value={cuts[id] || ''} onChange={(e) => calc({ ...cuts, [id]: Math.min(100, Number(e.target.value) || 0) })} /></td></tr>;
            })}</tbody></table></div>
          {res && <div className="alert ok" style={{ marginTop: 10 }}>Economia estimada: <strong>{brl(res.monthly)}/mês</strong> · <strong>{brl(res.yearly)}/ano</strong>, sobre a média dos últimos 3 meses completos.</div>}
        </>
      )}
    </Card>
  );
}

function Purchase() {
  const { today } = useApp();
  const [amount, setAmount] = useState(0);
  const [inst, setInst] = useState(1);
  const [first, setFirst] = useState(today);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const run = async () => { setErr(''); try { setRes(await post('/api/analysis/purchase', { amount, installments: inst, first_date: first })); } catch (e) { setErr(e.message); } };
  return (
    <Card title="Como uma compra nova afetaria os próximos meses?">
      <div className="filters">
        <Field label="Valor total"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Parcelas"><input type="number" min="1" max="120" value={inst} onChange={(e) => setInst(Number(e.target.value) || 1)} style={{ width: 90 }} /></Field>
        <Field label="Primeira parcela"><input type="date" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={!amount} onClick={run}>Simular</button>
      </div>
      <ErrorBox error={err} />
      {res && (
        <>
          <LineChart labels={res.after.months.map((m) => monthShort(m.month))} lines={[{ name: 'Sem a compra', color: COLORS.slate, values: res.before.months.map((m) => m.closing) }, { name: 'Com a compra', color: COLORS.green, values: res.after.months.map((m) => m.closing) }]} />
          {res.after.summary.negativeMonths.length > 0 && <div className="alert danger" style={{ marginTop: 8 }}>Com a compra, o saldo projetado fica negativo em: {res.after.summary.negativeMonths.map(monthShort).join(', ')}.</div>}
          <p className="muted" style={{ marginTop: 8 }}>Menor saldo projetado: {brl(res.before.summary.minClosing)} → {brl(res.after.summary.minClosing)}. Parcelas: {res.installments.map((i) => `${dateBR(i.date)} ${brl(i.amount)}`).join(' · ')}. Projeção com os dados cadastrados, sem garantias.</p>
        </>
      )}
    </Card>
  );
}

export default function Analysis() {
  const [months, setMonths] = useState(6);
  const { nav } = useApp();
  const { data: a, error } = useFetch(() => get('/api/analysis', { months }), [months]);
  if (error) return <ErrorBox error={error} />;
  if (!a) return <Loading />;
  const av = a.averages;
  return (
    <div className="stack">
      <PageHead title="Análises" sub="Cálculos transparentes com os seus dados, sem inteligência artificial.">
        <Tabs value={months} onChange={setMonths} items={[{ value: 3, label: '3 meses' }, { value: 6, label: '6 meses' }, { value: 12, label: '12 meses' }]} />
      </PageHead>
      {a.dataNote && <div className="alert">{a.dataNote}</div>}
      <div className="grid-stats">
        <Stat label="Renda média mensal" value={brl(av.income)} sub={`${av.basedOnMonths} mês(es) completos`} />
        <Stat label="Gasto médio mensal" value={brl(av.expense)} />
        <Stat label="Sobra média" value={brl(av.leftover)} tone={av.leftover < 0 ? 'neg' : 'pos'} sub={av.leftoverPct != null ? `${av.leftoverPct}% da renda` : 'sem renda registrada'} />
        <Stat label="Guardado por mês (média)" value={brl(av.saved)} />
        <Stat label="Assinaturas na renda" value={a.subscriptions.shareOfIncomePct != null ? `${a.subscriptions.shareOfIncomePct}%` : '—'} sub={`${brl(a.subscriptions.monthly)}/mês`} />
        <Stat label="Parcelas na renda (mês)" value={a.debts.shareOfIncomePct != null ? `${a.debts.shareOfIncomePct}%` : '—'} sub={brl(a.debts.monthly)} />
      </div>
      {a.recommendations.length > 0 ? (
        <Card title="Pontos de atenção (com os valores usados)"><ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>{a.recommendations.map((r) => <li key={r}>{r}</li>)}</ul></Card>
      ) : <div className="alert ok">Nenhum alerta com os dados atuais.</div>}
      <div className="cols-2">
        <Card title="Receitas, despesas e resultado por mês">
          <BarChart data={a.series.map((r) => ({ label: monthShort(r.month), values: [r.income, r.expense, r.net] }))} series={[{ name: 'Receitas', color: COLORS.green }, { name: 'Despesas', color: COLORS.slate }, { name: 'Resultado', color: COLORS.ink }]} />
        </Card>
        <Card title="Onde mais gasto no período">
          {a.categories.length ? <HBars items={a.categories.slice(0, 10).map((c) => ({ name: c.name, value: c.total }))} total={a.totalSpent} /> : <Empty>Sem despesas pagas no período.</Empty>}
        </Card>
      </div>
      <Card title="Categorias: mês atual versus anterior">
        {a.categories.length === 0 ? <Empty>Sem dados.</Empty> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Categoria</th><th className="num">Anterior</th><th className="num">Atual</th><th className="num">Variação</th><th className="num">Total no período</th></tr></thead>
            <tbody>{a.categories.map((c) => <tr key={c.name}><td>{c.name}</td><td className="num">{brl(c.previous)}</td><td className="num">{brl(c.current)}</td><td className={`num ${c.change > 0 ? 'neg' : c.change < 0 ? 'pos' : ''}`}>{c.change > 0 ? '+' : ''}{brl(c.change)}{c.changePct != null && ` (${c.changePct}%)`}</td><td className="num">{brl(c.total)}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <div className="cols-2">
        <Card title="Assinaturas que mais pesam" action={<button className="btn sm" onClick={() => nav('assinaturas')}>Abrir</button>}>
          {a.subscriptions.items.length ? <HBars items={a.subscriptions.items.map((s) => ({ name: s.name, value: s.monthly }))} /> : <Empty>Nenhuma assinatura ativa.</Empty>}
        </Card>
        <Card title="Meses com risco de saldo insuficiente (projeção 12 meses)">
          {a.insufficientMonths.length ? <div className="alert danger">Saldo negativo projetado em: {a.insufficientMonths.map(monthShort).join(', ')}. Veja o detalhe em Projeção.</div> : <div className="alert ok">Nenhum mês com saldo negativo na projeção, considerando apenas lançamentos cadastrados.</div>}
        </Card>
      </div>
      <Cuts categories={a.categories} />
      <Purchase />
      <p className="muted">Para o impacto de aumentar ou reduzir retiradas, use a simulação de "Retirada mensal" em Metas e projeções.</p>
    </div>
  );
}
