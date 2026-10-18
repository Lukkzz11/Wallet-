import { useState, Fragment } from 'react';
import { get, post, put, del } from '../api.js';
import { useApp, useFetch, Card, Stat, PageHead, Badge, Empty, ErrorBox, Loading, FormModal, useForm, Txt, Money, Sel, Area, Chk, accountOptions, categoryOptions } from '../ui.jsx';
import { brl, dateBR, PERIOD_LABEL, PAYMENT_METHODS } from '../fmt.js';

const STATUS = { active: ['ok', 'Ativa'], paused: ['warn', 'Pausada'], cancelled: ['neutral', 'Cancelada'] };

function SubForm({ sub, onClose }) {
  const { accounts, categories, today, refresh, notify } = useApp();
  const f = useForm(sub ? { ...sub, start_date: sub.start_date || sub.next_date, end_date: sub.end_date || '', continuous: !sub.end_date }
    : { name: '', amount: 0, period: 'monthly', start_date: today, next_date: today, end_date: '', continuous: true, payment_method: '', account_id: '', category_id: '', status: 'active', notes: '' });
  return (
    <FormModal title={sub ? 'Editar assinatura' : 'Nova assinatura'} onClose={onClose} wide
      onSubmit={async () => { const b = { ...f.v, next_date: sub ? f.v.next_date : f.v.start_date, end_date: f.v.continuous ? null : f.v.end_date || null, account_id: f.v.account_id || null, category_id: f.v.category_id || null }; sub ? await put(`/api/subscriptions/${sub.id}`, b) : await post('/api/subscriptions', b); notify('Assinatura salva.'); refresh(); }}>
      <Txt f={f} name="name" label="Nome do serviço" className="full" maxLength={80} required />
      <Money f={f} name="amount" label="Valor de cada cobrança" required />
      <Sel f={f} name="period" label="Periodicidade" options={Object.entries(PERIOD_LABEL).map(([value, label]) => ({ value, label }))} />
      <Txt f={f} name="start_date" type="date" label={sub ? 'Data de início' : 'Data de início (1ª cobrança)'} hint="O dia desta data define o dia da cobrança." required />
      {sub && <Txt f={f} name="next_date" type="date" label="Próxima cobrança" hint="Cobranças já registradas ficam no histórico." required />}
      <Chk f={f} name="continuous" label="Cobrança contínua (sem data final)" />
      {!f.v.continuous && <Txt f={f} name="end_date" type="date" label="Pagar até (data da última cobrança)" hint="Ao alterar, os meses futuros são recalculados." required />}
      <Sel f={f} name="status" label="Status" options={[{ value: 'active', label: 'Ativa' }, { value: 'paused', label: 'Pausada' }, { value: 'cancelled', label: 'Cancelada' }]} />
      <Sel f={f} name="payment_method" label="Forma de pagamento" options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} empty="—" />
      <Sel f={f} name="account_id" label="Conta utilizada" options={accountOptions(accounts)} empty="—" />
      <Sel f={f} name="category_id" label="Categoria" options={categoryOptions(categories, 'expense')} empty="Assinaturas (padrão)" />
      <Area f={f} name="notes" label="Observações" />
    </FormModal>
  );
}

function ChargeModal({ sub, onClose }) {
  const { accounts, today, refresh, notify } = useApp();
  const f = useForm({ mode: 'pending', account_id: sub.account_id || accounts.find((a) => !a.archived)?.id || '', paid_date: today });
  return (
    <FormModal title={`Registrar cobrança — ${sub.name}`} onClose={onClose} submitLabel="Registrar cobrança"
      onSubmit={async () => { await post(`/api/subscriptions/${sub.id}/charge`, f.v); notify('Cobrança registrada; próxima data atualizada.'); refresh(); }}>
      <div className="full alert">
        Será criada <strong>uma despesa de {brl(sub.amount)}</strong> com vencimento em <strong>{dateBR(sub.next_date)}</strong>, e a próxima cobrança passará para a data seguinte do ciclo. Nada é registrado sem esta confirmação, e o mesmo ciclo não pode ser cobrado duas vezes.
      </div>
      <Sel f={f} name="mode" label="Situação da despesa" className="full" options={[
        { value: 'pending', label: 'Pendente — ainda não foi cobrada na minha conta' },
        { value: 'paid', label: 'Pagar agora — descontar do saldo da conta' },
        { value: 'prepaid', label: 'Já foi pago anteriormente (não retirar do dinheiro disponível)' },
      ]} />
      {f.v.mode === 'paid' && <>
        <Sel f={f} name="account_id" label="Conta usada" options={accountOptions(accounts)} empty="Selecione…" required />
        <Txt f={f} name="paid_date" type="date" label="Data do pagamento" required />
      </>}
      {f.v.mode === 'prepaid' && <>
        <Txt f={f} name="paid_date" type="date" label="Data em que foi pago" required />
      </>}
    </FormModal>
  );
}

