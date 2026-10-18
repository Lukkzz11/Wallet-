import { useState, useEffect, Fragment } from 'react';
import { get, post, put, del } from '../api.js';
import { useApp, useFetch, Card, Stat, PageHead, Badge, Empty, ErrorBox, Loading, FormModal, useForm, Txt, Num, Money, Sel, Field, MoneyInput, Progress, MonthPicker, accountOptions } from '../ui.jsx';
import { LineChart, COLORS } from '../charts.jsx';
import { brl, dateBR, monthShort, monthFull, addMonthKey } from '../fmt.js';
import { PayModal } from './Entries.jsx';

const PALETTE = ['#14532d', '#1e3a8a', '#4c1d95', '#7c2d12', '#111827', '#9f1239', '#0f766e', '#374151'];
const BRANDS = ['Visa', 'Mastercard', 'Elo', 'American Express', 'Hipercard', 'Outra'];
const shade = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

// Cartão visual (inspirado em carteiras digitais; sem logotipos). stacked = faixa de cartão empilhado.
export function CardVisual({ card, onClick, stacked, extra, small }) {
  const color = card.color || PALETTE[(card.id || 0) % PALETTE.length];
  return (
    <div className={`wcard${stacked ? ' stacked' : ''}${small ? ' small' : ''}${onClick ? ' clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => onClick && (e.key === 'Enter' || e.key === ' ') && onClick()}
      style={{ background: `linear-gradient(135deg, ${color}, ${shade(color, -0.4)})` }} aria-label={`Cartão ${card.name}`}>
      <div className="wc-top"><span className="wc-bank">{card.bank || 'Cartão de crédito'}</span><span className="wc-brand">{card.brand || ''}</span></div>
      <div className="wc-name">{card.name}</div>
      {extra && <div className="wc-extra">{extra}</div>}
      <div className="wc-chip" />
      <div className="wc-bottom"><span>{card.last4 ? `•••• ${card.last4}` : ''}</span><span>{card.credit_limit ? `Limite ${brl(card.credit_limit)}` : ''}</span></div>
    </div>
  );
}

export function CardForm({ card, onClose, inline }) {
  const { accounts, refresh, notify } = useApp();
  const f = useForm(card || { name: '', bank: '', brand: '', last4: '', color: PALETTE[0], credit_limit: 0, due_day: 10, account_id: '', notes: '', used_extra: 0 });
  const [more, setMore] = useState(false);
  const v = f.v;
  return (
    <FormModal title={card ? 'Editar cartão' : 'Novo cartão'} wide inline={inline} onClose={onClose}
      onSubmit={async () => { const b = { ...v, account_id: v.account_id || null }; card ? await put(`/api/cards/${card.id}`, b) : await post('/api/cards', b); notify('Cartão salvo.'); refresh(); }}>
      <div className="full" style={{ maxWidth: 360 }}><CardVisual card={{ ...v, id: card?.id || 0, name: v.name || 'Nome do cartão' }} small /></div>
      <Txt f={f} name="bank" label="Banco ou instituição" maxLength={40} placeholder="Ex.: Nubank, Itaú" />
      <Txt f={f} name="name" label="Nome do cartão" maxLength={60} required placeholder="Ex.: Cartão principal" />
      <Sel f={f} name="brand" label="Bandeira (opcional)" options={BRANDS.map((b) => ({ value: b, label: b }))} empty="Não informar" />
      <Txt f={f} name="last4" label="Últimos 4 dígitos (opcional)" maxLength={4} inputMode="numeric" placeholder="0000" />
      <Money f={f} name="credit_limit" label="Limite (opcional)" hint="Se informar, o Wallet mostra quanto ainda tem disponível." />
      <div className="field"><span>Cor</span><div className="swatches">{PALETTE.map((c) => <button type="button" key={c} className={`swatch${v.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => f.set('color', c)} aria-label={`Cor ${c}`} />)}</div></div>
      <div className="full"><button type="button" className="link" onClick={() => setMore(!more)}>{more ? 'Menos opções' : 'Mais opções (vencimento, conta que paga, outros gastos)'}</button></div>
      {more && <>
        <Num f={f} name="due_day" label="Dia do vencimento da fatura" min="1" max="28" />
        <Sel f={f} name="account_id" label="Conta que paga a fatura" options={accountOptions(accounts)} empty="Escolher ao pagar" />
        <Money f={f} name="used_extra" label="Outros gastos na fatura (não parcelados)" hint="Só afeta o limite disponível." />
        <Txt f={f} name="notes" label="Observações" />
      </>}
    </FormModal>
  );
}

let lastCardId = ''; // mantém o cartão escolhido para cadastrar várias compras em sequência

