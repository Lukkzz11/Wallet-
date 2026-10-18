import { useState } from 'react';
import { get } from '../api.js';
import Summary from './Summary.jsx';
import Annual from './Annual.jsx';
import { useApp, useFetch, Card, Stat, Progress, PageHead, MonthPicker, Badge, Tabs, Empty, ErrorBox, Loading, RISK } from '../ui.jsx';
import { BarChart, LineChart, HBars, COLORS } from '../charts.jsx';
import { brl, dateBR, monthShort, monthFull, monthEnd } from '../fmt.js';

export default function Dashboard() {
  const { today, nav, settings } = useApp();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState('month');
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const { data: d, error, loading } = useFetch(() => get('/api/dashboard', { month }), [month]);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const goMonth = (page) => nav(page, { from: `${month}-01`, to: monthEnd(month) });
  const { charts } = d;
  const cmp = charts.comparison;
  const savingsLines = charts.balanceEvolution;
  return (
    <div className="stack" style={{ opacity: loading ? 0.6 : 1 }}>
      <PageHead title={`Olá, ${settings.user_name}`} sub={view === 'month' ? monthFull(month) : `Ano de ${year}`}>
        <Tabs value={view} onChange={setView} items={[{ value: 'month', label: 'Mensal' }, { value: 'year', label: 'Anual' }]} />
        {view === 'month' ? <MonthPicker value={month} onChange={setMonth} /> : <div className="actions"><button className="btn sm" onClick={() => setYear(year - 1)}>‹</button><strong>{year}</strong><button className="btn sm" onClick={() => setYear(year + 1)}>›</button></div>}
        {view === 'month' && month !== today.slice(0, 7) && <button className="btn" onClick={() => setMonth(today.slice(0, 7))}>Mês atual</button>}
      </PageHead>

      {view === 'year' && <Annual year={year} />}
      {view === 'month' && <>

      {!d.hasData && (
        <Card><Empty action={<button className="btn primary" onClick={() => nav('contas')}>Cadastrar primeira conta</button>}>
          O Wallet começa vazio. Cadastre suas contas com o saldo real, depois receitas e despesas. Nenhum número aparece até você informar seus dados.
        </Empty></Card>
      )}

      <Summary d={d} month={month} />

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Gráficos e mais números (opcional)</summary>
      <div className="stack" style={{ marginTop: 12 }}>
      <div className="grid-stats">
        <Stat label="Saldo total das contas" value={brl(d.totalBalance)} sub="Tudo o que está nas contas" onClick={() => nav('contas')} />
        <Stat label="Disponível para gastar" value={brl(d.available)} tone={d.available < 0 ? 'neg' : ''} sub="Contas gastáveis menos reservas" hint="Saldo das contas gastáveis menos o dinheiro reservado" />
        <Stat label="Reservado para objetivos" value={brl(d.reserved)} sub="Reservas e investimentos" onClick={() => nav('reservas')} />
        <Stat label="Receitas recebidas (Life Surf)" value={brl(d.receivedLifeSurf ?? d.received)} tone="pos" sub={`Rendimento disponível${d.receivedAluguel > 0 ? ` · Aluguel casa: ${brl(d.receivedAluguel)}` : ''}`} onClick={() => goMonth('receitas')} />
        <Stat label="Despesas pagas no mês" value={brl(d.paid)} onClick={() => goMonth('despesas')} />
        <Stat label="Contas pendentes" value={brl(d.pending.amount)} sub={`${d.pending.count} conta(s)${d.overdue.count ? ` · ${d.overdue.count} atrasada(s)` : ''}`} tone={d.overdue.count ? 'neg' : ''} onClick={() => nav('despesas', { status: 'pending' })} />
        <Stat label="Despesas previstas (30 dias)" value={brl(d.next30.amount)} sub={`Inclui assinaturas: ${brl(d.next30.subscriptions)}`} />
        <Stat label="Assinaturas ativas" value={`${brl(d.subscriptions.monthly)}/mês`} sub={`${d.subscriptions.count} serviço(s)`} onClick={() => nav('assinaturas')} />
        <Stat label="Dívidas e parcelas" value={brl(d.debts.owed)} sub={`${d.debts.pendingCount} parcela(s) pendente(s)`} onClick={() => nav('dividas')} />
        <Stat label="Posso retirar (equilibrado)" value={brl(d.withdrawal.suggested)} sub={<>Estimativa · <Badge tone={RISK[d.withdrawal.risk][0]}>{RISK[d.withdrawal.risk][1]}</Badge></>} onClick={() => nav('retirada')} />
      </div>

      {d.alerts.length > 0 && (
        <Card title="Alertas">
          <div className="alert-list">
            {d.alerts.map((a, i) => (
              <div key={i} className={`item ${a.kind}`}><span>{a.text.replace(/\d{4}-\d{2}-\d{2}/, (x) => dateBR(x))}</span><strong className="num">{brl(a.amount)}</strong></div>
            ))}
          </div>
        </Card>
      )}

      <div className="cols-2">
        <Card title="Receitas versus despesas (valores pagos/recebidos)">
          <BarChart data={charts.incomeExpense.map((r) => ({ label: monthShort(r.month), values: [r.income, r.expense] }))}
            series={[{ name: 'Receitas', color: COLORS.green }, { name: 'Despesas', color: COLORS.slate }]} />
        </Card>
        <Card title="Evolução do saldo (final de cada mês)">
          <LineChart labels={savingsLines.map((r) => monthShort(r.month))} lines={[{ name: 'Saldo total', color: COLORS.ink, values: savingsLines.map((r) => r.balance) }]} />
        </Card>
      </div>

      <div className="cols-2">
        <Card title={`Gastos por categoria — ${monthShort(month)}`}>
          {charts.categories.length ? <HBars items={charts.categories} /> : <Empty>Sem despesas pagas neste mês.</Empty>}
        </Card>
        <Card title="Evolução das economias (total em reservas)">
          <LineChart labels={savingsLines.map((r) => monthShort(r.month))} lines={[{ name: 'Guardado', color: COLORS.green, values: savingsLines.map((r) => r.savings) }]} />
        </Card>
      </div>

      <div className="cols-2">
        <Card title="Comparação com o mês anterior">
          {cmp.previous ? (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th></th><th className="num">{monthShort(cmp.previous.month)}</th><th className="num">{monthShort(cmp.current.month)}</th><th className="num">Diferença</th></tr></thead>
              <tbody>
                {[['Receitas', 'income'], ['Despesas', 'expense'], ['Resultado', 'net'], ['Guardado', 'saved']].map(([l, k]) => {
                  const diff = cmp.current[k] - cmp.previous[k];
                  return <tr key={k}><td>{l}</td><td className="num">{brl(cmp.previous[k])}</td><td className="num">{brl(cmp.current[k])}</td><td className={`num ${k === 'expense' ? (diff > 0 ? 'neg' : '') : diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}`}>{diff > 0 ? '+' : ''}{brl(diff)}</td></tr>;
                })}
              </tbody>
            </table></div>
          ) : <Empty>Sem mês anterior para comparar.</Empty>}
        </Card>
        <Card title="Metas">
          {d.goals.length ? d.goals.slice(0, 6).map((g) => (
            <div key={g.id} style={{ marginBottom: 12 }}>
              <div className="kv" style={{ border: 0 }}><span>{g.name}</span><span>{g.pct}% · {brl(g.saved)} de {brl(g.target)}</span></div>
              <Progress pct={g.pct} />
            </div>
          )) : <Empty action={<button className="btn" onClick={() => nav('planejamento')}>Criar meta</button>}>Nenhuma meta cadastrada.</Empty>}
        </Card>
      </div>
      </div>
      </details>
      </>}
    </div>
  );
}
