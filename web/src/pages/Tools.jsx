import { get, post } from '../api.js';
import { useApp, useFetch, Card, PageHead, ErrorBox, Loading, Badge } from '../ui.jsx';
import { brl, monthShort } from '../fmt.js';

// Hub de "Mais ferramentas": cada bloco mostra um número real dos seus dados e abre a ferramenta.
export default function Tools() {
  const { nav, today } = useApp();
  const { data, error } = useFetch(async () => {
    const [d, inc, res, goals, proj, an] = await Promise.all([
      get('/api/dashboard'), get('/api/incomes/list', { status: 'pending' }), get('/api/reserves'), get('/api/goals'),
      post('/api/projection', { months: 3 }), get('/api/analysis', { months: 3 }),
    ]);
    return { d, inc, res, goals, proj, an };
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { d, inc, res, goals, proj, an } = data;
  const activeGoals = goals.items.filter((g) => g.status === 'active');
  const toReceive = inc.reduce((t, r) => t + r.amount, 0);
  const neg = proj.summary.negativeMonths;
  const tiles = [
    { to: 'dashboard', title: 'Painel completo', text: 'Resumo da situação financeira, contas pendentes, gastos, receitas e compromissos futuros.', metric: `Saldo ${brl(d.totalBalance)} · ${d.pending.count} conta(s) pendente(s) (${brl(d.pending.amount)})` },
    { to: 'calendario', title: 'Calendário', text: 'Vencimentos, pagamentos, recebimentos e parcelas por dia, semana e mês.', metric: d.alerts.length ? `${d.alerts.length} vencimento(s) nos próximos dias` : 'Nada vencendo nos próximos dias' },
    { to: 'areceber', title: 'Valores a receber', text: 'Valores futuros com data prevista. Só entram no saldo quando você confirma o recebimento.', metric: `${inc.length} previsto(s) · ${brl(toReceive)}` },
    { to: 'reservas', title: 'Reservas e investimentos', text: 'Dinheiro guardado, objetivos de reserva e investimentos cadastrados manualmente.', metric: `Guardado ${brl(res.totals.accumulated)} · ${res.items.length} item(ns)` },
    { to: 'metas', title: 'Metas', text: 'Objetivos com valor desejado, valor acumulado e prazo.', metric: activeGoals.length ? `${activeGoals.length} meta(s) · ${brl(goals.totals.saved)} de ${brl(goals.totals.target)}` : 'Nenhuma meta cadastrada' },
    { to: 'projecao', title: 'Projeção', text: 'Estimativa do saldo futuro a partir das receitas e despesas registradas.', metric: `Saldo em 3 meses: ${brl(proj.summary.endClosing)}${neg.length ? ` · negativo em ${neg.map(monthShort).join(', ')}` : ''}`, warn: neg.length > 0 },
    { to: 'analises', title: 'Análise', text: 'Gráficos, comparação entre meses, categorias de gastos e compromissos.', metric: an.averages.basedOnMonths ? `Sobra média: ${brl(an.averages.leftover)}/mês` : 'Aparece quando houver meses completos com dados' },
  ];
  const more = [['receitas', 'Receitas'], ['despesas', 'Despesas'], ['contas', 'Contas'], ['dividas', 'Dívidas e parcelas'], ['retirada', 'Retirada pessoal'], ['relatorios', 'Relatórios']];
  return (
    <div className="stack">
      <PageHead title="Mais ferramentas" sub={`Tudo calculado com os seus dados reais, em ${today.split('-').reverse().join('/')}.`} />
      <div className="cols-3">
        {tiles.map((t) => (
          <Card key={t.to} title={t.title} action={<button className="btn sm primary" onClick={() => nav(t.to)}>Abrir</button>}>
            <p className="muted" style={{ marginBottom: 10 }}>{t.text}</p>
            <div className={`alert${t.warn ? ' danger' : ''}`}>{t.metric}</div>
          </Card>
        ))}
      </div>
      <Card title="Outras áreas">
        <div className="actions">{more.map(([k, l]) => <button key={k} className="btn" onClick={() => nav(k)}>{l}</button>)}</div>
      </Card>
      <p className="muted"><Badge>dica</Badge> Os valores acima são recalculados toda vez que você abre esta tela.</p>
    </div>
  );
}