// Cadastro rápido de uma compra parcelada que JÁ existe: só o que falta pagar.
export function PurchaseForm({ cards, preset, onClose, inline, purchase }) {
  const { today, refresh, notify } = useApp();
  const cur = today.slice(0, 7);
  const p = preset || {};
  const f = useForm(purchase ? {
    name: purchase.description, card_id: purchase.card_id, installment_amount: purchase.installment, remaining: purchase.remaining || 1, next_month: purchase.next ? purchase.next.due_date.slice(0, 7) : cur, total_amount: 0,
  } : {
    name: '', card_id: p.card_id || lastCardId || cards[0]?.id || '', installment_amount: p.installment_amount || 0, remaining: p.remaining || p.installments_total || 6,
    next_month: p.next_month || p.start_month || cur, total_amount: p.total_amount || 0,
  });
  const v = f.v;
  const n = Number(v.remaining) || 0;
  const months = Array.from({ length: Math.min(n, 12) }, (_, i) => addMonthKey(v.next_month, i));
  const end = n ? addMonthKey(v.next_month, n - 1) : null;
  return (
    <FormModal title={purchase ? 'Editar compra parcelada' : 'Adicionar parcela (compra que ainda estou pagando)'} inline={inline} onClose={onClose}
      onSubmit={async () => {
        if (purchase) {
          await put(`/api/cards/purchases/${purchase.id}`, { description: v.name, installment_amount: v.installment_amount, remaining: n, next_month: v.next_month });
          notify('Compra atualizada.');
        } else {
          lastCardId = v.card_id;
          await post('/api/cards/purchases', { name: v.name, card_id: v.card_id, installment_amount: v.installment_amount, installments_total: n, paid: 0, start_month: v.next_month, total_amount: v.total_amount || undefined });
          notify('Compra cadastrada. Pode adicionar a próxima.');
        }
        refresh();
      }}>
      <Txt f={f} name="name" label="Descrição da compra" className="full" maxLength={120} required />
      {!purchase && <Sel f={f} name="card_id" label="Cartão" options={cards.map((c) => ({ value: c.id, label: c.name }))} required />}
      <Money f={f} name="installment_amount" label="Valor da parcela mensal" required />
      <Num f={f} name="remaining" label="Quantas parcelas faltam" min="1" max="480" required />
      <Txt f={f} name="next_month" type="month" label="Mês da próxima parcela" required />
      {!purchase && <Money f={f} name="total_amount" label="Valor total da compra (opcional)" hint="Só para consulta." />}
      <div className="full alert">
        {n >= 1 && v.installment_amount > 0 && v.next_month ? <>
          Pagará <strong>{brl(v.installment_amount)}</strong> por mês, <strong>{n}</strong> vez(es): de <strong>{monthShort(v.next_month)}</strong> até <strong>{monthShort(end)}</strong> — total restante <strong>{brl(v.installment_amount * n)}</strong>. Depois disso o valor mensal diminui.
          <div className="muted" style={{ marginTop: 4 }}>{months.map((m) => monthShort(m)).join(' · ')}{n > 12 && ' …'}</div>
        </> : 'Preencha a parcela, quantas faltam e o mês da próxima para ver os meses.'}
      </div>
    </FormModal>
  );
}

function LimitBar({ u }) {
  if (!u.limit) return <p className="muted">Defina o limite em "Editar cartão" para ver quanto já usou e quanto ainda tem disponível.</p>;
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="kv" style={{ border: 0 }}><span>Limite {brl(u.limit)}</span><span>Usado {brl(u.used)} ({u.pct}%)</span></div>
      <Progress pct={u.pct} tone={u.pct >= 90 ? 'danger' : u.pct >= 70 ? 'warn' : ''} />
      <div className="kv" style={{ border: 0 }}><span>Disponível agora</span><strong className={u.available < 0 ? 'neg' : 'pos'}>{brl(u.available)}</strong></div>
      <p className="muted">Usado = parcelas ainda não pagas (todas as faturas futuras){u.extra > 0 && ` + ${brl(u.extra)} de outros gastos na fatura`}. Ao pagar uma parcela, o limite volta.</p>
    </div>
  );
}

const PAY_BADGE = (it, today) => (it.status === 'paid' ? <Badge tone="ok">Paga</Badge> : it.due_date < today ? <Badge tone="danger">Pendente (atrasada)</Badge> : <Badge>Pendente</Badge>);

// Nome exibido de cada cartão: instituição (ou o nome do cartão); se duas têm a mesma instituição, acrescenta o nome.
const cardLabel = (c, cards) => {
  const base = c.bank || c.name;
  return cards.filter((k) => (k.bank || k.name) === base).length > 1 && c.bank && c.name !== c.bank ? `${base} (${c.name})` : base;
};

