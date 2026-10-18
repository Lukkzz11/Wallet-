# Wallet

Controle financeiro pessoal, local e offline. Node.js + SQLite + React.

Guia de uso completo: [MANUAL.md](MANUAL.md).

## Usar no dia a dia
1. Uma única vez: dê dois cliques em `instalar.bat` (instala dependências, compila a interface e cria os atalhos *Wallet* na Área de Trabalho e no Menu Iniciar).
2. Depois é só abrir o atalho. Abre uma janela própria (Edge/Chrome em modo aplicativo); ao fechá-la, o servidor local é encerrado.

Requisitos: Windows, Node.js 22+ e Microsoft Edge (ou Chrome).

## Onde ficam os dados
- Banco: `%APPDATA%\WalletLucas\wallet.db` (fora da pasta do programa, não é afetado por atualizações).
- Backups: `%APPDATA%\WalletLucas\backups` (ou a pasta definida em Configurações). Um backup automático é criado por dia (mantém 30). Antes de restaurar/importar, o estado atual é copiado.
- Log do servidor: `%APPDATA%\WalletLucas\wallet-lucas.log`.
- O servidor escuta somente em `127.0.0.1:47821` e recusa `Host`/`Origin` de outros sites.

## Desenvolvimento
```
npm install
npm run dev:api     # API em 127.0.0.1:47821
npm run dev:web     # interface com hot reload em :5173
npm run build       # compila a interface em web/dist
npm test            # testes (node:test)
```

## Estrutura
- `server/core/` regras de cálculo puras (datas, saldos, assinaturas, retirada, projeções, análises).
- `server/services/` operações transacionais no SQLite (lançamentos, contas, planejamento, backup, senha, relatórios).
- `server/routes.js`, `server/index.js` API HTTP local e arquivos estáticos.
- `web/src/` interface React (uma página por módulo em `pages/`).
- `launcher/` inicializador Windows, ícone e instalador de atalhos.

## Regras de integridade
- Valores em centavos (inteiros). Datas `AAAA-MM-DD`.
- Saldo da conta = saldo inicial + movimentações a partir da data de referência. Um lançamento só gera uma movimentação (índice único), então não há desconto duplicado.
- Reservas são marcações dentro das contas: o dinheiro reservado sai do "disponível", mas não é contado duas vezes.
- Receitas incertas nunca entram nos cálculos de retirada e projeção (a menos que você as inclua explicitamente na projeção).
- Migrações de esquema criam uma cópia do banco antes de alterar qualquer coisa.
