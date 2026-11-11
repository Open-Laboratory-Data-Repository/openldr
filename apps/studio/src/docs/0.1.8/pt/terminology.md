# Terminologia

A **Terminologia** guarda os códigos que o OpenLDR entende: códigos de exames, tipos de amostra, motivos de recusa, países, tipos de unidade, e os grandes sistemas externos como LOINC e SNOMED CT quando os carrega. Os formulários, o catálogo de exames, as unidades e os relatórios leem daqui os seus códigos, por isso um código mudado aqui muda o que eles oferecem.

A página tem três níveis. Os **editores** (Publishers), à esquerda, agrupam os sistemas de códigos por quem os mantém. Um **sistema de códigos** (code system) é uma lista de códigos, como os motivos de recusa de um exame. Um **termo** (term) é um código dessa lista, com o nome de apresentação. Os **value sets** escolhem códigos de um ou mais sistemas para um uso concreto, como as respostas que um campo de formulário aceita.

A página Terminologia e os seus painéis estão só em inglês, por isso este guia mantém os rótulos em inglês. Leva cerca de 10 minutos. Selecione uma imagem ou um clip para o ampliar.

![Terminologia, editor System: os sistemas de códigos desta instalação, com URL e origem.](terminology-tour.png)

## Quem pode fazer o quê

| Capacidade | O que permite |
| --- | --- |
| **Browse terminology** | Abrir a Terminologia e ler editores, sistemas de códigos, termos e value sets |
| **Manage terminology** | Adicionar, editar e eliminar editores, sistemas de códigos, termos e value sets, e importar |

## O que tem uma instalação nova

O editor **System** guarda os sistemas de códigos que o OpenLDR instala e mantém, como **REJECT-TEST** (motivos de recusa de um exame), **REJECT-ORDER** (motivos de recusa de um pedido), **TEST-CATALOG**, **TEST-CATEGORY**, **FACILITY-TYPE** e **ISO-3166** (países). Outros aparecem com o trabalho. Importar um registo de unidades, como em [Unidades](/docs/facilities), junta duas listas dos níveis e estados observados desse registo.

**HL7 FHIR** guarda os value sets padrão do FHIR. **LOINC**, **SNOMED CT**, **WHO · ICD-10**, **WHO · ICD-11**, **UCUM** e **RxNorm** estão vazios até os carregar. Cada um mostra **No code systems or value sets yet**.

## Exemplo 1: percorrer um sistema de códigos

![Abrir REJECT-TEST a partir do editor System.](terminology-browse.mp4)

1. Abra **Terminologia**. O editor **System** está selecionado, no separador **Code systems**.
2. Selecione a linha **REJECT-TEST**.

**Resultado esperado:** quatro termos, todos **ACTIVE**: `CLOTTED` Clotted, `CONTAINER` Wrong container, `HAEM` Haemolysed, e `QNS` Insufficient volume. São os motivos que um laboratório pode dar para recusar um exame de um Lab order.

A pesquisa filtra os termos por código ou nome. A lista de estados mostra também os termos retirados. **← Code systems** volta à lista.

## Exemplo 2: adicionar um motivo de recusa

Adicione **Unlabelled specimen** como motivo de recusa de um exame, e veja-o no Lab order.

![Adicionar UNLABELLED, Unlabelled specimen, a REJECT-TEST.](terminology-add-term.mp4)

1. Com **REJECT-TEST** aberto, abra o menu **⋯** da página. Selecione **Term** e depois **New**. Abre-se o painel **New term**.
2. Em **Code**, escreva `UNLABELLED`. Em **Display name**, escreva `Unlabelled specimen`. Deixe **Status** em **Active**.
3. Abra o menu **⋯** do painel e guarde.

**Resultado esperado:** **5 terms**, com **UNLABELLED** Unlabelled specimen no fim.


Abra agora o Lab order: **Formulários**, **Lab order**, **View/Run**. Escolha um exame, abra o menu **⋯** da linha e selecione **Recusar com motivo**. **Unlabelled specimen** está na lista, com o código.

![A lista de recusa do Lab order oferece agora Unlabelled specimen.](terminology-reason-in-order.png)

Para retirar o motivo, abra o menu **⋯** da linha na Terminologia e selecione **Delete**. A outra entrada desse menu é **View**.

## Exemplo 3: ler os value sets

![O separador Value sets do editor System.](terminology-value-sets.png)

1. Abra **Terminologia** e selecione o separador **Value sets**.

**Resultado esperado:** 17 value sets, como **Biological Sex** (4 códigos), **Country** (249), **Facility Type** (63), **Test rejection reasons** e **This lab's tests**.

Um value set que leva um sistema de códigos inteiro, ou que o OpenLDR calcula na hora, mostra **0** em **Codes** nesta versão, e o painel diz **Expansion is empty**. **Test rejection reasons** e **This lab's tests** estão nesse caso. Leia a lista real na linha de comandos:

```bash
./openldr terminology expand urn:openldr:valueset:test-reject-reason
./openldr terminology expand urn:openldr:valueset:lab-tests
```