// Resumo mês a mês com o nome de cada cartão e o total mensal
function MatrixTable({ ov, month, onMonth }) {
  return (
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr><th>Mês</th><th>Cartões</th><th className="num">Total do mês</th><th className="num">Variação</th></tr></thead>
      <tbody>{ov.months.map((m, i) => {
        const diff = i ? ov.total[m] - ov.total[ov.months[i - 1]] : 0;
        const parts = ov.cards.filter((k) => k.monthly[m] > 0);
        return (
          <tr key={m} style={m === month ? { background: 'var(--green-bg)' } : undefined}>
            <td><button className="link" style={{ textDecoration: 'none' }} onClick={() => onMonth(m)}>{monthFull(m).split(' de ')[0]}</button><span className="sub">{m.slice(0, 4)}{i === 0 ? ' · mês atual' : ''}</span></td>
            <td>{parts.length ? parts.map((k) => <span key={k.id} style={{ marginRight: 14, whiteSpace: 'nowrap' }}><strong>{cardLabel(k, ov.cards)}:</strong> {brl(k.monthly[m])}</span>) : <span className="muted">—</span>}</td>
            <td className="num"><strong>{brl(ov.total[m])}</strong></td>
            <td className={`num ${diff < 0 ? 'pos' : diff > 0 ? 'neg' : ''}`}>{i && diff ? `${diff > 0 ? '+' : ''}${brl(diff)}` : '—'}</td>
          </tr>);
      })}</tbody>
    </table></div>
  );
}

// Parcelas do mês de um cartão, com situação e botão para marcar paga/pendente (totais recalculam ao mudar)
function CardMonthBlock({ c, month, cards }) {
  const { refresh, notify, confirm, today } = useApp();
  const [pay, setPay] = useState(null);
  const unpay = async (it) => {
    if (!(await confirm({ title: 'Marcar como pendente', message: `A parcela "${it.description}" volta para pendente e o valor volta para a conta.`, okLabel: 'Marcar pendente' }))) return;
    try { await post(`/api/entries/${it.entry_id}/unpay`); refresh(); } catch (x) { notify(x.message, true); }
  };
  return (
    <Card title={<>{cardLabel(c, cards)} {c.bank && c.name !== c.bank && <span className="muted" style={{ fontWeight: 400 }}>· {c.name}</span>}</>}
      action={<span className="muted">Mês {brl(c.monthTotal)} · pago <strong className="pos">{brl(c.monthPaid)}</strong> · falta <strong>{brl(c.monthPending)}</strong></span>}>
      {c.items.length === 0 ? <p className="muted">Nenhuma parcela neste cartão em {monthShort(month)}.</p> : (
        <div className="tbl-wrap"><table className="tbl"><tbody>{c.items.map((it) => (
          <tr key={it.entry_id}>
            <td>{it.description}</td><td>{dateBR(it.due_date)}</td><td className="num">{brl(it.amount)}</td>
            <td>{PAY_BADGE(it, today)}{it.paid_date && <span className="sub">paga em {dateBR(it.paid_date)}</span>}</td>
            <td className="row-actions">{it.status === 'paid'
              ? <button className="btn sm ghost" onClick={() => unpay(it)}>Marcar pendente</button>
              : <button className="btn sm primary" onClick={() => setPay({ id: it.entry_id, type: 'expense', description: `${cardLabel(c, cards)}: ${it.description}`, amount: it.amount, account_id: it.account_id || c.account_id })}>Marcar como paga</button>}</td>
          </tr>))}</tbody></table></div>
      )}
      {c.invoices.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer' }}>Próximas faturas ({c.invoices.length})</summary>
          <div className="tbl-wrap" style={{ marginTop: 8 }}><table className="tbl">
            <thead><tr><th>Mês</th><th>Vencimento</th><th className="num">Fatura</th><th className="num">Pago</th><th className="num">Pendente</th><th>Situação</th></tr></thead>
            <tbody>{c.invoices.slice(0, 8).map((i) => (
              <tr key={i.month}><td>{monthShort(i.month)}</td><td>{i.due_date ? dateBR(i.due_date) : 'não informado'}</td><td className="num">{brl(i.total)}</td><td className="num">{brl(i.paid)}</td><td className="num">{brl(i.pending)}</td>
                <td><Badge tone={i.status === 'paga' ? 'ok' : i.status === 'parcial' ? 'warn' : 'neutral'}>{{ paga: 'Paga', parcial: 'Paga em parte', pendente: 'Pendente' }[i.status]}</Badge></td></tr>))}</tbody>
          </table></div>
        </details>
      )}
      {pay && <PayModal entry={pay} onClose={() => setPay(null)} />}
    </Card>
  );
}

