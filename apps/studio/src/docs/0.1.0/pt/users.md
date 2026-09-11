# Utilizadores e funções

O editor de utilizadores do Studio atribui uma única função. A função reúne as permissões necessárias para o trabalho da pessoa.

![Lista de utilizadores](users-list.png)

## Atribuir uma função

1. Abra **Utilizadores** e procure a conta.
2. Abra o menu **⋯** da linha e escolha **Editar**.
3. Aguarde o carregamento das funções. Abra **Função** e selecione uma função.
4. A seleção é única. Escolher outra função substitui a seleção; não acrescenta uma segunda função.
5. Guarde e confirme a notificação de sucesso.
6. Volte a abrir a conta para verificar a função guardada.

![Editor de utilizadores e seleção da função](user-edit-roles.png)

Editar a conta exige permissão para gerir utilizadores. Atribuir a função também exige permissão para gerir funções. Se a atribuição falhar, o editor permanece aberto e apresenta um erro. Resolva esse erro antes de considerar a alteração concluída.

Se nenhuma função for adequada, crie ou ajuste uma em **Definições → Funções**. Alterar as permissões de uma função partilhada afeta todos os utilizadores com essa função.

## Guias relacionados

- [Funções](/docs/roles)
- [Auditoria](/docs/audit)
- [Definições](/docs/settings)

## Desativar ou reativar uma conta

Abra o menu **Ações** da linha da conta para a desativar ou reativar. A desativação bloqueia primeiro o acesso local e depois atualiza o fornecedor de identidade. O pedido autenticado seguinte à API recebe `403 account disabled`, mesmo com um token já emitido. Uma página já carregada pode continuar visível.

O bloqueio também abrange contas que nunca iniciaram sessão. A reativação atualiza primeiro o fornecedor e depois remove o bloqueio local. Se uma escrita falhar, a ação apresenta um erro. O fornecedor pode permitir o acesso enquanto o OpenLDR mantém o bloqueio. Restabeleça a ligação que falhou e repita a mesma ação. A auditoria regista `user.status.failed` em caso de falha e `user.status` em caso de sucesso.

Na CLI, use `openldr user deactivate <local-id>` ou `openldr user activate <local-id>`. Consulte o identificador local com `openldr users list`. As contas ligadas atualizam ambos os sistemas através do identificador do fornecedor. As contas apenas locais mudam só no OpenLDR. A auditoria destas alterações na CLI identifica o ator como `cli`.

Se outra alteração do estado desta conta estiver em curso, a API devolve `409`. Aguarde o fim dessa ação e tente novamente. Isto também se aplica a alterações simultâneas no Studio e na CLI.
