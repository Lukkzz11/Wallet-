# Wallet — manual de uso

O Wallet é o seu controle financeiro pessoal. Funciona no seu computador, sem internet, e guarda tudo em um banco de dados local (SQLite). Nada é enviado para fora.

## Abrir
Use o atalho **Wallet** na Área de Trabalho ou no Menu Iniciar. Para fechar, feche a janela (o programa encerra junto).
Primeira vez, ou depois de mudar a pasta do programa: dê dois cliques em `instalar.bat`.

## Começando em 4 passos (o Painel completo é a primeira tela)
1. **Meu dinheiro → Quanto eu tenho hoje.** Digite o saldo de cada conta. Para atualizar depois, mude o número e salve.
2. **Meu dinheiro → Quanto eu recebo.** Informe de onde vem, o valor e quando: *todo mês* (escolhe o dia do mês), *toda semana* (escolhe o dia da semana) ou *só uma vez*. Marque "Certo" só para o que você tem certeza.
3. **Cartões.** Cadastre o cartão com o **limite** e o dia do vencimento. Depois informe as parcelas que você já paga.
4. **Configurações → Reserva mínima.** O quanto você quer deixar sempre guardado. Os simuladores respeitam esse valor.

## Telas
| Tela | Para que serve |
|---|---|
| **Compra nova** | Cole o link de um produto: o Wallet lê nome, imagem, preço e parcelamento (só o que a página informa), mostra uma prévia editável e envia ao simulador. Nada é registrado sem sua confirmação. |
| **Painel completo** | Primeira tela, com **compromissos do mês** (cartões, assinaturas, casa e outras contas, sem duplicar, só o que vence no mês) e visão **Mensal** e **Anual** (realizado separado do previsto). Clique em cada indicador para abrir a área correspondente; **A receber** abre os próximos recebimentos (mensal/anual). Saldo atual, receitas recebidas, gastos do mês, contas pendentes (com o detalhe de cartões e casa), valor comprometido com cartões, parcela da casa, valores a receber (separados do saldo), reservas e metas, próximas parcelas dos cartões e atalhos para registrar gasto, adicionar compra parcelada e cadastrar valor a receber. |
| **Meu dinheiro** | Três abas: *Saldo e gastos do dia* (saldo por conta, **calculadora rápida de gastos** com editar/excluir e **FGTS**), *Recebimentos* (semana atual e previsão) e *Casa* (financiamento: saldo devedor, valor financiado, prazo, meses restantes, juros, parcela e próximo vencimento, com histórico e atualização). |
| **Novo cartão** / **Adicionar parcela** / **Cartões** | Cadastro simples do cartão (nome e limite opcional), cadastro rápido de cada compra parcelada que você ainda está pagando e acompanhamento por cartão e por mês. |
| **Assinaturas** | Tudo o que você paga de forma recorrente, separado dos cartões. O total fica no final da página. |
| **Simuladores** | *Posso investir?* e *Compra parcelada*. Nada é gravado. |
| **Conectar** | Importar extrato CSV e API local para outros programas seus. |
| **Mais ferramentas** | Hub com Painel completo, Calendário, Valores a receber, Reservas e investimentos, Metas, Projeção e Análise (cada bloco mostra um número real), além de Receitas, Despesas, Contas, Dívidas, Retirada pessoal e Relatórios. |
| **Configurações** | Nome, reserva mínima, meta de economia, categorias, senha e backups. |

## Cartões
- **Visual de carteira:** cada cartão aparece como um cartão colorido (instituição, nome, bandeira, últimos 4 dígitos opcionais e limite). Clique em um cartão para abrir os detalhes: fatura do mês, compras parceladas, pagamentos registrados e compromissos futuros.
- **Novo cartão:** nome obrigatório; instituição, bandeira, final, cor e limite são opcionais (vencimento e conta que paga ficam em "Mais opções").
- **+ Adicionar parcela (botão destacado):** para cada compra que você ainda está pagando: descrição, cartão, valor da parcela, **quantas parcelas faltam** e **mês da próxima parcela** (total da compra opcional). Exemplo: R$ 150, 4 parcelas, próxima em novembro → R$ 150 em nov, dez, jan e fev, e nada depois.
- **Página geral:** total a pagar no mês, parcelas **pagas** e **pendentes** do mês, parcelas **futuras** (só dos meses seguintes, sem o mês em exibição), o detalhamento por cartão (valor do mês, já pago e o que falta) com as parcelas de cada cartão e o botão de marcar como paga/pendente, e o resumo dos próximos meses com o nome de cada cartão e o total mensal.
- Cada parcela tem situação própria (**Paga** ou **Pendente**). Marcar como paga desconta da conta uma única vez; **Marcar pendente** desfaz. Dá para editar ou excluir cada compra (as parcelas já pagas são preservadas).
- **Limite disponível** = limite − parcelas ainda não pagas − gastos avulsos informados.

