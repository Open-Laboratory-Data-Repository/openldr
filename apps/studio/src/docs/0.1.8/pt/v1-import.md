# Importar do OpenLDR v1

O plugin de importação OpenLDR v1 lê uma base SQL Server v1 e guarda em CE pedidos, pacientes, resultados e resultados de suscetibilidade antimicrobiana associados. Executa no servidor em páginas de pedidos.

Use a sua base v1 através de um conector Microsoft SQL só de leitura. Diagnostique-o primeiro. O plugin tem de estar instalado e um administrador tem de autorizar a leitura desse conector.

Precisa de **Manage connectors** para conceder acesso à origem. A página do plugin destina-se ao papel de administrador do laboratório. Conheça o desfasamento UTC do laboratório de origem.

A página do plugin tem dois separadores. **Importação** lê a origem e guarda registos em CE. **Cópia** guarda uma cópia das linhas de origem no servidor CE. A cópia contém os dados dos pacientes por inteiro. Nesta versão pode fazer uma cópia e mantê-la, e nada a lê ainda. A importação continua a ler a própria origem.

As capturas usam um pedido, um paciente e um resultado de texto fictícios num SQL Server isolado. Demonstram uma simulação e uma importação reais desse pequeno conjunto. Não comprovam compatibilidade com todas as bases históricas v1. Os dados opcionais de prática encontram-se no fim.

## Autorizar o plugin a ler um conector

Instale o plugin através de Marketplace ou do ficheiro aprovado. Crie um conector Microsoft SQL cujo início de sessão tenha só a permissão SELECT nas tabelas v1. Assim lê a origem e nunca a altera.

### 1. Abrir Connectors

Abra **Settings** e depois **Connectors**. Use [Diagnosticar ligações](/docs/connector-diagnose) para verificar primeiro a ligação de origem.

![Abrir Settings e depois Connectors.](v1-import-guide-connectors.png)

### 2. Abrir Plugin access

Na linha do conector v1, abra os pontos e escolha **Plugin access**.

![Escolher Plugin access para o conector da base v1.](v1-import-guide-access.png)

### 3. Autorizar o importador

Ligue o interruptor junto de `openldr-v1-import`. Cada alteração guarda imediatamente.

![Autorizar openldr-v1-import a ler este conector.](v1-import-guide-allow.png)

### 4. Verificar o interruptor guardado

O interruptor permanece ligado. Desligue-o depois para revogar o acesso do plugin ao conector.

![O interruptor autorizado permanece ligado após guardar.](v1-import-guide-allowed.png)

**Resultado esperado:** o plugin pode oferecer este conector como origem. As concessões e revogações aparecem em Audit.

## Escolher e verificar a origem

Uma ligação bem-sucedida comprova o acesso de rede e a autenticação. A etapa Checks verifica depois as tabelas esperadas.

### 1. Abrir o importador

Selecione **OpenLDR v1 import** no menu principal.

![Abrir OpenLDR v1 import no menu principal.](v1-import-guide-plugin-nav.png)

### 2. Escolher o conector de origem

Em Source, selecione o conector que aponta para a base v1.

![Selecionar o conector v1 autorizado.](v1-import-guide-source.png)

### 3. Verificar a ligação

Selecione **Check connection**. Leia cada passo e aguarde **The connection works.** Corrija qualquer falha antes de continuar.

![Check connection tem de passar antes de importar.](v1-import-guide-connection.png)

**Resultado esperado:** a ligação selecionada funciona a partir do servidor CE. Ainda não foram importados dados da origem.

## Definir a hora de origem e os limites da importação

v1 guarda datas e horas locais sem fuso horário. Escolha o desfasamento que corresponde a essas datas e horas.

### 1. Definir Site time zone

Selecione Next para abrir Options. Introduza o desfasamento UTC do laboratório de origem, como `+02:00`. Use `Z` apenas para uma origem guardada em UTC. O exemplo fictício usa Z.

![Definir o desfasamento UTC real da origem. Esta origem fictícia usa Z.](v1-import-guide-timezone.png)

### 2. Escolher limites opcionais

Database substitui a base do conector. From date e To date limitam as datas de registo. Panel codes é uma lista separada por vírgulas. Deixe os limites vazios apenas se pretende ler tudo.

![Deixar os limites vazios apenas para importar tudo.](v1-import-guide-options.png)

### 3. Executar as verificações das tabelas

