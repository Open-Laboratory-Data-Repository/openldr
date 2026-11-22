# Pacotes de perfil

Um pacote de perfil prepara uma instalação do OpenLDR para um trabalho concreto: um posto de colheita, uma bancada de laboratório ou um centro de dados. Uma só instalação assinada cria a função desse trabalho, a sua disposição da barra lateral e os seus formulários. O pacote também pode indicar que plugins têm de estar instalados antes.

Um pacote de perfil é um pacote de conteúdo cujos passos incluem `needs`, `role`, `layout` ou `form`. Não existe um tipo de pacote à parte. Instala-se, atualiza-se e remove-se como qualquer pacote de conteúdo. Uma mesma instalação pode ter vários perfis lado a lado.

As capacidades continuam a ser o único cadeado. Uma disposição esconde páginas e não concede nada. Uma pessoa só abre uma página se uma das suas funções tiver a capacidade para isso.

O guia da aplicação **Pacotes de perfil** mostra a um administrador como instalar um pacote, ler o resumo e removê-lo. Esta página é para quem escreve o pacote.

## O ficheiro do pacote

Um pacote de conteúdo é um ficheiro `pack.json` ao lado do seu `manifest.json`. Os passos correm pela ordem da lista. Um pacote pode misturar os passos de perfil com os mais antigos, como `code-system` ou `datasets`.

O ficheiro é um só objeto com `"formatVersion": 1` e uma lista `steps`. Cada secção abaixo mostra um passo de perfil tal como entra nessa lista. Ponha os passos pela ordem em que devem correr: uma função antes da disposição e dos formulários que a nomeiam.

Um CE que não conheça um tipo de passo recusa o pacote inteiro com `this pack needs a newer CE`, antes de escrever o que quer que seja. Assim, um CE mais antigo nunca instala um perfil pela metade.

O identificador de uma função (`slug`) e a chave de uma disposição ou de um formulário (`key`) são os nomes que o pacote dá ao que instala. Cada um tem de 2 a 48 caracteres: letras minúsculas, algarismos e hífenes, a começar por uma letra. Cada chave aparece uma só vez por tipo. Mantenha-as iguais de uma versão para a seguinte. A versão seguinte encontra o que a anterior criou por estas chaves.

### O passo needs

`needs` lista os plugins e os pacotes de conteúdo de que este perfil depende. Cada um tem um identificador e um intervalo de versões.

```json
{
  "kind": "needs",
  "bundles": [
    { "id": "sample-tracking", "version": ">=0.1.0 <0.2.0" }
  ]
}
```

A instalação para antes de qualquer escrita se faltar um, ou se a versão estiver fora do intervalo. A mensagem é `this pack needs <id> <range>, which is not installed`, ou `this pack needs <id> <range>; <version> is installed`. Um pacote de conteúdo só conta se a última instalação terminou sem nenhum passo com falha.

Um intervalo é `*`, uma versão exata, ou uma comparação com `>=`, `<=`, `>` ou `<`. Um espaço entre duas comparações quer dizer que ambas têm de se cumprir. `||` quer dizer uma ou outra. Não há `^` nem `~`.

A instalação não mexe nos pacotes de que depende, e a remoção também não.

### O passo role

`role` cria uma função, com o nome, uma descrição opcional e as chaves das capacidades.

```json
{
  "kind": "role",
  "slug": "sample-clerk",
  "name": "Sample Clerk",
  "description": "Registers samples and sends them to the lab.",
  "capabilities": ["forms.view", "forms.submit", "patients.view"]
}
```

Cada capacidade tem de ser uma chave que o CE em execução conheça. As chaves estão em `packages/rbac/src/catalog.ts` no código do CE, e a página Funções mostra a mesma lista pelo nome. Uma chave desconhecida faz falhar a instalação com `unknown capability: <key>`.

O identificador já tem de estar na forma final: letras minúsculas, algarismos e hífenes simples. O CE recusa um identificador que alteraria ao guardá-lo.

### O passo layout

`layout` cria uma barra lateral com nome. `roles` lista as funções que a recebem como predefinição.

```json
{
  "kind": "layout",
  "key": "collection-site",
  "name": "Collection site",
  "startPage": "/forms",
  "pages": ["/forms", "/patients", "/docs"],
  "roles": ["sample-clerk"]
}
```

`name` tem de 1 a 60 caracteres, e nenhuma outra disposição da instalação pode ter o mesmo. `pages` lista de 1 a 50 caminhos do studio, cada um uma só vez. `startPage` é uma das `pages`, ou `null` para abrir a página predefinida.

### O passo form

`form` instala um Questionnaire FHIR como formulário, publica-o e define quem o pode abrir e submeter.

```json
{
  "kind": "form",
  "key": "sample-dispatch",
  "questionnaire": {
    "resourceType": "Questionnaire",
    "title": "Sample dispatch",
    "status": "active",
    "item": [
      { "linkId": "batch", "text": "Batch number", "type": "string", "required": true },
      { "linkId": "sent-on", "text": "Date sent", "type": "date" }
    ]
  },
  "open": ["sample-clerk"],
  "submit": ["sample-clerk"]
}
```

O formulário recebe o nome do `title` do Questionnaire. A etiqueta de versão é a versão do pacote. `open` e `submit` recebem identificadores de função, e o CE converte-os nos identificadores internos da instalação onde corre. Uma lista vazia significa todas as funções com a permissão, como no painel **Acesso** do construtor de formulários. Para submeter, a pessoa também tem de poder abrir o formulário.

Os códigos e os conjuntos de valores de um Questionnaire pertencem ao pacote. Guarde-os no repositório do pacote, nunca no CE.

