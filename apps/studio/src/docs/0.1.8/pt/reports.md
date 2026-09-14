# Relatórios

Este guia explica como agendar um relatório e recuperar seu arquivo.

![Relatório e resultados](reports-run-result.png)

## Agendar um relatório

1. Selecione um relatório e abra **⋯ → Agendamentos**. Seu perfil precisa permitir a gestão de relatórios.
2. Escolha **Novo agendamento** e a frequência. Semanal exige um dia da semana. Mensal oferece os dias 1 a 28.
3. Escolha CSV, XLSX ou PDF. Confira os filtros obrigatórios, incluindo estabelecimento e fuso horário. O novo agendamento copia os filtros atuais do relatório, exceto as datas.
4. Escolha **Salvar** e confira a confirmação. O agendamento mostra um interruptor, **Próxima** e **Última**.
5. Use o lápis para editar frequência, formato ou filtros e salve. Use o interruptor para desativar. O ícone de exclusão solicita confirmação.

### Horário e período

Todas as frequências usam 06:00 UTC. Não é possível escolher outra hora ou outro fuso. Próxima e Última usam o fuso do navegador. O filtro Fuso horário do relatório altera o cálculo dos dados, não o horário do agendamento.

| Frequência | Próxima data após salvar | Período automático |
| --- | --- | --- |
| Diário | Amanhã | Dia UTC anterior |
| Semanal | Próximo dia escolhido, nunca hoje | Sete dias UTC anteriores, terminando ontem |
| Mensal | Dia escolhido do próximo mês | Mês civil anterior em UTC |
| Trimestral | Primeiro dia do próximo trimestre | Trimestre civil anterior em UTC |

O período depende da data de execução, inclusive ao escolher **Executar**. Relatórios com parâmetro de intervalo de datas recebem esse período automaticamente. Os outros filtros salvos continuam em uso.

Um agendamento desativado ainda pode mostrar Próxima. Essa data armazenada não confirma uma execução futura. Confira o interruptor. Última pode indicar uma tentativa que falhou. Consulte o status no histórico.

### Executar e baixar o arquivo

1. Ative o agendamento e escolha o ícone de reprodução, **Executar**.
2. A notificação confirma a solicitação, não o sucesso do relatório. Um agendamento desativado pode mostrar a mesma notificação sem gerar uma execução.
3. Abra **⋯ → Histórico → Execuções agendadas**. As execuções automáticas e as iniciadas aqui aparecem após terminar. **Atividade** contém as execuções interativas.
4. Confira o status e escolha **Baixar** para obter o CSV, XLSX ou PDF salvo. Seu perfil precisa permitir a exportação.
5. Se o resultado não aparecer, saia e reabra **Execuções agendadas**. A lista não atualiza automaticamente.

Uma execução que falhou não fornece arquivo. No computador, passe o cursor sobre o status para ler o erro. Corrija os filtros salvos e tente novamente. O arquivo produzido não substitui o Documento ou a Planilha atualmente exibido na página do relatório.

![Histórico dos relatórios](reports-history-schedules.png)


## Limite dos resultados

Cada consulta guardada pode devolver até 1 000 linhas. Um resultado com exatamente 1 000 linhas é aceite. Se uma consulta usada num PDF exceder este limite, todo o PDF é recusado. As exportações CSV e XLSX também recusam resultados demasiado grandes. Reduza o intervalo de datas ou os outros filtros e execute novamente. Uma cláusula LIMIT escrita no SQL guardado continua a ser intencional e é respeitada. As execuções agendadas registam uma falha sem guardar um ficheiro. A CLI comunica o erro antes de escrever o ficheiro. Os ficheiros já guardados não são gerados novamente.
