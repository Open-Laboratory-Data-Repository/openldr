# Exposição de dados

Data Exposure controla as colunas adicionais propostas pelo construtor de painéis. Os administradores usam-no para ocultar colunas ou aprovar a disponibilidade. Precisa de Manage data exposure.

Esta política cobre as colunas adicionais do construtor de painéis. Exclui dimensões integradas, SQL direto e relatórios de conectores. Ocultar uma coluna não apaga os dados nem remove o acesso à base.

O distintivo PII significa informação que permite identificar uma pessoa. Mostrar uma destas colunas exige confirmação adicional e depois Save.

Use a política de colunas aprovada. As imagens usam uma instalação de teste isolada e repõem as colunas após a demonstração. Não precisa de registos de exemplo.

## Ocultar uma coluna adicional do painel

Use esta tarefa quando uma coluna adicional deixar de ser proposta no construtor de painéis.

### 1. Abrir Settings e Data Exposure

Abra o menu de utilizador no canto inferior esquerdo, escolha **Settings** e selecione **Data Exposure**.

![Abra o menu de utilizador no canto inferior esquerdo.](data-exposure-guide-user-menu.png)

![Escolha Settings.](data-exposure-guide-settings-menu.png)

![Selecione Data Exposure em Settings.](data-exposure-guide-exposure-page.png)

### 2. Encontrar o grupo da tabela

Encontre a tabela que contém a coluna. O exemplo usa **Patient**. Confira os nomes da tabela e da coluna.

![Encontre o grupo correto antes de alterar uma coluna.](data-exposure-guide-table-group.png)

### 3. Verificar o estado atual

Leia **Shown** ou **Hidden** junto do interruptor. O exemplo começa com `managing_organization` em Shown.

![Shown indica que a coluna adicional é proposta no construtor de painéis.](data-exposure-guide-shown-column.png)

### 4. Desativar a coluna

Desligue o interruptor. O rascunho passa a indicar **Hidden**.

![Desligue o interruptor para marcar a coluna adicional como Hidden.](data-exposure-guide-hide-column.png)

### 5. Verificar o indicador de alterações

**Unsaved changes** significa que o rascunho ainda não alterou a política guardada.

![Unsaved changes indica que a política ainda não foi aplicada.](data-exposure-guide-unsaved.png)

### 6. Guardar a política

Abra os pontos da página no canto superior direito e selecione **Save**.

![Abra os pontos da página Data Exposure.](data-exposure-guide-page-actions.png)

![Escolha Save para aplicar a política de colunas.](data-exposure-guide-save-hidden.png)

**Resultado esperado:** o indicador desaparece. A coluna continua Hidden após reabrir a página e deixa de aparecer nas colunas adicionais do construtor.

![A coluna guardada continua Hidden após reabrir a página.](data-exposure-guide-hidden-result.png)

## Descartar alterações não guardadas

Use esta tarefa para manter a política guardada após alterar um interruptor.

### 1. Rever a alteração do rascunho

Confira o interruptor alterado. O exemplo voltou a ativar a coluna oculta sem guardar.

![Alterar um interruptor apenas prepara uma política. Este exemplo não foi guardado.](data-exposure-guide-discard-draft.png)

### 2. Escolher Discard

Abra os pontos da página e selecione **Discard**.

![Discard recarrega a política guardada e remove as alterações do rascunho.](data-exposure-guide-discard-menu.png)

**Resultado esperado:** a página recarrega a política guardada. A alteração não guardada do interruptor desaparece.

![A coluna regressa ao estado guardado Hidden.](data-exposure-guide-discard-result.png)

## Aprovar a apresentação de uma coluna identificável

Use esta tarefa apenas após decidir que os utilizadores dos painéis devem poder usar esta coluna. As imagens usam uma instalação de teste.

### 1. Verificar o distintivo PII

Encontre a tabela e a coluna corretas. O exemplo usa `surname` em Patient, marcado **PII** e Hidden.

