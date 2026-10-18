import { useState } from 'react';
import { get, post, put, del } from '../api.js';
import { useApp, useFetch, Card, Stat, PageHead, Badge, Empty, ErrorBox, Loading, FormModal, useForm, Txt, Money, Sel, Area, Progress, Tabs, accountOptions } from '../ui.jsx';
import { brl, dateBR } from '../fmt.js';

function ReserveForm({ reserve, onClose }) {
  const { accounts, refresh, notify } = useApp();
  const f = useForm(reserve || { name: '', kind: 'reserva', target: 0, account_id: '', purpose: '', deadline: '', notes: '', initial_amount: 0 });
  return (
    <FormModal title={reserve ? 'Editar' : 'Nova reserva ou investimento'} onClose={onClose}
      onSubmit={async () => { const b = { ...f.v, account_id: f.v.account_id || null, deadline: f.v.deadline || null }; reserve ? await put(`/api/reserves/${reserve.id}`, b) : await post('/api/reserves', b); notify('Salvo.'); refresh(); }}>
      <Txt f={f} name="name" label="Nome" className="full" maxLength={80} required />
      <Sel f={f} name="kind" label="Tipo" options={[{ value: 'reserva', label: 'Reserva / objetivo' }, { value: 'investimento', label: 'Investimento (manual)' }]} />
      <Money f={f} name="target" label="Valor desejado" hint="Opcional." />
      <Sel f={f} name="account_id" label="Conta de origem" options={accountOptions(accounts)} empty="Nenhuma" hint="O dinheiro continua na conta, apenas marcado como reservado." />
      <Txt f={f} name="deadline" type="date" label="Prazo" />
      {!reserve && <Money f={f} name="initial_amount" label="Valor já acumulado" hint="Será registrado como um aporte inicial." />}
      <Txt f={f} name="purpose" label="Objetivo" className="full" maxLength={200} />
      {reserve && <Sel f={f} name="status" label="Situação" options={[{ value: 'active', label: 'Ativa' }, { value: 'archived', label: 'Arquivada' }]} />}
      <Area f={f} name="notes" label="Observações" />
      {f.v.kind === 'investimento' && <div className="full muted">Investimentos são cadastrados manualmente: o sistema não inventa rentabilidade. Use "Ajustar valor" para informar rendimentos reais.</div>}
    </FormModal>
  );
}

const MOVE = {
  aporte: { title: 'Guardar dinheiro', label: 'Valor a guardar', ok: 'Guardar' },
  retirada: { title: 'Retirar da reserva', label: 'Valor a retirar', ok: 'Retirar' },
  ajuste: { title: 'Ajustar valor (rendimento/perda real)', label: 'Valor do ajuste', ok: 'Registrar ajuste' },
};
function MoveForm({ reserve, kind, onClose }) {
  const { today, refresh, notify } = useApp();
  const f = useForm({ kind, amount: 0, date: today, note: '', direction: 'in' });
  const m = MOVE[kind];
  return (
    <FormModal title={`${m.title} — ${reserve.name}`} onClose={onClose} submitLabel={m.ok}
      onSubmit={async () => { await post(`/api/reserves/${reserve.id}/movements`, f.v); notify('Movimentação registrada.'); refresh(); }}>
      <div className="full alert">
        {kind === 'aporte' && 'O dinheiro permanece na conta, mas deixa de contar como livre para gastar.'}
        {kind === 'retirada' && 'O valor volta a contar como livre para gastar. Nenhum dinheiro sai da conta.'}
        {kind === 'ajuste' && 'Use para registrar rendimento ou perda reais. Não altera o disponível das contas.'}
      </div>
      {kind === 'ajuste' && <Sel f={f} name="direction" label="Tipo" options={[{ value: 'in', label: 'Rendimento (+)' }, { value: 'out', label: 'Perda (−)' }]} />}
      <Money f={f} name="amount" label={m.label} required />
      <Txt f={f} name="date" type="date" label="Data" required />
      <Txt f={f} name="note" label="Observação" className="full" maxLength={200} />
    </FormModal>
  );
}

