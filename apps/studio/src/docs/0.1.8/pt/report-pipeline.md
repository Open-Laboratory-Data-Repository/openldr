# Relatórios agendados com fluxos de trabalho

Este guia constrói um relatório agendado clássico só com fluxos de trabalho: consultar uma base de dados, preencher um modelo Excel com a sua imagem e enviá-lo por e-mail. Ninguém escreve nem corre um programa à parte.

O padrão usa **dois fluxos ligados por um conjunto de dados** (dataset):

1. **Materialize**: a parte pesada. Num horário, lê a base de origem, reorganiza os dados e guarda um **dataset** com nome, uma tabela de resultados guardada. Corra-o tantas vezes quantas os dados precisarem de ser atualizados.
2. **Relatório e e-mail**: a parte de entrega. **Carrega** esse dataset, preenche um modelo Excel e envia o ficheiro. Corra-o quando o relatório for devido.

Separar o trabalho torna a entrega rápida, porque lê o dataset guardado e não as tabelas vivas. As duas partes podem também ter horários diferentes.

Os nomes dos nós e campos dos fluxos estão em inglês no ecrã, por isso este guia mantém-nos em inglês. Leva cerca de 20 minutos. Selecione uma imagem ou um clip para o ampliar.

## Quem pode fazer o quê

Precisa de **Edit workflows** para construir os fluxos, e de **Manage connectors** para criar os conectores de base de dados e de e-mail que usam. Veja [Fluxos de trabalho](/docs/workflows) e [Conectores](/docs/connectors).

## Antes de começar

