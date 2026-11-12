# Auditoria

Audit regista quem executou uma ação, quando ocorreu e que elemento afetou. Os administradores e revisores usam-no para investigar alterações e acessos.

Precisa de View audit log. Use os eventos já registados na instalação. As capturas mostram alterações a contas e disposições fictícias numa instalação de teste. Não são necessários dados de exemplo.

Audit é só de leitura. Ler um evento não o altera. Before, After e Metadata aparecem apenas quando a ação registou esses valores.

## Encontrar eventos de uma ação

Use esta tarefa quando conhece o tipo de ação a investigar. Também pode filtrar por autor, elemento ou hora.

### 1. Abrir Audit

Selecione **Audit** no menu principal.

![Selecionar Audit no menu principal.](audit-guide-open-audit.png)

### 2. Ler as colunas

Leia **When**, **Actor**, **Action**, **Entity type** e **Entity ID**. Uma ação como user.update descreve a operação registada.

![Ler When, Actor, Action e os detalhes do elemento antes de abrir um evento.](audit-guide-read-event-row.png)

### 3. Abrir Filter

Selecione **Filter** acima da tabela.

![Usar Filter para encontrar uma ação ou autor.](audit-guide-filter-open.png)

### 4. Adicionar uma regra

Selecione **Add filter**.

![Escolher Add filter.](audit-guide-filter-add.png)

### 5. Escolher Action

Abra o seletor de coluna e escolha **Action**. Mantenha **Equals** para um nome de ação exato.

![Escolher Action como coluna do filtro.](audit-guide-filter-action.png)

### 6. Introduzir a ação

Introduza a ação a inspecionar. O exemplo usa `user.update` para alterações de perfil. Use uma ação presente na sua instalação.

![Introduzir o nome da ação. O exemplo usa user.update.](audit-guide-filter-value.png)

### 7. Aplicar o filtro

Selecione **Apply**.

![Escolher Apply para pedir os eventos correspondentes.](audit-guide-filter-apply.png)

**Resultado esperado:** a lista mostra os eventos correspondentes. Um resultado vazio significa que nenhum evento corresponde às regras atuais.

![A lista contém os eventos user.update correspondentes.](audit-guide-filter-result.png)

## Ler um evento e os valores registados

Use esta tarefa para identificar a ficha afetada e comparar alterações. Ações diferentes registam detalhes diferentes.

### 1. Abrir o evento

Selecione a linha correspondente. No painel, leia o identificador do evento, a data e hora, o autor, a ação e o elemento afetado.

![Verificar Event ID, Timestamp, Actor e o elemento afetado.](audit-guide-event-identifiers.png)

### 2. Ler Before

Desloque até **Before**. Contém os valores anteriores quando a ação os forneceu. **None recorded.** significa que não foi registada uma cópia desses valores.

![Before regista os valores anteriores quando a ação os fornece.](audit-guide-event-before.png)

### 3. Ler After

Desloque até **After**. Compare os valores guardados com Before. São cópias registadas, não um editor.

![After regista os valores guardados quando a ação os fornece.](audit-guide-event-after.png)

### 4. Ler Metadata

Desloque até **Metadata** para consultar o contexto adicional registado.

![Metadata contém contexto adicional quando a ação o regista.](audit-guide-event-metadata.png)

### 5. Copiar uma referência quando necessário

Use **Copy Event ID** junto do identificador para guardar uma referência na investigação. Os restantes valores preenchidos também têm comandos de cópia.

![Usar o comando de cópia junto de um valor para guardar uma referência.](audit-guide-event-copy.png)

### 6. Fechar o painel

Selecione **Close** no canto superior direito.

![Close regressa à lista filtrada.](audit-guide-event-close.png)

**Resultado esperado:** regressa à mesma lista filtrada. O registo de auditoria permanece inalterado.

## Percorrer mais eventos e atualizar a lista

Use esta tarefa para consultar eventos noutra página ou alterações registadas após abrir Audit.

### 1. Limpar o filtro quando necessário

Abra Filter e escolha **Clear** para regressar a todos os eventos.

![Clear remove as regras de filtro ativas.](audit-guide-filter-clear.png)

### 2. Escolher o tamanho da página

Abra **Rows per page** em baixo e escolha um tamanho. O exemplo escolhe **10**.

![Usar Rows per page para alterar o número de eventos apresentados.](audit-guide-page-size.png)

![Escolher o tamanho da página. O exemplo escolhe 10.](audit-guide-ten-rows.png)

### 3. Ler a página seguinte

Selecione **Next page** quando estiver disponível.

![Next page lê o grupo seguinte de eventos.](audit-guide-next-page.png)

### 4. Regressar à página anterior

Selecione **Previous page**.

![Previous page regressa ao grupo anterior.](audit-guide-previous-page.png)

### 5. Atualizar a lista

Abra o menu de pontos da página e escolha **Refresh**. Os filtros atuais continuam aplicados.

![Abrir o menu de pontos de Audit.](audit-guide-refresh-actions.png)

![Escolher Refresh para pedir novamente a lista filtrada atual.](audit-guide-refresh-menu.png)

**Resultado esperado:** a tabela lê do servidor a página pedida ou os eventos atualizados.

## Ler eventos num telemóvel

Use a mesma página Audit no telemóvel. A tabela pode deslocar-se horizontalmente.

### 1. Usar os filtros

Use **Filter** acima da tabela para reduzir os resultados antes de ler linhas largas.

![Filter continua disponível acima da tabela no telemóvel.](audit-guide-phone-filter.png)

### 2. Abrir o painel do evento

Selecione uma linha. Desloque o painel para ler os identificadores e as cópias registadas.

![O painel usa a largura do telemóvel e permite percorrer os valores registados.](audit-guide-phone-event.png)

## Prática opcional

Numa instalação de teste, faça uma alteração aprovada de perfil ou disposição e encontre o respetivo evento. Compare Before e After quando existirem. Não é necessário importar dados de auditoria.

## Limites

Esta página não edita, elimina ou exporta eventos. A ausência de uma cópia não prova que a ação não alterou nada. Significa que a ação não registou essa cópia.

## Resolução de problemas

**Nenhum evento corresponde.** Reveja os filtros ativos ou escolha Filter e depois Clear.

**Falta um evento recente.** Escolha Refresh e verifique os filtros e a página atuais.

**Before ou After indica None recorded.** Use o autor, a ação, os detalhes do elemento e os metadados disponíveis. Não pode recuperar essa cópia através desta página.

## Guias relacionados

Leia [Utilizadores](/docs/users) para ações sobre contas e [Papéis](/docs/roles) para permissões. Leia [Começar aqui](/docs/start-here) para configurar a linha de comandos.
