import { useState } from 'react';
import { get } from '../api.js';
import { useApp, useFetch, Card, PageHead, Badge, Empty, ErrorBox, Tabs } from '../ui.jsx';
import { brl, dateBR, addDaysStr, addMonthKey, monthEnd, monthFull, weekdayOf, WEEKDAY } from '../fmt.js';
import { PayModal } from './Entries.jsx';

const KIND_LABEL = { income: 'Receita', expense: 'Despesa', subscription: 'Assinatura', installment: 'Parcela', goal: 'Meta/prazo' };

export default function CalendarPage() {
  const { today } = useApp();
  const [view, setView] = useState('month');
  const [anchor, setAnchor] = useState(today);
  const [sel, setSel] = useState(today);
  const [pay, setPay] = useState(null);
  const key = anchor.slice(0, 7);
  // intervalo exibido
  let from, to;
  if (view === 'month') {
    const first = `${key}-01`;
    const dow = weekdayOf(first);
    from = addDaysStr(first, -dow);
    const last = monthEnd(key);
    to = addDaysStr(last, 6 - weekdayOf(last));
  } else if (view === 'week') { from = addDaysStr(anchor, -weekdayOf(anchor)); to = addDaysStr(from, 6); } else { from = to = anchor; }
  const { data: items, error } = useFetch(() => get('/api/calendar', { from, to }), [from, to]);
  const move = (n) => setAnchor(view === 'month' ? `${addMonthKey(key, n)}-01` : addDaysStr(anchor, n * (view === 'week' ? 7 : 1)));
  const byDay = {};
  (items || []).forEach((i) => { (byDay[i.date] ||= []).push(i); });
  const days = [];
  for (let d = from; d <= to; d = addDaysStr(d, 1)) days.push(d);
  const cls = (i) => `chip ${i.income ? 'income' : ''} ${i.status === 'overdue' ? 'overdue' : ''} ${i.status === 'paid' ? 'paid' : ''} ${i.kind === 'goal' ? 'goal' : ''}`;
  const listDay = view === 'day' ? anchor : sel;
  const listItems = view === 'week' ? items || [] : byDay[listDay] || [];
  const title = view === 'month' ? monthFull(key) : view === 'week' ? `${dateBR(from)} a ${dateBR(to)}` : dateBR(anchor);
  return (
    <div className="stack">
      <PageHead title="Calendário financeiro" sub="Vencimentos, assinaturas, parcelas, receitas previstas e prazos. Uma data passada não marca nada como pago.">
        <Tabs value={view} onChange={setView} items={[{ value: 'month', label: 'Mês' }, { value: 'week', label: 'Semana' }, { value: 'day', label: 'Dia' }]} />
      </PageHead>
      <div className="filters" style={{ justifyContent: 'space-between' }}>
        <div className="actions"><button className="btn sm" onClick={() => move(-1)}>‹</button><strong style={{ minWidth: 190, textAlign: 'center' }}>{title}</strong><button className="btn sm" onClick={() => move(1)}>›</button></div>
        <button className="btn sm" onClick={() => { setAnchor(today); setSel(today); }}>Hoje</button>
      </div>
      <ErrorBox error={error} />
      {view !== 'day' && (
        <div className="cal">
          {WEEKDAY.map((w) => <div key={w} className="dow">{w}</div>)}
          {days.map((d) => (
            <button key={d} className={`day${d.slice(0, 7) !== key && view === 'month' ? ' out' : ''}${d === today ? ' today' : ''}${d === sel ? ' sel' : ''}`} onClick={() => setSel(d)} style={view === 'week' ? { minHeight: 150 } : undefined}>
              <span className="dn">{Number(d.slice(8))}</span>
              {(byDay[d] || []).slice(0, view === 'week' ? 8 : 3).map((i, k) => <span key={k} className={cls(i)} title={`${i.title} — ${brl(i.amount)}`}>{i.title}</span>)}
              {(byDay[d] || []).length > (view === 'week' ? 8 : 3) && <span className="muted">+{byDay[d].length - (view === 'week' ? 8 : 3)}</span>}
            </button>
          ))}
        </div>
      )}
      <Card title={view === 'week' ? 'Compromissos da semana' : `Compromissos de ${dateBR(listDay)}`}>
        {listItems.length === 0 ? <Empty>Nada nesta data.</Empty> : (
          <div className="tbl-wrap"><table className="tbl"><tbody>
            {listItems.map((i, k) => (
              <tr key={k}>
                <td>{view === 'week' && dateBR(i.date)}</td>
                <td>{i.title}{i.uncertain && <> <Badge tone="warn">incerta</Badge></>}<span className="sub">{KIND_LABEL[i.kind]}{i.category ? ` · ${i.category}` : ''}</span></td>
                <td><Badge tone={i.status === 'overdue' ? 'danger' : i.status === 'paid' ? 'ok' : 'neutral'}>{{ overdue: 'Atrasada', paid: i.income ? 'Recebida' : 'Paga', pending: i.income ? 'Prevista' : 'Pendente', info: 'Prazo' }[i.status]}</Badge></td>
                <td className={`num ${i.income ? 'pos' : ''}`}>{brl(i.amount)}</td>
                <td className="row-actions">{i.entry_id && i.status !== 'paid' && <button className="btn sm" onClick={() => setPay({ id: i.entry_id, type: i.income ? 'income' : 'expense', description: i.title, amount: i.amount })}>{i.income ? 'Receber' : 'Pagar'}</button>}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
      {pay && <PayModal entry={pay} onClose={() => setPay(null)} />}
    </div>
  );
}
