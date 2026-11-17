# Mapear dados do laboratório para FHIR

<!-- operator-platform -->

Map to FHIR é um nó de workflow. No studio, as suas definições têm o título «Mapear para FHIR». Lê o que um laboratório envia e produz registos FHIR que o OpenLDR guarda. Reconhece três tipos de entrada:

- FHIR, como Bundle, lista de recursos ou um único recurso. O nó passa-o adiante como recursos.
- Respostas a um formulário que o nó aceita. O nó verifica-as pelo formulário e transforma-as em registos.
- As linhas próprias de um laboratório, como as de uma exportação CSV ou de uma lista JSON. O nó só as transforma em registos quando alguém guardou no nó um mapeamento para as suas colunas.

Cada conjunto de registos passa pelas verificações do OpenLDR ao nível de validação configurado. O que o nó não consegue mapear, ou o que falha uma verificação, segue para a saída **retidos** com um motivo. Nada de uma linha retida é guardado.

## Quando usar

Use-o quando um sistema de laboratório envia a sua própria exportação e não consegue enviar FHIR. Uma pessoa mapeia as colunas uma vez, no studio, sobre uma amostra real. Depois disso, cada ficheiro novo com essas colunas é mapeado sem ajuda.

Numa instalação nova, o workflow fornecido **Ingest** já o usa. O webhook, `/api/workflows/hooks/ingest`, envia cada pedido para Map to FHIR. **saída** segue para **Persist store**. Nada está ligado a **retidos**, de propósito. Uma instalação feita antes desta versão mantém o grafo Ingest antigo. **Reset to default** no workflow Ingest aplica o novo e elimina qualquer alteração feita ao antigo.

O guia da aplicação **Map to FHIR** mostra passo a passo como mapear um ficheiro.

Use um nó Map to FHIR por cada ficheiro do laboratório. Uma linha só é mapeada quando exatamente um mapeamento guardado do nó conhece todas as suas colunas. Quando dois mapeamentos guardados servem para uma linha, o nó retém-na.

## Ver um mapeamento antes de o usar

O studio mostra cada campo de origem e o seu exemplo antes do nome de destino e do caminho FHIR. Depois de **Testar**, o menu de pontos de uma linha que passa oferece **Ver FHIR gerado**. Mostra os registos dessa linha em JSON copiável, com os valores convertidos e as ligações entre registos. O teste não os guarda. Alterar o mapeamento ou carregar outra amostra limpa os resultados anteriores.

## Um ficheiro com uma coluna por análise

Uma folha de laboratório ou uma exportação WHONET tem muitas vezes uma coluna por análise, por exemplo uma coluna por antibiótico. Para o mapear:

1. No painel de mapeamento, escolha a primeira coluna de análise no campo de resultado.
2. Selecione **Adicionar outra coluna** e marque as outras colunas de análise.
3. Confira a análise ao lado de cada coluna. Começa com o nome da coluna.
4. Para transformar as análises em códigos padrão, junte uma regra **Lista de códigos** em **Análise**.
5. Guarde o mapeamento, e depois o workflow.

Cada linha dá então um resultado por cada coluna de análise com valor, ligado ao paciente, à amostra e ao pedido da linha. Uma célula vazia não dá resultado. O mapeamento guarda a análise de cada coluna como configuração, nunca um valor de uma linha.

## O que o emissor vê

O webhook responde pela execução inteira. O workflow predefinido **Ingest** recusa uma mensagem inteira quando alguma parte dela não pode ser guardada. Como nada está ligado a **retidos**, uma única linha retida faz falhar o nó e a execução, e o Persist store não corre. Nada dessa mensagem é guardado. O emissor recebe HTTP 500 com `ok: false`, o identificador da execução e o erro `workflow execution failed; inspect the recorded run before resubmitting`. Os motivos não vêm na resposta. Estão na execução, no nó Map to FHIR, em **History**.

Uma execução concluída responde HTTP 200 com `ok: true` e o seu `runId`.

