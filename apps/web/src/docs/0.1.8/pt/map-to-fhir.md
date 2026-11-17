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

## O que o emissor vê

O webhook responde pela execução inteira. O workflow predefinido **Ingest** recusa uma mensagem inteira quando alguma parte dela não pode ser guardada. Como nada está ligado a **retidos**, uma única linha retida faz falhar o nó e a execução, e o Persist store não corre. Nada dessa mensagem é guardado. O emissor recebe HTTP 500 com `ok: false`, o identificador da execução e o erro `workflow execution failed; inspect the recorded run before resubmitting`. Os motivos não vêm na resposta. Estão na execução, no nó Map to FHIR, em **History**.

Uma execução concluída responde HTTP 200 com `ok: true` e o seu `runId`.

Alguns laboratórios querem guardar as linhas boas de uma mensagem e pôr as más de parte. Nesse caso, crie o seu próprio workflow e ligue **retidos** a um nó Log ou a outro nó. Uma execução desse workflow conclui e responde `ok: true`, mesmo quando houve linhas retidas. Consulte em **History** o nó ligado a **retidos** para as encontrar.

## Experimentar um mapeamento guardado na linha de comandos

`workflows map-test` aplica os mapeamentos guardados de um nó Map to FHIR a uma lista `.json` ou a um ficheiro `.csv`. Não guarda nada. Sem `--json`, mostra contagens e os motivos das linhas retidas, nunca um valor de linha. Lê o workflow guardado, por isso guarde primeiro o workflow no studio. No workflow fornecido Ingest, o identificador do workflow é `wf-ingest` e o do nó é `map-1`.

```sh
{{operator:data-map-test}}
```

![Experimentar os mapeamentos guardados de um nó Map to FHIR num ficheiro.](guide:operator-data-map-test)

O comando termina com 0 quando todas as linhas passam e com 1 quando alguma linha fica retida. Com `--json`, mostra o resultado de cada linha, com os registos, e portanto com os valores da linha. Uma execução sobre um CSV lê cada célula como texto, sem os espaços à volta, e deixa de fora as células vazias. **Extract from File** com **Read every cell as text** ativo dá as mesmas linhas, mas mantém esses espaços.

## Limites

- Uma linha sem número do paciente fica retida.
- A mesma linha enviada duas vezes dá os mesmos registos, não cópias. Cada identificador de registo vem dos identificadores da própria linha. O do paciente usa o número do paciente e o seu sistema. O da amostra junta o número da amostra ou, na falta dele, a data de colheita. O do pedido junta o código de análise quando mapeado. O do resultado junta a análise e, quando mapeada, a data do resultado.
- Numa mesma execução, as linhas que dão o mesmo paciente, a mesma amostra ou o mesmo pedido fazem um só registo, e uma linha seguinte só preenche o que uma anterior deixou vazio. Um ficheiro mais pobre enviado numa execução seguinte ainda substitui o registo guardado. Uma segunda linha da mesma execução que dá o mesmo resultado com outros valores é retida: `this row gives a result that an earlier row of this run already gave, with other values`.
- Se um ficheiro mapear o sistema do número do paciente e outro não, o mesmo paciente fica com dois registos Patient. Mapeie-o da mesma forma em todos os ficheiros, por exemplo como valor fixo. Sem ele, a deteção de duplicados não consegue comparar pacientes pelo número.
- Ative **Read every cell as text** em **Extract from File** antes de um nó Map to FHIR. Cada célula CSV chega então como o texto do ficheiro, e as regras **Número** e **Data** leem-na. Um nó adicionado a partir da biblioteca de nós tem a opção ativa, e um nó guardado antes desta versão tem-na desativada. Sem ela, `12,5` chega como 125, `007` como 7, e uma data como `01/12/2024` como um número de dia, que a regra **Data** retém.
- Num ficheiro Excel, uma célula de data chega como um número de dia, com a opção ativa ou não, e a regra **Data** retém a linha. Guarde a folha como CSV, ou formate as células de data como texto.
- Um texto simples num campo codificado é guardado como o código do próprio laboratório, sem sistema. Uma regra **Lista de códigos** guarda um código padrão. A lista de códigos do próprio laboratório precisa de um sistema de origem na regra; sem ele, nenhum código corresponde.
- Um ficheiro com uma coluna por análise, por exemplo uma coluna por antibiótico, não pode ser mapeado tal como está. Várias colunas num mesmo campo repetido precisam de um código de análise para cada uma, e um único código partilhado é recusado com `Test: two Observation records in this row have the same value, so they would share one id`.
- A regra **Data** lê apenas uma data, sem hora.
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
