# Atividade

**Atividade** acompanha cada envio de dados, chamado carga, enquanto passa pelo OpenLDR: recebida, verificada, guardada, enviada. Uma carga é um lote de dados, por exemplo um envio HTTP para um webhook. Use-a para responder a "estes dados chegaram, e foram guardados?".

Não é a [Auditoria](/docs/audit). A Auditoria regista o que as pessoas mudaram. A Atividade regista o que aconteceu aos dados.

Este guia leva cerca de 10 minutos. Selecione uma imagem ou um clip para o ampliar.

![Atividade depois de três envios para o webhook Ingest. Cada um chegou a Persistida e está Concluída.](activity-list.png)

## Quem pode fazer o quê

Uma só permissão cobre esta página: **View activity**. Só lê. Nada aqui altera ou volta a correr dados.

## Antes de começar

Uma instalação nova mostra **Nenhuma carga recente.** A Atividade lista cargas que passaram por um fluxo de trabalho, importações, e lotes carregados com `openldr ingest`. Os dados de exemplo, depois de carregados com `openldr ingest`, aparecem aqui como um lote. A **Origem** é `cli`. O **Status** mostra **Concluída** quando fica guardado, ou **Falhou** com o erro.

Para ver uma carga, envie uma pelo webhook Ingest. Veja [Fluxos de trabalho, exemplos 1 e 2](/docs/workflows#exemplo-1-preparar-o-webhook-ingest). Leva cerca de cinco minutos e não muda nenhuma contagem.

## Exemplo 1: acompanhar uma carga

![Selecionar uma carga para abrir o seu ciclo de vida.](activity-detail.mp4)

1. Abra **Atividade**. As cargas mais recentes estão no topo.
2. Encontre a sua carga. **Origem** é **webhook**. **Etapa** mostra **Persistida**. **Status** mostra **Concluída**.
3. Selecione a linha. **Ciclo de vida da carga** abre à direita.

**Resultado esperado:** duas etapas. **Recebida**, do webhook, com o identificador da execução. Depois **Persistida**, com **1 × Patient**: o recurso guardado.

Guarde o identificador da carga, o identificador longo no topo, se pedir a um administrador para investigar.

Para ver as cargas mais recentes, abra o menu de três pontos no canto superior direito e selecione **Atualizar**. Abra de novo uma linha para obter os detalhes mais recentes.

## Ler as etapas e o estado

| Etapa | O que quer dizer |
| --- | --- |
| Recebida | Um lote ou uma execução de fluxo registou a chegada dos dados. |
| Validada | Um passo do fluxo verificou os dados e passaram. |
| Persistida | Os dados foram guardados. O detalhe diz quantos de cada recurso. |
| Enviada | Um passo do fluxo enviou os dados, por exemplo para outro sistema. |

O detalhe lista as etapas registadas. Nem todos os fluxos registam as quatro. A barra de etapas na lista é um resumo, não a prova de cada etapa anterior. Um envio registado não prova que alguém verificou os dados no destino.

| Estado | O que quer dizer |
| --- | --- |
| Concluída | Os dados foram guardados, e nenhuma execução de fluxo para eles falhou. Não precisa da etapa Enviada. |
| Falhou | Uma execução de fluxo para eles falhou. Abra o **History** do fluxo. |
| Bloqueada | Não se consegue mostrar nenhum dos dois casos. Veja o **History** do fluxo antes de concluir que o tratamento parou. |

## Encontrar uma carga

- **Pesquisar cargas úteis…** encontra o identificador da carga, a origem, o estado ou a etapa.
- **Filtrar**, **Ordenar** e **Colunas** funcionam como em qualquer tabela.
- A página carrega as 200 cargas mais recentes. A pesquisa, os filtros, a ordenação e a paginação só funcionam nessas 200. Não procuram no histórico mais antigo.

## Resolução de problemas

- **A lista está vazia.** Isso não prova que nada chegou. Limpe a pesquisa e os filtros, selecione **Atualizar**, e veja o **History** do fluxo. A Atividade mostra os 100 lotes mais recentes carregados com `openldr ingest`. Para os mais antigos, execute `openldr pipeline status`.
- **Aparece um erro ao carregar.** Selecione **Atualizar** de novo. Se continuar, comunique o erro a um administrador.
- **O painel do ciclo de vida fica a carregar.** Feche-o, selecione **Atualizar** e abra de novo a linha. A página nem sempre distingue um pedido falhado de um lento.
- **Uma carga Falhou.** Abra o fluxo por onde passou, depois **History**, e leia o erro do nó que falhou. Esta página não tem botão para repetir. Siga o procedimento de recuperação do fluxo.

## Como são tratados os eventos em fila

Estas notas são para administradores.

- Cada instância do barramento de eventos trata um gestor de cada vez. Um gestor lento atrasa os eventos seguintes. Mais notificações da fila não lançam mais gestores enquanto um lote corre. Os eventos pendentes esperam por um lote seguinte. Processos de servidor separados podem tratar eventos ao mesmo tempo.
- O processo renova as reservas dos eventos a correr e dos que esperam no seu lote reservado. Um processo de substituição recebe um novo testemunho de reserva. Um processo antigo deixa de poder marcar essa reserva como terminada, falhada ou a repetir.
- Depois de uma falha, uma reserva expirada conta como uma tentativa falhada e pode ser repetida. Os gestores têm de aguentar ser corridos duas vezes: uma falha da base ou um processo em pausa pode deixar outro processo correr o mesmo evento.
- Pare os processos antigos antes de atualizar. Processos sem verificação do testemunho de reserva não dão esta proteção.

## Guias relacionados

- [Fluxos de trabalho](/docs/workflows)
- [Auditoria](/docs/audit)