![PII identifica colunas com informação que permite identificar uma pessoa.](data-exposure-guide-pii-hidden.png)

### 2. Ler e confirmar o aviso

Ative o interruptor. Leia o aviso e selecione **Un-hide** para aprovar o rascunho. Selecione Cancel para manter a coluna oculta.

![Leia o aviso de exposição antes de escolher Un-hide.](data-exposure-guide-pii-confirm.png)

### 3. Rever o estado do rascunho

A coluna indica agora **Shown**. A política continua com alterações não guardadas.

![Confirmar marca a coluna Shown no rascunho. Save continua necessário para aplicar.](data-exposure-guide-pii-draft.png)

### 4. Guardar a aprovação

Abra os pontos da página e selecione **Save**.

![Escolha Save para aplicar a política de colunas.](data-exposure-guide-save-pii.png)

**Resultado esperado:** a coluna guardada fica disponível nas colunas adicionais do construtor de painéis.

![A coluna identificável guardada indica agora Shown.](data-exposure-guide-pii-result.png)

## Voltar a ocultar uma coluna identificável

Use esta tarefa quando uma coluna identificável aprovada deixar de ser proposta.

### 1. Desativar a coluna

Encontre a coluna e desligue o interruptor. O exemplo volta a ocultar `surname`.

![Desligue novamente a coluna identificável quando deva ficar oculta.](data-exposure-guide-rehide-pii.png)

### 2. Guardar a nova política

Abra os pontos da página e selecione **Save**.

![Escolha Save para aplicar a política de colunas.](data-exposure-guide-save-rehide.png)

**Resultado esperado:** a coluna fica Hidden na política guardada. Não foram eliminados dados identificáveis.

## Mostrar uma coluna sem aviso PII

Use esta tarefa para voltar a disponibilizar uma coluna adicional sem PII.

### 1. Ativar a coluna

Encontre a coluna correta e ative o interruptor. O exemplo repõe `managing_organization`.

![Ative uma coluna sem PII quando deva ficar disponível novamente.](data-exposure-guide-show-normal.png)

### 2. Guardar a política

Abra os pontos da página e selecione **Save**.

![Escolha Save para aplicar a política de colunas.](data-exposure-guide-restore-column.png)

**Resultado esperado:** a coluna guardada volta a estar disponível nas colunas adicionais do construtor.

## Rever a política num telemóvel

Use os mesmos grupos e interruptores no telemóvel. Desloque os grupos verticalmente.

### 1. Encontrar o grupo da tabela

Encontre o grupo correto antes de alterar uma coluna.

![Desloque os grupos de tabelas num telemóvel.](data-exposure-guide-phone-group.png)

### 2. Ler a coluna e o estado

Confira o nome, o eventual distintivo PII e o estado Shown ou Hidden antes de alterar o interruptor. Guarde nos pontos da página.

![Leia o nome, o distintivo PII e o estado Shown ou Hidden antes de alterar.](data-exposure-guide-phone-column.png)

## Prática opcional

Use uma instalação de teste. Oculte uma coluna sem PII, guarde e reponha-a. Experimente Discard com uma alteração não guardada. Pratique a aprovação PII apenas com dados fictícios e reponha a política pretendida.

## Limites

Esta função não é uma barreira de segurança da base nem uma ferramenta de eliminação. As dimensões integradas, o SQL direto e os relatórios de conectores ficam fora da política. As alterações continuam em rascunho até Save.

## Resolução de problemas

**A política não mudou.** Confira Unsaved changes e escolha Save nos pontos da página.

**Discard está indisponível.** Não existe alteração de interruptor por guardar.

**Um campo oculto continua disponível noutro local.** Confira se é uma dimensão integrada, um campo de SQL direto ou de relatório de conector. Esta política não os abrange.

## Guias relacionados

Leia [Painéis](/docs/dashboard) para criar widgets e [Funções](/docs/roles) para permissões. Leia [Começar aqui](/docs/start-here) para configurar a CLI.
