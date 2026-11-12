# Funções

Uma função agrupa capacidades, as permissões para ações específicas. Atribua funções em Users. O painel Users atribui uma função por pessoa.

Use os seus próprios nomes de funções e requisitos de acesso. As imagens mostram uma função temporária Documentation reader numa instalação de teste isolada. Não precisa de dados de prática.

Precisa de View roles para consultar funções e de Manage roles para criar, alterar, eliminar ou atribuir funções. Abrir Users também exige View users. Criar ou editar identidades exige Manage users. Administrator está bloqueado. As restantes funções do sistema podem ser editadas, mas não eliminadas.

Para a instalação e a CLI, leia [Começar aqui](/docs/start-here). Este guia cobre a página Roles.

## Consultar uma função antes de alterar o acesso

Use esta tarefa para verificar as ações permitidas por uma função existente.

### 1. Abrir Settings e Roles

Abra o menu de utilizador no canto inferior esquerdo, escolha **Settings** e selecione **Roles**.

![Abra o menu de utilizador no canto inferior esquerdo.](roles-guide-open-user-menu.png)

![Escolha Settings no menu de utilizador.](roles-guide-settings-menu.png)

![Selecione Roles na lista de secções de Settings.](roles-guide-roles-page.png)

### 2. Abrir a função

Selecione a linha de uma função. Leia o nome, a descrição e as capacidades selecionadas. Desloque o painel para ler cada permissão.

![Leia o nome, a descrição e as capacidades selecionadas da função.](roles-guide-inspect-role.png)

### 3. Verificar se está bloqueada

A função integrada Administrator mostra um aviso e campos apenas de leitura. Selecione **Close** no canto superior direito quando terminar.

![Administrator está bloqueado. As suas capacidades não podem ser alteradas.](roles-guide-locked-role.png)

**Resultado esperado:** consultar uma função não altera as permissões.

## Criar uma função com permissões escolhidas

Use esta tarefa quando as funções existentes não correspondem ao acesso necessário. Decida as ações necessárias antes de selecionar capacidades.

### 1. Abrir as ações da página

Selecione os pontos acima da tabela Roles.

![Abra o menu de pontos de Roles.](roles-guide-create-actions.png)

### 2. Escolher Create role

Selecione **Create role**.

![Escolha Create role.](roles-guide-create-menu.png)

### 3. Introduzir o nome

Use um nome reconhecido pela equipa. O exemplo usa `Documentation reader`.

![Introduza um nome que descreva esta função.](roles-guide-name.png)

### 4. Verificar o slug

**Slug** é o identificador da função. O nome preenche-o automaticamente até o editar. Escolha-o com cuidado porque não pode alterá-lo após a criação.

![Confira o identificador. Fica apenas de leitura após a criação.](roles-guide-slug.png)

### 5. Descrever a função

Indique o objetivo em **Description**. Isto ajuda outros administradores a perceber a quem atribuir a função.

![Descreva quem deve usar esta função.](roles-guide-description.png)

### 6. Selecionar as capacidades

Ative cada permissão necessária. Leia a descrição junto de cada interruptor. O exemplo seleciona **View dashboards**.

![Escolha cada permissão necessária. O exemplo permite consultar painéis.](roles-guide-capability.png)

### 7. Abrir as ações do painel

Selecione os pontos no topo do painel Create role.

![Abra o menu de pontos do painel da função.](roles-guide-sheet-actions.png)

### 8. Criar a função

Selecione **Create**.

![Escolha Create para guardar a função.](roles-guide-create-save.png)

**Resultado esperado:** o painel fecha e a função aparece na lista. Criá-la não a atribui a ninguém. Use Users para a atribuir.

![A função criada aparece com a descrição e o número de membros.](roles-guide-created-result.png)

## Alterar a descrição ou as permissões de uma função

Use esta tarefa quando mudam as responsabilidades das pessoas com a função. Confira quem a tem antes de alterar o acesso.