Alguns laboratórios querem guardar as linhas boas de uma mensagem e pôr as más de parte. Nesse caso, crie o seu próprio workflow e ligue **retidos** a um nó Log ou a outro nó. Uma execução desse workflow conclui e responde `ok: true`, mesmo quando houve linhas retidas. Consulte em **History** o nó ligado a **retidos** para as encontrar. Quando há linhas retidas, a linha da execução em **History** mostra um número como **3 retidas** ao lado do estado. Uma execução pode terminar com todas as linhas retidas. O cabeçalho da execução mostra quantas linhas foram mapeadas e retidas, e quantos registos Persist store guardou.

## Experimentar um mapeamento guardado na linha de comandos

`workflows map-test` aplica os mapeamentos guardados de um nó Map to FHIR a uma lista `.json` ou a um ficheiro `.csv`. Não guarda nada. Sem `--json`, mostra contagens e os motivos das linhas retidas, nunca um valor de linha. Lê o workflow guardado, por isso guarde primeiro o workflow no studio. No workflow fornecido Ingest, o identificador do workflow é `wf-ingest` e o do nó é `map-1`.

```sh
{{operator:data-map-test}}
```

![Experimentar os mapeamentos guardados de um nó Map to FHIR num ficheiro.](guide:operator-data-map-test)

O comando termina com 0 quando todas as linhas passam e com 1 quando alguma linha fica retida. Verifica cada linha sozinha, como **Testar** no studio. Duas linhas que dão o mesmo resultado com outros valores passam ambas aí, enquanto uma execução retém a segunda. Com `--json`, mostra o resultado de cada linha, com os registos, e portanto com os valores da linha. Uma execução sobre um CSV lê cada célula como texto, sem os espaços à volta, e deixa de fora as células vazias. **Extract from File** com **Read every cell as text** ativo dá as mesmas linhas, mas mantém esses espaços.

## Limites

- Uma linha sem número do paciente fica retida.
- A mesma linha enviada duas vezes dá os mesmos registos, não cópias. Cada identificador de registo vem dos identificadores da própria linha. O do paciente usa o número do paciente e o seu sistema. O da amostra junta o número da amostra ou, na falta dele, a data de colheita. O do pedido junta o código de análise quando mapeado. O do resultado junta a análise e, quando mapeada, a data do resultado. Quando o campo Análises pedidas do pedido não está mapeado, o pedido recebe os códigos de análise de todos os seus resultados da execução, cada um uma vez, e o seu identificador não muda. Uma execução seguinte substitui-os pelos seus próprios códigos.
- Numa mesma execução, as linhas que dão o mesmo paciente, a mesma amostra ou o mesmo pedido fazem um só registo, e uma linha seguinte só preenche o que uma anterior deixou vazio. Um ficheiro com menos colunas enviado numa execução seguinte substitui o registo guardado, e os campos que não tem ficam vazios. History guarda a versão antiga. Uma segunda linha da mesma execução que dá o mesmo resultado com outros valores é retida: `this row gives a result that an earlier row of this run already gave, with other values`.
- Um paciente já guardado com outro identificador e o mesmo número do paciente, por exemplo a partir de um formulário, fica com um segundo registo Patient. Nada procura um paciente pelo número antes de guardar.
- Se um ficheiro mapear o sistema do número do paciente e outro não, o mesmo paciente fica com dois registos Patient. Mapeie-o da mesma forma em todos os ficheiros, por exemplo como valor fixo. Sem ele, a deteção de duplicados não consegue comparar pacientes pelo número.
- Ative **Read every cell as text** em **Extract from File** antes de um nó Map to FHIR. Cada célula CSV chega então como o texto do ficheiro, e as regras **Número** e **Data** leem-na. Um nó adicionado a partir da biblioteca de nós tem a opção ativa, e um nó guardado antes desta versão tem-na desativada. Sem ela, `12,5` chega como 125, `007` como 7, e uma data como `01/12/2024` como um número de dia, que a regra **Data** retém.
- Num ficheiro Excel, uma célula de data chega como um número de dia. A regra **Data** lê-o com **Uma célula de data do Excel**, só no sistema de datas 1900 habitual do Excel. Um livro guardado no sistema de datas 1904, num Mac antigo, dá datas quatro anos e um dia mais cedo.
- Um texto simples num campo codificado é guardado como o código do próprio laboratório, sem sistema. Uma regra **Lista de códigos** guarda um código padrão, e um código escolhido numa regra **Valores** é guardado com o seu sistema. A lista de códigos do próprio laboratório precisa de um sistema de origem na regra; sem ele, nenhum código corresponde.
- A regra **Data** lê apenas uma data, sem hora.
- Um número inteiro enviado sem aspas e demasiado longo para ser guardado exatamente, acima de 9 007 199 254 740 991, como um número de amostra com 19 dígitos, mantém todos os dígitos: o webhook lê-o como texto e nomeia o campo em `notes` na entrada do webhook da execução. Um campo de texto como **Número da amostra** guarda-o tal como foi enviado. **Resultado (número)** recusa-o e retém a linha, porque um número não consegue guardar tantos dígitos exatamente. Peça ao emissor que envie esses identificadores entre aspas.
- Um motivo de retenção sobre uma entrada de uma coluna de lista, como `results.value`, diz qual, por exemplo `(entry 2 of 4)`. Nunca mostra o valor.
- Dois resultados de uma linha com o mesmo teste ficam retidos, porque dariam um só registo de resultado. O motivo nomeia as duas entradas da lista, como `entries 1 and 3 of 4 in results.code`, ou as duas colunas. Quando **Data do resultado** não está mapeada, diz para a mapear: dois resultados de um teste com datas de resultado diferentes ficam separados.
- Em **Resultado (número)**, um `<`, `<=`, `>=`, `>`, `≤` ou `≥` no início fica como comparador. `≤` e `≥` são guardados como `<=` e `>=`.
- O nó não lê mensagens HL7 v2.
- Os motivos estão em inglês.

