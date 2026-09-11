# Report schedules

## English

### Schedule a report

1. Select a report, then open its **⋯ → Schedules** menu. Your role needs permission to manage reports.
2. Choose **New schedule**. Select Daily, Weekly, Monthly, or Quarterly. Weekly requires a weekday; Monthly offers days 1 through 28.
3. Choose CSV, XLSX, or PDF. Check the saved filters, including any required facility or time zone. A new schedule starts with the report page's current filters, except its date range.
4. Choose **Save** and check the saved confirmation. The schedule appears with an enabled switch, **Next**, and **Last**.
5. Use the pencil icon to edit its frequency, output format, or filters. Save the changes. Use the switch to disable it, or the delete icon and confirmation to remove it.

#### Timing and date window

Every frequency uses 06:00 UTC. The schedule cannot select another hour or time zone. **Next** and **Last** display in your browser's local time zone. A report's Time zone filter controls its data calculation, not the scheduler's clock.

| Frequency | Next date when saved | Automatic report window |
| --- | --- | --- |
| Daily | Tomorrow | Previous UTC day |
| Weekly | Next selected weekday, never today | Previous seven UTC days, ending yesterday |
| Monthly | Selected day in the next month | Previous calendar month in UTC |
| Quarterly | First day of the next calendar quarter | Previous calendar quarter in UTC |

The scheduler calculates the window when execution starts, including **Run now**. Reports with a Date range parameter receive that window automatically. The schedule does not retain the date range selected on the report page. Other saved filters remain in use.

A disabled schedule can still show **Next**. That stored timestamp does not mean it will execute. Check the enabled switch. **Last** can refer to a failed attempt; inspect its status in history.

#### Run now and download the output

1. Enable the schedule before selecting its play icon, **Run now**.
2. A notification confirms the request was queued. This does not confirm successful generation. A disabled schedule can show the same notification but produces no run.
3. Open the report's **⋯ → Run History → Scheduled Runs**. Automatic runs and **Run now** results appear here after completion. **Activity** contains interactive report runs.
4. Check the status and use **Download** beside a successful output to retrieve its saved CSV, XLSX, or PDF. Downloading requires report-export permission.
5. If the result is absent, leave and reopen **Scheduled Runs** to reload the list. The list does not refresh automatically.

A failed run has no downloadable output. On desktop, hover over its failed status to read the error. Check the schedule's saved filters, correct them, and try **Run now** again. The schedule output does not replace the report page's current Document or Spreadsheet view.

### Report result limit

Each stored report query can return up to 1,000 rows. Exactly 1,000 rows are accepted. If any query used by a PDF exceeds this limit, the whole PDF is refused. CSV and XLSX exports also refuse oversized results. Narrow the date range or other filters, then run again. A LIMIT written in the saved SQL remains intentional and is respected. Scheduled runs record a failure without saving an output file. The CLI reports the error before writing the export. Previously saved outputs are not regenerated.

## Français

### Planifier un rapport

1. Sélectionnez un rapport, puis **⋯ → Planifications**. Votre rôle doit autoriser la gestion des rapports.
2. Choisissez **Nouvelle planification**, puis la fréquence. Une fréquence hebdomadaire demande un jour de la semaine. Une fréquence mensuelle propose les jours 1 à 28.
3. Choisissez CSV, XLSX ou PDF. Vérifiez les filtres requis, dont l'établissement et le fuseau horaire. La nouvelle planification reprend les filtres courants du rapport, sauf les dates.
4. Choisissez **Enregistrer** et vérifiez la confirmation. La planification affiche un interrupteur, **Prochaine** et **Dernière**.
5. Utilisez le crayon pour modifier la fréquence, le format ou les filtres, puis enregistrez. L'interrupteur désactive la planification. L'icône de suppression demande une confirmation.

#### Horaire et période

Toutes les fréquences utilisent 06:00 UTC. Vous ne pouvez pas choisir une autre heure ou un autre fuseau. Les dates Prochaine et Dernière utilisent le fuseau du navigateur. Le filtre Fuseau horaire du rapport agit sur les données, pas sur l'heure de lancement.

| Fréquence | Prochaine date après enregistrement | Période automatique |
| --- | --- | --- |
| Quotidien | Demain | Jour UTC précédent |
| Hebdomadaire | Prochain jour choisi, jamais aujourd'hui | Sept jours UTC précédents, jusqu'à hier |
| Mensuel | Jour choisi du mois suivant | Mois civil précédent en UTC |
| Trimestriel | Premier jour du trimestre suivant | Trimestre civil précédent en UTC |

La période dépend de la date réelle d'exécution, y compris avec **Exécuter**. Elle remplace automatiquement les dates des rapports ayant un paramètre de période. Les autres filtres enregistrés restent utilisés.

Une planification désactivée peut encore afficher Prochaine. Cette date conservée ne signifie pas qu'elle sera exécutée. Vérifiez l'interrupteur. Dernière peut désigner une tentative échouée. Consultez son statut dans l'historique.

#### Exécuter et récupérer le fichier

