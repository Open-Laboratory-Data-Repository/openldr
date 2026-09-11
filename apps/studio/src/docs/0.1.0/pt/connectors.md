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

## Encerramento do servidor

Com SIGTERM ou SIGINT, a API deixa de aceitar pedidos e para de consultar a fila.
Aguarda os pedidos ativos, o lote já reservado e o ciclo de projeção ativo antes de fechar as respetivas bases de dados.
Sinais repetidos não iniciam outro encerramento.
Um processamento que nunca termina pode bloquear o encerramento indefinidamente.
Reserve tempo suficiente para as importações ativas antes de o gestor de serviços forçar o encerramento.
Após parar o worker, o processamento manual continua disponível. Fechar o contexto termina esse acesso.