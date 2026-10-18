import { useState, useEffect } from 'react';
import { get, post, put, del, setToken } from '../api.js';
import { useApp, useFetch, Card, PageHead, Badge, Empty, ErrorBox, Modal, FormModal, useForm, Txt, Num, Money, Sel, Field } from '../ui.jsx';
import { dateBR, download } from '../fmt.js';
import { APP_VERSION } from '../App.jsx';
import ClearSystem from './ClearSystem.jsx';

function Preferences() {
  const { settings, refresh, notify } = useApp();
  const f = useForm({ ...settings, min_reserve: Number(settings.min_reserve), monthly_savings_goal: Number(settings.monthly_savings_goal) });
  const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault(); setErr('');
    try { await put('/api/settings', f.v); notify('Configurações salvas.'); refresh(); } catch (x) { setErr(x.message); }
  };
  return (
    <Card title="Preferências pessoais">
      <form onSubmit={save} className="form">
        <div className="grid">
          <Txt f={f} name="user_name" label="Seu nome" maxLength={40} required />
          <Field label="Moeda padrão"><input value="BRL (R$)" disabled /></Field>
          <Money f={f} name="min_reserve" label="Reserva mínima de segurança" hint="Valor que nunca deve ser tocado nas retiradas." />
          <Money f={f} name="monthly_savings_goal" label="Meta de economia mensal" />
          <Num f={f} name="withdrawal_horizon" label="Período de planejamento da retirada (dias)" min="7" max="365" />
          <Num f={f} name="alert_days" label="Alertar vencimentos com antecedência (dias)" min="1" max="60" />
          <Sel f={f} name="chart_months" label="Meses nos gráficos" options={[{ value: '3', label: '3 meses' }, { value: '6', label: '6 meses' }, { value: '12', label: '12 meses' }]} />
          <Sel f={f} name="default_report_period" label="Período padrão dos relatórios" options={[{ value: 'month', label: 'Mês atual' }, { value: 'quarter', label: 'Últimos 3 meses' }, { value: 'year', label: 'Ano atual' }]} />
        </div>
        {err && <div className="alert danger" style={{ marginTop: 10 }}>{err}</div>}
        <div className="form-actions"><button className="btn primary" type="submit">Salvar configurações</button></div>
      </form>
    </Card>
  );
}

