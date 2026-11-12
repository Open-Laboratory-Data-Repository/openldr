# Utilizadores

Use Users para encontrar contas, atualizar perfis, atribuir um papel e controlar o acesso. Os papéis definem as permissões da conta. O painel Users seleciona um papel por pessoa.

Use as contas reais da equipa e decisões de acesso aprovadas. As imagens usam uma conta fictícia numa instalação de teste isolada. Não precisa de dados de exemplo.

View users permite consultar o diretório. Manage users permite criar contas, alterar perfis e ativar ou desativar o acesso. Manage roles permite atribuir papéis. Reset passwords e Force logout permitem as respetivas ações de segurança.

Criar contas, editar perfis do fornecedor, repor palavras-passe e terminar sessões do fornecedor exige administração de identidade configurada. Quando não está disponível, a página pede para contactar o administrador do fornecedor de identidade. Os controlos de papéis e acesso OpenLDR continuam disponíveis.

Para instalação e linha de comandos, leia [Começar aqui](/docs/start-here). Para definir permissões dos papéis, leia [Papéis](/docs/roles).

## Criar uma conta de operador

Faça esta tarefa quando uma pessoa precisa do seu próprio acesso. Verifique o papel necessário antes de criar a conta.

### 1. Abrir Users

Selecione **Users** no menu principal.

![Selecione Users no menu principal.](users-guide-open-users.png)

### 2. Escolher New user

Abra os pontos da página acima do diretório e selecione **New user**. Se não estiver disponível, contacte o administrador do fornecedor de identidade.

![Abra o menu de pontos de Users.](users-guide-page-actions.png)

![Escolha New user.](users-guide-new-user.png)

### 3. Introduzir o nome de utilizador

Introduza o nome de acesso da pessoa. O exemplo usa `documentation.operator`.

![Introduza o nome de utilizador da conta.](users-guide-username.png)

### 4. Escolher uma palavra-passe inicial

Introduza uma **Password** inicial, ou deixe vazia e combine a ativação pelo fornecedor de identidade. Uma palavra-passe inicial exige alteração no próximo acesso. Partilhe as credenciais pelo processo aprovado.

![Introduza uma palavra-passe inicial ou deixe vazia e combine a ativação pelo fornecedor.](users-guide-password.png)

### 5. Confirmar a palavra-passe

Se introduziu uma palavra-passe, repita-a em **Confirm password**.

![Introduza novamente a mesma palavra-passe inicial.](users-guide-confirm-password.png)

### 6. Escolher o papel

Selecione o papel que permite as ações necessárias à pessoa. As novas contas usam **Lab Technician** por predefinição.

![Escolha o papel adequado. O exemplo usa Lab Technician.](users-guide-choose-role.png)

### 7. Completar o perfil

Preencha os campos do formulário Users publicado. O formulário mostrado pede nome próprio, apelido e email. O seu pode ter outros campos. Um formulário publicado é opcional para criar contas.

![Complete o formulário Users publicado. Este formulário de teste pede nome e email.](users-guide-profile.png)

### 8. Criar a conta

Abra os pontos do painel e selecione **Create**. Se a atribuição do papel falhar após guardar a conta, escolha um papel válido e tente novamente no mesmo painel.

![Abra os pontos do painel New user.](users-guide-sheet-actions.png)

![Escolha Create para guardar a conta e o papel.](users-guide-create-user.png)

**Resultado esperado:** o painel fecha e a conta aparece Active no diretório.

![A conta aparece Active com o nome e o email.](users-guide-created-result.png)

## Editar um perfil ou atribuir outro papel

Faça esta tarefa quando os dados ou as responsabilidades mudarem. Alterar o papel altera as permissões da pessoa.

### 1. Encontrar a conta

Pesquise por nome de utilizador, nome ou email. A pesquisa abrange todo o diretório.

![Pesquise em todo o diretório por nome de utilizador, nome ou email.](users-guide-search-user.png)

### 2. Abrir as ações

Selecione os pontos da conta certa.

![Abra os pontos do utilizador certo.](users-guide-row-actions.png)

### 3. Escolher Edit

Selecione **Edit**. Selecionar a linha abre o mesmo painel. Sem administração de identidade, o menu mostra **Edit role**.

![Escolha Edit para abrir o perfil e o papel.](users-guide-edit-user.png)

### 4. Atualizar o perfil

Edite os campos fornecidos pelo formulário Users. Não pode alterar o nome de utilizador aqui.

![Atualize os campos de perfil fornecidos pelo formulário Users.](users-guide-edit-profile.png)

### 5. Escolher o papel

Abra **Role** e selecione o papel necessário. O exemplo escolhe **System Auditor**.

![Escolha outro papel. O exemplo muda para System Auditor.](users-guide-change-role.png)

### 6. Guardar a conta

Abra os pontos do painel e selecione **Save**.

![Escolha Save no menu de pontos do painel.](users-guide-save-user.png)

**Resultado esperado:** o painel fecha e o diretório mostra o perfil guardado. Reabra a conta para consultar o papel guardado.

![O perfil guardado aparece na tabela Users.](users-guide-edited-result.png)

## Desativar o acesso de uma conta

Faça esta tarefa quando uma pessoa já não deve entrar. Não pode desativar a própria conta pelo menu da sua linha.

### 1. Escolher Disable

Encontre a conta. Abra os pontos da linha e selecione **Disable**.

![Escolha Disable para o utilizador certo.](users-guide-disable-menu.png)

### 2. Confirmar a conta

Verifique o nome de utilizador na confirmação. Selecione **Disable** para continuar.

![Confirme o nome da conta antes de selecionar Disable.](users-guide-disable-confirm.png)

### 3. Abrir Status