Selecione Next para abrir Checks. Leia as contagens de tabelas e linhas. Têm de ser encontradas **4 of 4** tabelas: Requests, LabResults, Patients e ASTResults.

![Ler as contagens de tabelas e linhas antes de continuar.](v1-import-guide-checks.png)

**Resultado esperado:** Checks conta tabelas e linhas sem importar. Se faltar uma tabela, verifique a base e o esquema de origem.

## Experimentar uma simulação

Uma simulação lê e transforma um número limitado de pedidos sem guardar os registos clínicos.

### 1. Definir o limite de pedidos

Selecione Next para abrir Dry run. Introduza um limite pequeno. O exemplo usa `100` num conjunto de um pedido.

![Dry run limita os pedidos lidos sem guardar.](v1-import-guide-dry-limit.png)

### 2. Iniciar a simulação

Escolha **Start dry run**.

![Escolher Start dry run.](v1-import-guide-dry-start.png)

### 3. Ler o resultado

Aguarde Finished. Verifique os pedidos lidos, transformados ou importados e as falhas. Leia os motivos antes de continuar.

![Ler as contagens transformadas e falhadas da simulação.](v1-import-guide-dry-result.png)

**Resultado esperado:** o conjunto fictício termina com um pedido bem-sucedido e nenhuma falha. Uma amostra bem-sucedida não garante a transformação de todos os pedidos de uma origem grande.

## Importar a origem verificada

Uma importação real guarda registos em CE. Mantenha uma cópia de segurança da base de origem e acorde o âmbito antes de começar.

### 1. Rever o resumo da importação

Selecione Next para abrir Import. Verifique o conector e as opções.

![Verificar o conector e as opções antes da importação real.](v1-import-guide-import-summary.png)

### 2. Iniciar a importação

Escolha **Start import**. O servidor lê os pedidos página a página e guarda os registos transformados.

![Start import guarda os registos transformados.](v1-import-guide-import-start.png)

### 3. Ler as contagens finais

Aguarde Finished ou examine um resultado parado ou falhado. O exemplo guarda um pedido sem falhas. Os contadores atualizam por página e podem ficar imóveis enquanto uma página executa.

![O exemplo terminou com um pedido importado e nenhuma falha.](v1-import-guide-complete.png)

### 4. Verificar Activity

Abra **Activity**. A importação aparece com o estado e as contagens de pedidos. Uma simulação não aparece como atividade de importação.

![A execução de importação aparece em Activity.](v1-import-guide-activity.png)

**Resultado esperado:** os dados transformados ficam guardados em CE. Os registos conservam a proveniência do plugin e da execução. A base de origem permanece inalterada.

## Ler uma importação num telemóvel

Iniciar uma importação longa é mais fácil num computador. A página do plugin continua disponível no telemóvel.

### 1. Abrir a página do importador

Leia a etapa atual e o estado da execução. Desloque dentro da página nos resumos longos.

![A página de importação adapta-se à largura do telemóvel.](v1-import-guide-phone.png)

## Parar, retomar e repetir

Uma importação ativa continua no servidor quando sai da página. Ao regressar, abre a execução atual. **Stop** termina após a página em curso. **Resume** continua após o último pedido concluído depois de uma paragem, falha ou reinício do servidor.

Um pedido já importado é substituído, sem duplicação. Repetir uma importação atualiza dados. Reveja primeiro o âmbito e as opções. O pequeno conjunto das capturas terminou depressa demais para demonstrar Stop e Resume. Esses comandos foram verificados no código, sem captura numa execução longa.

As falhas de um pedido não param os restantes. A página mostra os primeiros 100 motivos. Guarda códigos de motivo sem conteúdo das linhas de origem. A importação não emite data.persisted para cada pedido. Os workflows que escutam esse evento não executam para esses registos.

## Copiar primeiro a origem

Uma cópia lê as linhas da base v1 e guarda-as no disco do próprio servidor CE. Use-a quando a ligação à origem for lenta ou cair. O servidor lê página a página, tenta de novo depois de uma ligação perdida e continua depois de um reinício. Ninguém precisa de vigiar a página.

Nada lê a cópia ainda. A importação das secções anteriores continua a ler a própria origem, por isso uma cópia não muda o que uma importação guarda.

A cópia contém os dados dos pacientes por inteiro. Guarda todas as colunas das linhas Requests, LabResults, Patients e ASTResults de cada pedido lido. Proteja o servidor CE e as suas cópias de segurança como protege a origem. Há uma cópia por conector. O plugin tem de estar autorizado a ler o conector primeiro.

