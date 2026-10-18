import { get } from '../api.js';
import { useApp, useFetch, Card, Stat, PageHead, Badge, ErrorBox, Loading, RISK } from '../ui.jsx';
import { brl, dateBR } from '../fmt.js';

export default function Home() {
  const { nav, settings, accounts } = useApp();
  const { data: d, error } = useFetch(() => get('/api/dashboard'), []);
  const { data: cards } = useFetch(() => get('/api/cards'), []);
  const { data: inc } = useFetch(() => get('/api/incomes/list'), []);
  if (error) return <ErrorBox error={error} />;
  if (!d || !cards || !inc) return <Loading />;
  const hasAcc = accounts.some((a) => !a.archived);
  const steps = [
    { ok: hasAcc, title: 'Quanto eu tenho hoje', text: 'Informe o saldo de cada conta ou do dinheiro em mãos.', go: 'dinheiro' },
    { ok: inc.length > 0, title: 'Quanto eu recebo', text: 'Salário e outros valores, com a data.', go: 'dinheiro' },
    { ok: cards.cards.length > 0, title: 'Meus cartões e faturas', text: 'Cadastre o cartão e o que você paga nele todo mês.', go: 'cartoes' },
    { ok: Number(settings.min_reserve) > 0, title: 'Quanto quero deixar sempre guardado', text: 'A reserva mínima que os simuladores respeitam.', go: 'configuracoes' },
  ];
  const left = steps.filter((s) => !s.ok);
  const sobra = d.available + d.income30 - d.next30.amount;
  return (
    <div className="stack">
      <PageHead title={`Olá, ${settings.user_name}`} sub="Resumo simples dos próximos 30 dias." />
      {left.length > 0 && (
        <Card title={`Para começar (${steps.length - left.length}/${steps.length})`}>
          <div className="alert-list">
            {steps.map((s) => (
              <div key={s.title} className="item" style={{ alignItems: 'center', borderLeftColor: s.ok ? 'var(--green)' : undefined }}>
                <span><strong>{s.ok ? '✓ ' : ''}{s.title}</strong><span className="sub">{s.text}</span></span>
                {!s.ok && <button className="btn sm primary" onClick={() => nav(s.go)}>Preencher</button>}
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="grid-stats">
        <Stat label="Tenho hoje" value={brl(d.spendable)} sub={`Livre para gastar: ${brl(d.available)}`} onClick={() => nav('dinheiro')} />
        {d.fgts > 0 && <Stat label="FGTS (travado)" value={brl(d.fgts)} sub="Não conta como dinheiro livre" onClick={() => nav('dinheiro')} />}
        <Stat label="Vai entrar (30 dias)" value={brl(d.income30)} tone="pos" sub="Só o que você marcou como garantido" onClick={() => nav('dinheiro')} />
        <Stat label="Vou pagar (30 dias)" value={brl(d.next30.amount)} sub={`Cartões este mês: ${brl(cards.totals.currentMonth)}`} onClick={() => nav('cartoes')} />
        <Stat label="Sobra estimada em 30 dias" value={brl(sobra)} tone={sobra < 0 ? 'neg' : 'pos'} sub="Livre hoje + entradas − saídas previstas" />
        <Stat label="Posso tirar com segurança" value={brl(d.withdrawal.suggested)} sub={<>Equilibrado · <Badge tone={RISK[d.withdrawal.risk][0]}>{RISK[d.withdrawal.risk][1]}</Badge></>} onClick={() => nav('retirada')} />
      </div>
      <div className="cols-2">
        <Card title="Simuladores">
          <div className="alert-list">
            <div className="item"><span><strong>Posso investir?</strong><span className="sub">Veja se um valor ou aporte mensal cabe no seu orçamento.</span></span><button className="btn sm" onClick={() => nav('simuladores', { tab: 'invest' })}>Abrir</button></div>
            <div className="item"><span><strong>Posso parcelar uma compra?</strong><span className="sub">Soma a nova parcela ao que você já paga no cartão.</span></span><button className="btn sm" onClick={() => nav('simuladores', { tab: 'compra' })}>Abrir</button></div>
          </div>
        </Card>
        <Card title="Atenção">
          {d.alerts.length === 0 ? <p className="muted">Nada vencendo nos próximos dias.</p> : (
            <div className="alert-list">{d.alerts.slice(0, 6).map((a, i) => <div key={i} className={`item ${a.kind}`}><span>{a.text.replace(/\d{4}-\d{2}-\d{2}/, dateBR)}</span><strong className="num">{brl(a.amount)}</strong></div>)}</div>
          )}
        </Card>
      </div>
    </div>
  );
}