// Visão geral: totais do mês, cartões, detalhamento por cartão e resumo dos próximos meses
function CardsHome({ ov, month, onMonth, onOpen }) {
  const { nav } = useApp();
  const sel = ov.selected;
  return (
    <div className="stack">
      <div className="filters" style={{ marginBottom: 0 }}><MonthPicker value={month} onChange={onMonth} /><span className="muted">{monthFull(month)}</span></div>
      <div className="grid-stats">
        <Stat label={`Total a pagar em ${monthShort(month)}`} value={brl(sel.total)} sub={`${sel.paidCount + sel.pendingCount} parcela(s) de todos os cartões`} />
        <Stat label="Parcelas pagas no mês" value={brl(sel.paid)} tone="pos" sub={`${sel.paidCount} parcela(s)`} />
        <Stat label="Parcelas pendentes no mês" value={brl(sel.pending)} tone={sel.pending > 0 ? '' : 'pos'} sub={`${sel.pendingCount} parcela(s)`} />
        <Stat label="Parcelas futuras (meses seguintes)" value={brl(ov.totals.futureAmount)} sub={`${ov.totals.futureCount} parcela(s) depois de ${monthShort(month)}`} />
      </div>

      <div className="wstack">
        {ov.cards.map((c) => <CardVisual key={c.id} card={c} stacked onClick={() => onOpen(c.id)} extra={`${monthShort(month)}: ${brl(c.monthTotal)}${c.monthTotal ? (c.monthPending > 0 ? ` · falta ${brl(c.monthPending)}` : ' · pago') : ''}`} />)}
        <button className="wadd" onClick={() => nav('novo-cartao')}>+ Novo cartão</button>
      </div>
      <p className="muted">Clique em um cartão para ver a fatura, as compras parceladas, os pagamentos e os compromissos futuros.</p>

      <Card title={`Por cartão em ${monthShort(month)}`}>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Cartão</th><th className="num">Fatura do mês</th><th className="num">Já pago</th><th className="num">Ainda pendente</th><th className="num">Parcelas futuras</th></tr></thead>
          <tbody>{ov.cards.map((c) => (
            <tr key={c.id}><td><button className="link" style={{ textDecoration: 'none' }} onClick={() => onOpen(c.id)}>{cardLabel(c, ov.cards)}</button>{c.bank && c.name !== c.bank && <span className="sub">{c.name}</span>}</td>
              <td className="num">{brl(c.monthTotal)}</td><td className="num pos">{brl(c.monthPaid)}</td><td className="num"><strong>{brl(c.monthPending)}</strong></td><td className="num">{brl(c.futureAmount)}<span className="sub">{c.futureCount} parcela(s)</span></td></tr>))}</tbody>
          <tfoot><tr><td>Total</td><td className="num">{brl(sel.total)}</td><td className="num">{brl(sel.paid)}</td><td className="num">{brl(sel.pending)}</td><td className="num">{brl(ov.totals.futureAmount)}</td></tr></tfoot>
        </table></div>
      </Card>

      {ov.cards.map((c) => <CardMonthBlock key={c.id} c={c} month={month} cards={ov.cards} />)}

      <Card title="Resumo dos próximos meses"><MatrixTable ov={ov} month={month} onMonth={onMonth} /></Card>
    </div>
  );
}