### 1. Abrir o separador Cópia

Abra **OpenLDR v1 import** no menu principal e selecione o separador **Cópia** no topo da página.

![O separador Cópia fica ao lado do separador Importação.](v1-import-guide-copy-tab.png)

### 2. Escolher a origem e as opções

Selecione o conector. Em **Opções da cópia**, preencha os mesmos valores que numa importação. **Base de dados**, **Data inicial**, **Data final** e **Códigos de painel** decidem que pedidos a cópia lê. A cópia não precisa de **Fuso horário do local**, porque guarda as datas tal como a origem as escreveu. A página pede mesmo assim um valor como `+02:00` ou `Z`. Qualquer valor válido dá a mesma cópia.

![Escolher o conector e as opções da cópia.](v1-import-guide-copy-options.png)

### 3. Iniciar a cópia

Abra o menu de pontos no canto superior direito do separador Cópia e selecione **Iniciar cópia**. O estado mostra **Na fila. O servidor inicia-a dentro de alguns segundos.** Depois mostra **A copiar**. Pode sair da página. Enquanto uma cópia está a decorrer, as suas opções ficam bloqueadas. Pode mesmo assim escolher outro conector para ver ou iniciar a sua cópia.

![Iniciar cópia está no menu de pontos no canto superior direito do separador.](v1-import-guide-copy-start.png)

### 4. Ler a tabela de conjuntos

Cada linha da tabela é um conjunto. O plugin v1 copia um só conjunto, `requests`, que contém as linhas das quatro tabelas de cada pedido. **Estado** mostra Não iniciado, A copiar, À espera, Copiado em parte, Concluído, Por ler de novo ou A eliminar. **Pedidos lidos** é o número de pedidos guardados até agora. **Linhas** é o número de linhas de origem guardadas, das quatro tabelas. **Tamanho** é o tamanho dessas linhas tal como o CE as guarda.

A linha por baixo do estado conta os pedidos "de um total ainda desconhecido". O CE conta os pedidos da origem quando uma cópia começa ou continua, mas esta página ainda não mostra esse número. **Activity** e `openldr import copy status` mostram a parte lida e o tempo restante. Uma cópia terminada mostra **Concluída** e dá **Pedidos copiados:** com o número.

![A tabela dá o estado, os pedidos, as linhas e o tamanho.](v1-import-guide-copy-sets.png)

Quando o CE não conseguiu copiar alguns pedidos, uma linha cor de âmbar dá **Pedidos deixados de fora:** e o número, e o estado mostra **Concluída, com pedidos deixados de fora**. A resolução de problemas explica porquê.

![Uma cópia com pedidos deixados de fora não está completa.](v1-import-guide-copy-skipped.png)

### 5. Não mexer numa cópia à espera

Quando a origem ou a ligação a ela está em baixo, o estado mostra **À espera da origem. Voltará a tentar automaticamente.** A página mostra **Tentativas até agora:**, quando começou a espera e o último erro. Não precisa de fazer nada. A primeira espera dura 5 segundos. Cada espera duplica, até 5 minutos, até a origem responder ou alguém parar a cópia. Se a origem responder mas a mesma página se perder duas vezes seguidas, a cópia lê essa página de novo com metade do tamanho. As esperas voltam então a começar em 5 segundos. A página volta a crescer depois de 5 páginas boas seguidas.

O último erro de uma ligação perdida começa em geral com palavras simples e depois dá as palavras do controlador. Quando a própria origem reinicia, pode recusar o início de sessão ou indicar que a base de dados não está disponível durante algum tempo. Uma cópia que já leu esta origem espera então até cerca de uma hora. O mesmo acontece com uma palavra-passe errada escrita no conector antes de continuar uma cópia. Essa cópia espera até cerca de uma hora e depois falha. Uma cópia nova com uma palavra-passe errada falha depois de cerca de meio minuto.

Depois de mudar as definições do conector, pare a cópia e continue-a. Uma cópia à espera continua a tentar as definições antigas.

Uma cópia também continua sozinha depois de o servidor CE reiniciar. Não precisa de fazer nada. As contagens podem ficar paradas até cerca de dois minutos depois do reinício antes de voltarem a avançar.

![Uma cópia à espera volta a tentar sozinha.](v1-import-guide-copy-waiting.png)

