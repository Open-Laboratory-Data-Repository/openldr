# Permissões dos plugins

Um plugin pode acrescentar as suas próprias permissões ao CE. Um administrador dá-as às funções na página Roles, como as capacidades do CE. O CE verifica-as antes de cada ação que o plugin executa.

Esta página é para quem escreve o plugin. Os dois campos ficam em `payload` do manifesto assinado. Um manifesto sem eles instala-se e funciona como antes. O administrador vê cada permissão, e o que cada ação precisa, no ecrã de instalação.

## Declarar permissões

```json
"permissions": [
  {
    "key": "sinkhost.run",
    "label": "Run the test sink",
    "description": "Run the actions of the test sink plugin.",
    "labels": {
      "fr": { "label": "Lancer le plugin de test", "description": "Lancer les actions du plugin de test." },
      "pt": { "label": "Executar o plugin de teste", "description": "Executar as ações do plugin de teste." }
    }
  }
]
```

- Uma chave está em minúsculas, com pelo menos duas partes separadas por um ponto. Corresponde a `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`.
- `label` (até 80 caracteres) e `description` (até 300) estão em inglês. `labels` pode acrescentar francês e português. A página Roles mostra o inglês quando falta uma língua.
- Um plugin declara até 50 permissões, cada chave uma só vez.
- Uma chave não pode ser uma capacidade do CE. Um manifesto que declara `forms.edit` como chave própria é recusado na instalação. Um plugin não pode dar a si mesmo uma capacidade do CE.

## Grupos de permissões

A primeira parte de uma chave é o seu grupo. A chave `sinkhost.run` está no grupo `sinkhost`.

- O primeiro plugin que instala uma chave num grupo fica dono desse grupo para sempre. O CE regista o identificador do plugin e a chave de editor que assinou o pacote. Uma instalação não assinada não regista editor.
- Nenhum outro identificador de plugin pode declarar chaves nesse grupo. Nem o mesmo identificador assinado por outra chave de editor, nem sem assinatura quando o dono estava assinado. Isto vale mesmo depois de o dono ser removido, para que um plugin novo não herde as concessões que o antigo deixou.
- O CE guarda os seus próprios grupos, como `forms`, `patients` e `reports`. Uma chave de plugin num deles é recusada, para que nenhum plugin tenha uma permissão que o CE acrescente mais tarde.
- Uma instalação recusada não muda nada. A versão instalada antes continua ativa.
- Se assinar com uma nova chave de editor, o seu plugin perde os seus grupos. Peça ao administrador para mudar o dono do grupo à mão. O CE ainda não tem um comando para isso.

## A permissão de que cada ação precisa

`actionPermissions` associa um ponto de entrada às permissões que o abrem. Quem chama precisa de uma delas.

```json
"actionPermissions": {
  "health_check": ["sinkhost.run"],
  "host_ce_read": ["sinkhost.run", "patients.find"],
  "host_fhir_emit": ["forms.edit"]
}
```

- Cada entrada indica um ponto de entrada de `payload.entrypoints` e lista de 1 a 10 permissões. Até 100 entradas.
- Uma permissão listada é uma chave do plugin ou uma capacidade do CE. Listar uma capacidade do CE só a pede a quem chama. O plugin não a recebe.
- **Fechado por omissão.** Logo que um plugin tem `actionPermissions`, o CE recusa cada ponto de entrada que não esteja na lista. Uma página que chama um ponto de entrada fora da lista recebe um erro, e o wasm não é executado.
- Um plugin sem `actionPermissions` mantém a regra antiga. Quem passa o controlo de funções do plugin pode executar qualquer ponto de entrada.
- O CE lê o campo no manifesto guardado da versão ativa, nunca na chamada.
- Uma ação que chama `fhir_emit` precisa da sua própria permissão, como qualquer outra. `fhir_emit` continua a recusar quem está limitado a algumas unidades.

A recusa indica a ação e as permissões que a abrem. Está em inglês, por exemplo `the action host_fhir_emit of plugin test-sink-host needs one of these permissions: Edit forms`.

## Quem recebe as permissões

- **Administrator.** A função Administrator recebe todas as permissões de um plugin quando o plugin é instalado, ativado ou volta a uma versão anterior. O CE também verifica em cada arranque, para um plugin instalado antes desta versão.
- **As outras funções** não recebem nada por si. Um administrador dá as permissões na página Roles, ou com `openldr roles`. O passo `role` de um pacote de perfil também as pode listar, quando o plugin é instalado antes.
- **Remover e desativar mantêm as concessões.** A função continua com a chave. `openldr roles doctor` lista-a como mantida. A função continua editável, e guardá-la mantém a chave. A chave não abre nada enquanto o plugin não está instalado.
- **Reinstalar** torna as chaves mantidas de novo conhecidas. As funções que as tinham podem executar as ações logo.

## Páginas e menu lateral

`payload.ui.requiredRoles` e `payload.ui.requiredCapabilities` decidem quem vê o plugin. Um utilizador vê a entrada no menu lateral, e abre `/x/<id>`, só quando tem uma das funções ou uma das capacidades. Escrever o endereço não contorna este controlo. Um plugin sem nenhuma das listas está aberto a todos.

