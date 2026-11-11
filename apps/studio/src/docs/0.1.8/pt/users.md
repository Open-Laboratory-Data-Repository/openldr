# Utilizadores e funções

**Utilizadores** lista quem pode entrar, o seu estado e a sua função. Os administradores usam-no para juntar pessoas, dar uma função a cada uma, e ligar ou desligar o acesso.

A entrada propriamente dita é tratada pelo fornecedor de identidade, normalmente o Keycloak. O OpenLDR decide o que uma pessoa autenticada pode fazer, através da sua função. As funções estão descritas em [Funções](/docs/roles).

Este guia leva cerca de 15 minutos. Selecione uma imagem para a ampliar.

![Utilizadores: as contas do fornecedor de identidade, com pesquisa, estado e colunas.](users-tour.png)

## Quem pode fazer o quê

Os nomes das permissões aparecem em inglês.

| Permissão | O que permite |
| --- | --- |
| View users | Abrir **Utilizadores** e ver as contas. |
| Manage users | Criar, editar, ativar e desativar contas. |
| Reset passwords | Repor uma palavra-passe ou enviar um e-mail de reposição. |
| Force logout | Terminar todas as sessões ativas de uma pessoa. |
| Manage roles | Também é precisa para guardar uma função num utilizador. |

O administrador tem todas.

## A lista

1. Abra **Utilizadores**. Começa com as contas ativas.
2. Escreva em **Pesquisar utilizador, nome ou e-mail**. A pesquisa abrange todo o diretório, não só a página que vê.
3. **Estado** muda entre **Ativo**, contas desativadas e **Todos os estados**.
4. **Colunas** escolhe o que a lista mostra.

A lista segue a ordem do fornecedor de identidade. Cada página tem no máximo 100 contas. O rodapé mostra o intervalo no ecrã sem total, como **1–2 (total desconhecido)**, porque o fornecedor não o dá. Use **Seguinte** para ver mais. Os filtros e a ordenação por coluna não estão disponíveis, porque o fornecedor não os suporta. Contas juntadas ou removidas enquanto pagina podem deslocar as páginas.

O menu de três pontos no canto superior direito tem **Novo utilizador** e **Atualizar**.

## Exemplo 1: dar uma função a alguém

![O menu de uma linha: Editar, Desativar, Repor palavra-passe, Enviar e-mail de reposição, Forçar término de sessão.](users-row-menu.png)

1. Na linha da pessoa, abra o menu de três pontos.
2. Selecione **Editar**. A ficha **Editar utilizador** abre.

![A ficha Editar utilizador: função, primeiro nome, apelido e e-mail.](users-edit-sheet.png)

3. Espere que **Função** carregue e escolha uma função. Cada pessoa tem uma só função. Escolher outra substitui-a.
4. Mude **Primeiro nome**, **Apelido** ou **E-mail** se for preciso.
5. Abra o menu de três pontos da ficha e guarde.
6. Confirme a mensagem de sucesso. Abra de novo a pessoa para ver a função guardada.

Se a ficha mostrar um erro de atribuição de função, fica aberta. Corrija o erro antes de dar a alteração por feita.

Escolha a função com menos capacidades que ainda deixe a pessoa trabalhar. Se nenhuma servir, crie uma primeiro. Veja [Funções, exemplo 1](/docs/roles#exemplo-1-criar-uma-funcao-so-de-leitura).

## Exemplo 2: juntar uma pessoa

1. Abra o menu de três pontos no canto superior direito e selecione **Novo utilizador**.
2. Preencha o nome de utilizador, o nome e o e-mail.
3. Escolha uma função.
4. Guarde e confirme a mensagem de sucesso.

Uma conta nova sem função não pode fazer nada. Dê-lhe sempre uma função.

## Desativar ou ativar o acesso

Abra o menu da linha e selecione **Desativar**, ou **Ativar** numa conta desativada.

- Desativar escreve primeiro um bloqueio local no OpenLDR e depois atualiza o fornecedor de identidade.
- O pedido seguinte da pessoa devolve `403 account disabled`, mesmo com um testemunho emitido antes. Um ecrã já aberto no navegador pode continuar visível.
- As contas que nunca entraram também recebem o bloqueio local.
- Ativar atualiza primeiro o fornecedor e depois levanta o bloqueio local.
- Se algum passo falhar, a ação mostra um erro. Uma desativação falhada pode deixar o fornecedor ativo enquanto o OpenLDR bloqueia o acesso. Uma ativação falhada pode deixar o fornecedor ativo enquanto o bloqueio local fica. Corrija a ligação e repita a mesma ação.
- Se outra mudança de estado da mesma conta ainda estiver a correr, a resposta é `409`. Espere e tente de novo. O mesmo acontece quando o Studio e a linha de comandos mudam a mesma conta ao mesmo tempo.

O registo de auditoria guarda `user.status` quando corre bem e `user.status.failed` quando falha.

## Palavras-passe e sessões

- **Repor palavra-passe** define uma nova palavra-passe para a pessoa.
- **Enviar e-mail de reposição** envia-lhe uma ligação para repor.
- **Forçar término de sessão** termina todas as suas sessões de uma vez.

Estas ações dependem do fornecedor de identidade. Podem faltar em contas que ele não deixa o OpenLDR gerir.

## Num telemóvel

A lista de utilizadores funciona num telemóvel.

![Utilizadores num telemóvel.](users-phone.png)

## Na linha de comandos

```bash
./openldr users list
./openldr user deactivate <local-id>
./openldr user activate <local-id>
./openldr user directory-list --offset 100 --limit 25 --search Ada --enabled true --json
```

- `users list` lista as contas locais e os seus identificadores locais.
- `deactivate` e `activate` atualizam os dois sistemas numa conta associada, pelo seu identificador no fornecedor. Uma conta criada só no OpenLDR muda localmente. O registo de auditoria dá `cli` como autor.
- `directory-list` lê o diretório do fornecedor. O JSON tem `rows`, `offset`, `limit`, `total: null` e `hasMore`. Some `limit` a `offset` enquanto `hasMore` for verdadeiro. Omita `--enabled` para os dois estados.

Quando a administração do fornecedor não está configurada, a lista mostra as contas locais. A pesquisa local encontra o nome de utilizador, o nome e o e-mail em qualquer parte do texto, e os resultados vêm por nome de utilizador.

## Resolução de problemas

- **Permissão negada.** A função da pessoa não tem a capacidade que a página ou a ação pede.
- **Falta uma página no menu de alguém.** A sua função não a inclui.
- **Faltam as ações de reposição.** A conta pode ser controlada pelo fornecedor de identidade.
- **Uma pessoa desativada ainda vê um ecrã antigo.** O conteúdo já carregado fica. O pedido seguinte é bloqueado.
- **Alguém mantém o acesso antigo depois de mudar de função.** Peça-lhe para terminar a sessão e voltar a entrar, ou espere que a sessão se renove.
- **Uma conta nova não pode fazer nada.** Ainda não tem função.

## Guias relacionados

- [Funções](/docs/roles)
- [Auditoria](/docs/audit)
- [Definições](/docs/settings)