### 6. Parar e continuar

Abra o menu de pontos ao lado do estado e selecione **Parar**. O estado mostra **A parar depois desta página** e depois **Parada**. Uma cópia na fila é parada logo. As linhas já copiadas ficam. Para continuar, abra o menu de pontos no canto superior direito do separador e selecione **Continuar cópia**. Cada conjunto continua de onde parou. Numa cópia concluída, **Continuar cópia** só tenta de novo os pedidos deixados de fora. Não lê pedidos novos da origem. Se a cópia foi iniciada pela CLI sem fuso, **Fuso horário do local** fica vazio, exceto um exemplo a cinzento. A página pede então um desfasamento válido, como `Z`, antes de **Continuar cópia** funcionar. Esse desfasamento não muda nada na cópia.

![Parar está no menu de pontos ao lado do estado.](v1-import-guide-copy-stop.png)

Se mudou **Base de dados**, **Data inicial**, **Data final** ou **Códigos de painel**, Continuar cópia pergunta **Ler de novo desde o início?** e nomeia os conjuntos. **Ler de novo** elimina as linhas já copiadas para esses conjuntos e depois lê-os de novo desde o início. Numa ligação lenta isso pode levar dias. Para manter a cópia, selecione **Cancelar** e reponha as opções. Depois abra o menu de pontos no canto superior direito do separador e selecione **Continuar cópia**.

![Ler de novo elimina o que foi copiado para os conjuntos nomeados.](v1-import-guide-copy-reread.png)

### 7. Eliminar uma cópia

Pare primeiro a cópia. Abra o menu de pontos e selecione **Eliminar cópia**. O passo nomeia o conector e dá as linhas e o tamanho. Escreva `openldr-v1-import` e selecione **Eliminar cópia**.

O estado mostra **A eliminar as linhas copiadas**. O servidor elimina as linhas em lotes, em segundo plano. Continua quando sai da página e depois de um reinício do servidor. No fim, a página mostra **A cópia foi eliminada.**

![Escrever o identificador do plugin para eliminar a cópia.](v1-import-guide-copy-delete.png)

**Resultado esperado:** a cópia guarda as linhas de origem no servidor CE, e a base de origem fica inalterada. Nada no CE lê a cópia ainda.

## Importar pela linha de comandos

Leia [Começar aqui](/docs/start-here) para configurar a CLI. A partir de `openldr_ce`, autorize apenas o conector pretendido. Faça uma simulação antes da importação real. Substitua o identificador e o desfasamento de origem.

```shell
pnpm openldr import allow openldr-v1-import <connector-id>
pnpm openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00 --dry-run --limit 100
pnpm openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00
pnpm openldr import status openldr-v1-import
pnpm openldr import allowed openldr-v1-import
```

Quatro comandos trabalham sobre a cópia. Substitua os identificadores. Uma cópia não precisa da opção `tz`. Sem ela, a página pede um fuso como `Z` antes de **Continuar cópia** funcionar. Qualquer fuso válido dá a mesma cópia.

```shell
pnpm openldr import copy start --plugin openldr-v1-import --connector <connector-id>
pnpm openldr import copy status openldr-v1-import
pnpm openldr import copy stop openldr-v1-import <copy-id>
pnpm openldr import copy delete openldr-v1-import <copy-id> --force
```

`start` regista o pedido e o comando termina logo. O servidor faz a cópia. Numa cópia que já está na fila, a copiar ou à espera com as mesmas opções, `start` devolve essa cópia sem a mudar. Numa cópia parada ou com falha, continua de onde cada conjunto parou. Numa cópia concluída, só tenta de novo os pedidos deixados de fora e não lê pedidos novos.

Acompanhe o progresso com `status`. Mostra uma linha por cópia: o identificador da cópia, o estado e depois `keys`, `rows`, `bytes` e `skipped` de cada conjunto. Uma cópia concluída com pedidos deixados de fora mostra `completed with skipped keys`. Uma cópia à espera ou com falha termina a linha com o erro. O identificador da cópia é o primeiro valor da linha.

Quando uma opção mudou o que um conjunto lê, `start` nomeia os conjuntos e não muda nada. Execute-o de novo com `--reread` para ler esses conjuntos de novo desde o início. Uma cópia a copiar ou à espera tem de ser parada primeiro. `stop` para a cópia depois da página em curso. `delete` recusa sem `--force`. Tal como o botão, o comando termina antes de as linhas desaparecerem, e o servidor continua a eliminar em segundo plano.