## Casa (financiamento)
Em **Meu dinheiro → Casa**, informe: saldo devedor atual, valor financiado, prazo total, meses restantes, juros nominais (% ao ano), valor da parcela e vencimento da próxima. O resumo mostra saldo devedor, valor mensal e prazo restante. À medida que paga, use **Atualizar dados** com os números do extrato do banco: as parcelas pagas são mantidas, as pendentes são refeitas e o histórico guarda cada atualização.
O saldo devedor é **sempre o valor que você informa**: o Wallet não o calcula com juros nominais, porque isso depende do contrato e do sistema de amortização. As comparações exibidas são estimativas rotuladas.

## Painel completo (simples)
Quatro números em destaque: **Quanto tenho guardado** (dinheiro nas contas hoje, sem valores a receber), **Quanto ganhei** e **Quanto gastei** no mês (só o que já foi recebido/pago) e **Quanto sobra no mês** (recebido − pago). Abaixo: o que ainda falta pagar (faturas de cada cartão pelo nome, assinaturas, casa e outras contas, sem contar nada duas vezes), o **saldo projetado** (saldo atual − pendências do mês), o que há **a receber** (fora do saldo) e os próximos meses. Gráficos e números extras ficam em "Gráficos e mais números". Há visão Mensal e Anual.
- **Saldo atual** = dinheiro nas contas hoje. **Resultado do mês** = recebido − pago. **Saldo projetado** = saldo atual − o que ainda falta pagar.

## Assinaturas
Informe nome, valor, frequência, **data de início** (o dia define o dia da cobrança) e **cobrança contínua** ou **data final** ("Pagar até"). A assinatura entra automaticamente em todos os meses vigentes. Alterar a data final recalcula os meses futuros; **Pausar** (e **Retomar**) interrompe as previsões. Cobranças já registradas e pagas ficam no histórico. "Registrar cobrança" cria a despesa do ciclo e avança a próxima data (não duplica).

## Compra nova (link de produto)
A análise é feita no seu computador, sem serviços pagos. O Wallet baixa a página, lê dados estruturados (JSON-LD), metadados e o texto de parcelamento ("10x de R$ ..."). O que não for encontrado aparece como **não encontrado** (nunca é inventado) e você preenche à mão. Lojas que bloqueiam robôs ou montam o preço por JavaScript podem não ser lidas: há o botão "Tentar com navegador local" (Edge/Chrome sem janela). Links para endereços locais ou de rede privada são bloqueados. Depois da prévia, escolha **à vista** (registra um gasto pago só após confirmar) ou **parcelar em um cartão** (envia ao simulador; só vira compromisso quando você confirma lá).

## Simuladores
- **Posso investir?** Informe um valor agora e/ou por mês e o prazo. O Wallet mostra se cabe no orçamento sem deixar o disponível abaixo da reserva mínima, quanto você pode tirar agora com segurança e o maior aporte mensal seguro. O rendimento é opcional e é uma hipótese sua: o Wallet não inventa rentabilidade nem recomenda investimentos.
- **Compra parcelada** (planilha completa). Escolha um cartão ou mostre todos; a tabela mês a mês traz, por cartão: comprometido, já pago, pendente, assinaturas, valor adicional da nova compra e total projetado, até a última parcela relevante. Nada é gravado.
- **Detalhes:** Informe cartão, valor total, parcelas e o mês da primeira. Mostra a nova parcela, quanto você já paga, o novo total mensal, a projeção mês a mês, a comparação entre quantidades de parcelas e se a compra cabe no **limite**. Só ao clicar em *Confirmar que fiz esta compra* ela é registrada.

