import { useState } from 'react';
import { get } from '../api.js';
import { PiggyBank, CalendarClock, ShoppingCart, CreditCard, Scale } from 'lucide-react';
import { useApp, useFetch, Card, Kpi, Empty, Modal, Tabs, MonthPicker, Badge } from '../ui.jsx';
import { BarChart, COLORS } from '../charts.jsx';
import { brl, dateBR, monthShort, monthFull, monthEnd } from '../fmt.js';

const sum = (l, f = () => true) => l.filter(f).reduce((t, r) => t + r.amount, 0);
const cardLabel = (c) => c.bank || c.name;

// Janela de "A receber": próximos recebimentos, mensal ou anual. Previsto nunca entra no saldo.
function ReceivablesPanel({ onClose, initialMonth }) {
  const { today, nav } = useApp();
  const [view, setView] = useState('month');
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(Number(initialMonth.slice(0, 4)));
  const { data } = useFetch(() => get('/api/incomes/list'), []);
  const all = data || [];
  const inMonth = all.filter((r) => r.due_date.slice(0, 7) === month).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const yearRows = Array.from({ length: 12 }, (_, i) => {
    const k = `${year}-${String(i + 1).padStart(2, '0')}`;
    const l = all.filter((r) => r.due_date.slice(0, 7) === k);
    return { k, received: sum(l, (r) => r.status === 'paid'), sure: sum(l, (r) => r.status === 'pending' && r.certain), maybe: sum(l, (r) => r.status === 'pending' && !r.certain) };
  });
  const late = all.filter((r) => r.status === 'pending' && r.due_date < today);
  return (
    <Modal title="A receber" wide onClose={onClose} footer={<><button className="btn" onClick={() => { onClose(); nav('dinheiro', { tab: 'rec' }); }}>Abrir recebimentos</button><button className="btn primary" onClick={onClose}>Fechar</button></>}>
      <div className="alert" style={{ marginBottom: 12 }}>Estes valores são <strong>previsões</strong>: não estão no saldo atual. Entram no saldo só quando você marca como recebido.</div>
      <Tabs value={view} onChange={setView} items={[{ value: 'month', label: 'Mensal' }, { value: 'year', label: 'Anual' }]} />
      {late.length > 0 && <div className="alert warn" style={{ marginBottom: 10 }}>{late.length} recebimento(s) passaram da data e ainda não foram marcados como recebidos ({brl(sum(late))}).</div>}
      {view === 'month' ? (
        <>
          <div className="filters"><MonthPicker value={month} onChange={setMonth} /><span className="muted">A receber: <strong>{brl(sum(inMonth, (r) => r.status === 'pending'))}</strong> · Recebido: <strong>{brl(sum(inMonth, (r) => r.status === 'paid'))}</strong></span></div>
          {inMonth.length === 0 ? <Empty>Nada previsto para {monthShort(month)}.</Empty> : (
            <div className="tbl-wrap"><table className="tbl"><tbody>{inMonth.map((r) => (
              <tr key={r.id}><td>{dateBR(r.due_date)}</td><td>{r.origin || r.description}</td>
                <td>{r.status === 'paid' ? <Badge tone="ok">Recebido</Badge> : r.due_date < today ? <Badge tone="danger">Passou da data</Badge> : <Badge>Previsto</Badge>}{r.status !== 'paid' && !r.certain && <> <Badge tone="warn">incerto</Badge></>}</td>
                <td className="num pos">{brl(r.amount)}</td></tr>))}</tbody></table></div>
          )}
        </>
      ) : (
        <>
          <div className="filters"><div className="actions"><button className="btn sm" onClick={() => setYear(year - 1)}>‹</button><strong>{year}</strong><button className="btn sm" onClick={() => setYear(year + 1)}>›</button></div></div>
          <BarChart data={yearRows.map((r) => ({ label: monthShort(r.k).slice(0, 3), values: [r.received, r.sure, r.maybe] }))} series={[{ name: 'Recebido', color: COLORS.ink }, { name: 'A receber (certo)', color: COLORS.green }, { name: 'A receber (incerto)', color: COLORS.slate }]} height={180} />
          <div className="tbl-wrap" style={{ marginTop: 10 }}><table className="tbl">
            <thead><tr><th>Mês</th><th className="num">Recebido</th><th className="num">A receber (certo)</th><th className="num">A receber (incerto)</th></tr></thead>
            <tbody>{yearRows.map((r) => <tr key={r.k}><td>{monthFull(r.k).split(' de ')[0]}</td><td className="num">{brl(r.received)}</td><td className="num pos">{brl(r.sure)}</td><td className="num">{brl(r.maybe)}</td></tr>)}</tbody>
            <tfoot><tr><td>Total {year}</td><td className="num">{brl(yearRows.reduce((t, r) => t + r.received, 0))}</td><td className="num">{brl(yearRows.reduce((t, r) => t + r.sure, 0))}</td><td className="num">{brl(yearRows.reduce((t, r) => t + r.maybe, 0))}</td></tr></tfoot>
          </table></div>
        </>
      )}
    </Modal>
  );
}

