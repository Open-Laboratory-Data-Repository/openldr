# Pacotes de perfil

Um pacote de perfil prepara esta instalação para um trabalho concreto, como um posto de colheita. Numa só instalação assinada, cria uma função, uma disposição da barra lateral e formulários. Os administradores instalam-no a partir do Marketplace e podem removê-lo lá mais tarde.

Um pacote de perfil é um pacote de conteúdo. Instala-se e remove-se como qualquer outro. O que faz dele um perfil são os passos de função, de disposição ou de formulário.

Para instalar ou remover um pacote que cria uma função, precisa de **Gerir o marketplace** e de **Gerir funções**. Um pacote não pode dar à sua função uma capacidade que o utilizador que o instala não tenha.

## Instalar um pacote de perfil

Faça isto quando a sua organização lhe entregar um pacote de perfil assinado para preparar um trabalho, por exemplo um posto de colheita.

1. Abra **Definições** e depois **Marketplace**.
2. Selecione **Explorar** e abra o cartão do pacote.
3. Abra o menu de pontos no canto superior direito e selecione **Instalar**.
4. Leia a versão e cada linha em **Passos**. A tarefa seguinte explica as linhas.
5. Selecione a seta à direita de cada linha **Função** e leia as suas capacidades.
6. Selecione **Aprovar e instalar**.

**Resultado esperado:** aparece a mensagem **instalado** com o identificador do pacote. O pacote passa a constar em **Instalados**. A nova função aparece na página **Funções** e a nova disposição na página **Disposições**. Cada uma mostra **Do pacote** seguido do identificador do pacote. Os formulários ficam publicados em Formulários.

A nova função ainda não tem membros. Atribua-a em Utilizadores. Quem tiver a função vê a disposição do pacote como barra lateral predefinida, se o pacote a definiu como predefinição dessa função.

O OpenLDR verifica cada passo antes de escrever o que quer que seja. Se uma verificação falhar, uma mensagem indica o problema e nada é instalado. A secção Resolução de problemas lista os casos mais comuns. Se um passo falhar a meio, o pacote mostra **Falha no passo** com o número e o erro. Corrija a causa, abra o menu de pontos e selecione **Instalar novamente**.

## Ler as linhas do resumo

A janela de instalação mostra uma linha por passo, pela ordem em que o pacote os instala. Cada linha indica o tipo de passo e o seu nome. A maioria termina com um número.

- **Depende de** lista os plugins e pacotes que têm de estar instalados antes, e quantos são. Se faltar um, ou se a versão for demasiado antiga, a instalação para antes de escrever.
- **Função** indica o nome da função e quantas capacidades concede. Selecione a seta à direita da linha para ver cada capacidade pelo nome.
- **Disposição** indica o nome da barra lateral e quantas páginas mostra.
- **Formulário** indica o título do formulário, sem número.

Os passos mais antigos, como **Sistema de códigos** ou **Conjuntos de dados**, mostram apenas um número. O guia [Marketplace](/docs/marketplace) explica-os.

Leia todas as capacidades de cada função antes de aprovar. Quem receber a função mais tarde fica com todas elas.

## Remover um pacote de perfil

Faça isto quando a instalação já não precisar do trabalho que o pacote preparou.

1. Abra **Definições** e depois **Marketplace**.
2. Selecione **Instalados** e abra o pacote.
3. Abra o menu de pontos no canto superior direito e selecione **Remover**.
4. Leia as três listas: **Funções removidas**, **Disposições removidas** e **Formulários mantidos**.
5. Selecione **Remover**.

**Resultado esperado:** aparece a mensagem **removido** com o identificador do pacote. O pacote deixa de constar em **Instalados**. As suas funções e disposições desaparecem.

A remoção mantém os formulários do pacote publicados, com todas as respostas. Arquive um formulário em Formulários se já não o quiser. A remoção também não mexe nas listas de códigos, consultas, conjuntos de dados e correspondências que o pacote instalou, nem nos plugins e pacotes de que ele dependia.

Se alguém ainda tiver uma das funções do pacote, a janela avisa a vermelho e lista cada função com os seus utilizadores. **Remover** fica desativado. Retire a função a essas pessoas em Utilizadores e volte a abrir a janela.

## O que significa "Do pacote"

Na página **Funções** e na página **Disposições**, uma função ou disposição criada por um pacote mostra **Do pacote** e o identificador do pacote por baixo do nome.

Pode continuar a editar essa função ou disposição. A próxima atualização do pacote repõe o que o pacote define, e a sua alteração perde-se. Se a apagar, a próxima instalação do pacote volta a criá-la.

Um pacote nunca altera uma função ou disposição que não criou. Se tiver criado à mão uma função ou disposição com o mesmo identificador ou o mesmo nome, o pacote recusa a instalação.

Uma atualização do pacote remove a função ou disposição que a nova versão já não inclui. Recusa enquanto alguém ainda tiver essa função, tal como a remoção.

## Limites

- A disposição e os formulários de um pacote só podem nomear funções criadas pelo mesmo pacote. Um pacote não os pode associar a uma função criada por si.
- Uma disposição apenas esconde páginas. São as capacidades da função que decidem o que uma pessoa pode abrir.
- Num servidor central, um pacote cria a sua função e a sua disposição apenas nesse servidor. As funções e as disposições não seguem para os laboratórios. Os formulários chegam aos laboratórios como qualquer outro formulário.

## Resolução de problemas

As mensagens abaixo vêm do servidor, em inglês. Uma palavra entre parênteses angulares substitui um nome.

- **A mensagem diz `installing this pack needs the roles.manage capability`.** Não tem **Gerir funções**. Peça a um administrador que a tenha para instalar o pacote.
- **A mensagem diz `you cannot install a role that grants <capability>, because you do not hold it`.** Instale o pacote com uma conta que tenha essa capacidade.
- **A mensagem diz `a role with the slug <slug> already exists and this pack did not make it`.** Alguém criou essa função à mão. O mesmo vale para `a layout named <name>`. Apague a sua se ninguém precisar dela, ou peça ao editor um pacote com outro nome.
- **A mensagem diz `this pack needs <id> <version>, which is not installed`.** Instale primeiro esse plugin ou pacote, numa versão dentro do intervalo indicado.
- **Remover fica desativado.** Alguém ainda tem uma das funções do pacote. Retire-lha primeiro em Utilizadores.

## Guias relacionados

- [Marketplace](/docs/marketplace)
- [Funções](/docs/roles)
- [Disposições](/docs/layouts)
- [Formulários](/docs/forms)
