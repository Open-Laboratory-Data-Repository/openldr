# Funções

Uma **função** é um conjunto com nome de **capacidades**. Uma capacidade é uma permissão precisa, como **Run reports** ou **Edit workflows**. Cada pessoa recebe uma função, e o servidor verifica as suas capacidades antes de cada página e de cada ação.

A entrada é tratada pelo fornecedor de identidade, normalmente o Keycloak. As funções não. Cada função, capacidade e atribuição vive na base de dados do OpenLDR, por isso o controlo de acesso funciona da mesma forma seja qual for o fornecedor de identidade.

Este guia leva cerca de 10 minutos. Selecione uma imagem ou um clip para o ampliar. Os nomes das funções incluídas e das capacidades aparecem em inglês.

![Definições, Funções: as cinco funções incluídas.](roles-tour.png)

## Quem pode fazer o quê

Precisa de **Manage roles** para criar, alterar ou eliminar funções. **View roles** deixa abri-las e ler as suas capacidades. O administrador tem as duas.

## As funções incluídas

| Função | Para que serve |
| --- | --- |
| Administrator | Todas as capacidades. **Bloqueada**: não pode ser alterada nem eliminada, para que alguém possa sempre recuperar o acesso. |
| Lab Manager | Painéis, relatórios, formulários, fluxos de trabalho, terminologia e consultas. Nem utilizadores nem definições. |
| Data Analyst | Ver painéis, executar e exportar relatórios, usar as consultas. Nada para alterar. |
| System Auditor | Só leitura nas áreas principais, mais o registo de auditoria. |
| Lab Technician | Registo na bancada: abrir e enviar formulários, nada mais. |

As capacidades das funções incluídas, exceto Administrator, podem ser mudadas. Uma função não pode ser eliminada enquanto houver pessoas com ela.

As capacidades estão agrupadas por área: Dashboards, Reports, Forms, Workflows, Query, Users, Facilities, Patients, Roles, Terminology, Marketplace, Connectors, Sync, Settings, Observability e Audit.

## Exemplo 1: criar uma função só de leitura

Crie uma função para alguém que só lê painéis e executa relatórios.

![Criar Dashboard viewer com três capacidades.](roles-create.mp4)

1. Abra **Definições** e depois **Funções**.
2. Abra o menu de três pontos no canto superior direito e selecione **Criar função**.
3. Em **Nome**, escreva `Dashboard viewer`. **Identificador** preenche-se sozinho. Pode mudá-lo antes de guardar, e depois fica fixo.
4. Em **Descrição**, escreva para que serve a função, por exemplo `Reads dashboards and runs reports. Changes nothing.`
5. Em **Capacidades**, ative **View dashboards**, **View reports** e **Run reports**. O contador por cima da lista mostra quantas estão ativas.
6. Abra o menu de três pontos da ficha e selecione **Criar**.

**Resultado esperado:** uma mensagem de sucesso, e a função na lista com **0 membros**.

Para dar esta função a alguém, veja [Utilizadores e funções, exemplo 1](/docs/users#exemplo-1-dar-uma-funcao-a-alguem).

Para mudar uma função mais tarde, abra o menu da sua linha e selecione **Editar**. **Eliminar** remove uma função sem membros. Mudar uma função partilhada muda-a para todos os que a têm.

## Como as capacidades chegam a uma instalação existente

As versões novas juntam capacidades. As funções vivem na base de dados, por isso uma função criada por uma versão antiga não conhece sozinha uma capacidade mais recente. O OpenLDR resolve isto em cada arranque:

- **Administrator** recebe sempre a lista completa no reinício seguinte. Está bloqueada e quer dizer "todas as capacidades", por isso não há nada a preservar.
- **As outras funções incluídas** recebem uma capacidade nova só da primeira vez que ela existe. Depois disso, o OpenLDR nunca a volta a dar. Se tirar uma capacidade a Lab Manager, ela continua tirada depois de reinícios e atualizações.
- **As funções que criou nunca são alteradas.** Dê-lhes uma capacidade nova você mesmo.

Uma capacidade dada desta forma fica no registo de auditoria como `role.capability.backfill`.

Para comparar a sua instalação com as definições incluídas:

```bash
./openldr roles doctor
```

Lista, por função incluída, as capacidades que tem, as que tirou de propósito e as que ainda faltam, mais as chaves de capacidade deixadas por uma funcionalidade retirada.

## Na linha de comandos

```bash
./openldr roles list
./openldr roles show <slug>
./openldr roles create <name>
./openldr roles grant <slug> <capability>
./openldr roles revoke <slug> <capability>
./openldr roles delete <slug>
./openldr user assign-role <subject> <slug>
```

`roles create` também aceita `--slug`, `--desc`, e `--caps` com capacidades separadas por vírgulas. Por exemplo, a função do exemplo 1:

```bash
./openldr roles create "Dashboard viewer" --slug dashboard_viewer \
  --desc "Reads dashboards and runs reports. Changes nothing." \
  --caps dashboards.view,reports.view,reports.run
```

## Resolução de problemas

- **As capacidades de uma função não se podem mudar.** É Administrator, que está bloqueada, ou falta-lhe **Manage roles**. Pode na mesma abri-la para ler as capacidades.
- **Uma função não se pode eliminar.** É uma função incluída bloqueada, ou ainda há pessoas com ela. Dê-lhes primeiro outra função.
- **Alguém mantém o acesso antigo depois de mudar de função.** Peça-lhe para terminar a sessão e voltar a entrar, ou espere que a sessão se renove.
- **Uma conta nova não pode fazer nada.** Ainda não tem função. Uma conta sem função não tem capacidades.

## Guias relacionados

- [Utilizadores e funções](/docs/users)
- [Auditoria](/docs/audit)
- [Definições](/docs/settings)