// Painel simples: 1) quatro números principais, 2) o que ainda falta pagar, 3) previsão, 4) a receber.
// Saldo atual (dinheiro de hoje) ≠ resultado do mês (recebido − pago) ≠ saldo projetado (saldo − pendências).
export default function Summary({ d, month }) {
  const { nav } = useApp();
  const [panel, setPanel] = useState(false);
  const { data } = useFetch(async () => {
    const [cards, incAll] = await Promise.all([get('/api/cards', { month }), get('/api/incomes/list')]);
    return { cards, incAll };
  }, [month]);
  const cm = d.commitments;
  const ov = data?.cards;
  const incAll = data?.incAll || [];
  const inc = incAll.filter((r) => r.status === 'pending').sort((a, b) => a.due_date.localeCompare(b.due_date));
  const incMonth = incAll.filter((r) => r.due_date.slice(0, 7) === month);
  // previsto do mês inteiro = já recebido + pendente certo (receita incerta nunca entra na previsão)
  const monthMaybe = sum(incMonth, (r) => r.status === 'pending' && !r.certain);
  // o aluguel é amortizado na parcela da casa: do total entra só o que sobra do aluguel
  const rent = d.rentToHouse || { expected: 0, houseTotal: 0, amortized: 0, left: 0 }; // servidor antigo ainda aberto não envia este campo
  const monthExpected = sum(incMonth, (r) => r.status === 'paid' || r.certain) - rent.amortized;
  const monthReceived = sum(incMonth, (r) => r.status === 'paid');
  const monthToReceive = monthExpected - Math.max(0, monthReceived - rent.amortized);
  const cardsSubs = cm.cards.total + cm.subs.total;
  const afterCardsSubs = monthExpected - cardsSubs;
  const toReceiveMonth = sum(inc, (r) => r.due_date.slice(0, 7) === month);
  const sureMonth = sum(inc, (r) => r.due_date.slice(0, 7) === month && r.certain);
  const result = d.received - d.paid;
  // pendências de meses anteriores (já vencidas): fazem parte do que precisa ser pago
  const prevOverdue = Math.max(0, d.pending.amount - (cm.pending - cm.subsProjected));
  const projected = d.spendable - cm.pending - prevOverdue;
  const range = { from: `${month}-01`, to: monthEnd(month) };
  const groups = [
    ['Contas e despesas', cm.other, () => nav('despesas', range)],
    ['Casa', cm.house, () => nav('dinheiro', { tab: 'casa' })],
    ['Assinaturas e serviços', cm.subs, () => nav('assinaturas')],
  ];
  return (
    <div className="stack">
      <div className="actions">
        <button className="btn" onClick={() => nav('dinheiro', { tab: 'dia' })}>+ Registrar gasto</button>
        <button className="btn" onClick={() => nav('compra-parcelada')}>+ Adicionar parcela</button>
        <button className="btn" onClick={() => nav('dinheiro', { tab: 'rec' })}>+ Valor a receber</button>
        <button className="btn" onClick={() => nav('compra-nova')}>+ Compra nova</button>
      </div>
      {d.overdue.count > 0 && <div className="alert danger">Você tem {d.overdue.count} conta(s) atrasada(s) ({brl(d.overdue.amount)}). <button className="link" onClick={() => nav('despesas', { status: 'overdue' })}>Ver</button></div>}

      <div className="kpi-grid">
        <Kpi index={0} color="#10b981" icon={PiggyBank} label="Saldo Total Guardado" value={brl(d.totalBalance)}
          sub={`Em contas e investimentos. Livre para gastar: ${brl(d.available)}${d.reserved > 0 ? ` · Reservado: ${brl(d.reserved)}` : ''}${d.fgts > 0 ? ` · FGTS: ${brl(d.fgts)}` : ''}`} onClick={() => nav('contas')} />
        <Kpi index={1} color="#38bdf8" icon={CalendarClock} label="Total a Receber no Mês" value={brl(monthExpected)}
          sub={`${rent.amortized > 0 ? `Aluguel ${brl(rent.expected)} − parcela da casa ${brl(rent.amortized)} = ${brl(rent.left)}. ` : ''}Recebido ${brl(monthReceived)} · falta receber ${brl(monthToReceive)}${monthMaybe > 0 ? ` (${brl(monthMaybe)} incertos ficam de fora)` : ''}`} onClick={() => setPanel(true)} />
        <Kpi index={2} color="#fb923c" icon={ShoppingCart} label="Quanto gastei" value={brl(d.paid)}
          sub={`Despesas já pagas em ${monthShort(month)}`} onClick={() => nav('despesas', range)} />
        <Kpi index={3} color="#a78bfa" icon={CreditCard} label="Gastos Cartões & Assinaturas" value={brl(cardsSubs)}
          sub={`Faturas ${brl(cm.cards.total)} · Assinaturas ${brl(cm.subs.total)} · Falta pagar ${brl(cm.cards.pending + cm.subs.pending)}`} onClick={() => nav('cartoes')} />
        <Kpi index={4} color={afterCardsSubs < 0 ? '#fb7185' : '#2dd4bf'} icon={Scale} label="A receber − Cartões & Assinaturas" value={brl(afterCardsSubs)} tone={afterCardsSubs < 0 ? 'neg' : 'pos'}
          sub={`Total a receber ${brl(monthExpected)} menos cartões e assinaturas ${brl(cardsSubs)}`} onClick={() => nav('cartoes')} />
      </div>
      {!d.rentToHouse && <div className="alert warn">O Wallet aberto está com o programa antigo e ainda não aplica a regra do aluguel. Feche o Wallet e use o atalho <strong>Atualizar Wallet</strong>.</div>}
      {rent.amortized > 0 && <p className="muted">O aluguel de {monthShort(month)} ({brl(rent.expected)}) é usado nas parcelas da casa ({brl(rent.houseTotal)}); só {brl(rent.left)} entra em "Total a Receber no Mês".</p>}

      <Card title={`O que ainda falta pagar em ${monthShort(month)}`}>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Grupo</th><th className="num">Total do mês</th><th className="num">Já pago</th><th className="num">Falta pagar</th></tr></thead>
          <tbody>
            <tr><td><button className="link" style={{ textDecoration: 'none' }} onClick={() => nav('cartoes')}><strong>Faturas dos cartões</strong></button></td><td className="num">{brl(cm.cards.total)}</td><td className="num pos">{brl(cm.cards.paid)}</td><td className="num"><strong>{brl(cm.cards.pending)}</strong></td></tr>
            {(ov?.cards || []).filter((c) => c.monthTotal > 0).map((c) => (
              <tr key={c.id} style={{ color: 'var(--ink-2)' }}><td style={{ paddingLeft: 28 }}>{cardLabel(c)}{c.bank && c.name !== c.bank && <span className="sub">{c.name}</span>}</td><td className="num">{brl(c.monthTotal)}</td><td className="num">{brl(c.monthPaid)}</td><td className="num">{brl(c.monthPending)}</td></tr>
            ))}
            {groups.map(([label, g, go]) => (
              <tr key={label}><td><button className="link" style={{ textDecoration: 'none' }} onClick={go}><strong>{label}</strong></button></td><td className="num">{brl(g.total)}</td><td className="num pos">{brl(g.paid)}</td><td className="num"><strong>{brl(g.pending)}</strong></td></tr>
            ))}
          </tbody>
          <tfoot><tr><td>Total do mês (cada despesa conta uma vez)</td><td className="num">{brl(cm.total)}</td><td className="num">{brl(cm.paid)}</td><td className="num">{brl(cm.pending)}</td></tr></tfoot>
        </table></div>
        {cm.subsProjected > 0 && <p className="muted" style={{ marginTop: 8 }}>Inclui {brl(cm.subsProjected)} de assinaturas previstas que ainda não foram registradas. Assinaturas e parcelas aparecem uma única vez, mesmo quando pagas no cartão.</p>}
      </Card>

      <div className="cols-2" style={{ marginBottom: 0 }}>
        <Card title="Saldo projetado">
          <div className="kv"><span>Saldo atual (hoje)</span><strong>{brl(d.spendable)}</strong></div>
          {prevOverdue > 0 && <div className="kv"><span>(−) Atrasado de meses anteriores</span><span className="neg">−{brl(prevOverdue)}</span></div>}
          <div className="kv"><span>(−) Compromissos pendentes de {monthShort(month)}</span><span>−{brl(cm.pending)}</span></div>
          <div className="kv" style={{ fontWeight: 700 }}><span>(=) Saldo projetado, sem contar o que vai receber</span><span className={projected < 0 ? 'neg' : ''}>{brl(projected)}</span></div>
          {sureMonth > 0 && <div className="kv"><span>Se receber o que está garantido em {monthShort(month)}</span><span className="pos">{brl(projected + sureMonth)}</span></div>}
          <p className="muted" style={{ marginTop: 8 }}>Saldo atual = dinheiro nas contas hoje. Resultado do mês = recebido − pago. Saldo projetado = saldo atual − o que ainda falta pagar. Previsões de recebimento nunca entram no saldo atual.</p>
        </Card>
        <Card title="A receber (fora do seu saldo)" action={<button className="btn sm" onClick={() => setPanel(true)}>Ver mensal e anual</button>}>
          <div className="kv"><span>Previsto em {monthShort(month)}</span><strong className="pos">{brl(toReceiveMonth)}</strong></div>
          <div className="kv"><span>Total geral previsto</span><span>{brl(sum(inc))}</span></div>
          {inc.length === 0 ? <Empty>Nada a receber cadastrado.</Empty> : (
            <div className="tbl-wrap" style={{ marginTop: 8 }}><table className="tbl"><tbody>{inc.slice(0, 4).map((r) => (
              <tr key={r.id}><td>{dateBR(r.due_date)}</td><td>{r.origin || r.description}</td><td className="num pos">{brl(r.amount)}</td></tr>))}</tbody></table></div>
          )}
        </Card>
      </div>

      <Card title="Parcelas futuras e próximos meses">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Mês</th><th className="num">Compromissos</th><th className="num">Cartões</th><th className="num">Assinaturas</th><th className="num">Casa</th><th className="num">Outras</th></tr></thead>
          <tbody>{d.nextMonths.map((n) => (
            <tr key={n.month}><td>{monthFull(n.month).split(' de ')[0]} <span className="muted">{n.month.slice(0, 4)}</span></td><td className="num"><strong>{brl(n.total)}</strong></td><td className="num">{brl(n.cards)}</td><td className="num">{brl(n.subs)}</td><td className="num">{brl(n.house)}</td><td className="num">{brl(n.other)}</td></tr>))}</tbody>
        </table></div>
        {ov && <p className="muted" style={{ marginTop: 8 }}>Parcelas de cartão depois de {monthShort(month)}: <strong>{brl(ov.totals.futureAmount)}</strong> ({ov.totals.futureCount} parcela(s)). <button className="link" onClick={() => nav('cartoes')}>Ver cartões</button></p>}
        {ov && ov.relief[0] && <p className="muted">O valor mensal dos cartões diminui em <strong>{monthShort(ov.relief[0].month)}</strong> ({brl(ov.relief[0].amount)} a menos).</p>}
      </Card>
      {panel && <ReceivablesPanel initialMonth={month} onClose={() => setPanel(false)} />}
    </div>
  );
}

