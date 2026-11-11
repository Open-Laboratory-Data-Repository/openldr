# Relatórios

Um relatório é uma página imprimível de números do laboratório que pode voltar a executar sempre que precisar. Cada um junta duas partes. Um modelo do **Designer de relatórios** define o aspeto. Uma **consulta personalizada** vai buscar os dados. Executa um relatório com um intervalo de datas e outros filtros, lê-o como documento ou como planilha, transfere-o e agenda-o para correr sozinho.

Este guia leva cerca de 30 minutos. Usa os dados de exemplo da documentação, por isso carregue-os primeiro. Selecione uma imagem ou um clip para o ampliar. Os nomes dos relatórios e dos seus filtros estão em inglês, porque vêm dos modelos.

![Um relatório depois de executado. 1 Pesquisa na biblioteca. 2 Menu de ações do relatório. 3 Vista Documento. 4 Vista Planilha. 5 Baixar.](reports-tour.png)

1. **Pesquisa.** Filtra a lista de relatórios pelo nome. Os relatórios estão agrupados por categoria.
2. **Ações.** O menu de três pontos do relatório escolhido: **Atualizar**, **Parâmetros**, **Histórico**, **Agendamentos** e, para gestores, **Editar modelo**, **Despublicar** e **Excluir relatório**.
3. **Documento.** O PDF imprimível.
4. **Planilha.** As mesmas linhas numa tabela que pode filtrar, ordenar e exportar.
5. **Baixar.** Guarda o PDF.

## Quem pode fazer o quê

Os nomes das permissões aparecem em inglês.

| Permissão | O que permite |
| --- | --- |
| View reports | Abrir **Relatórios** e ver a biblioteca. |
| Run reports | Executar um relatório e ver o resultado. |
| Export reports | Transferir o PDF, o CSV ou o XLSX, e os ficheiros guardados dos agendamentos. |
| Edit report templates | Criar, alterar e excluir agendamentos. Usar **Editar modelo**, **Despublicar** e **Excluir relatório**. |

Os relatórios novos não se criam nesta página. Um gestor de laboratório constrói um modelo no [Designer de relatórios](/docs/report-designer) e publica-o. Depois aparece na biblioteca.

## Antes de começar