Com o catálogo de exemplo ativado, como em [Catálogo de exames, Exemplo 2](/docs/test-catalog#exemplo-2-ativar-exames-neste-laboratorio), a segunda mostra `5 total; CREAT, FBC, GLU, HIV-VL, MAL-RDT`. É a lista que o campo **Tests** do Lab order oferece.

Um value set padrão é só de leitura. O painel diz para o duplicar para o alterar.

## Importar termos

O menu **⋯** da página, em **Term**, tem **Import terms…** e **Download template**. O modelo é um ficheiro de texto com um objeto JSON por linha:

```text
{"type":"meta","codingSystem":"REJECT-TEST","version":"2026-01-01"}
{"code":"LEAKED","displayName":"Leaking container"}
```

`code` e `displayName` são obrigatórios. `shortName`, `class`, `unit`, `status` e `metadata` são opcionais. As linhas vazias e as que começam por `//` são ignoradas. Um CSV com as colunas `code` e `display` também é lido.

Uma linha sem `code` ou sem `displayName` para a importação. A mensagem indica a linha, e nada é importado.

Os grandes sistemas externos carregam-se na linha de comandos:

```bash
./openldr terminology import loinc <path> --accept-license
./openldr terminology distribution import snomed --file <snomed.zip> --accept-license
```

## De onde vem um sistema de códigos

A tabela de sistemas de códigos mostra uma descrição por baixo de cada nome, quando o sistema a tem, e uma coluna **Source**:

- **OpenLDR**: o CE instala-o e mantém-no. Não pode ser eliminado.
- **Received data**: o CE criou-o ao projetar dados recebidos, por exemplo os códigos de laboratório vistos nos resultados.
- **Imported**: um administrador importou-o, nesta página ou com `openldr terminology import resource`.
- **Content pack**: um pacote de conteúdo instalou-o. O pacote e a versão aparecem por baixo da etiqueta.
- **Facility register**: um registo de unidades. As unidades estão em Unidades.
- **Created here**: um administrador criou-o nesta página.

Um sistema importado recebe o nome e a descrição do `title` (ou `name`) e da `description` do recurso. `openldr terminology system list` mostra a mesma origem na última coluna.

## Catálogo de exames e categorias

Cada instalação tem dois sistemas de códigos no editor System. **Test catalog** guarda a lista nacional de exames. **Test categories** guarda as categorias a que um exame pode pertencer, começando por Chemistry, Haematology, Microbiology, Serology e Molecular. Adicione ou mude o nome de categorias aqui.

Um exame do catálogo tem também uma categoria e tipos de amostra que esta página não mostra. O código LOINC é um mapeamento, no separador Mappings do termo. Editar um exame aqui mantém a categoria, as amostras e a ligação LOINC. Um termo adicionado aqui não tem categoria nem amostras. Num laboratório que recebe o catálogo do central, a próxima alteração do central substitui qualquer edição feita aqui.

## Na linha de comandos

```bash
./openldr terminology system list
./openldr terminology term list urn:openldr:cs:reject-test
./openldr terminology lookup urn:openldr:cs:reject-test HAEM
./openldr terminology expand urn:openldr:valueset:test-reject-reason
./openldr terminology valueset list
```

`system list` mostra a origem de cada sistema na última coluna. `term list` mostra os quatro termos de REJECT-TEST e o estado. `lookup` mostra um código, aqui `HAEM: Haemolysed`. `validate-code --code HAEM --valueset urn:openldr:valueset:test-reject-reason` mostra `true: HAEM is in urn:openldr:valueset:test-reject-reason`.

## O que usar e quando

- Use **termos** para valores codificados isolados.
- Use **value sets** quando um campo de formulário precisa de uma lista fechada de respostas.
- Use **índices de ontologia** quando é preciso hierarquia, relações ou exploração de conceitos. Vêm com as distribuições LOINC, SNOMED CT e RxNorm.
- Ligue cedo os formulários à terminologia, para que os dados enviados sejam coerentes o bastante para relatórios e fluxos.

## Num telemóvel

Num telemóvel, a lista de editores fica aberta e ocupa quase metade do ecrã, com nomes cortados. Recolha-a com o botão ao lado de **PUBLISHERS** para dar espaço à tabela. A tabela desliza para o lado até ao menu **⋯** de cada linha.

## Resolução de problemas

- **Import terms para com `line 3: displayName required`.** Essa linha não tem nome. Corrija-a e importe de novo. Nada do ficheiro foi guardado.
- **Um value set mostra 0 códigos.** Leva um sistema inteiro ou é calculado na hora. Use `openldr terminology expand <url>`.
- **Um termo novo não aparece num formulário.** Recarregue o formulário. Um value set com uma lista fixa de códigos precisa também do código novo.
- **Formato de ficheiro não suportado.** Compare o ficheiro com o modelo transferido.
- **Falta o código ou o nome.** Corrija o ficheiro de origem: os dois são precisos.
- **Uma fonte não está disponível.** Confirme a licença e a disponibilidade da fonte antes de esperar vê-la.
- **Um índice de ontologia está vazio.** O sistema pode não ter hierarquia, ou o índice não foi construído para essa fonte.
- **Uma entrada perdeu propriedades depois de editada.** Antes de 2026-09-15, guardar um termo aqui apagava todas as propriedades que a página não mostra, como as partes LOINC, o tipo de um organismo ou o papel de um parâmetro de resultado. Já não acontece. As entradas danificadas antes continuam assim até a fonte ser importada de novo: `openldr terminology import loinc <path> --accept-license` para LOINC, `openldr terminology import organisms <file>` para organismos, e `openldr terminology import parameters <file>` para parâmetros de resultado.

## Guias relacionados

- [Formulários](/docs/forms)
- [Catálogo de exames](/docs/test-catalog)
- [Unidades](/docs/facilities)
- [Auditoria](/docs/audit)