// Detalhe de um cartão
function CardDetail({ ov, c, month, onMonth, onBack, onAdd }) {
  const { refresh, notify, confirm, today } = useApp();
  const [pay, setPay] = useState(null);
  const [editCard, setEditCard] = useState(null);
  const [editBuy, setEditBuy] = useState(null);
  const unpay = async (it) => {
    if (!(await confirm({ title: 'Marcar como pendente', message: `A parcela "${it.description}" volta para pendente e o valor volta para a conta.`, okLabel: 'Marcar pendente' }))) return;
    try { await post(`/api/entries/${it.entry_id}/unpay`); refresh(); } catch (x) { notify(x.message, true); }
  };
  const removePurchase = async (p) => {
    if (!(await confirm({ title: 'Excluir compra', message: `Excluir "${p.description}" e todas as suas parcelas pendentes? Se alguma parcela já foi paga pelo Wallet, desfaça o pagamento antes.`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/debts/${p.id}`); notify('Compra excluída.'); refresh(); } catch (x) { notify(x.message, true); }
  };
  const removeBase = async (it) => {
    if (!(await confirm({ title: 'Excluir', message: `Excluir "${it.description}" de ${monthShort(month)}?`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/entries/${it.entry_id}`, { scope: 'one' }); refresh(); } catch (x) { notify(x.message, true); }
  };
  const removeCard = async () => {
    if (!(await confirm({ title: 'Excluir cartão', message: `Excluir o cartão "${c.name}"? Só é possível sem compras cadastradas.`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/cards/${c.id}`); onBack(); refresh(); } catch (x) { notify(x.message, true); }
  };
  const pendingMonth = c.monthTotal - c.monthPaid;
  const future = ov.months.filter((m) => m > ov.months[0] && c.monthly[m] > 0);
  return (
    <div className="stack">
      <div className="actions"><button className="btn" onClick={onBack}>← Todos os cartões</button><MonthPicker value={month} onChange={onMonth} /></div>
      <div className="cols-2" style={{ marginBottom: 0 }}>
        <div><CardVisual card={c} /></div>
        <div>
          <div className="grid-stats" style={{ marginBottom: 12 }}>
            <Stat label={`Fatura de ${monthShort(month)}`} value={brl(c.monthTotal)} />
            <Stat label="Paga" value={brl(c.monthPaid)} tone="pos" />
            <Stat label="Pendente" value={brl(pendingMonth)} tone={pendingMonth > 0 ? '' : 'pos'} />
          </div>
          {c.usage.limit > 0 && <LimitBar u={c.usage} />}
          <div className="actions"><button className="btn" onClick={() => setEditCard(c)}>Editar cartão</button><button className="btn ghost" onClick={removeCard}>Excluir cartão</button></div>
        </div>
      </div>

      <Card title={`Fatura de ${monthFull(month)}`}>
        {c.items.length === 0 ? <Empty>Nenhuma parcela neste cartão em {monthShort(month)}.</Empty> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Compra</th><th>Vence</th><th className="num">Valor</th><th>Situação</th><th>Pago em</th><th></th></tr></thead>
            <tbody>{c.items.map((it) => (
              <tr key={it.entry_id}>
                <td>{it.description}</td><td>{dateBR(it.due_date)}</td><td className="num">{brl(it.amount)}</td>
                <td>{PAY_BADGE(it, today)}</td><td>{it.paid_date ? dateBR(it.paid_date) : '—'}</td>
                <td className="row-actions">
                  {it.status === 'paid' ? <button className="btn sm ghost" onClick={() => unpay(it)}>Marcar pendente</button> : <button className="btn sm primary" onClick={() => setPay({ id: it.entry_id, type: 'expense', description: `${c.name}: ${it.description}`, amount: it.amount, account_id: it.account_id || c.account_id })}>Marcar como paga</button>}
                  {it.kind === 'base' && <button className="btn sm ghost" onClick={() => removeBase(it)}>Excluir</button>}
                </td>
              </tr>))}</tbody>
            <tfoot><tr><td colSpan={2}>Total da fatura</td><td className="num">{brl(c.monthTotal)}</td><td colSpan={3}>Paga {brl(c.monthPaid)} · Pendente {brl(pendingMonth)}</td></tr></tfoot>
          </table></div>
        )}
      </Card>

      <Card title="Compras parceladas" action={<button className="btn sm primary" onClick={onAdd}>+ Adicionar parcela</button>}>
        {c.purchases.length === 0 ? <Empty>Nenhuma compra parcelada neste cartão.</Empty> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Compra</th><th className="num">Parcela</th><th className="num">Faltam</th><th>Termina em</th><th></th></tr></thead>
            <tbody>{c.purchases.map((p) => (
              <tr key={p.id}>
                <td>{p.description}{p.totalAmount > 0 && p.totalAmount !== p.installment * p.total && <span className="sub">total da compra {brl(p.totalAmount)}</span>}</td>
                <td className="num">{brl(p.installment)}</td>
                <td className="num">{p.done ? '—' : <>{p.remaining} <span className="sub">{brl(p.remainingAmount)}</span></>}</td>
                <td>{p.done ? <Badge tone="ok">Quitada</Badge> : monthShort(p.endMonth)}</td>
                <td className="row-actions"><button className="btn sm" onClick={() => setEditBuy({ ...p, card_id: c.id })}>Editar</button><button className="btn sm ghost" onClick={() => removePurchase(p)}>Excluir</button></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>

      <div className="cols-2">
        <Card title="Pagamentos registrados">
          {c.payments.length === 0 ? <Empty>Nenhum pagamento registrado ainda.</Empty> : (
            <div className="tbl-wrap"><table className="tbl"><tbody>{c.payments.map((p) => (
              <tr key={p.entry_id}><td>{dateBR(p.paid_date)}</td><td>{p.description}</td><td className="num">{brl(p.amount)}</td><td><Badge tone="ok">Paga</Badge></td></tr>))}</tbody></table></div>
          )}
        </Card>
        <Card title="Compromissos futuros">
          {future.length === 0 ? <Empty>Nenhuma parcela futura neste cartão.</Empty> : (
            <div className="tbl-wrap"><table className="tbl"><tbody>{future.map((m) => (
              <tr key={m}><td>{monthShort(m)}</td><td>{c.breakdown[m].map((b) => b.description).join(', ')}</td><td className="num">{brl(c.monthly[m])}</td></tr>))}</tbody></table></div>
          )}
          {c.pendingCount > 0 && <p className="muted" style={{ marginTop: 8 }}>Restam {c.pendingCount} parcela(s), {brl(c.pendingAmount)} no total. Quando uma compra termina, o valor mensal diminui.</p>}
        </Card>
      </div>
      {pay && <PayModal entry={pay} onClose={() => setPay(null)} />}
      {editCard && <CardForm card={editCard} onClose={() => setEditCard(null)} />}
      {editBuy && <PurchaseForm cards={ov.cards} purchase={editBuy} onClose={() => setEditBuy(null)} />}
    </div>
  );
}

export function Simulator({ cards, onConfirm, initial }) {
  const { today, notify } = useApp();
  const cur = today.slice(0, 7);
  const [s, setS] = useState({ card_id: cards[0]?.id || '', total: 0, installments: 10, first_month: addMonthKey(cur, 1), installment_amount: 0, show_all: true, ...(initial || {}) });
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const set = (k, v) => setS((p) => ({ ...p, [k]: v }));
  const ready = s.card_id && s.total > 0 && s.installments >= 1;
  useEffect(() => {
    if (!ready) { setRes(null); return; }
    const t = setTimeout(() => post('/api/cards/simulate', { ...s, installment_amount: s.installment_amount || null }).then((r) => { setRes(r); setErr(''); }).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.card_id, s.total, s.installments, s.first_month, s.installment_amount, s.show_all]);
  void notify;
  return (
    <div className="stack">
      <Card title="Compra que pretendo fazer (simulação temporária, nada é salvo)">
        <div className="filters">
          <Field label="Cartão"><select value={s.card_id} onChange={(e) => set('card_id', Number(e.target.value))}>{cards.map((c) => <option key={c.id} value={c.id}>{c.bank || c.name}{c.bank && c.name !== c.bank ? ` — ${c.name}` : ''}</option>)}</select></Field>
          <Field label="Valor total da compra"><MoneyInput value={s.total} onChange={(v) => set('total', v)} /></Field>
          <Field label="Parcelas"><input type="number" min="1" max="48" value={s.installments} onChange={(e) => set('installments', Math.max(1, Number(e.target.value) || 1))} style={{ width: 90 }} /></Field>
          <Field label="1ª parcela em"><input type="month" value={s.first_month} onChange={(e) => e.target.value && set('first_month', e.target.value)} /></Field>
          <Field label="Parcela com juros (opcional)"><MoneyInput value={s.installment_amount} onChange={(v) => set('installment_amount', v)} /></Field>
          <label className="check" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}><input type="checkbox" checked={s.show_all} onChange={(e) => set('show_all', e.target.checked)} /><span>Mostrar todos os cartões na planilha</span></label>
        </div>
        <ErrorBox error={err} />
        {!ready && <p className="muted">Informe o cartão, o valor total e a quantidade de parcelas.</p>}
      </Card>
      {res && (
        <>
          <div className="grid-stats">
            <Stat label="Valor da nova parcela" value={brl(res.installment)} sub={`${res.installments.length}x · última em ${monthShort(res.lastMonth)} · total ${brl(res.totalPaid)}`} />
            <Stat label="Total já pago em cartões (consolidado)" value={brl(res.totalCardsPaidConsolidated)} sub="Valor integral quitado de todos os cartões" tone="pos" />
            <Stat label="Total já pago em assinaturas" value={brl(res.totalSubscriptionsPaid)} sub="Total acumulado pago em serviços e planos" />
            <Stat label={`Total de todos os cartões em ${monthShort(res.firstMonth)}`} value={brl(res.allFirstMonth)} sub={`Antes: ${brl(res.allBeforeFirstMonth)} (mês atual: ${brl(res.allCurrentMonth)})`} />
          </div>
          {res.limit.limit > 0 && (
            <div className={`alert ${res.limit.exceeds ? 'danger' : 'ok'}`}>
              Limite disponível no {res.card.name}: <strong>{brl(res.limit.available)}</strong> → <strong>{brl(res.limit.availableAfter)}</strong> depois desta compra.
              {res.limit.exceeds && ' A compra passa do limite disponível.'}
            </div>
          )}
          <p className="muted">{res.note}</p>
          <Card title="Projeção mensal, considerando quando as parcelas antigas terminam">
            <LineChart labels={res.rows.map((r) => monthShort(r.month))} lines={[{ name: 'Todos os cartões, sem a compra', color: COLORS.slate, values: res.rows.map((r) => r.allBefore) }, { name: 'Todos os cartões, com a compra', color: COLORS.green, values: res.rows.map((r) => r.allAfter) }]} />
            <div className="tbl-wrap" style={{ marginTop: 12, maxHeight: 340, overflow: 'auto' }}><table className="tbl">
              <thead><tr><th>Mês</th><th className="num">{res.card.name} hoje</th><th className="num">{res.card.name} com a compra</th><th className="num">Todos os cartões hoje</th><th className="num">Todos com a compra</th></tr></thead>
              <tbody>{res.rows.map((r) => <tr key={r.month}><td>{monthShort(r.month)}</td><td className="num">{brl(r.cardBefore)}</td><td className="num">{brl(r.cardAfter)}</td><td className="num">{brl(r.allBefore)}</td><td className="num"><strong>{brl(r.allAfter)}</strong></td></tr>)}</tbody>
            </table></div>
          </Card>
          <Card title="Planilha de faturas, mês a mês">
            <p className="muted" style={{ marginBottom: 8 }}>Comprometido = parcelas já cadastradas no cartão (pagas + pendentes). A nova compra é só simulação. Assinaturas aparecem à parte (mesmo pagas no cartão) e cada despesa entra uma única vez no total.</p>
            <div className="tbl-wrap" style={{ maxHeight: 520, overflow: 'auto' }}><table className="tbl">
              <thead><tr><th>Mês</th><th>Cartão</th><th className="num">Comprometido</th><th className="num">Já pago</th><th className="num">Pendente</th><th className="num">Assinaturas</th><th className="num">Nova compra</th><th className="num">Total projetado</th></tr></thead>
              <tbody>{res.table.map((m) => (
                <Fragment key={m.month}>
                  {m.cards.map((c, i) => (
                    <tr key={c.card_id}>{i === 0 && <td rowSpan={m.cards.length + 1} style={{ verticalAlign: 'top', fontWeight: 600 }}>{monthShort(m.month)}</td>}
                      <td>{c.name}{c.card_name !== c.name && <span className="sub">{c.card_name}</span>}</td><td className="num">{brl(c.committed)}</td><td className="num">{brl(c.paid)}</td><td className="num">{brl(c.pending)}</td><td className="num muted">—</td>
                      <td className="num">{c.extra ? <strong className="pos">+{brl(c.extra)}</strong> : '—'}</td><td className="num">{brl(c.projected)}</td></tr>))}
                  <tr style={{ background: 'var(--panel)', fontWeight: 600 }}><td>Total do mês</td><td className="num">{brl(m.cardsCommitted)}</td><td className="num">{brl(m.cardsPaid)}</td><td className="num">{brl(m.cardsPending)}</td><td className="num">{brl(m.subs)}</td><td className="num">{m.extra ? `+${brl(m.extra)}` : '—'}</td><td className="num">{brl(m.total)}</td></tr>
                </Fragment>))}</tbody>
            </table></div>
          </Card>
          <Card title="Comparação entre quantidades de parcelas">
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Parcelas</th><th className="num">Valor da parcela</th><th className="num">Total pago</th><th>Termina em</th><th className="num">{res.card.name} em {monthShort(res.firstMonth)}</th><th className="num">Todos os cartões em {monthShort(res.firstMonth)}</th><th className="num">Pico mensal (todos)</th></tr></thead>
              <tbody>{res.comparison.map((c) => (
                <tr key={c.n} style={c.n === res.installments.length ? { background: 'var(--green-bg)' } : undefined}>
                  <td><button className="link" onClick={() => set('installments', c.n)}>{c.n}x</button></td><td className="num">{brl(c.installment)}</td><td className="num">{brl(c.totalPaid)}</td><td>{monthShort(c.lastMonth)}</td>
                  <td className="num">{brl(c.cardFirstMonth)}</td><td className="num">{brl(c.allFirstMonth)}</td><td className="num">{brl(c.allPeak)}</td>
                </tr>))}</tbody>
            </table></div>
          </Card>
          <div><button className="btn primary" onClick={() => onConfirm({ card_id: res.card.id, installment_amount: res.installment, remaining: res.installments.length, next_month: res.firstMonth, total_amount: res.total })}>Confirmar que fiz esta compra…</button>
            <span className="muted" style={{ marginLeft: 10 }}>Só aqui a compra é registrada nos seus dados.</span></div>
        </>
      )}
    </div>
  );
}

// ---- páginas da navegação: Novo cartão | Adicionar parcela | Cartões ----
export function NewCardPage() {
  const { nav, notify, confirm, refresh } = useApp();
  const [k, setK] = useState(0);
  const [edit, setEdit] = useState(null);
  const { data: ov, error } = useFetch(() => get('/api/cards'), []);
  const remove = async (c) => {
    if (!(await confirm({ title: 'Excluir cartão', message: `Excluir o cartão "${c.name}"?`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/cards/${c.id}`); refresh(); } catch (x) { notify(x.message, true); }
  };
  return (
    <div className="stack">
      <PageHead title="Novo cartão" sub="Só o nome é obrigatório. Depois adicione as compras parceladas que você ainda está pagando." />
      <CardForm key={k} inline onClose={() => setK(k + 1)} />
      <ErrorBox error={error} />
      {ov && ov.cards.length > 0 && (
        <Card title="Cartões cadastrados" action={<button className="btn sm" onClick={() => nav('cartoes')}>Ver pagamentos</button>}>
          <div className="tbl-wrap"><table className="tbl"><tbody>{ov.cards.map((c) => (
            <tr key={c.id}><td>{c.name}</td><td className="num">{c.credit_limit ? `Limite ${brl(c.credit_limit)}` : 'sem limite informado'}</td>
              <td className="row-actions"><button className="btn sm" onClick={() => nav('compra-parcelada', { card_id: c.id })}>Adicionar parcela</button><button className="btn sm ghost" onClick={() => setEdit(c)}>Editar</button><button className="btn sm ghost" onClick={() => remove(c)}>Excluir</button></td></tr>
          ))}</tbody></table></div>
        </Card>
      )}
      {edit && <CardForm card={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function PurchasePage() {
  const { nav, params, refresh, notify, confirm } = useApp();
  const [k, setK] = useState(0);
  const [edit, setEdit] = useState(null);
  const { data: ov, error } = useFetch(() => get('/api/cards'), []);
  if (error) return <ErrorBox error={error} />;
  if (!ov) return <Loading />;
  const rows = ov.cards.flatMap((c) => c.purchases.filter((p) => !p.done).map((p) => ({ ...p, card: c.name, card_id: c.id })));
  const remove = async (p) => {
    if (!(await confirm({ title: 'Excluir compra', message: `Excluir "${p.description}" e suas parcelas pendentes?`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/debts/${p.id}`); notify('Compra excluída.'); refresh(); } catch (x) { notify(x.message, true); }
  };
  return (
    <div className="stack">
      <PageHead title="Adicionar parcela" sub="Cadastre rapidamente, uma por uma, cada compra parcelada que você ainda está pagando: descrição, cartão, parcela, quantas faltam e o mês da próxima." />
      {ov.cards.length === 0 ? (
        <Card><Empty action={<button className="btn primary" onClick={() => nav('novo-cartao')}>Cadastrar cartão</button>}>Cadastre um cartão antes de adicionar compras parceladas.</Empty></Card>
      ) : <PurchaseForm key={k} inline cards={ov.cards} preset={params.card_id ? { card_id: params.card_id } : undefined} onClose={() => setK(k + 1)} />}
      {rows.length > 0 && (
        <Card title={`Compras em andamento (${rows.length})`} action={<button className="btn sm" onClick={() => nav('cartoes')}>Ver pagamentos por mês</button>}>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Compra</th><th>Cartão</th><th className="num">Parcela</th><th className="num">Faltam</th><th>Termina em</th><th></th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id}><td>{p.description}</td><td>{p.card}</td><td className="num">{brl(p.installment)}</td><td className="num">{p.remaining}</td><td>{monthShort(p.endMonth)}</td>
                <td className="row-actions"><button className="btn sm" onClick={() => setEdit(p)}>Editar</button><button className="btn sm ghost" onClick={() => remove(p)}>Excluir</button></td></tr>))}</tbody>
          </table></div>
        </Card>
      )}
      {edit && <PurchaseForm cards={ov.cards} purchase={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

export default function Cards() {
  const { today, nav } = useApp();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selId, setSelId] = useState(null);
  const [adding, setAdding] = useState(null);
  const { data: ov, error } = useFetch(() => get('/api/cards', { month }), [month]);
  if (error) return <ErrorBox error={error} />;
  if (!ov) return <Loading />;
  const c = ov.cards.find((x) => x.id === selId);
  return (
    <div>
      <PageHead title="Cartões" sub="Seus cartões, o que pagar em cada mês e as parcelas de cada compra.">
        <button className="btn" onClick={() => nav('novo-cartao')}>Novo cartão</button>
        <button className="btn primary big" disabled={!ov.cards.length} onClick={() => setAdding({ card_id: c?.id })}>+ Adicionar parcela</button>
      </PageHead>
      {ov.cards.length === 0 ? (
        <Card><Empty action={<button className="btn primary" onClick={() => nav('novo-cartao')}>Cadastrar primeiro cartão</button>}>Nenhum cartão cadastrado.</Empty></Card>
      ) : c ? <CardDetail ov={ov} c={c} month={month} onMonth={setMonth} onBack={() => setSelId(null)} onAdd={() => setAdding({ card_id: c.id })} />
        : <CardsHome ov={ov} month={month} onMonth={setMonth} onOpen={setSelId} />}
      {adding && <PurchaseForm cards={ov.cards} preset={adding.card_id ? { card_id: adding.card_id } : undefined} onClose={() => setAdding(null)} />}
    </div>
  );
}