Os exemplos precisam dos dados de exemplo da documentação. Se **Total Orders** no painel de exemplo mostrar 0, carregue-os primeiro. Veja [Carregar os dados de exemplo](/docs/dashboard#carregar-os-dados-de-exemplo).

Uma instalação nova traz dez relatórios em quatro categorias:

| Categoria | Relatórios | Funciona com o exemplo |
| --- | --- | --- |
| AMR / Surveillance | AMR Cumulative Antibiogram, AMR First-Isolate Resistance Summary, AMR Resistance Rate, AMR Resistance by Facility | Não. Precisam de resultados de microbiologia. |
| Operational | Clinical Microbiology Report, LIS Stakeholders Update, Specimen Turnaround Time, Test Volume Over Time | Turnaround e Test Volume, sim |
| Quality | Patient Demographics | Sim |
| Regulatory | AMR GLASS RIS (stratified) | Não. Precisa de resultados de microbiologia. |

Os relatórios AMR e de microbiologia leem organismos e resultados de antibiograma. O exemplo não os tem, por isso ficam vazios. Enchem-se quando o seu sistema de laboratório envia microbiologia, por exemplo através de uma exportação WHONET. Veja [Load and push data](https://openldr.online/#/docs/load-data) no site.

## Exemplo 1: executar um relatório

Conte os exames pedidos em cada mês de setembro e outubro de 2026.

![Escolher Test Volume Over Time, definir o intervalo de datas e executá-lo.](reports-run.mp4)

1. Abra **Relatórios**.
2. Na biblioteca, em **Operational**, selecione **Test Volume Over Time**. A página diz **Execute o relatório para ver os resultados.**
3. Abra o menu de três pontos e selecione **Parâmetros**. Um painel lateral lista os filtros do relatório. Uma estrela marca um filtro obrigatório.
4. Selecione **Date range**. Volte a setembro de 2026. Selecione 1 de setembro e depois 31 de outubro.
5. Deixe **Facility** em **Todos**.
6. Selecione **Executar**. O painel fecha e o relatório corre.

**Resultado esperado:** **Total tests** mostra 60. O documento tem dez linhas, uma por exame e por mês. Em outubro: Blood glucose 3, Creatinine 5, Full blood count 8, HIV viral load 8, Malaria rapid test 8.

Os filtros vêm dos parâmetros do modelo. Para juntar, tirar ou mudar o nome de um, altere o modelo no [Designer de relatórios](/docs/report-designer), não esta página. Um relatório lembra-se dos últimos valores usados, neste navegador.

## Ler o resultado

A vista de documento tem setas de página, zoom e **Baixar**. **Baixar** guarda o PDF e regista uma execução `pdf` no histórico.

Selecione **Planilha** para ver as mesmas linhas numa tabela.

![A vista Planilha, com Filtrar, Ordenar, Colunas e as duas exportações.](reports-spreadsheet.png)

- **Filtrar.** Escolha uma coluna, um operador e um valor, depois **Aplicar**. Tire uma etiqueta de filtro para limpar uma regra, ou use **Limpar tudo**.
- **Ordenar.** Muda a ordem.
- **Colunas.** Esconde e mostra colunas.
- **Exportar CSV** e **Exportar XLSX.** Transferem as linhas para outras ferramentas.

Use a planilha quando precisar dos valores exatos, ou para levar as linhas para outra ferramenta.

### O que quer dizer "Facility" nos relatórios incluídos

O filtro **Facility** e as colunas de unidade dos relatórios incluídos querem dizer o **laboratório que fez o exame**. Não agrupam pela clínica que enviou a amostra. Numa instalação nova a lista está vazia até carregar um registo de unidades. Veja [Unidades](/docs/facilities).

## Histórico

Abra o menu de três pontos e selecione **Histórico**.

![O histórico. Atividade lista cada execução, com o formato, as linhas, o utilizador e a hora.](reports-history.png)

- **Atividade** lista as execuções feitas à mão. `preview` é uma execução nesta página. `pdf`, `csv` e `xlsx` são transferências.
- **Execuções agendadas** lista as tentativas dos agendamentos, o estado e o ficheiro guardado. **Baixar**, junto a uma execução bem-sucedida, obtém o seu CSV, XLSX ou PDF.

Use o histórico para comparar execuções e para ver se um resultado mudou depois de chegarem dados novos. Para saber quem mudou definições ou agendamentos, veja [Auditoria](/docs/audit).

## Exemplo 2: tempo de resposta das amostras

Veja quanto tempo cada exame leva, da amostra recebida ao relatório emitido.

![Specimen Turnaround Time para setembro e outubro de 2026.](reports-turnaround.png)

1. Na biblioteca, selecione **Specimen Turnaround Time**.
2. Abra o menu de três pontos e depois **Parâmetros**. Defina **Date range** de 1 de setembro a 31 de outubro de 2026.
3. Selecione **Executar**.

**Resultado esperado:** **Reports** mostra 39 e **Avg hours** mostra 358.6. Blood glucose tem em média 137.7 horas, HIV viral load 288.0, Malaria rapid test 349.8, Full blood count 392.5 e Creatinine 615.0.

Estas horas são muito mais longas do que o tempo real de cada amostra. Este relatório mede a partir da **primeira** amostra recebida do paciente até cada relatório. O exemplo tem pacientes com vários pedidos ao longo de dois meses, por isso um relatório mais tardio é contado desde a primeira amostra. Tenha isto em conta nos pacientes com exames repetidos, como a carga viral do VIH.

## Exemplo 3: agendar um relatório

Ponha o Test Volume a correr todas as segundas-feiras e a guardar um PDF.

![Abrir Agendamentos, criar um agendamento semanal em PDF e salvá-lo.](reports-schedule.mp4)

1. Selecione **Test Volume Over Time**. Abra o menu de três pontos e selecione **Agendamentos**. A sua função precisa de **Edit report templates**.
2. Selecione **Novo agendamento**.
3. Defina **Frequência** como **Semanal**. Defina **Dia da semana** como **Mon**. Os dias aparecem em inglês.
4. Defina **Formato de saída** como **PDF**. Deixe **Facility** em **Todos**.
5. Abra o menu de três pontos do agendamento e selecione **Salvar**. Aparece a mensagem **Agendamento salvo.**

**Resultado esperado:** a lista mostra o agendamento semanal de segunda-feira, uma etiqueta **PDF**, um interruptor ligado e a **Próxima** execução.

![O agendamento guardado, com o interruptor, Executar, Editar e Excluir.](reports-schedules.png)

Cada linha de agendamento tem um interruptor para o ligar e desligar, um botão de reprodução, **Executar**, um lápis para **Editar** e um caixote para **Excluir**.

### Frequência, hora e intervalo de datas

- **Diário**, **Semanal**, **Mensal** ou **Trimestral**. Semanal pede um dia da semana. Mensal oferece os dias 1 a 28.
- Todos os agendamentos correm às 06:00 UTC. Não pode escolher outra hora nem outro fuso horário.
- **Próxima** e **Última** aparecem no fuso horário do seu navegador.
- O filtro **Time zone** de um relatório define como os dados são contados, não quando o agendamento corre.
- Um agendamento novo começa com os filtros atuais da página, exceto o intervalo de datas.

O intervalo de datas não fica guardado. O agendador calcula-o quando a execução começa, incluindo com **Executar**:

| Frequência | Próxima data ao guardar | Intervalo de datas |
| --- | --- | --- |
| Diário | Amanhã | O dia UTC anterior |
| Semanal | O próximo dia escolhido, nunca hoje | Os sete dias UTC anteriores, até ontem |
| Mensal | O dia escolhido no mês seguinte | O mês civil anterior em UTC |
| Trimestral | O primeiro dia do trimestre seguinte | O trimestre civil anterior em UTC |

Um agendamento desligado pode continuar a mostrar **Próxima**. Essa data não quer dizer que vai correr. Veja o interruptor. **Última** pode ser uma tentativa falhada. Veja o estado no histórico.

### Executar agora e transferir o ficheiro

1. Ligue o agendamento e depois selecione **Executar**, o botão de reprodução.
2. Uma mensagem diz que a execução foi posta na fila. Isso não quer dizer que correu bem. Um agendamento desligado mostra a mesma mensagem e não faz nada.
3. Abra o menu de três pontos, **Histórico**, **Execuções agendadas**. As execuções automáticas e as lançadas à mão aparecem aqui quando terminam.
4. Selecione **Baixar** junto a uma execução bem-sucedida. Precisa de **Export reports**.
5. Se a execução não aparecer, feche e volte a abrir **Execuções agendadas**. A lista não se atualiza sozinha.

Uma execução falhada não tem ficheiro. Num computador, aponte para o estado **Falhou** para ler o erro. Corrija os filtros do agendamento e tente de novo. Uma execução agendada nunca substitui o que a página do relatório mostra.

## Gerir um relatório

Com **Edit report templates**, o menu de três pontos do relatório tem também:

- **Editar modelo.** Abre o modelo no [Designer de relatórios](/docs/report-designer).
- **Despublicar.** Tira o relatório da biblioteca e mantém o modelo.
- **Excluir relatório.** Remove-o, depois de confirmar.

## Num telemóvel

Num telemóvel, a biblioteca começa dobrada numa faixa estreita à esquerda. Selecione o botão de painel no topo da faixa para a abrir. Os nomes longos aparecem cortados na lista. O nome completo aparece quando escolhe o relatório. Volte a dobrar a biblioteca para dar o ecrã todo ao relatório.

![A biblioteca de relatórios aberta num telemóvel.](reports-phone.png)

## Limites

Cada consulta de relatório guardada devolve no máximo 1 000 linhas. Exatamente 1 000 é aceite. Se alguma consulta por trás de um PDF passar disso, o PDF inteiro é recusado. As exportações CSV e XLSX também recusam. Restrinja o intervalo de datas ou outros filtros e execute de novo. Um `LIMIT` escrito no SQL guardado é mantido de propósito.

Uma execução agendada acima do limite regista uma falha e não guarda ficheiro. A linha de comandos mostra o erro antes de escrever a exportação. Os ficheiros já guardados não voltam a ser gerados.

## O LIS Stakeholders Update

Este relatório mostra, por laboratório, se chegaram dados ao OpenLDR em cada dia útil de um mês.

- As datas ficam no cabeçalho das colunas, o dia por cima do mês, e repetem-se em cada página.
- Uma célula preenchida quer dizer que chegaram dados nesse dia. Uma vazia quer dizer que não chegou nada.
- Os fins de semana ficam de fora. Não se aplica nenhum calendário de feriados, por isso um feriado conta como dia útil.
- Os dias são contados no fuso horário definido em **Definições**, **Laboratório**, **Time zone**. O filtro **Time zone** da execução começa por essa definição e pode mudá-lo. Uma execução agendada ou pela linha de comandos não lê a definição. Dê-lhe o fuso diretamente.
- **HVL/EID panel codes** recebe os códigos que o seu programa conta como carga viral ou diagnóstico precoce, em cada execução. O resto vai para a grelha Other.
- Um laboratório que não enviou nada nesse mês não aparece na grelha.
- A vista **Planilha** e o CSV são o resultado bruto da consulta. A primeira linha traz as datas das colunas, não um laboratório, e incluem a coluna de ordenação que a página esconde. Salte essa primeira linha quando levar o ficheiro para outra ferramenta.

## O Clinical Microbiology Report

Este relatório recebe o **número de laboratório** como Request ID: o número do pedido e da etiqueta da amostra, tal como o sistema o envia, por exemplo `TZDISATDS0013538`.

Um sistema de laboratório divide muitas vezes um resultado de microbiologia em vários pedidos com o mesmo número. A cultura que cresceu é um pedido, o antibiograma outro. O relatório lê todos os pedidos com esse número e imprime um isolado com as suas sensibilidades numa página. Uma amostra com mais de um organismo é recusada, não juntada, porque dois antibiogramas sob um só nome de organismo pareceriam um só isolado. Um único identificador de pedido também funciona.

## Resolução de problemas

- **Executar está desativado.** Falta um filtro obrigatório. Abra **Parâmetros** e preencha todos os filtros marcados com estrela. A maioria dos relatórios pede um intervalo de datas.
- **"date range not selected", ou uma mensagem com o nome de um parâmetro.** O relatório correu sem um valor de que precisa. Defina-o em **Parâmetros** e execute de novo. A mensagem diz qual é o parâmetro.
- **O resultado está vazio.** Alargue o intervalo de datas, limpe os filtros opcionais ou confirme que os dados estão carregados. Os relatórios AMR ficam vazios sem dados de microbiologia.
- **"no data for this report request" no Clinical Microbiology Report.** Esse número não tem microbiologia. Um pedido de bioquímica ou serologia não tem organismo. O relatório recusa em vez de imprimir uma página vazia, porque um relatório de microbiologia sem organismo parece uma cultura negativa. Veja primeiro os painéis do pedido em **Consulta**.
- **Um relatório de microbiologia mostra um organismo sem sensibilidades.** Normalmente é um resultado verdadeiro. A cultura cresceu e não se fez antibiograma.
- **Todos os relatórios de microbiologia têm a tabela de sensibilidades vazia.** Veja primeiro em **Terminologia** o conjunto de valores de interpretação do antibiograma. O relatório escolhe as sensibilidades desse conjunto. Se nunca foi carregado nesta instalação, todas as tabelas ficam vazias, como culturas sem antibiograma. Uma tabela vazia é um resultado. Todas vazias é um problema de instalação.
- **Um antibiograma mostra uma coluna `(unmapped)`.** São resultados que o relatório não conseguiu ligar a um antibiótico, muitas vezes uma linha de resumo, um resultado para dois fármacos, ou um resultado de microscopia registado como S, I ou R. Aparecem para que a contagem se veja. Um número grande é um problema de qualidade dos dados a levar a quem configura o analisador.
- **As horas de resposta parecem demasiado longas.** Veja o [Exemplo 2](#exemplo-2-tempo-de-resposta-das-amostras). O relatório conta cada relatório desde a primeira amostra do paciente.
- **Permissão negada.** A sua função pode ver relatórios, mas não gerir agendamentos, editar modelos, nem despublicar ou excluir.
- **Uma execução anterior falhou.** Abra **Histórico**, leia o erro, mude os filtros e execute de novo.
- **Falta um relatório que esperava.** Pode estar despublicado ou ainda não ter sido criado. Veja o [Designer de relatórios](/docs/report-designer).
- **O LIS Stakeholders Update não tem dados num dia em que um laboratório enviou.** Veja primeiro **Definições**, **Laboratório**, **Time zone**, ou o filtro **Time zone** da execução. Os dias são contados nesse fuso. Um fuso UTC numa instalação adiantada em relação a UTC pode passar uma chegada ao fim da tarde para o dia anterior.
- **Num armazém SQL Server, a definição Time zone não se pode usar.** Essa definição só aceita nomes de fuso IANA, e o SQL Server pede nomes do Windows. No SQL Server, deixe a definição vazia e escreva o nome do Windows no filtro **Time zone** de cada execução. A definição funciona no PostgreSQL e no MySQL ou MariaDB.
- **A execução é recusada com uma mensagem sobre o filtro Time zone.** O filtro recebeu um desvio com sinal, como `+3`, `+03:00` ou `Etc/GMT+3`. Isto é recusado de propósito. A base de dados lê o sinal ao contrário, por isso `+3` quer dizer três horas atrás de UTC, e a grelha ficaria desviada o dobro sem nada na página o mostrar. Escreva um fuso com nome, como `Africa/Maputo`, ou o nome do Windows no SQL Server. Um nome que o armazém não conhece não é recusado aqui. O armazém indica-o claramente.
- **Falta um laboratório no LIS Stakeholders Update.** Não enviou nada nesse mês. Se faltarem todos, veja primeiro o ponto seguinte.
- **Faltam todos os laboratórios num armazém MySQL ou MariaDB.** As tabelas de fusos horários do servidor provavelmente não estão carregadas. Enquanto ninguém correr `mysql_tzinfo_to_sql` nesse servidor, todos os dias ficam vazios. A grelha desenha as datas sem nenhuma linha, como um mês em que nada chegou. Peça ao administrador do armazém para carregar essas tabelas. O PostgreSQL e o SQL Server não são afetados.
- **A grelha HVL/EID está vazia mas a Other não.** Os códigos em **HVL/EID panel codes** não coincidem com o que este laboratório envia. O filtro é obrigatório, por isso não estava vazio. Abra **Consulta**, encontre um pedido que sabe ser de carga viral ou diagnóstico precoce e leia o seu código de painel. É essa grafia exata, com pontuação e maiúsculas, que o filtro precisa.

## Guias relacionados

- [Designer de relatórios](/docs/report-designer)
- [Consultas personalizadas](/docs/query)
- [Painéis](/docs/dashboard)
- [Auditoria](/docs/audit)