### 1. Encontrar a função

Introduza o nome em **Search roles**. O exemplo pesquisa `Documentation`.

![Use Search roles para encontrar uma função pelo nome.](roles-guide-search.png)

### 2. Abrir as ações da linha

Selecione os pontos na linha da função correspondente.

![Abra os pontos da função correspondente.](roles-guide-row-actions.png)

### 3. Escolher Edit

Selecione **Edit**. Selecionar a linha abre o mesmo painel.

![Escolha Edit para alterar a descrição ou as permissões.](roles-guide-edit-menu.png)

### 4. Atualizar a descrição

Altere **Description** se o objetivo mudou. Também pode alterar Name. Slug continua apenas de leitura.

![Atualize a descrição. O slug continua apenas de leitura.](roles-guide-edit-description.png)

### 5. Ajustar as permissões individuais

Ative ou desative capacidades. O exemplo acrescenta **View reports**.

![Ative ou desative capacidades individuais.](roles-guide-edit-capability.png)

### 6. Guardar a função

Abra os pontos do painel e selecione **Save**.

![Escolha Save para guardar as alterações.](roles-guide-edit-save.png)

**Resultado esperado:** a lista mostra a descrição guardada. Os utilizadores com esta função recebem as suas permissões.

![A descrição atualizada aparece na linha da função.](roles-guide-edited-result.png)

## Eliminar uma função personalizada

Use esta tarefa apenas quando as pessoas devem perder as permissões concedidas pela função. Não pode eliminar funções do sistema.

### 1. Escolher Delete

Encontre a função, abra os pontos da linha e selecione **Delete**.

![Delete está disponível para uma função personalizada.](roles-guide-delete-menu.png)

### 2. Confirmar a função e o efeito

Leia a confirmação. Os membros perdem as capacidades concedidas pela função. Selecione **Delete** para confirmar ou **Cancel** para a manter.

![Confira o nome da função e o efeito nos membros antes de confirmar.](roles-guide-delete-confirm.png)

**Resultado esperado:** a função desaparece. Não pode anular a eliminação. Confira os utilizadores afetados após remover a função.

![A função eliminada deixa de aparecer na pesquisa.](roles-guide-deleted-result.png)

## Consultar funções num telemóvel

Use a mesma página Roles no telemóvel. Colunas largas podem exigir deslocação horizontal.

### 1. Pesquisar a função

Introduza o nome em **Search roles**.

![Pesquise funções no telemóvel. A tabela pode deslocar-se horizontalmente.](roles-guide-phone-search.png)

### 2. Abrir as definições

Selecione a linha da função. Desloque o painel para ler a descrição e as capacidades. Selecione **Close** no canto superior direito para regressar.

![O painel da função usa a largura do telemóvel. Desloque-o para consultar as capacidades.](roles-guide-phone-sheet.png)

## Prática opcional

Numa instalação de teste, crie a função `Documentation reader`. Selecione apenas View dashboards. Acrescente View reports na tarefa de edição e elimine a função de prática quando terminar. Não a atribua a pessoal real.

## Antes de alterar o acesso

Administrator está bloqueado. As restantes funções do sistema podem ser editadas, mas não eliminadas. Não pode alterar um slug guardado.

Criar uma função não a atribui a ninguém. As atribuições são geridas em Users. Confira as pessoas afetadas antes de alterar ou eliminar uma função atribuída.

## Resolução de problemas

**A função está apenas de leitura.** Confira se abriu a função bloqueada Administrator e se a sua conta tem Manage roles.

**Uma nova função não altera o acesso de ninguém.** Criá-la apenas guarda as permissões. Use Users para atribuir a função à pessoa pretendida.

## Guias relacionados

[Começar aqui](/docs/start-here) explica a CLI instalada e de desenvolvimento. Users explica a atribuição de funções às pessoas.