1. Activez la planification, puis choisissez l'icône de lecture, **Exécuter**.
2. La notification confirme la demande, pas la réussite du rapport. Une planification désactivée peut afficher cette notification sans produire d'exécution.
3. Ouvrez **⋯ → Historique → Exécutions planifiées**. Les exécutions automatiques et celles lancées ici apparaissent après leur fin. **Activité** contient les exécutions interactives.
4. Vérifiez le statut, puis choisissez **Télécharger** pour récupérer le fichier CSV, XLSX ou PDF enregistré. Votre rôle doit autoriser l'exportation.
5. Si le résultat manque, quittez puis rouvrez **Exécutions planifiées**. La liste ne se rafraîchit pas automatiquement.

Une exécution échouée ne fournit pas de fichier. Sur ordinateur, survolez son statut pour lire l'erreur. Corrigez les filtres enregistrés et réessayez. Le fichier produit ne remplace pas le Document ou le Tableur actuellement affiché sur la page du rapport.

### Limite des résultats

Chaque requête enregistrée peut renvoyer jusqu'à 1 000 lignes. Un résultat de 1 000 lignes est accepté. Si une requête utilisée par un PDF dépasse cette limite, le PDF entier est refusé. Les exports CSV et XLSX refusent aussi les résultats trop volumineux. Réduisez la période ou les autres filtres, puis relancez le rapport. Une clause LIMIT écrite dans le SQL enregistré reste volontaire et est respectée. Les exécutions planifiées enregistrent un échec sans créer de fichier. La CLI signale l'erreur avant d'écrire le fichier. Les fichiers déjà enregistrés ne sont pas régénérés.

## Português

### Agendar um relatório

1. Selecione um relatório e abra **⋯ → Agendamentos**. Seu perfil precisa permitir a gestão de relatórios.
2. Escolha **Novo agendamento** e a frequência. Semanal exige um dia da semana. Mensal oferece os dias 1 a 28.
3. Escolha CSV, XLSX ou PDF. Confira os filtros obrigatórios, incluindo estabelecimento e fuso horário. O novo agendamento copia os filtros atuais do relatório, exceto as datas.
4. Escolha **Salvar** e confira a confirmação. O agendamento mostra um interruptor, **Próxima** e **Última**.
5. Use o lápis para editar frequência, formato ou filtros e salve. Use o interruptor para desativar. O ícone de exclusão solicita confirmação.

#### Horário e período

Todas as frequências usam 06:00 UTC. Não é possível escolher outra hora ou outro fuso. Próxima e Última usam o fuso do navegador. O filtro Fuso horário do relatório altera o cálculo dos dados, não o horário do agendamento.

| Frequência | Próxima data após salvar | Período automático |
| --- | --- | --- |
| Diário | Amanhã | Dia UTC anterior |
| Semanal | Próximo dia escolhido, nunca hoje | Sete dias UTC anteriores, terminando ontem |
| Mensal | Dia escolhido do próximo mês | Mês civil anterior em UTC |
| Trimestral | Primeiro dia do próximo trimestre | Trimestre civil anterior em UTC |

O período depende da data de execução, inclusive ao escolher **Executar**. Relatórios com parâmetro de intervalo de datas recebem esse período automaticamente. Os outros filtros salvos continuam em uso.

Um agendamento desativado ainda pode mostrar Próxima. Essa data armazenada não confirma uma execução futura. Confira o interruptor. Última pode indicar uma tentativa que falhou. Consulte o status no histórico.

#### Executar e baixar o arquivo

1. Ative o agendamento e escolha o ícone de reprodução, **Executar**.
2. A notificação confirma a solicitação, não o sucesso do relatório. Um agendamento desativado pode mostrar a mesma notificação sem gerar uma execução.
3. Abra **⋯ → Histórico → Execuções agendadas**. As execuções automáticas e as iniciadas aqui aparecem após terminar. **Atividade** contém as execuções interativas.
4. Confira o status e escolha **Baixar** para obter o CSV, XLSX ou PDF salvo. Seu perfil precisa permitir a exportação.
5. Se o resultado não aparecer, saia e reabra **Execuções agendadas**. A lista não atualiza automaticamente.

Uma execução que falhou não fornece arquivo. No computador, passe o cursor sobre o status para ler o erro. Corrija os filtros salvos e tente novamente. O arquivo produzido não substitui o Documento ou a Planilha atualmente exibido na página do relatório.

### Limite dos resultados

Cada consulta guardada pode devolver até 1 000 linhas. Um resultado com exatamente 1 000 linhas é aceite. Se uma consulta usada num PDF exceder este limite, todo o PDF é recusado. As exportações CSV e XLSX também recusam resultados demasiado grandes. Reduza o intervalo de datas ou os outros filtros e execute novamente. Uma cláusula LIMIT escrita no SQL guardado continua a ser intencional e é respeitada. As execuções agendadas registam uma falha sem guardar um ficheiro. A CLI comunica o erro antes de escrever o ficheiro. Os ficheiros já guardados não são gerados novamente.