## Prática opcional com dados de origem fictícios

A utilização normal exige uma base v1 existente. Apenas num SQL Server descartável, [example-source.sql](https://openldr.online/docs-samples/user-guide/v1-import/example-source.sql) cria uma base separada `guide_v1`, as quatro tabelas esperadas, um pedido, um paciente e um resultado de texto fictícios. ASTResults está vazia. Este conjunto mínimo não é um esquema histórico v1 completo.

O ficheiro cria uma base. Leia-o antes de executar e use um servidor descartável sem uma base chamada guide_v1. Peça ao operador uma conta só de leitura. O ficheiro não fornece credenciais de início de sessão.

No código-fonte, `pnpm build:v1-import` prepara o importador de referência. Exige Rust e o destino wasm32-wasip1. Instale o ficheiro com `pnpm openldr plugin install reference-plugins/openldr-v1-import/plugin.wasm`. Esse comando passa pela API em execução, por isso inicie-a e inicie sessão primeiro. A compilação sem assinatura destina-se a testes. Na utilização normal, use o pacote assinado aprovado pela organização.

## Resolução de problemas

**Falta o importador no menu principal.** Verifique a instalação, o estado ativo do plugin e o acesso de administrador.

**Plugin access está vazio.** Verifique que o conector é Microsoft SQL e que o importador está instalado.

**Não existem origens.** Autorize o plugin no conector correto e reabra a página.

**A ligação falha.** Use Diagnose do conector e corrija o primeiro passo que falhou.

**Menos de quatro tabelas.** Verifique a substituição da base, os nomes das tabelas e as permissões de leitura. Uma ligação bem-sucedida não comprova o esquema v1.

**Start ou Resume é recusado.** Leia o erro e o registo da API. O serviço exige uma entrada de auditoria antes de iniciar.

**As contagens ficam imóveis.** Aguarde a página atual. Cada página pode conter 500 pedidos. Verifique os erros antes de concluir que uma importação grande ficou parada.

**A cópia mostra À espera da origem.** O CE não consegue ligar-se à origem, ou a ligação a ela está em baixo. A cópia volta a tentar sozinha, com no máximo 5 minutos entre tentativas. Leia o último erro. Se a espera continuar, execute Diagnose no conector. Depois de corrigir o conector, pare a cópia e continue-a, para que use as definições novas. Pare a cópia só se quiser que deixe de tentar.

**Alguns pedidos ficaram de fora.** A linha cor de âmbar **Pedidos deixados de fora:** dá quantos são. O CE deixa um pedido de fora por uma de duas razões. Lido sozinho, excedeu o tempo limite três vezes. O CE regista isto como `SOURCE_TIMEOUT`. Ou uma das suas linhas tem texto que a base de dados do CE não consegue guardar, como um carácter NUL. O CE regista isto como `ROW_NOT_STORABLE`. A cópia tenta-os de novo no fim de cada passagem e no início seguinte. A página e a CLI mostram só o número. Na CLI, o estado aparece como `completed with skipped keys`. Uma cópia com pedidos deixados de fora não está completa.

**Continuar cópia pede para ler um conjunto de novo.** Na CLI, `start` nomeia os conjuntos em vez disso. Mudou uma opção que decide que pedidos são lidos, ou o plugin foi atualizado. Ler de novo elimina as linhas copiadas para os conjuntos nomeados. Selecione **Cancelar** e reponha as opções para as manter.

**A cópia falhou.** Leia o último erro. Um início de sessão recusado, uma base ou tabela em falta, uma falha do plugin, ou uma escrita recusada pela base de dados do próprio CE, por exemplo com o disco cheio, termina a cópia. Tentar de novo não resolve isso. Há uma exceção. Uma cópia que já leu esta origem espera até cerca de uma hora por um início de sessão recusado ou uma base em falta, caso a origem esteja a reiniciar. Corrija a causa e depois abra o menu de pontos no canto superior direito do separador Cópia e selecione **Continuar cópia**. As linhas já copiadas ficam.

**Eliminar cópia está a cinzento.** Só se pode eliminar uma cópia parada, com falha ou concluída. Pare-a primeiro.

## Guias relacionados

[Diagnosticar ligações](/docs/connector-diagnose), [Conectores](/docs/connectors), [Mercado](/docs/marketplace), [Atividade](/docs/activity) e [Auditoria](/docs/audit).