function CategoryRow({ c, onDone }) {
  const { categories, notify, confirm, refresh } = useApp();
  const [edit, setEdit] = useState(null);
  const rename = async () => { try { await put(`/api/categories/${c.id}`, { name: edit }); setEdit(null); refresh(); } catch (x) { notify(x.message, true); } };
  const remove = async () => {
    if (!(await confirm({ title: 'Excluir categoria', message: `Excluir a categoria "${c.name}"?`, danger: true, okLabel: 'Excluir' }))) return;
    try { await del(`/api/categories/${c.id}`); refresh(); } catch (x) {
      if (!/reatribu/.test(x.message)) return notify(x.message, true);
      const others = categories.filter((o) => o.kind === c.kind && o.id !== c.id);
      const target = window.prompt(`${x.message}\n\nDigite o número da categoria de destino:\n${others.map((o, i) => `${i + 1} - ${o.name}`).join('\n')}`);
      const t = others[Number(target) - 1];
      if (!t) return;
      try { await del(`/api/categories/${c.id}`, { reassign: t.id }); refresh(); } catch (y) { notify(y.message, true); }
    }
  };
  return (
    <tr><td>{edit == null ? c.name : <input value={edit} autoFocus onChange={(e) => setEdit(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()} />}</td>
      <td className="row-actions">{edit == null ? <><button className="btn sm ghost" onClick={() => setEdit(c.name)}>Renomear</button><button className="btn sm ghost" onClick={remove}>Excluir</button></> : <><button className="btn sm" onClick={rename}>Salvar</button><button className="btn sm ghost" onClick={() => setEdit(null)}>Cancelar</button></>}</td></tr>
  );
}
function Categories() {
  const { categories, refresh, notify } = useApp();
  const [name, setName] = useState({ expense: '', income: '' });
  const add = async (kind) => {
    try { await post('/api/categories', { name: name[kind], kind }); setName({ ...name, [kind]: '' }); refresh(); } catch (x) { notify(x.message, true); }
  };
  return (
    <div className="cols-2">
      {[['expense', 'Categorias de despesas'], ['income', 'Categorias de receitas']].map(([kind, title]) => (
        <Card key={kind} title={title}>
          <div className="tbl-wrap"><table className="tbl"><tbody>{categories.filter((c) => c.kind === kind).map((c) => <CategoryRow key={c.id} c={c} />)}</tbody></table></div>
          <div className="filters" style={{ marginTop: 10, marginBottom: 0 }}>
            <input placeholder="Nova categoria" value={name[kind]} onChange={(e) => setName({ ...name, [kind]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add(kind)} />
            <button className="btn" disabled={!name[kind].trim()} onClick={() => add(kind)}>Adicionar</button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Security() {
  const { boot, refresh, notify } = useApp();
  const locked = boot.locked;
  const [modal, setModal] = useState(null);
  const f = useForm({ current: '', password: '', confirm: '' });
  return (
    <Card title="Bloqueio por senha" action={<Badge tone={locked ? 'ok' : 'neutral'}>{locked ? 'Ativado' : 'Desativado'}</Badge>}>
      <p className="muted" style={{ marginBottom: 12 }}>A senha é guardada apenas como hash seguro (scrypt com sal), nunca em texto puro. Ela bloqueia o acesso à interface; não criptografa o arquivo do banco. Se esquecer, será preciso restaurar os dados de um backup sem senha.</p>
      <div className="actions">
        <button className="btn" onClick={() => { f.setV({ current: '', password: '', confirm: '' }); setModal('set'); }}>{locked ? 'Alterar senha' : 'Definir senha'}</button>
        {locked && <button className="btn" onClick={() => { f.setV({ current: '', password: '', confirm: '' }); setModal('remove'); }}>Remover senha</button>}
      </div>
      {modal && (
        <FormModal title={modal === 'set' ? (locked ? 'Alterar senha' : 'Definir senha') : 'Remover senha'} onClose={() => setModal(null)}
          onSubmit={async () => {
            if (modal === 'set') {
              if (f.v.password !== f.v.confirm) throw new Error('A confirmação não confere.');
              const r = await post('/api/auth/password', { current: f.v.current, password: f.v.password });
              if (!locked) { const { token } = await post('/api/auth/login', { password: f.v.password }); setToken(token); }
              void r;
            } else { await post('/api/auth/remove', { current: f.v.current }); setToken(''); }
            notify('Senha atualizada.'); refresh();
          }}>
          {(locked || modal === 'remove') && <Txt f={f} name="current" type="password" label="Senha atual" className="full" required />}
          {modal === 'set' && <><Txt f={f} name="password" type="password" label="Nova senha (mín. 4 caracteres)" required /><Txt f={f} name="confirm" type="password" label="Confirmar nova senha" required /></>}
        </FormModal>
      )}
    </Card>
  );
}

function Backups() {
  const { refresh, notify, confirm, settings } = useApp();
  const { data, error } = useFetch(() => get('/api/backups'), []);
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState({});
  const [dir, setDir] = useState(settings.backup_dir || '');
  const run = async (fn, ok) => { setBusy(true); try { const r = await fn(); notify(typeof ok === 'function' ? ok(r) : ok); refresh(); } catch (x) { notify(x.message, true); } setBusy(false); };
  const restore = async (b) => {
    if (!(await confirm({ title: 'Restaurar backup', message: `Restaurar "${b.name}"? Os dados atuais serão substituídos. Uma cópia de segurança do estado atual é criada antes.`, danger: true, okLabel: 'Restaurar' }))) return;
    run(() => post('/api/backups/restore', { name: b.name }), (r) => `Backup restaurado. Estado anterior salvo em ${r.safety}.`);
  };
  const exportJson = async () => {
    const data2 = await get('/api/export');
    download(`WalletLucas_export_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data2, null, 1), 'application/json');
  };
  const importJson = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (!(await confirm({ title: 'Importar dados', message: 'Importar substitui TODOS os dados atuais pelos do arquivo. Uma cópia de segurança é criada antes. Continuar?', danger: true, okLabel: 'Importar' }))) return;
      run(async () => { const payload = JSON.parse(reader.result); return post('/api/import', payload); }, (r) => `Dados importados. Cópia anterior: ${r.safety}.`);
    };
    reader.readAsText(file);
  };
  return (
    <Card title="Backup e restauração">
      <ErrorBox error={error} />
      <div className="actions" style={{ marginBottom: 12 }}>
        <button className="btn primary" disabled={busy} onClick={() => run(() => post('/api/backups'), (r) => `Backup criado e verificado: ${r.name}`)}>Criar backup agora</button>
        <button className="btn" onClick={exportJson}>Exportar dados (JSON)</button>
        <label className="btn" style={{ cursor: 'pointer' }}>Importar dados (JSON)<input type="file" accept=".json,application/json" hidden onChange={(e) => { importJson(e.target.files[0]); e.target.value = ''; }} /></label>
      </div>
      <p className="muted" style={{ marginBottom: 10 }}>Um backup automático é criado uma vez por dia ao abrir o programa (mantém os 30 mais recentes). Cada backup é verificado ao ser criado.</p>
      <div className="filters">
        <Field label="Pasta dos backups (vazio = padrão)"><input style={{ minWidth: 320 }} value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Ex.: D:\Backups\WalletLucas" /></Field>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => run(() => put('/api/settings', { backup_dir: dir }), 'Pasta de backup salva.')}>Salvar pasta</button>
      </div>
      {data && <p className="muted" style={{ marginBottom: 8 }}>Pasta atual: {data.dir}</p>}
      {data && (data.items.length === 0 ? <Empty>Nenhum backup ainda.</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Arquivo</th><th>Data</th><th className="num">Tamanho</th><th></th></tr></thead>
          <tbody>{data.items.map((b) => (
            <tr key={b.name}><td>{b.name}{verify[b.name] && <span className="sub" style={{ color: verify[b.name].ok ? 'var(--green)' : 'var(--red)' }}>{verify[b.name].ok ? `Íntegro · ${verify[b.name].counts.accounts} conta(s), ${verify[b.name].counts.entries} lançamento(s)` : verify[b.name].error}</span>}</td>
              <td>{dateBR(b.modified.slice(0, 10))} {b.modified.slice(11, 16)}</td><td className="num">{(b.size / 1024).toFixed(0)} KB</td>
              <td className="row-actions">
                <button className="btn sm ghost" onClick={async () => { try { setVerify({ ...verify, [b.name]: await post('/api/backups/verify', { name: b.name }) }); } catch (x) { setVerify({ ...verify, [b.name]: { ok: false, error: x.message } }); } }}>Verificar</button>
                <button className="btn sm" disabled={busy} onClick={() => restore(b)}>Restaurar</button>
              </td></tr>
          ))}</tbody></table></div>
      ))}
    </Card>
  );
}

// Atualização local: compara a versão instalada com a da pasta onde está o código-fonte (sem internet).
function LocalUpdate() {
  const { notify } = useApp();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => get('/api/local-update/status').then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); }, []);
  const apply = async () => {
    setBusy(true);
    try { await post('/api/local-update/apply', {}); notify('Abrindo o atualizador…'); } catch (x) { notify(x.message, true); }
    setBusy(false);
  };
  return (
    <Card title="Atualizar o Wallet (versão da sua pasta)" action={<Badge tone={st?.hasUpdate ? 'warn' : 'ok'}>{st?.hasUpdate ? 'nova versão disponível' : 'em dia'}</Badge>}>
      <div className="kv"><span>Versão instalada (esta que está aberta)</span><strong>{st?.installed || APP_VERSION}</strong></div>
      <div className="kv"><span>Versão pronta na sua pasta{st?.source ? ` (${st.source})` : ''}</span><strong>{st?.available || '—'}</strong></div>
      {!st?.source && <p className="muted" style={{ marginTop: 8 }}>Ainda não sei em que pasta está a versão nova. Use uma vez o atalho <strong>Atualizar Wallet</strong> da Área de Trabalho e isto passa a aparecer aqui.</p>}
      {st?.source && !st?.sourceFound && <p className="muted" style={{ marginTop: 8 }}>A pasta {st.source} não foi encontrada.</p>}
      {st?.hasUpdate && <div className="alert warn" style={{ marginTop: 10 }}>Há uma versão mais nova ({st.available}). Clique em <strong>Atualizar agora</strong>: o Wallet fecha, faz backup do banco, troca os arquivos e abre de novo. Seus dados são mantidos.</div>}
      {st?.source && st?.sourceFound && !st?.hasUpdate && <p className="muted" style={{ marginTop: 8 }}>Você já está na versão mais nova da sua pasta. Toda mudança nova que eu fizer sobe o número da versão, para você ver aqui se foi instalada.</p>}
      <div className="actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={load}>Verificar de novo</button>
        <button className="btn primary" disabled={busy || !st?.hasUpdate} onClick={apply}>Atualizar agora</button>
      </div>
    </Card>
  );
}

// Atualizações pelo GitHub (recurso adicionado fora do restante do app; ver CLAUDE.md sobre os riscos).
function Updater() {
  const { notify } = useApp();
  const [st, setSt] = useState(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [repo, setRepo] = useState('');
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    get('/api/updater/status').then((s) => { setSt(s); setRepo(s.repo || 'Lukkzz11/Wallet-'); }).catch(() => {});
  }, []);
  const check = async () => {
    setChecking(true);
    try {
      const r = await post('/api/updater/check', { repo });
      const s = await get('/api/updater/status');
      setSt(s);
      if (r.hasUpdate) notify(`Nova versão v${r.latestVersion} encontrada!`); else notify('Você já está na versão mais recente.');
    } catch (x) {
      notify('Erro ao verificar atualizações: ' + x.message, true);
    } finally {
      setChecking(false);
    }
  };
  const download_ = async () => {
    setDownloading(true);
    try {
      await post('/api/updater/download', {});
      const s = await get('/api/updater/status');
      setSt(s);
      notify('Atualização baixada e pronta para instalar!');
    } catch (x) {
      notify('Erro no download: ' + x.message, true);
    } finally {
      setDownloading(false);
    }
  };
  const apply = async () => {
    setApplying(true);
    try {
      await post('/api/updater/apply', {});
    } catch (x) {
      notify(x.message, true);
      setApplying(false);
    }
  };
  const saveRepo = async () => {
    try {
      await put('/api/updater/repo', { repo });
      notify('Repositório GitHub atualizado.');
    } catch (x) {
      notify(x.message, true);
    }
  };
  const latest = st?.updateInfo?.latestVersion || st?.latestVersion || '';
  return (
    <Card title="Atualizações pelo GitHub (opcional)" action={<Badge tone="neutral">v{st?.currentVersion || APP_VERSION}</Badge>}>
      <p className="muted" style={{ marginBottom: 12 }}>O Wallet verifica novas versões diretamente do GitHub na inicialização, baixa os updates automaticamente e permite reiniciar com um clique.</p>
      <div className="filters" style={{ marginBottom: 16 }}>
        <Field label="Repositório no GitHub (usuario/repositorio)">
          <input style={{ minWidth: 280 }} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="Lukkzz11/Wallet-" />
        </Field>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={saveRepo}>Salvar repositório</button>
      </div>
      <div className="actions" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" disabled={checking || downloading || applying} onClick={check}>{checking ? 'Verificando...' : 'Verificar atualizações agora'}</button>
        {st?.hasUpdate && !st?.readyToInstall && (
          <button className="btn primary" disabled={downloading} onClick={download_}>{downloading ? `Baixando... (${st?.downloadProgress || 0}%)` : `Baixar v${st?.latestVersion || ''}`}</button>
        )}
        {st?.readyToInstall && (
          <button className="btn primary" style={{ background: 'var(--green, #16a34a)' }} disabled={applying} onClick={apply}>{applying ? 'Reiniciando para instalar...' : `Reiniciar e Atualizar para v${latest}`}</button>
        )}
      </div>
      {st?.lastCheck && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
          Última verificação: {dateBR(st.lastCheck.slice(0, 10))} {st.lastCheck.slice(11, 16)}
          {st.hasUpdate
            ? <span style={{ color: 'var(--green)', marginLeft: 8, fontWeight: 600 }}>• Nova versão v{st.updateInfo?.latestVersion} disponível!</span>
            : <span style={{ color: 'var(--ink-2)', marginLeft: 8 }}>• Versão atualizada</span>}
        </div>
      )}
      {st?.readyToInstall && (
        <div className="alert ok" style={{ marginTop: 12 }}><strong>Atualização pronta!</strong> O instalador foi baixado com sucesso. Clique no botão acima para reiniciar o Wallet e aplicar o update.</div>
      )}
      {st?.updateInfo?.body && (
        <div style={{ marginTop: 12, padding: 12, background: 'var(--panel-2, #18181b)', borderRadius: 6, fontSize: 13, border: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Notas da versão {st.updateInfo.latestVersion}:</div>
          <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)', maxHeight: 150, overflowY: 'auto' }}>{st.updateInfo.body}</div>
        </div>
      )}
      {applying && (
        <Modal title="Atualizando o aplicativo" onClose={() => {}}>
          <p style={{ lineHeight: 1.5 }}>O aplicativo está aplicando a atualização e será reiniciado automaticamente em instantes. Por favor, aguarde.</p>
        </Modal>
      )}
    </Card>
  );
}

export default function Settings() {
  return (
    <div className="stack">
      <PageHead title="Configurações" sub="Preferências, categorias, segurança e backups." />
      <Preferences />
      <Categories />
      <Security />
      <Backups />
      <LocalUpdate />
      <Updater />
      <ClearSystem />
      <div className="muted" style={{ textAlign: 'center', fontSize: 12, padding: '12px 0 24px' }}>Wallet · Versão {APP_VERSION} · Executando localmente no seu computador</div>
    </div>
  );
}
