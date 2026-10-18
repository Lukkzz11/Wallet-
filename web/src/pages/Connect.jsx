import { useState, useEffect, useRef } from 'react';
import { get, post } from '../api.js';
import { useApp, useFetch, Card, PageHead, Field, Empty, ErrorBox, Loading, MoneyInput, Badge } from '../ui.jsx';
import { parseCsv, parseOfx, parsePdfText, extractPdfText, detectInstallment } from '../importers.js';

// DecompressionStream('deflate') lê o formato zlib dos PDFs (disponível no Edge/Chrome)
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

let rowKey = 0;
const mkRow = (r, mode) => {
  const det = detectInstallment(r.description);
  return {
    k: ++rowKey, include: mode === 'card' ? r.amount < 0 : true, touched: false, date: r.date, description: r.description, amount: r.amount, id: r.id,
    category_id: '', remaining: det ? det.total - det.current + 1 : 1, detected: !!det,
  };
};

function Importer() {
  const { accounts, categories, today, refresh, notify } = useApp();
  const accs = accounts.filter((a) => !a.archived && a.type !== 'fgts');
  const { data: cardsOv } = useFetch(() => get('/api/cards'), []);
  const cards = cardsOv?.cards || [];
  const [mode, setMode] = useState('account');
  const [destId, setDestId] = useState('');
  const [invoice, setInvoice] = useState(today.slice(0, 7));
  const [file, setFile] = useState(null); // {name, kind, text?, bad, notes}
  const [rows, setRows] = useState([]);
  const [dups, setDups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const dest = mode === 'card' ? cards : accs;
  const destValid = dest.some((d) => d.id === Number(destId));
  useEffect(() => { if (!dest.some((d) => d.id === Number(destId))) setDestId(dest[0]?.id ?? ''); }, [mode, accs.length, cards.length]); // eslint-disable-line

  const load = async (f) => {
    if (!f) return;
    setErr(''); setDups([]);
    const ext = f.name.split('.').pop().toLowerCase();
    try {
      let parsed, kind = ext, notes = [], text = '';
      if (ext === 'ofx' || ext === 'qfx') {
        parsed = parseOfx(await f.text());
        if (parsed.kind === 'card' && cards.length) { setMode('card'); notes.push('Arquivo de cartão de crédito: as compras serão enviadas ao cartão escolhido.'); }
      } else if (ext === 'pdf') {
        text = await extractPdfText(new Uint8Array(await f.arrayBuffer()), inflate);
        parsed = parsePdfText(text, Number(today.slice(0, 4)));
        notes.push(text ? 'PDF: o texto foi extraído, mas o formato varia entre bancos. Confira cada linha com atenção.' : 'Não consegui ler texto neste PDF (pode ser imagem/escaneado ou ter codificação própria). Adicione as linhas manualmente abaixo.');
      } else {
        parsed = parseCsv(await f.text(), Number(today.slice(0, 4)));
      }
      const m = ext === 'ofx' && parsed.kind === 'card' && cards.length ? 'card' : mode;
      setRows(parsed.rows.map((r) => mkRow(r, m)));
      setFile({ name: f.name, kind, bad: parsed.bad, notes, text });
    } catch (x) { setErr(`Não foi possível ler o arquivo: ${x.message}`); setRows([]); setFile(null); }
  };

  const toItems = () => rows.map((r) => ({ date: r.date, description: r.description, amount: r.amount, id: r.id, remaining: r.remaining }));
  // pré-verificação de duplicidades (não grava nada)
  useEffect(() => {
    const valid = rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.description.trim() && r.amount);
    if (!rows.length || !destValid || !valid) { setDups([]); return undefined; }
    const t = setTimeout(() => {
      post('/api/import/check', { mode, [mode === 'card' ? 'card_id' : 'account_id']: Number(destId), items: toItems() }).then((r) => setDups(r.results)).catch(() => setDups([]));
    }, 400);
    return () => clearTimeout(t);
  }, [rows, mode, destId]); // eslint-disable-line

  const upd = (k, patch) => setRows((rs) => rs.map((r) => (r.k === k ? { ...r, ...patch } : r)));
  const eff = (r, i) => (dups[i]?.kind === 'id' ? false : r.touched ? r.include : r.include && !dups[i]);
  const ready = rows.map((r, i) => ({ r, i })).filter(({ r, i }) => eff(r, i) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.description.trim() && r.amount);
  const dupCount = dups.filter(Boolean).length;
  const incomplete = rows.filter((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !r.description.trim() || !r.amount).length;
  const changeMode = (m) => { setMode(m); setRows((rs) => rs.map((r) => ({ ...r, include: m === 'card' ? r.amount < 0 : true, touched: false }))); setDups([]); };

  const send = async () => {
    setBusy(true); setErr('');
    try {
      const items = ready.map(({ r }) => ({ date: r.date, description: r.description.trim(), amount: r.amount, id: r.id, category_id: r.category_id || undefined, remaining: Number(r.remaining) || 1 }));
      const res = mode === 'card'
        ? await post('/api/import/card', { card_id: Number(destId), invoice_month: invoice, items })
        : await post('/api/import/transactions', { account_id: Number(destId), items });
      notify(`${res.created} registro(s) importado(s)${res.skipped ? `, ${res.skipped} já existiam` : ''}.`);
      setRows([]); setFile(null); setDups([]); if (fileRef.current) fileRef.current.value = '';
      refresh();
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };

  return (
    <Card title="Importar arquivo do banco ou do cartão">
      <p className="muted" style={{ marginBottom: 10 }}>Escolha um arquivo <strong>CSV, OFX ou PDF</strong> do seu computador. Nada é gravado até você revisar e confirmar. O arquivo é lido aqui mesmo e não sai do computador. Não há conexão automática com bancos.</p>
      <div className="filters">
        <Field label="Destino"><select value={mode} onChange={(e) => changeMode(e.target.value)}><option value="account">Conta bancária (extrato)</option><option value="card">Cartão de crédito (fatura)</option></select></Field>
        <Field label={mode === 'card' ? 'Cartão' : 'Conta'}>
          <select value={destId} onChange={(e) => setDestId(Number(e.target.value))}>{dest.length === 0 && <option value="">{mode === 'card' ? 'Cadastre um cartão' : 'Cadastre uma conta'}</option>}{dest.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </Field>
        {mode === 'card' && <Field label="Mês de vencimento desta fatura"><input type="month" value={invoice} onChange={(e) => e.target.value && setInvoice(e.target.value)} /></Field>}
        <Field label="Arquivo (.csv, .ofx, .pdf)"><input ref={fileRef} type="file" accept=".csv,.txt,.ofx,.qfx,.pdf" onChange={(e) => load(e.target.files[0])} /></Field>
      </div>
      <ErrorBox error={err} />
      {file && (
        <div className="stack">
          <div className="alert">
            <strong>{file.name}</strong> — {rows.length} linha(s) encontrada(s){file.bad.length > 0 && <>; {file.bad.length} linha(s) não reconhecida(s)</>}{dupCount > 0 && <>; <strong>{dupCount} possível(is) duplicado(s)</strong> (desmarcados)</>}.
            {file.notes.map((n) => <div key={n}>{n}</div>)}
            {mode === 'card' && <div>Cada linha vira uma compra do cartão com as <strong>parcelas restantes</strong> distribuídas a partir de {invoice.split('-').reverse().join('/')}. Onde o arquivo não indica parcelas, fica 1 parcela: complete manualmente se precisar. Não altera o saldo.</div>}
            {mode === 'account' && <div>Ao confirmar, as linhas entram como lançamentos já realizados na conta e <strong>alteram o saldo</strong> (movimentos anteriores à data de referência da conta não alteram).</div>}
          </div>
          {file.text && <details><summary style={{ cursor: 'pointer' }}>Ver texto extraído do PDF</summary><pre style={{ maxHeight: 200, overflow: 'auto', background: 'var(--panel)', padding: 10, fontSize: 12 }}>{file.text}</pre></details>}
          <div className="actions">
            <button className="btn sm" onClick={() => setRows((rs) => [...rs, { k: ++rowKey, include: true, touched: true, date: today, description: '', amount: 0, category_id: '', remaining: 1, detected: false }])}>+ Adicionar linha</button>
            <button className="btn sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, amount: -r.amount })))}>Inverter sinais</button>
            <button className="btn sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: true, touched: true })))}>Marcar todas</button>
            <button className="btn sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: false, touched: true })))}>Desmarcar todas</button>
          </div>
          {rows.length === 0 ? <Empty>Nenhuma linha reconhecida. Use "Adicionar linha" para lançar manualmente.</Empty> : (
            <div className="tbl-wrap" style={{ maxHeight: 460, overflow: 'auto' }}><table className="tbl">
              <thead><tr><th></th><th>Data</th><th>Descrição</th><th>{mode === 'card' ? 'Tipo' : 'Tipo'}</th><th className="num">{mode === 'card' ? 'Valor da parcela' : 'Valor'}</th>{mode === 'card' ? <th>Parcelas restantes</th> : <th>Categoria</th>}<th>Situação</th><th></th></tr></thead>
              <tbody>{rows.map((r, i) => {
                const locked = dups[i]?.kind === 'id';
                const on = eff(r, i);
                return (
                  <tr key={r.k} style={on ? undefined : { opacity: 0.6 }}>
                    <td><input type="checkbox" checked={on} disabled={locked} onChange={(e) => upd(r.k, { include: e.target.checked, touched: true })} aria-label="Importar" /></td>
                    <td><input type="date" value={r.date} onChange={(e) => upd(r.k, { date: e.target.value })} style={{ minWidth: 130 }} /></td>
                    <td><input value={r.description} maxLength={120} onChange={(e) => upd(r.k, { description: e.target.value })} style={{ minWidth: 200 }} /></td>
                    <td><select value={r.amount > 0 ? 'in' : 'out'} onChange={(e) => upd(r.k, { amount: (e.target.value === 'in' ? 1 : -1) * Math.abs(r.amount) })}><option value="out">{mode === 'card' ? 'Compra' : 'Saída'}</option><option value="in">{mode === 'card' ? 'Crédito/estorno' : 'Entrada'}</option></select></td>
                    <td className="num"><MoneyInput value={Math.abs(r.amount)} onChange={(v) => upd(r.k, { amount: (r.amount > 0 ? 1 : -1) * v })} /></td>
                    {mode === 'card' ? (
                      <td><input type="number" min="1" max="480" value={r.remaining} onChange={(e) => upd(r.k, { remaining: e.target.value })} style={{ width: 80 }} />{r.detected && <span className="sub">detectado no texto</span>}{!r.detected && <span className="sub">não identificado</span>}</td>
                    ) : (
                      <td><select value={r.category_id} onChange={(e) => upd(r.k, { category_id: e.target.value })}><option value="">Sem categoria</option>{categories.filter((c) => c.kind === (r.amount > 0 ? 'income' : 'expense')).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                    )}
                    <td>{dups[i] ? <Badge tone={locked ? 'neutral' : 'warn'}>{locked ? 'Já importada' : 'Possível duplicado'}</Badge> : <Badge tone="ok">Nova</Badge>}{dups[i] && <span className="sub">{dups[i].text}</span>}</td>
                    <td><button className="btn sm ghost" onClick={() => setRows((rs) => rs.filter((x) => x.k !== r.k))} aria-label="Remover linha">×</button></td>
                  </tr>);
              })}</tbody>
            </table></div>
          )}
          {incomplete > 0 && <div className="alert warn">{incomplete} linha(s) incompleta(s) (data, descrição ou valor) não serão importadas.</div>}
          <div className="actions">
            <button className="btn primary big" disabled={busy || !destValid || ready.length === 0 || (mode === 'card' && !invoice)} onClick={send}>Confirmar importação de {ready.length} linha(s)</button>
            <span className="muted">{ready.length} marcada(s) · {rows.length - ready.length} fora da importação</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function OpenApi() {
  const { notify, confirm } = useApp();
  const [show, setShow] = useState(false);
  const { data, error } = useFetch(() => get('/api/integration'), []);
  const [key, setKey] = useState(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const k = key ?? data.key;
  const url = `${location.origin}/api/open/transactions`;
  const gen = async () => {
    if (k && !(await confirm({ title: 'Gerar nova chave', message: 'A chave atual deixará de funcionar. Programas que a usam precisarão da nova.', okLabel: 'Gerar nova' }))) return;
    setKey((await post('/api/integration/key')).key); setShow(true); notify('Chave gerada.');
  };
  const example = `{\n  "account_id": 1,\n  "items": [\n    { "id": "txn-123", "date": "2026-10-14", "description": "Mercado", "amount": -4590 },\n    { "id": "txn-124", "date": "2026-10-14", "description": "Pix recebido", "amount": 15000 }\n  ]\n}`;
  const ps = `Invoke-RestMethod -Method Post -Uri ${url} -Headers @{ 'X-Wallet-Key' = '${show && k ? k : 'SUA_CHAVE'}' } -ContentType 'application/json' -Body (Get-Content envio.json -Raw)`;
  return (
    <Card title="Porta aberta para outros programas (API local)">
      <p className="muted" style={{ marginBottom: 10 }}>Qualquer script ou programa seu <strong>neste computador</strong> pode enviar movimentações para o Wallet. Fica restrito a este computador e exige a chave abaixo. Valores em centavos (entrada positiva, saída negativa). Com <code>id</code>, o mesmo item nunca é duplicado.</p>
      <div className="filters">
        <Field label="Chave"><input readOnly style={{ minWidth: 340 }} value={k ? (show ? k : '•'.repeat(24)) : 'ainda não gerada'} /></Field>
        {k && <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => setShow(!show)}>{show ? 'Ocultar' : 'Mostrar'}</button>}
        <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={gen}>{k ? 'Gerar nova chave' : 'Gerar chave'}</button>
      </div>
      <p><strong>Endereço:</strong> <code>POST {url}</code> com o cabeçalho <code>X-Wallet-Key</code></p>
      <pre style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 12, overflow: 'auto', fontSize: 12 }}>{example}</pre>
      <p className="muted" style={{ margin: '8px 0 4px' }}>Exemplo em PowerShell (salve o JSON acima como envio.json):</p>
      <pre style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 12, overflow: 'auto', fontSize: 12 }}>{ps}</pre>
      <p className="muted" style={{ marginTop: 8 }}>O Wallet não conversa com bancos sozinho. Para isso, use um programa seu ou um serviço que exporte o extrato, e envie para cá por esta porta ou pelo CSV acima. A porta só funciona com o Wallet aberto.</p>
    </Card>
  );
}

export default function Connect() {
  return (
    <div className="stack">
      <PageHead title="Conectar" sub="Importe arquivos do seu computador ou envie dados de outros programas seus." />
      <Importer />
      <OpenApi />
    </div>
  );
}