## As regras que um pacote tem de seguir

O OpenLDR verifica todos os passos antes de escrever qualquer um. Um pacote que quebre uma destas regras não instala nada.

- **Um pacote só altera o que criou.** O CE regista que pacote criou cada função, disposição e formulário. Se já existir uma função com o mesmo identificador, ou uma disposição com o mesmo nome, que este pacote não criou, a instalação para e indica-a.
- **Uma disposição ou um formulário só nomeia funções do próprio pacote.** Cada identificador em `roles`, `open` ou `submit` tem de pertencer a um passo `role` anterior do mesmo pacote. Um pacote não pode associar a sua disposição nem os seus formulários a uma função criada por um administrador, porque tornar uma disposição a predefinição de uma função alteraria essa função.
- **Quem instala precisa de roles.manage.** Instalar um pacote exige `marketplace.manage`. Um pacote com um passo de função exige também `roles.manage`. O mesmo vale para qualquer atualização de um pacote que criou uma função, mesmo que a nova versão já não tenha passos de função, e para a remoção desse pacote. As mensagens são `installing this pack needs the roles.manage capability` e `removing this pack needs the roles.manage capability`.
- **Um pacote não concede mais do que quem o instala tem.** Se um passo de função listar uma capacidade que essa pessoa não tem, a instalação para com `you cannot install a role that grants <key>, because you do not hold it`. Executada na própria máquina, a CLI não fica limitada por estas duas verificações.

Os passos escrevem um de cada vez, sem transação à volta. Se um passo de formulário falhar depois de um passo de função ter escrito, a função fica. Voltar a instalar o mesmo pacote encontra essa função pelo identificador e atualiza-a. Cada passo de perfil pode correr duas vezes sem problema.

## Atualizações e remoção

Uma versão mais recente do pacote atualiza a função, a disposição e o formulário que criou antes. Uma alteração feita por um administrador a um deles perde-se na atualização seguinte. As páginas Funções e Disposições mostram **Do pacote** e o identificador do pacote por baixo de cada item criado por um pacote, para que isto não seja uma surpresa.

Se a nova versão deixar de fora uma função ou disposição que a anterior criou, a atualização apaga-a. Se alguém ainda tiver essa função, a atualização para antes de qualquer escrita e indica cada função com os seus utilizadores. Um formulário que a nova versão deixe de fora fica como está e deixa de pertencer ao pacote.

Remover o pacote apaga as suas disposições e depois as suas funções. Se o pacote criou uma função, a remoção exige `roles.manage`. Sem ela, a mensagem é `removing this pack needs the roles.manage capability`. A remoção recusa enquanto alguém tiver uma das suas funções, e lista essas pessoas. Mantém os formulários publicados, com todas as respostas, para que um administrador os arquive à mão. Apagar uma função retira-a da lista de acesso de cada formulário. Se estes formulários estavam limitados às funções do pacote, qualquer pessoa com `forms.view` poderá abri-los após a remoção. Não mexe nos sistemas de códigos, consultas, conjuntos de dados e correspondências que o pacote instalou, nem nos pacotes indicados em `needs`.

Num servidor central, um pacote só atua nesse servidor. As suas funções e disposições ficam lá. Os formulários chegam aos laboratórios como qualquer outro formulário.

## A lista de passos no manifesto

`manifest.json` repete cada passo numa linha com `kind`, `label` e `count`, em `payload.steps`. O ecrã de instalação lê esta lista. O CE volta a calculá-la a partir de `pack.json` e recusa o pacote com `step list does not match pack.json` quando as duas diferem. Para os passos de perfil:

| Passo | `label` | `count` |
| --- | --- | --- |
| `needs` | Os identificadores dos pacotes, separados por `, ` | Quantos pacotes |
| `role` | O `name` da função | Quantas capacidades |
| `layout` | O `name` da disposição | Quantas páginas |
| `form` | O `title` do Questionnaire, ou a `key` do formulário | 1 |

Para o exemplo do posto de colheita acima, a lista é:

```json
[
  { "kind": "role", "label": "Sample Clerk", "count": 3 },
  { "kind": "layout", "label": "Collection site", "count": 3 },
  { "kind": "form", "label": "Sample dispatch", "count": 1 }
]
```

A lista tem de ter uma linha por cada passo do pacote, pela mesma ordem. Caso contrário, a instalação falha com `step list does not match pack.json`.

Um pacote de conteúdo não declara capacidades no manifesto e tem de indicar um editor.

## Construir, assinar e instalar

Um pacote de perfil constrói-se e assina-se como qualquer pacote de conteúdo. `openldr artifact keygen --out <dir>` cria uma chave de editor nessa pasta. `openldr artifact pack <dir> --key <key>` preenche o hash de `pack.json` e a impressão digital da chave, assina o manifesto e escreve o pacote. [Interface de linha de comandos (CLI)](/docs/cli) lista os comandos `artifact` e `market`.

Antes de publicar, experimente o pacote numa instalação de teste:

```sh
openldr market install <bundle-directory> --dry-run
openldr market install <bundle-directory>
openldr market update <bundle-directory>
openldr market remove <pack-id> --force
```

`--dry-run` não escreve nada. Faz as verificações como se tivesse todas as capacidades. Por isso não testa a regra `roles.manage`, nem se tem cada capacidade que uma função concede. `market update` instala uma versão mais recente de um pacote já instalado. Sem `--force`, `market remove` mostra as funções e disposições que removeria, os formulários que mantém e quem ainda tem uma das funções do pacote. Não altera nada.

Depois, entre no studio com uma conta que tenha a função e confirme que a barra lateral mostra as páginas da disposição e que os formulários abrem.