export default function Subscriptions() {
  const { today, refresh, notify, confirm } = useApp();
  const [modal, setModal] = useState(null);
  const [open, setOpen] = useState(null);
  const { data, error } = useFetch(() => get('/api/subscriptions'), []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { items, totals } = data;
  const remove = async (s) => {
    if (!(await confirm({
      title: 'Excluir assinatura',
      message: `Excluir "${s.name}"? Ela será removida das assinaturas e convertida automaticamente para o módulo de Despesas.`,
      danger: true,
      okLabel: 'Excluir e converter em despesa'
    }))) return;
    try {
      await del(`/api/subscriptions/${s.id}`);
      notify('Assinatura removida e convertida para Despesas.');
      refresh();
    } catch (x) {
      notify(x.message, true);
    }
  };
  const resetAll = async () => {
    if (!(await confirm({
      title: 'Zerar todas as assinaturas?',
      message: 'Limpar completamente todas as assinaturas cadastradas para recadastro limpo? Suas despesas já pagas serão preservadas no histórico de Despesas.',
      danger: true,
      okLabel: 'Zerar assinaturas'
    }))) return;
    try {
      await post('/api/subscriptions/reset');
      notify('Todas as assinaturas foram zeradas para recadastro limpo.');
      refresh();
    } catch (x) {
      notify(x.message, true);
    }
  };
  const quick = async (s, patch) => {
    try {
      await put(`/api/subscriptions/${s.id}`, { name: s.name, amount: s.amount, period: s.period, next_date: s.next_date, start_date: s.start_date || s.next_date, end_date: s.end_date, continuous: !s.end_date, payment_method: s.payment_method, account_id: s.account_id, category_id: s.category_id, status: s.status, notes: s.notes, ...patch });
      notify(patch.status === 'paused' ? 'Assinatura pausada: nenhuma cobrança futura é prevista.' : 'Assinatura retomada.'); refresh();
    } catch (x) { notify(x.message, true); }
  };
  const markSubPrepaid = async (s) => {
    if (!(await confirm({
      title: 'Marcar cobrança como já paga',
      message: `Marcar a cobrança de "${s.name}" (${brl(s.amount)}) em ${dateBR(s.next_date)} como já quitada anteriormente? A data avançará para o próximo ciclo e NENHUM valor será retirado do seu saldo disponível.`,
      okLabel: 'Confirmar como já pago'
    }))) return;
    try {
      await post(`/api/subscriptions/${s.id}/charge`, { mode: 'prepaid', paid_date: s.next_date });
      notify('Cobrança registrada como já paga (sem debitar da conta).');
      refresh();
    } catch (x) { notify(x.message, true); }
  };
  const alerts = items.filter((i) => i.alert);
  return (
    <div className="stack">
      <PageHead title="Assinaturas e planos" sub="Tudo o que você paga de forma recorrente: streaming, apps, internet, planos. Cadastre uma vez; o total aparece no final.">
        <button className="btn primary" onClick={() => setModal({ t: 'form' })}>Nova assinatura</button>
        {items.length > 0 && <button className="btn danger" onClick={resetAll}>Zerar assinaturas</button>}
      </PageHead>
      {alerts.length > 0 && (
        <div className="alert warn">Cobranças próximas ou a registrar:
          <ul>{alerts.map((a) => <li key={a.id}>{a.name} — {brl(a.amount)} em {dateBR(a.next_date)}{a.late ? ' (data já passou: registre a cobrança)' : ''}</li>)}</ul>
        </div>
      )}
      {items.length === 0 ? <Card><Empty action={<button className="btn primary" onClick={() => setModal({ t: 'form' })}>Cadastrar assinatura</button>}>Nenhuma assinatura cadastrada.</Empty></Card> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Serviço</th><th className="num">Cobrança</th><th>Periodicidade</th><th className="num">Por mês</th><th className="num">Por ano</th><th>Próxima</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {items.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td>{s.name}{s.end_date && <span className="sub">{s.ended ? `Encerrada em ${dateBR(s.end_date)}` : `Paga até ${dateBR(s.end_date)}`}</span>}{!s.end_date && s.status === 'active' && <span className="sub">Cobrança contínua</span>}{s.status !== 'cancelled' && !s.ended && <span className="sub">Cancelar economiza {brl(s.monthly)}/mês · {brl(s.yearly)}/ano</span>}</td>
                  <td className="num">{brl(s.amount)}</td><td>{PERIOD_LABEL[s.period]}</td><td className="num">{brl(s.monthly)}</td><td className="num">{brl(s.yearly)}</td>
                  <td>{s.status === 'active' ? <>{dateBR(s.next_date)}<span className="sub" style={s.late ? { color: 'var(--red)' } : {}}>{s.late ? `atrasada ${-s.days_to_charge} dia(s)` : s.days_to_charge === 0 ? 'hoje' : `em ${s.days_to_charge} dia(s)`}</span></> : '—'}</td>
                  <td>{s.ended ? <Badge>Encerrada</Badge> : <Badge tone={STATUS[s.status][0]}>{STATUS[s.status][1]}</Badge>}</td>
                  <td className="row-actions">
                    {s.status === 'active' && !s.ended && (
                      <>
                        <button className="btn sm" onClick={() => setModal({ t: 'charge', sub: s })}>Registrar cobrança</button>
                        <button className="btn sm ghost" title="Marcar como já pago sem debitar da conta" onClick={() => markSubPrepaid(s)}>Já foi pago</button>
                      </>
                    )}
                    {(s.status === 'active' || s.status === 'paused') && !s.ended && <button className="btn sm ghost" onClick={() => quick(s, { status: s.status === 'active' ? 'paused' : 'active' })}>{s.status === 'active' ? 'Pausar' : 'Retomar'}</button>}
                    <button className="btn sm ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>Histórico ({s.history.length})</button>
                    <button className="btn sm ghost" onClick={() => setModal({ t: 'form', sub: s })}>Editar</button>
                    <button className="btn sm ghost" onClick={() => remove(s)}>Excluir</button>
                  </td>
                </tr>
                {open === s.id && (
                  <tr key={`${s.id}h`}><td colSpan={8} style={{ background: 'var(--panel)' }}>
                    {s.history.length === 0 ? <span className="muted">Nenhuma cobrança registrada ainda.</span> : (
                      <table className="tbl"><thead><tr><th>Vencimento</th><th>Pagamento</th><th>Status</th><th className="num">Valor</th><th></th></tr></thead>
                        <tbody>{s.history.map((h) => (
                          <tr key={h.id}>
                            <td>{dateBR(h.due_date)}</td>
                            <td>{dateBR(h.paid_date)}</td>
                            <td>{h.status === 'paid' ? 'Paga' : 'Pendente'}</td>
                            <td className="num">{brl(h.amount)}</td>
                            <td className="row-actions">
                              {h.status === 'pending' && (
                                <button className="btn sm ghost" onClick={async () => {
                                  await post(`/api/entries/${h.id}/mark-prepaid`, { paid_date: h.due_date });
                                  notify('Marcado como pago sem debitar.');
                                  refresh();
                                }}>Já foi pago</button>
                              )}
                            </td>
                          </tr>
                        ))}</tbody></table>
                    )}
                    <p className="muted" style={{ marginTop: 6 }}>Total já pago: {brl(s.paid_total)}</p>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table></div>
      )}
      {items.length > 0 && (
        <Card title="Quanto eu gasto com assinaturas">
      <div className="grid-stats" style={{ marginBottom: 0 }}>
        <Stat label="Assinaturas ativas" value={totals.activeCount} />
        <Stat label="Custo mensal equivalente" value={brl(totals.monthly)} />
        <Stat label="Custo anual equivalente" value={brl(totals.yearly)} />
        <Stat label="A cobrar nos próximos 30 dias" value={brl(totals.next30)} sub="Valor real que sairá da conta" />
      </div>

          <p className="muted" style={{ marginTop: 10 }}>Assinaturas ficam separadas dos cartões, mesmo que você pague com cartão. O custo mensal é uma média; o dinheiro precisa estar disponível na data de cada cobrança.</p>
        </Card>
      )}
      {modal?.t === 'form' && <SubForm sub={modal.sub} onClose={() => setModal(null)} />}
      {modal?.t === 'charge' && <ChargeModal sub={modal.sub} onClose={() => setModal(null)} />}
    </div>
  );
}