export default function Reserves() {
  const { refresh, notify, confirm } = useApp();
  const [tab, setTab] = useState('reserva');
  const [modal, setModal] = useState(null);
  const [open, setOpen] = useState(null);
  const { data, error } = useFetch(() => get('/api/reserves'), []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const items = data.items.filter((r) => r.kind === tab);
  const remove = async (r) => {
    if (!(await confirm({ title: 'Excluir', message: `Excluir "${r.name}" e todo o seu histórico? O valor reservado volta a contar como livre.`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/reserves/${r.id}`); notify('Excluída.'); refresh(); } catch (x) { notify(x.message, true); }
  };
  return (
    <div className="stack">
      <PageHead title="Reservas e investimentos" sub="Dinheiro guardado não é dinheiro livre para gastar.">
        <button className="btn primary" onClick={() => setModal({ t: 'form' })}>Nova</button>
      </PageHead>
      <div className="grid-stats">
        <Stat label="Total guardado" value={brl(data.totals.accumulated)} />
        <Stat label="Retido nas contas gastáveis" value={brl(data.totals.earmarked)} sub="Já descontado do disponível" />
        <Stat label="Livre para gastar" value={brl(data.totals.available)} tone={data.totals.available < 0 ? 'neg' : ''} />
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'reserva', label: 'Reservas' }, { value: 'investimento', label: 'Investimentos' }]} />
      {items.length === 0 ? <Card><Empty action={<button className="btn primary" onClick={() => setModal({ t: 'form' })}>Criar</button>}>Nada cadastrado nesta aba.</Empty></Card> : (
        <div className="cols-2">
          {items.map((r) => (
            <Card key={r.id} title={<>{r.name} {r.status === 'archived' && <Badge>arquivada</Badge>}</>}>
              <div className="stat-value">{brl(r.accumulated)}{r.target > 0 && <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}> de {brl(r.target)}</span>}</div>
              {r.pct != null && <><div style={{ margin: '8px 0' }}><Progress pct={r.pct} /></div><div className="muted">{r.pct}% · faltam {brl(Math.max(0, r.target - r.accumulated))}</div></>}
              <div className="muted" style={{ marginTop: 6 }}>{[r.purpose, r.account_name && `Conta: ${r.account_name}`, r.deadline && `Prazo: ${dateBR(r.deadline)}`].filter(Boolean).join(' · ')}</div>
              <div className="actions" style={{ marginTop: 12 }}>
                <button className="btn sm primary" onClick={() => setModal({ t: 'move', r, kind: 'aporte' })}>Guardar</button>
                <button className="btn sm" onClick={() => setModal({ t: 'move', r, kind: 'retirada' })}>Retirar</button>
                {r.kind === 'investimento' && <button className="btn sm" onClick={() => setModal({ t: 'move', r, kind: 'ajuste' })}>Ajustar valor</button>}
                <button className="btn sm ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>Histórico</button>
                <button className="btn sm ghost" onClick={() => setModal({ t: 'form', r })}>Editar</button>
                <button className="btn sm ghost" onClick={() => remove(r)}>Excluir</button>
              </div>
              {open === r.id && (r.movements.length === 0 ? <p className="muted" style={{ marginTop: 10 }}>Sem movimentações.</p> : (
                <div className="tbl-wrap" style={{ marginTop: 10 }}><table className="tbl"><tbody>
                  {r.movements.map((m) => <tr key={m.id}><td>{dateBR(m.date)}</td><td>{{ aporte: 'Guardado', retirada: 'Retirado', ajuste: 'Ajuste' }[m.kind]}{m.note && <span className="sub">{m.note}</span>}</td><td className={`num ${m.amount > 0 ? 'pos' : ''}`}>{m.amount > 0 ? '+' : ''}{brl(m.amount)}</td></tr>)}
                </tbody></table></div>
              ))}
            </Card>
          ))}
        </div>
      )}
      {modal?.t === 'form' && <ReserveForm reserve={modal.r} onClose={() => setModal(null)} />}
      {modal?.t === 'move' && <MoveForm reserve={modal.r} kind={modal.kind} onClose={() => setModal(null)} />}
    </div>
  );
}
