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

## Páginas do diretório

A página Utilizadores começa com as contas ativas. A pesquisa abrange os nomes de utilizador, nomes e e-mails de todo o diretório do fornecedor. Selecione Todos os estados para incluir contas desativadas. Alterar a pesquisa, o estado ou o tamanho da página volta à primeira página.

Use Seguinte para alcançar contas após as primeiras 100. Cada pedido devolve até 100 contas. O rodapé mostra o intervalo visível sem indicar um total. As colunas continuam configuráveis. Os filtros de colunas e a ordenação livre estão indisponíveis porque o fornecedor não os suporta. O fornecedor controla a ordem. Adicionar ou remover contas entre pedidos pode deslocar as páginas.

Na linha de comandos:

```sh
openldr user directory-list --offset 100 --limit 25 --search Ada --enabled true --json
```

O JSON contém `rows`, `offset`, `limit`, `total: null` e `hasMore`. Some `limit` a `offset` enquanto `hasMore` for true. Omita `--enabled` para incluir ambos os estados. `openldr user list` mantém a lista de contas locais.

Sem administração do fornecedor configurada, a listagem usa contas locais. A pesquisa local procura fragmentos no nome de utilizador, nome e e-mail. Os resultados locais seguem a ordem nome de utilizador e ID. A pesquisa do fornecedor segue as regras desse fornecedor.
