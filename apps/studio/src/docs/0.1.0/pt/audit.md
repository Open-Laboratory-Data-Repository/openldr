# Auditoria

A Auditoria ajuda administradores e gestores a rastrear alterações visíveis aos utilizadores em fluxos de trabalho, formulários, utilizadores, relatórios, conectores e definições.

> **Histórico de início de sessão:** Os inícios e términos de sessão bem-sucedidos são geridos pelo Keycloak, não pelo OpenLDR — a aplicação nunca vê a palavra-passe. Encontre-os na consola de administração do Keycloak em **Realm → Events**. Este registo regista falhas de autenticação (`auth.failed`) e ações de operadores — incluindo ações da CLI, apresentadas com o tipo de ator `cli`.

## Resultado

Pode abrir a Auditoria, aplicar filtros, inspecionar um evento, interpretar os campos ator/ação/entidade/hora, copiar identificadores e seguir uma alteração através de eventos relacionados.

![Tabela de Auditoria com filtros e coluna de data/hora](audit-filter.png)

## Antes de começar

- Conheça a hora aproximada, o ator, a entidade ou a ação a investigar.
- Utilize filtros restritos primeiro quando o volume de eventos for elevado.

## Passos

1. Abra **Auditoria**.
2. Utilize o botão **Filtrar** da barra de ferramentas para adicionar uma regra: escolha uma coluna, um operador e um valor.
3. Utilize **Ordenar** para ordenar a tabela por qualquer coluna ordenável, de forma crescente ou decrescente.
4. Utilize **Colunas** para mostrar ou ocultar colunas; utilize **Repor** para voltar às predefinições.
5. Os filtros ativos aparecem como etiquetas removíveis abaixo da barra de ferramentas — remova uma sem reabrir a janela de filtro.
6. A filtragem, a ordenação e a paginação são todas executadas no servidor, mantendo rápidos registos de auditoria volumosos.
7. Selecione uma linha de evento, por exemplo uma atualização de fluxo de trabalho ou de formulário.
8. Reveja o ator, a ação, a entidade e a hora.
9. Copie identificadores quando precisar de comparar com outro ecrã.
10. Inspecione os detalhes de antes/depois quando estiverem disponíveis.
11. Siga eventos relacionados reutilizando o ator, a entidade ou o identificador como outro filtro.

![Detalhe de evento de Auditoria com ator, entidade e dados de antes/depois](audit-event-detail.png)

## Resultado esperado

Pode explicar quem alterou o quê, quando aconteceu, qual entidade foi afetada e que eventos vizinhos podem fazer parte da mesma atividade.

## Resolução de problemas

- **Nenhum evento aparece:** alargue o intervalo de tempo ou remova os filtros um de cada vez.
- **O ator é inesperado:** verifique se um fluxo de trabalho agendado ou uma ação do sistema realizou a alteração.
- **Os detalhes de antes/depois estão vazios:** alguns eventos registam a ação sem um instantâneo completo do objeto.
- **Demasiados eventos relacionados:** combine os filtros de entidade e ator para restringir a sequência.

## Utilização web avançada

Combine filtros para seguir atividade em várias etapas: comece pela entidade, adicione o ator e depois compare as datas/horas entre eventos de atualização, execução, publicação ou eliminação.

## Linha de comandos

`openldr audit list` suporta a mesma gramática de filtro e ordenação da barra de ferramentas web, permitindo que um script reproduza qualquer vista construída no navegador.

- `--where column:operator:value` — repetível. Apenas os dois primeiros dois-pontos são delimitadores, pelo que um valor pode conter um dois-pontos (um identificador de entidade ou um URL, por exemplo).
- `--sort column` — crescente. `--sort -column` — decrescente (traço à frente). Repetível.
- Na coluna de data/hora, `eq` com uma data simples (`2026-08-06`, sem hora) corresponde ao dia inteiro, não a um único instante. `between` com duas datas simples inclui o dia final por completo.

```bash
openldr audit list --where action:like:form. --sort -occurredAt
```

Este comando lista os eventos de auditoria cuja `action` contém `form.`, do mais recente para o mais antigo.

Uma coluna desconhecida ou um operador não permitido nessa coluna é rejeitado com uma mensagem que identifica exatamente o erro — a mesma validação usada pela barra de ferramentas web, pelo que um sinalizador mal digitado falha da mesma forma que um filtro mal digitado no navegador.

## Guias relacionados

- [Utilizadores e Funções](/docs/users)
- [Fluxos de Trabalho](/docs/workflows)
