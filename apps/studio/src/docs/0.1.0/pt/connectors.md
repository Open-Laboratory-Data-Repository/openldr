# Conectores

Um conector guarda a configuração de uma ligação externa. Os nós de workflow selecionam o conector pelo nome. Os segredos são encriptados e deixam de ser apresentados após a gravação.

## Criar um conector

![Lista de conectores](connectors-list.png)

1. Abra **Definições → Conectores**.
2. Abra o menu **⋯** da página e escolha **Adicionar conector**.
3. Introduza um **Nome** reconhecível nos nós de workflow.
4. Escolha a **Categoria**. O valor inicial, **Plugin**, exige um plugin de saída instalado. Para uma base de dados, servidor de correio ou servidor de ficheiros, escolha **Anfitrião**.
5. Para Anfitrião, selecione o serviço em **Tipo de base de dados**. Este seletor também inclui serviços de correio e de ficheiros. Para Plugin, selecione o plugin de saída instalado.
6. Preencha os campos de ligação do serviço e escolha **Salvar**.
7. Confirme a notificação com o nome e a nova linha. O conector começa ativado. O formulário de criação não permite escolher o estado Ativado.
8. Para o desativar, desligue **Ativado** na lista. Também pode escolher **Editar** no menu **⋯** da linha, desligar Ativado e salvar.
9. No menu **⋯** da linha, escolha **Testar** para verificar a ligação a partir do servidor OpenLDR.
10. Selecione o conector ativado num nó de workflow compatível quando pretender utilizá-lo.

![Formulário de configuração do conector](connector-form.png)

## Escolher a categoria

Se Plugin não apresentar plugins de saída, escolha Anfitrião para um serviço integrado. Para um destino fornecido por um plugin, instale primeiro esse plugin no [Marketplace](/docs/marketplace).

O endereço e a porta devem estar acessíveis a partir do servidor OpenLDR. No Docker, use o endereço acessível a partir do contentor, que pode ser diferente do endereço usado no seu computador.

A gravação confirma que a configuração foi guardada. Use Testar para verificar a ligação. Se o conector não aparecer num nó, verifique se está ativado e se é compatível com esse nó.

## Guias relacionados

- [Workflows](/docs/workflows)
- [Relatórios agendados](/docs/report-pipeline)
- [Definições](/docs/settings)
- [Marketplace](/docs/marketplace)

## Limite de tempo das consultas

As consultas dos conectores PostgreSQL e MySQL têm um limite de execução de 30 segundos. Uma consulta lenta falha em vez de bloquear o workflow ou o relatório indefinidamente. O PostgreSQL cancela a consulta no servidor. O MySQL usa uma segunda ligação com as mesmas credenciais para terminar a ligação da consulta. O cancelamento pode demorar mais um segundo. A ligação inicial tem um limite separado de 30 segundos.

Se uma consulta ultrapassar este limite, reduza o intervalo de datas ou ajuste os filtros e verifique o plano de execução. Tente novamente depois de corrigir a consulta. O formulário do conector não tem um campo para alterar este limite.

Se o erro indicar `server cancellation failed`, o OpenLDR fechou a ligação local sem confirmar o cancelamento no servidor. Peça ao administrador para verificar as consultas ativas. A conta MySQL deve poder abrir outra ligação e terminar as suas próprias sessões.
