# Importar do OpenLDR v1

O plugin de importação OpenLDR v1 lê uma base SQL Server v1 e guarda em CE pedidos, pacientes, resultados e resultados de suscetibilidade antimicrobiana associados. Executa no servidor em páginas de pedidos.

Use a sua base v1 através de um conector Microsoft SQL só de leitura. Diagnostique-o primeiro. O plugin tem de estar instalado e um administrador tem de autorizar a leitura desse conector.

Precisa de **Manage connectors** para conceder acesso à origem. A página do plugin destina-se ao papel de administrador do laboratório. Conheça o desfasamento UTC do laboratório de origem.

As capturas usam um pedido, um paciente e um resultado de texto fictícios num SQL Server isolado. Demonstram uma simulação e uma importação reais desse pequeno conjunto. Não comprovam compatibilidade com todas as bases históricas v1. Os dados opcionais de prática encontram-se no fim.

## Autorizar o plugin a ler um conector

Instale o plugin através de Marketplace ou do ficheiro aprovado. Crie um conector Microsoft SQL com acesso SELECT às tabelas v1. A conta não deve alterar os registos de origem.

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

## Importar pela linha de comandos

Leia [Começar aqui](/docs/start-here) para configurar a CLI. A partir de `openldr_ce`, autorize apenas o conector pretendido. Faça uma simulação antes da importação real. Substitua o identificador e o desfasamento de origem.

```shell
pnpm openldr import allow openldr-v1-import <connector-id>
pnpm openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00 --dry-run --limit 100
pnpm openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00
pnpm openldr import status openldr-v1-import
pnpm openldr import allowed openldr-v1-import
```

## Prática opcional com dados de origem fictícios

A utilização normal exige uma base v1 existente. Apenas num SQL Server descartável, [example-source.sql](https://openldr.online/docs-samples/user-guide/v1-import/example-source.sql) cria uma base separada `guide_v1`, as quatro tabelas esperadas, um pedido, um paciente e um resultado de texto fictícios. ASTResults está vazia. Este conjunto mínimo não é um esquema histórico v1 completo.

O ficheiro cria uma base. Leia-o antes de executar e use um servidor descartável sem uma base chamada guide_v1. Peça ao operador uma conta só de leitura. O ficheiro não fornece credenciais de início de sessão.

No código-fonte, `pnpm build:v1-import` prepara o importador de referência. Exige Rust e o destino wasm32-wasip1. Instale o ficheiro com `pnpm openldr plugin install reference-plugins/openldr-v1-import/plugin.wasm`. A compilação sem assinatura destina-se a testes. Na utilização normal, use o pacote assinado aprovado pela organização.

## Resolução de problemas

**Falta o importador no menu principal.** Verifique a instalação, o estado ativo do plugin e o acesso de administrador.

**Plugin access está vazio.** Verifique que o conector é Microsoft SQL e que o importador está instalado.

**Não existem origens.** Autorize o plugin no conector correto e reabra a página.

**A ligação falha.** Use Diagnose do conector e corrija o primeiro passo que falhou.

**Menos de quatro tabelas.** Verifique a substituição da base, os nomes das tabelas e as permissões de leitura. Uma ligação bem-sucedida não comprova o esquema v1.

**Start ou Resume é recusado.** Leia o erro e o registo da API. O serviço exige uma entrada de auditoria antes de iniciar.

**As contagens ficam imóveis.** Aguarde a página atual. Cada página pode conter 500 pedidos. Verifique os erros antes de concluir que uma importação grande ficou parada.

## Guias relacionados

[Diagnosticar ligações](/docs/connector-diagnose), [Conectores](/docs/connectors), [Mercado](/docs/marketplace), [Atividade](/docs/activity) e [Auditoria](/docs/audit).