As contas desativadas desaparecem da lista Active predefinida. Abra **Status**.

![Use Status para encontrar uma conta desativada.](users-guide-status-filter.png)

### 4. Escolher Disabled

Selecione **Disabled**.

![Escolha Disabled.](users-guide-disabled-option.png)

**Resultado esperado:** a conta aparece com estado Disabled. Desativar o acesso mantém a conta e o perfil.

![A conta aparece com estado Disabled.](users-guide-disabled-result.png)

## Restaurar o acesso de uma conta

Faça esta tarefa quando uma pessoa desativada deve voltar a entrar.

### 1. Escolher Enable

Encontre a conta com Status em Disabled ou All statuses. Abra os pontos da linha e selecione **Enable**.

![Escolha Enable para restaurar o acesso da conta.](users-guide-enable-menu.png)

### 2. Confirmar a conta

Verifique o nome de utilizador e selecione **Enable**.

![Verifique a conta e confirme Enable.](users-guide-enable-confirm.png)

### 3. Voltar a Active

Abra **Status** e escolha **Active**.

![Escolha Active para encontrar a conta ativada.](users-guide-active-option.png)

**Resultado esperado:** a conta volta à lista Active.

![A conta volta à lista Active.](users-guide-enabled-result.png)

## Repor uma palavra-passe

Faça esta tarefa quando uma conta precisa de uma nova palavra-passe. Exige administração de identidade e Reset passwords.

### 1. Abrir Reset password

Encontre a conta. Abra os pontos da linha e selecione **Reset password**.

![Escolha Reset password para a conta certa.](users-guide-reset-menu.png)

### 2. Introduzir uma nova palavra-passe

Introduza **New password**. **Generate** cria uma palavra-passe e preenche ambos os campos. O olho revela-a e Copy copia-a.

![Introduza uma nova palavra-passe. Generate pode preencher ambos os campos.](users-guide-reset-new-password.png)

### 3. Confirmar a nova palavra-passe

Introduza a mesma palavra-passe em **Confirm password**. Generate já preencheu este campo.

![Introduza novamente a mesma nova palavra-passe.](users-guide-reset-confirm-password.png)

### 4. Escolher se é temporária

Mantenha **Require password change at next sign-in** selecionado para uma palavra-passe temporária. Desmarque apenas se a pessoa deve usar esta palavra-passe diretamente.

![Mantenha Require password change ligado para uma palavra-passe temporária, ou desligue quando adequado.](users-guide-reset-change.png)

### 5. Repor a palavra-passe

Selecione **Reset password**. Partilhe a palavra-passe de forma segura pelo processo aprovado.

![Selecione Reset password após verificar a escolha de alteração da palavra-passe.](users-guide-reset-submit.png)

**Resultado esperado:** a página confirma a reposição. Com a opção temporária predefinida, a pessoa tem de a alterar no próximo acesso.

![A página confirma a reposição da palavra-passe.](users-guide-reset-result.png)

## Terminar as sessões do fornecedor de um utilizador

Faça esta tarefa quando as sessões existentes do fornecedor devem terminar. Exige administração de identidade e Force logout.

### 1. Escolher Force sign-out

Encontre a conta. Abra os pontos da linha e selecione **Force sign-out**. Não pode aplicar esta ação à própria conta aqui.

![Escolha Force sign-out para terminar as sessões do fornecedor deste utilizador.](users-guide-logout-menu.png)

### 2. Confirmar a conta

Verifique o nome de utilizador e selecione **Force sign-out**.

![Confirme Force sign-out para a conta certa.](users-guide-logout-confirm.png)

**Resultado esperado:** a página confirma o fim de todas as sessões. Esta ação não desativa a conta.

![A página confirma o fim de todas as sessões.](users-guide-logout-result.png)

## Usar Users num telemóvel

Use o mesmo diretório e painel de conta no telemóvel. Colunas largas podem exigir deslocamento horizontal.

### 1. Encontrar a conta

Pesquise por nome de utilizador, nome ou email.

![Pesquise uma conta no telemóvel.](users-guide-phone-search.png)

### 2. Abrir a conta

Selecione a linha. Desloque o painel User para ler o perfil e o papel. Selecione **Close** no canto superior direito para voltar.

![O painel User usa a largura do telemóvel. Desloque para ler os campos do perfil.](users-guide-phone-profile.png)

## Enviar email de reposição quando o correio está configurado

Os pontos da conta também oferecem **Send reset email**. Pede ao fornecedor de identidade para enviar uma ligação de reposição. Verifique primeiro o email e a configuração de envio do fornecedor. O teste documentado não enviou email.

## Prática opcional

Use uma instalação de teste e um operador fictício. Siga as tarefas com o seu nome de utilizador de teste e um email example.invalid. Não teste desativação, reposição de palavra-passe ou saída forçada na conta de outra pessoa sem autorização.

## Limites

Users não permite eliminar contas. Desative o acesso quando uma conta já não deve entrar. Os campos abaixo de Role dependem do formulário Users publicado. O OpenLDR não configura aqui o envio de email do fornecedor.

## Resolução de problemas

**New user ou as ações de palavra-passe não aparecem.** Leia o aviso acima do diretório. Peça ao administrador do fornecedor de identidade para configurar a administração de contas.

**A conta desaparece após mudar o estado.** Mude Status para Active, Disabled ou All statuses para a encontrar.

**A conta foi guardada, mas a atribuição do papel falhou.** Mantenha o painel aberto, escolha um papel válido e guarde novamente. Não retire a última pessoa capaz de gerir papéis.

## Guias relacionados

Leia [Papéis](/docs/roles) para definir permissões. Leia [Começar aqui](/docs/start-here) para instalação e linha de comandos.
