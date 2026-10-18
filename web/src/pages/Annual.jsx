import { get } from '../api.js';
import { useApp, useFetch, Card, Stat, Badge, ErrorBox, Loading } from '../ui.jsx';
import { BarChart, LineChart, COLORS } from '../charts.jsx';
import { brl, monthShort } from '../fmt.js';

// Visão anual (janeiro a dezembro). Realizado (já recebido/pago) fica separado do previsto (pendente).
export default function Annual({ year }) {
  const { nav } = useApp();
  const { data: a, error } = useFetch(() => get('/api/dashboard/annual', { year }), [year]);
  if (error) return <ErrorBox error={error} />;
  if (!a) return <Loading />;
  const t = a.totals;
  const real = a.rows.filter((r) => !r.future);
  return (
    <div className="stack">
      <div className="alert">Em {year}: <strong>realizado</strong> = o que já foi recebido ou pago (mexe no saldo). <strong>Previsto</strong> = pendente (não entra no saldo atual de {brl(a.balanceNow)}).</div>
      <div className="grid-stats">
        <Stat label="Recebido no ano" value={brl(t.received)} tone="pos" sub="Realizado" onClick={() => nav('receitas')} />
        <Stat label="Pago no ano" value={brl(t.paid)} sub="Realizado" onClick={() => nav('despesas')} />
        <Stat label="Resultado realizado" value={brl(t.result)} tone={t.result < 0 ? 'neg' : 'pos'} sub="Recebido − pago" />
        <Stat label="A receber (previsto)" value={brl(t.toReceive)} sub="Ainda não recebido" />
        <Stat label="A pagar (previsto)" value={brl(t.toPay)} sub="Contas, parcelas e casa pendentes" onClick={() => nav('despesas', { status: 'pending' })} />
      </div>
      <div className="cols-2">
        <Card title="Realizado por mês (recebido e pago)">
          <BarChart data={a.rows.map((r) => ({ label: monthShort(r.month).slice(0, 3), values: [r.received, r.paid] }))} series={[{ name: 'Recebido', color: COLORS.green }, { name: 'Pago', color: COLORS.slate }]} />
        </Card>
        <Card title="Previsto por mês (a receber e a pagar)">
          <BarChart data={a.rows.map((r) => ({ label: monthShort(r.month).slice(0, 3), values: [r.toReceive, r.toPay] }))} series={[{ name: 'A receber (previsto)', color: '#6ee7b7' }, { name: 'A pagar (previsto)', color: '#fda4af' }]} />
        </Card>
      </div>
      <Card title="Evolução do saldo real (fim de cada mês, até o mês atual)">
        {real.length === 0 ? <p className="muted">Este ano ainda não começou.</p> : <LineChart labels={real.map((r) => monthShort(r.month))} lines={[{ name: 'Saldo das contas', color: COLORS.ink, values: real.map((r) => r.balance) }]} />}
      </Card>
      <Card title="Comparação entre os meses">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Mês</th><th className="num">Recebido</th><th className="num">Pago</th><th className="num">Resultado</th><th className="num">vs. mês anterior</th><th className="num">A receber (prev.)</th><th className="num">A pagar (prev.)</th><th className="num">Saldo final</th></tr></thead>
          <tbody>{a.rows.map((r, i) => {
            const prev = i ? a.rows[i - 1] : null;
            const diff = prev && !r.future && !prev.future ? r.result - prev.result : null;
            return (
              <tr key={r.month} style={r.month === a.current ? { background: 'var(--green-bg)' } : undefined}>
                <td>{monthShort(r.month)}{r.future && <> <Badge>previsto</Badge></>}</td>
                <td className="num">{r.future ? '—' : brl(r.received)}</td><td className="num">{r.future ? '—' : brl(r.paid)}</td>
                <td className={`num ${r.result < 0 ? 'neg' : ''}`}>{r.future ? '—' : brl(r.result)}</td>
                <td className={`num ${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}`}>{diff == null ? '—' : `${diff > 0 ? '+' : ''}${brl(diff)}`}</td>
                <td className="num">{brl(r.toReceive)}</td>
                <td className="num">{brl(r.toPay)}{r.toPay > 0 && <span className="sub">Cartões {brl(r.toPaySplit.cards)} · Casa {brl(r.toPaySplit.house)} · Outras {brl(r.toPaySplit.other)}</span>}</td>
                <td className="num">{r.balance == null ? '—' : brl(r.balance)}</td>
              </tr>);
          })}</tbody>
          <tfoot><tr><td>Total {year}</td><td className="num">{brl(t.received)}</td><td className="num">{brl(t.paid)}</td><td className="num">{brl(t.result)}</td><td /><td className="num">{brl(t.toReceive)}</td><td className="num">{brl(t.toPay)}</td><td /></tr></tfoot>
        </table></div>
      </Card>
    </div>
  );
}