`requiredCapabilities` pode indicar as chaves do próprio plugin. Um utilizador que entra por uma capacidade pode executar as ações do plugin quando o plugin tem `actionPermissions`. O controlo das ações decide então cada chamada. O armazenamento do plugin (`storage.*`) continua fechado a esse utilizador. Precisa de uma das funções do plugin. As chamadas de página reservadas a administradores (`connectors.*`, `schedule.*`, `import.*`) estão abertas a esse utilizador se ele for também administrador. Uma página que lista os conectores para um administrador funciona, por isso, sem indicar uma função.

A página recebe as capacidades do utilizador com sessão iniciada no seu contexto inicial, incluindo as chaves do plugin. Use-as só para mostrar ou esconder separadores. São uma cópia para mostrar. O broker no servidor verifica cada chamada.

Um layout de perfil pode listar uma página de plugin pelo seu caminho, por exemplo `"pages": ["/forms", "/x/test-sink-host"]`. Quando há um layout ativo, a entrada do plugin só aparece se o layout a listar. Um layout só esconde. Nunca abre uma página que as capacidades do utilizador não abrem. `startPage` também pode ser `/x/<id>`.

### O ícone do menu lateral

`payload.ui.nav.icon` indica um ícone incluído: `puzzle`, `share-2`, `bar-chart-3`, `database`, `plug`, `settings` ou `file-text`. Qualquer outro nome mostra o puzzle.

Para desenhar o seu próprio ícone, acrescente `payload.ui.nav.iconPaths`. É uma lista de cadeias `d` de caminhos SVG numa grelha de 24x24. Mantenha também `icon`. Um CE anterior a 0.1.13 ignora `iconPaths` e mostra `icon`.

```json
"nav": {
  "label": "Analyzer interface",
  "section": "apps",
  "icon": "plug",
  "iconPaths": [
    "M3 15 5.5 5.5h13L21 15v4.5H3Z",
    "M3.5 15h17",
    "M8 11h2l1.4-3 2 4 1.4-2H17"
  ]
}
```

O studio desenha cada cadeia como um `<path>` no seu próprio `<svg>` de 16 píxeis. Define a cor (`currentColor`), um traço de 2 unidades, pontas e junções arredondadas, e nenhum preenchimento. Desenhe ícones de traço para isso. A ligação mantém o nome do plugin como nome.

A verificação do manifesto recusa um ícone que não cumpra estas regras:

- 1 a 8 caminhos, cada um com 1 a 1000 caracteres.
- Cada caminho começa por `M` ou `m`.
- Só comandos de caminho (`M L H V C S Q T A Z`, maiúsculas ou minúsculas), algarismos, `e`, `.`, `,`, `+`, `-` e espaços. Sem marcação, URL nem estilo.

Para mudar o ícone, publique uma nova versão assinada com novos caminhos e instale-a. O menu lateral mostra o novo ícone no próximo carregamento da página. O studio não precisa de ser reconstruído.

## Encontrar um paciente com patients.find

`patients.find` é uma capacidade do CE para utilizadores que precisam de encontrar um paciente sem percorrer a lista. O studio mostra-a como **Find a patient**, em inglês em todas as línguas. Um utilizador limitado a algumas unidades mantém-na, e perde `patients.view`. Entre as funções predefinidas, só Administrator a tem.

Através de `ce_read`, quem chama com `patients.find` e sem `patients.view`:

- `patients.search` recebe um identificador exato, `{ "identifier": { "system": "...", "value": "..." } }`, em que `system` é opcional. Ou recebe juntos `given`, `family` e uma `birthDate` completa (`YYYY-MM-DD`). Um nome tem de coincidir por inteiro, sem distinguir maiúsculas. Uma parte de um nome ou de um identificador não encontra nada. Uma pesquisa livre `search` é recusada com `FORBIDDEN`.
- Os resultados vêm só das unidades de quem chama.
- `patients.get` só devolve um paciente das unidades de quem chama. Qualquer outro responde `NOT_FOUND`.
- `patients.register` aceita `patients.view` ou `patients.find`.
- Os identificadores ficam ocultos, a menos que quem chama tenha `patients.view_identifiers`.

Quem tem `patients.view` também pode pesquisar por identificador, ou por nome com data de nascimento, mas não na mesma chamada que `search`.

## Uma porta série para a página de um plugin

Um plugin cuja página fala com um instrumento por um cabo pede a capacidade `host:serial` no seu manifesto:

```json
{ "kind": "host:serial" }
```

Não leva parâmetros. No ecrã de instalação, o administrador vê a linha **Usar uma porta série do PC, quando uma pessoa escolhe uma (host:serial)**, e aprova-a com as outras capacidades do plugin.

Esta capacidade não é uma das chaves de permissão do plugin, e nenhum papel a detém. Pertence à versão instalada do plugin. Qualquer pessoa que possa abrir a página do plugin pode então ser convidada a escolher uma porta. O Studio pergunta de cada vez, com o nome do plugin, e a pessoa pode cancelar.

É o Studio que a aplica, não o servidor: as chamadas série não enviam nenhum byte para o servidor. Desligar o plugin, removê-lo ou ativar outra versão fecha qualquer porta aberta. [Tabelas e funções do anfitrião para plugins](/docs/plugin-host-functions) lista as chamadas.