## Resolução de problemas

Estes são os motivos de retenção mais frequentes. O motivo de uma regra começa pelo nome da coluna, e o de uma verificação pelo registo em causa.

- **no mapping for this shape.** A linha tem uma coluna que nenhum mapeamento guardado do nó conhece. Mapeie uma amostra que tenha essa coluna.
- **more than one saved mapping fits this row.** Dois mapeamentos guardados do nó conhecem todas as suas colunas. Mantenha um mapeamento por ficheiro, ou use um nó por ficheiro.
- **Patient ID is required and has no value.** A célula do número do paciente está vazia. A etiqueta no motivo indica o campo.
- **expected a date in the format dd/MM/yyyy.** A célula não segue o formato da regra **Data**. O motivo indica o formato que definiu.
- **value is not in the translation list.** Uma regra **Valores** não tem linha para este valor. Acrescente uma.
- **value has no match in the code list.** A regra **Lista de códigos** não encontrou correspondência para o valor. Com a lista de códigos do próprio laboratório, confirme que a regra indica um sistema de origem.
- **more than one match in the code list.** O código dá dois destinos na lista de códigos.
- **not a FHIR Bundle this node can unwrap.** O corpo parece FHIR mas não pode ser dividido.
- **laboratory result must reference a ServiceRequest (basedOn).** Um resultado de laboratório FHIR chegou sem pedido. Envie o pedido na mesma mensagem.
- **basedOn ServiceRequest not found in batch or store.** Um resultado de laboratório FHIR indica um pedido que não está na mesma execução nem guardado.
- **nothing at body.** O item não tem nada em `body`, ou só uma lista vazia ou um valor único. Depois de Extract from File, deixe o caminho de origem em branco. Depois de um webhook, confirme que o emissor envia um corpo.
- **not a row.** A lista no caminho de origem contém algo que não é uma linha, como um número ou um texto.
- **held port is not connected.** É uma falha da execução, não um motivo de retenção. O erro indica até cinco motivos. No **Ingest**, é assim que uma mensagem que não pode ser guardada é recusada. No seu próprio workflow, ligue **retidos** a um nó Log para manter as linhas boas.
