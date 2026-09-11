# Atividade

A Atividade agrupa execuções de workflows pelo identificador dos dados recebidos. A [Auditoria](/docs/audit) regista alterações de utilizadores e de configuração.

## Inspecionar um processamento

1. Abra **Atividade**. A conta deve ter permissão para consultar esta página.
2. Pesquise por identificador, origem, estado ou etapa. Os filtros reduzem as linhas carregadas.
3. Selecione uma linha para consultar etapas, horas e detalhes registados. Guarde o identificador para uma investigação.
4. Feche os detalhes, atualize pelo menu **⋯** e volte a abrir a linha para obter os detalhes mais recentes.
5. Se houver uma falha ou um processamento incompleto, consulte o histórico do workflow em [Workflows](/docs/workflows).

## Etapas e estados

As etapas representam receção, validação bem-sucedida, um evento de persistência e uma etapa de envio bem-sucedida. Nem todas são necessárias em cada workflow. O indicador da linha resume o percurso; não prova cada etapa anterior. Um envio bem-sucedido não prova uma revisão humana no destino.

O estado completo significa que existe um evento de persistência e nenhuma execução associada falhou. Não exige uma etapa de envio. O estado de falha indica uma execução falhada. O estado bloqueado significa que os registos não estabelecem nenhum dos dois; consulte o histórico antes de concluir que o processamento parou.

## Resultados vazios e limites

A página carrega os 200 grupos mais recentes. Pesquisa, filtros, ordenação e paginação abrangem apenas esse conjunto, não todo o histórico.

Uma lista vazia não prova que não foram recebidos dados. Limpe a pesquisa e os filtros, atualize e consulte as execuções dos workflows. Dados sem histórico de workflow associado podem não aparecer na lista.

Se os detalhes continuarem a carregar, feche-os, atualize e abra novamente a linha. A página pode mostrar carregamento depois de uma falha no pedido. A Atividade não permite repetir o processamento; siga o procedimento de recuperação do workflow.

## Espera dos eventos em fila

Cada instância do barramento de eventos executa um único processador de eventos de cada vez. Um processador lento pode atrasar os eventos seguintes. As notificações repetidas não iniciam outros processadores durante o lote atual. Os eventos pendentes ficam em fila para um lote posterior. Processos de servidor separados podem continuar a tratar eventos em simultâneo.

## Guias relacionados

- [Workflows](/docs/workflows)
- [Auditoria](/docs/audit)
