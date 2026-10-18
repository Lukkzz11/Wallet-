import { useState } from 'react';
import { get, del, post } from '../api.js';
import { useApp, useFetch, Card, Stat, PageHead, Badge, Empty, ErrorBox, Loading } from '../ui.jsx';
import { BarChart, COLORS } from '../charts.jsx';
import { brl, dateBR, monthShort, monthFull, addMonthKey } from '../fmt.js';
import { PayModal, EntryForm } from './Entries.jsx';

export default function Receivables() {
  const { today, refresh, notify, confirm } = useApp();
  const [showDone, setShowDone] = useState(false);
  const [form, setForm] = useState(null);
  const [pay, setPay] = useState(null);
  const { data: rows, error } = useFetch(() => get('/api/incomes/list'), []);
  const { data: dash } = useFetch(() => get('/api/dashboard'), []);
  if (error) return <ErrorBox error={error} />;
  if (!rows) return <Loading />;
  const cur = today.slice(0, 7);
  const pending = rows.filter((r) => r.status === 'pending');
  const late = pending.filter((r) => r.due_date < today);
  const groups = {};
  for (const r of rows) {
    if (r.status === 'paid' && !showDone) continue;
    if (r.status === 'paid' && r.due_date.slice(0, 7) < addMonthKey(cur, -2)) continue;
    const k = r.status === 'pending' && r.due_date < today ? 'late' : r.due_date.slice(0, 7);
    (groups[k] ||= []).push(r);
  }
  const keys = Object.keys(groups).sort((a, b) => (a === 'late' ? -1 : b === 'late' ? 1 : a.localeCompare(b)));
  const sumOf = (list, f) => list.filter(f).reduce((t, r) => t + r.amount, 0);
  const chart = Array.from({ length: 6 }, (_, i) => addMonthKey(cur, i)).map((k) => {
    const inM = rows.filter((r) => r.status === 'pending' && r.due_date.slice(0, 7) === k || (k === cur && late.includes(r)));
    return { label: monthShort(k), values: [sumOf(inM, (r) => r.certain), sumOf(inM, (r) => !r.certain)] };
  });
  const remove = async (r) => {
    if (!(await confirm({ title: 'Excluir', message: `Excluir "${r.description}" (${brl(r.amount)})?${r.status === 'paid' ? ' O recebimento será desfeito e o saldo ajustado.' : ''}`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/entries/${r.id}`, { scope: 'one' }); notify('Excluído.'); refresh(); } catch (x) { notify(x.message, true); }
  };
  const undo = async (r) => {
    if (!(await confirm({ title: 'Desfazer recebimento', message: `O valor de "${r.description}" sai do saldo e volta a ser "a receber".`, okLabel: 'Desfazer' }))) return;
    try { await post(`/api/entries/${r.id}/unpay`); refresh(); } catch (x) { notify(x.message, true); }
  };
  return (
    <div className="stack">
      <PageHead title="Valores a receber" sub="Dinheiro que ainda vai entrar. Só passa a fazer parte do saldo quando você marca como recebido.">
        <button className="btn primary" onClick={() => setForm({})}>Novo valor a receber</button>
      </PageHead>
      <div className="grid-stats">
        <Stat label="Saldo real hoje" value={brl(dash?.totalBalance ?? 0)} sub="Não inclui nada a receber" />
        <Stat label="A receber (total)" value={brl(sumOf(pending, () => true))} sub={`${pending.length} lançamento(s)`} />
        <Stat label="Garantido" value={brl(sumOf(pending, (r) => r.certain))} tone="pos" sub="Só entra no saldo ao receber" />
        <Stat label="Incerto" value={brl(sumOf(pending, (r) => !r.certain))} />
        <Stat label="Atrasado (data passou, não recebido)" value={brl(sumOf(late, () => true))} tone={late.length ? 'neg' : ''} sub={late.length ? 'Confirme se já recebeu' : 'Nada atrasado'} />
      </div>
      <Card title="Previsto por mês (próximos 6 meses)">
        <BarChart data={chart} series={[{ name: 'Garantido', color: COLORS.green }, { name: 'Incerto', color: COLORS.slate }]} height={180} />
      </Card>
      <div className="filters"><label className="check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /><span>Mostrar recebidos recentes</span></label></div>
      {keys.length === 0 ? <Card><Empty action={<button className="btn primary" onClick={() => setForm({})}>Cadastrar valor a receber</button>}>Nada a receber cadastrado.</Empty></Card> : keys.map((k) => {
        const list = groups[k].sort((a, b) => a.due_date.localeCompare(b.due_date));
        return (
          <Card key={k} title={k === 'late' ? 'Atrasados — aguardando confirmação' : monthFull(k)} action={<span className="muted">A receber: {brl(sumOf(list, (r) => r.status !== 'paid'))} · Recebido: {brl(sumOf(list, (r) => r.status === 'paid'))}</span>}>
            <div className="tbl-wrap"><table className="tbl"><tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>{dateBR(r.due_date)}</td>
                  <td>{r.origin || <span className="muted">sem origem</span>}<span className="sub">{r.description}</span></td>
                  <td>{r.status === 'paid' ? <Badge tone="ok">Recebido {dateBR(r.paid_date)}</Badge> : r.due_date < today ? <Badge tone="danger">Atrasado</Badge> : <Badge>Previsto</Badge>}{r.status !== 'paid' && !r.certain && <> <Badge tone="warn">incerto</Badge></>}</td>
                  <td className="num pos">{brl(r.amount)}</td>
                  <td className="row-actions">
                    {r.status === 'paid' ? <button className="btn sm ghost" onClick={() => undo(r)}>Desfazer</button> : <button className="btn sm primary" onClick={() => setPay(r)}>Marcar recebido</button>}
                    <button className="btn sm ghost" onClick={() => setForm(r)}>Editar</button>
                    <button className="btn sm ghost" onClick={() => remove(r)}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody></table></div>
          </Card>
        );
      })}
      {form && <EntryForm kind="income" entry={form.id ? form : null} onClose={() => setForm(null)} />}
      {pay && <PayModal entry={pay} onClose={() => setPay(null)} />}
    </div>
  );
}