- **Os dados de exemplo da documentação**, para o exemplo. Veja [Painéis, Carregar os dados de exemplo](/docs/dashboard#carregar-os-dados-de-exemplo).
- **Um conector de base de dados** para a sua origem. Uma instalação nova tem **Target Warehouse (Postgres)**, que o exemplo usa.
- **Um conector de e-mail** para a parte B. SMTP é o mais simples, incluindo o Gmail com uma palavra-passe de aplicação. Veja [Conectores, Conectores de e-mail](/docs/connectors#conectores-de-e-mail).
- **O seu modelo `.xlsx`** para a parte B, com uma linha de cabeçalho e os dados a começar logo abaixo.

## Exemplo 1: materializar um dataset a partir do exemplo

Construa a parte Materialize com os dados de exemplo: conte os pedidos por exame em setembro e outubro de 2026, e guarde o resultado no dataset `orders_by_test_sample`.

![Dar nome ao fluxo, largar Manual Trigger, Postgres e Materialize Dataset, ligá-los e escrever o SQL.](report-pipeline-build.mp4)

1. Abra **Fluxos de trabalho**. Abra **Workflow actions** e selecione **New**.
2. Em **Workflow name**, escreva `Materialize orders by test (sample)`.
3. Da biblioteca de nós, arraste **Manual Trigger** (em **Core**), **Postgres** (em **Databases**) e **Materialize Dataset** (em **Core**) para a tela.
4. Ligue-os: Manual Trigger a Postgres, e depois Postgres a Materialize Dataset. Arraste do ponto direito de um nó para o ponto esquerdo do seguinte.
5. Selecione **Postgres** e depois a roda dentada. Escolha o conector **Target Warehouse (Postgres)** e escreva:

```sql
SELECT panel_desc AS test, COUNT(*) AS orders
FROM lab_requests
WHERE authored_at >= '2026-09-01' AND authored_at < '2026-11-01'
GROUP BY panel_desc
ORDER BY orders DESC
```

6. Selecione **Materialize Dataset** e depois a roda dentada. Em **Dataset name**, escreva `orders_by_test_sample`. Um dataset é substituído pelo nome: a última execução substitui as linhas anteriores.

![As definições do nó Materialize Dataset.](report-pipeline-materialize-config.png)

![Guardar, executar, e a execução a terminar.](report-pipeline-run.mp4)

7. Selecione **Save** e depois **Run**. Selecione o distintivo de reprodução em Manual Trigger.

**Resultado esperado:** **Completed, 3 steps**. O separador **Output** de Materialize Dataset lista cinco itens: Full blood count 18, Malaria rapid test 16, HIV viral load 11, Blood glucose 9, Creatinine 6.

![A saída da execução: cinco linhas.](report-pipeline-output.png)

A janela de datas limita o exemplo aos dois meses da amostra. Num relatório real, a janela vem de um nó **Edit Fields**, como na parte A abaixo.

### Ver o dataset

1. No editor de fluxos, selecione **Datasets** na barra de ferramentas. **orders_by_test_sample** aparece com **5** linhas, a data de atualização e uma transferência **CSV**.

![A lista Datasets no editor de fluxos.](report-pipeline-datasets.png)

2. Abra **Consulta**. No explorador, expanda **Datasets** e selecione **orders_by_test_sample**. As cinco linhas abrem num separador.

![O dataset aberto em Consulta.](report-pipeline-query.mp4)

![As cinco linhas do dataset em Consulta.](report-pipeline-query-result.png)

Um dataset vive na base de dados interna. Para que os nós SQL e os painéis o consultem como uma tabela real do armazém Postgres, ligue **Publicar conjuntos de dados de fluxo de trabalho** em [Definições](/docs/settings).

## Parte A: o fluxo Materialize completo

Construa este grafo (gatilho → campos → duas extrações SQL → reorganização → materialização):

![O fluxo Materialize: horário, limites de datas, duas extrações, um pivot, uma junção e a materialização](report-materialize-builder.png)

1. **Schedule trigger**: defina o cron conforme a frequência de reconstrução dos dados.
2. **Edit Fields**: calcule o período, por exemplo `periodStart` = primeiro dia do mês passado, `periodEnd` = primeiro dia deste mês. Estes valores alimentam as consultas.
3. **Nó(s) de base de dados**: um ou mais nós **Postgres / Microsoft SQL**, cada um com o **conector** da origem e um `SELECT` simples. Injete o período com modelos:

   ```sql
   select ...
   from requests r
   where r.registered >= '{{ $json.periodStart }}'
     and r.registered <  '{{ $json.periodEnd }}'
   ```

   Mantenha cada consulta um `SELECT` portável. Faça a reorganização nos nós seguintes, não em SQL próprio de uma base.
4. **Pivot** (se precisar): transforme linhas longas em colunas largas (por exemplo uma coluna por antibiótico). Defina as chaves de agrupamento, a coluna pivot, a coluna de valor e a lista fixa de colunas de saída.
5. **Merge → Combine by key** (se tiver duas extrações): junte-as por chaves comuns (por exemplo `requestid`, `organism`). Ligue primeiro o ramo "esquerdo" ao nó.
6. **Materialize Dataset**: dê-lhe um nome estável, por exemplo `amr_ndola_monthly`.

**Guarde e execute-o.** Confirme que a execução está verde e que o dataset tem linhas. Um dataset vazio quer dizer que a origem ou o período não devolveu nada.

## Parte B: o fluxo Relatório e e-mail

Construa este grafo (gatilho → carregar → modelo → e-mail):

1. **Schedule trigger**: defina-o para disparar depois de a parte A atualizar o dataset.
2. **Load Dataset**: o mesmo nome materializado (`amr_ndola_monthly`).

![A configuração do nó Excel Template, com o botão Upload template](report-excel-template.png)

3. **Excel Template**:
   - Clique em **Upload template** e escolha o seu `.xlsx`. A *Template artifact key* preenche-se sozinha. O fluxo tem de ser guardado primeiro, porque o ficheiro fica guardado com ele.
   - **Start cell**: onde começam os dados, por exemplo `A2`.
   - **Columns (ordered)**: os campos dos itens pela ordem das colunas do modelo. Os valores escrevem-se da esquerda para a direita a partir da célula inicial.
   - **Auto-filter header cell**: por exemplo `A1`, para juntar um filtro à linha de cabeçalho (opcional).
   - **Password**: para proteger o ficheiro, aponte para um conector ou segredo com a palavra-passe. Deixe vazio para um ficheiro sem proteção.
4. **Send Email**:
   - **Connector**: o seu conector SMTP ou de e-mail.
   - **To** (e **Cc**): os destinatários.
   - **Subject**, **Body**, **Body format**.
   - **Attachment field**: defina como `file` para anexar a saída do Excel Template.

**Execute-o** e veja a caixa do destinatário, e o spam no primeiro envio.

## Um exemplo maior: o relatório AMR mensal

O relatório de sensibilidade antimicrobiana leva o padrão ao máximo:

- **Materialize:** dois `SELECT` portáveis, um para os isolados de cultura e outro para os resultados de antibiograma em formato longo. Depois um **Pivot** espalha cerca de 50 antibióticos por colunas, um **Merge → Combine by key** junta os isolados aos resultados pivotados por `requestid` + `organism`, e **Materialize Dataset** escreve `amr_ndola_monthly`.
- **Relatório:** **Load Dataset** → **Excel Template** preenche o modelo `AMR_temp.xlsx` (início `A2`, filtro `A1`, palavra-passe opcional) → **Send Email** anexa o ficheiro para os destinatários.

Tudo o que é próprio dos antimicrobianos ou das datas vive nos nós, por isso os mesmos dois fluxos correm em Postgres ou SQL Server só com a escolha do conector certo.

## Ordem das operações

Corra sempre **Materialize antes de Relatório**: o Relatório lê o que Materialize escreveu. Num horário, defina o Relatório para disparar um pouco depois de Materialize.

## Resolução de problemas

- **O anexo está vazio ou só tem cabeçalhos:** o dataset estava vazio. Corra primeiro Materialize e veja o período e a consulta de origem.
- **"Save the workflow first" ao carregar um modelo:** guarde o fluxo e depois carregue o ficheiro.
- **O e-mail sai sem anexo:** defina **Attachment field** de Send Email como `file`.
- **O Gmail recusa o início de sessão:** use uma palavra-passe de aplicação, não a palavra-passe normal. Veja [Conectores, Enviar do Gmail](/docs/connectors#enviar-do-gmail-com-uma-palavra-passe-de-aplicacao).
- **Um nó de base de dados não tem onde correr:** crie e associe um conector. Veja [Conectores](/docs/connectors).
- **A junção não dá linhas:** confirme que os dois ramos usam os **mesmos nomes de chave**, e que o ramo esquerdo foi ligado primeiro ao Merge.

## Num telemóvel

Os fluxos leem-se num telemóvel, mas construir um precisa de um ecrã grande. Um relatório agendado corre no servidor, não precisa do ecrã de ninguém.

## Guias relacionados

- [Fluxos de trabalho](/docs/workflows)
- [Conectores](/docs/connectors)
- [Consultas personalizadas](/docs/query)
- [Relatórios](/docs/reports)
- [Definições](/docs/settings)