## FGTS
Em **Meu dinheiro → FGTS**, informe o saldo. Ele aparece como patrimônio, mas **não conta como dinheiro livre** (não entra em "disponível", retirada ou investimento).

## Conectar (importar arquivos e API local)
- **Importar arquivo (CSV, OFX ou PDF):** 1) escolha o destino (conta bancária ou cartão) e o arquivo; 2) o Wallet mostra uma **prévia** do que encontrou, sem gravar nada; 3) revise e edite data, descrição, valor, categoria (e as parcelas restantes, no caso de cartão); 4) confirme. Só então os registros são criados e o saldo muda (para extratos de conta).
  - Possíveis duplicados aparecem sinalizados e desmarcados; o que já foi importado antes (mesmo identificador) não entra de novo.
  - **Cartão:** cada compra vira uma compra do cartão, com as parcelas restantes distribuídas a partir do mês da fatura. Se o arquivo não trouxer parcelas ("PARC 03/10"), fica 1 parcela e você completa manualmente. Importar compras de cartão não altera o saldo.
  - **PDF:** só funciona quando o PDF tem texto (não é imagem escaneada) e o formato varia entre bancos; confira sempre as linhas, ou adicione-as manualmente.
  - Não existe conexão automática com bancos.
- **API local:** gere uma chave e envie movimentações de outro programa seu (neste computador) para `POST /api/open/transactions`, com o cabeçalho `X-Wallet-Key`. Valores em centavos, positivo = entrada. Com `id`, o mesmo item nunca é duplicado.

## Regras que o Wallet segue
- Valores futuros **nunca** entram no saldo de hoje: só quando você confirma ("Recebi", "Marcar como pago").
- Cada lançamento gera no máximo uma movimentação na conta (sem desconto duplicado).
- Dinheiro reservado não é "livre para gastar". FGTS e poupança também não.
- Receitas marcadas como incertas não entram em retirada, investimento nem projeções (a menos que você as inclua na projeção).
- Parcelas de compras novas aparecem em Dívidas e nas contas a pagar sem contar duas vezes.
- Valores em centavos; datas no formato brasileiro.

## Seus dados
- Banco: `%APPDATA%\WalletLucas\wallet.db` (a pasta mantém esse nome para preservar seus dados).
- Backups: `%APPDATA%\WalletLucas\backups` (ou a pasta que você definir em Configurações). Um backup automático é criado por dia (guarda os 30 mais recentes). Antes de restaurar, importar ou atualizar o banco, o Wallet salva uma cópia do estado atual.
- Para mudar de computador: *Configurações → Exportar dados (JSON)* e, no outro, *Importar dados*. Ou copie um backup `.db` e use *Restaurar*.
- O programa só aceita conexões do próprio computador e pode ser bloqueado por senha (*Configurações → Bloqueio por senha*; a senha é guardada com hash).

## Problemas comuns
- **Não vejo as novidades depois de uma atualização:** feche a janela por completo e abra de novo pelo atalho.
- **"O Node.js não foi encontrado":** instale o Node.js 22 ou superior (nodejs.org) e abra de novo.
- **Janela não abre:** veja `%APPDATA%\WalletLucas\wallet-lucas.log`.

## Limpar sistema
*Configurações → Limpar sistema* apaga **todos os dados financeiros** (receitas, despesas, contas, movimentações, cartões, parcelas, financiamento da casa, valores a receber, reservas, investimentos, metas, assinaturas, dívidas e históricos) para recomeçar. Há duas confirmações (a segunda exige digitar `ZERAR SISTEMA`) e a opção, marcada por padrão, de fazer um **backup antes**. Configurações, categorias, senha, preferências e a estrutura do banco são mantidas. Sem backup, a ação não pode ser desfeita.

## Atualizar o Wallet
Dê dois cliques em **Atualizar Wallet** (atalho na Área de Trabalho, ou o arquivo `Atualizar Wallet.vbs` na pasta do projeto) e confirme. Ele monta a interface nova, fecha o Wallet, cria uma cópia de segurança do banco (`antes-atualizar_...` em Backups), troca os arquivos do programa instalado e abre o Wallet de novo. Seus dados não são alterados. Se algo falhar, ele avisa e mantém a versão anterior; os arquivos antigos ficam em `.antigo` dentro da pasta do programa. Funciona sem internet.
