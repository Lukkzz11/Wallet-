import { useState } from 'react';
import { post } from '../api.js';
import { useApp, Card, Modal } from '../ui.jsx';

const PHRASE = 'ZERAR SISTEMA';

export default function ClearSystem() {
  const { refresh, notify, nav } = useApp();
  const [step, setStep] = useState(0);
  const [backup, setBackup] = useState(true);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const close = () => { setStep(0); setText(''); setErr(''); };
  const run = async () => {
    setBusy(true); setErr('');
    try {
      const r = await post('/api/system/clear', { confirm: text, backup });
      notify(r.backup ? `Sistema zerado. Backup salvo: ${r.backup}` : 'Sistema zerado.');
      close(); await refresh(); nav('dashboard');
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  return (
    <Card title="Limpar sistema">
      <p className="muted" style={{ marginBottom: 12 }}>Apaga todos os dados financeiros para recomeçar do zero. Configurações, categorias, senha, preferências e a estrutura do banco são mantidas.</p>
      <button className="btn danger" onClick={() => setStep(1)}>Limpar sistema…</button>
      {step === 1 && (
        <Modal title="Limpar sistema — confirmação" onClose={close} footer={<><button className="btn" onClick={close}>Cancelar</button><button className="btn danger" onClick={() => setStep(2)}>Continuar</button></>}>
          <div className="alert danger"><strong>Esta ação é irreversível sem backup.</strong> Serão apagados:</div>
          <ul style={{ lineHeight: 1.7, margin: '10px 0' }}>
            <li>Receitas, despesas, valores a receber e pagamentos registrados</li>
            <li>Contas e movimentações</li>
            <li>Cartões e compras parceladas</li>
            <li>Financiamento da casa</li>
            <li>Reservas, investimentos e metas</li>
            <li>Assinaturas, dívidas e históricos financeiros</li>
          </ul>
          <label className="check"><input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} /><span>Fazer um backup completo antes de limpar <small>Recomendado. Fica na pasta de backups e pode ser restaurado em Configurações.</small></span></label>
          {!backup && <div className="alert warn" style={{ marginTop: 10 }}>Sem backup, não será possível recuperar os dados.</div>}
        </Modal>
      )}
      {step === 2 && (
        <Modal title="Segunda confirmação" onClose={close} footer={<><button className="btn" onClick={close}>Cancelar</button><button className="btn danger" disabled={text !== PHRASE || busy} onClick={run}>{busy ? 'Apagando…' : 'Zerar sistema agora'}</button></>}>
          <p style={{ marginBottom: 10 }}>Para continuar, digite <strong>{PHRASE}</strong> abaixo.</p>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={PHRASE} />
          <p className="muted" style={{ marginTop: 8 }}>{backup ? 'Um backup será criado e verificado antes de apagar.' : 'Nenhum backup será criado.'}</p>
          {err && <div className="alert danger" style={{ marginTop: 10 }}>{err}</div>}
        </Modal>
      )}
    </Card>
  );
}
