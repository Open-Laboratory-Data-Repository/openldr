# Documentação de instalação e desenvolvimento

Use o manual integrado para tarefas no Studio. Consulte a documentação de instalação e desenvolvimento para configurar o servidor, desenvolver a partir do código-fonte e usar a CLI.

Esta página ajuda a encontrar e guardar esses documentos. Não acrescenta um editor de instalação ao Studio nem executa comandos de manutenção. Não precisa de dados de exemplo.

## Encontrar instruções de instalação e desenvolvimento

Pesquise no manual as referências de instalação, CLI ou servidor.

### 1. Abrir Docs

Selecione **Docs** no menu principal.

![Abra Docs no menu principal.](advanced-docs-guide-docs.png)

### 2. Pesquisar o tema

Introduza `Deployment` em Search documentation. Também pode pesquisar um tema mais específico.

![Pesquise a documentação por título ou tema.](advanced-docs-guide-search.png)

### 3. Abrir o guia correspondente

Escolha **Deployment & developer docs**.

![Escolha Deployment & Developer Docs nos resultados.](advanced-docs-guide-guide-link.png)

### 4. Escolher as instruções necessárias

Leia o guia. A instalação, as variáveis de ambiente, o Windows Server, o desenvolvimento e a CLI são temas distintos.

![Leia a entrada de documentação de instalação e desenvolvimento.](advanced-docs-guide-guide.png)

### 5. Seguir a referência do projeto

Use o [site OpenLDR](https://openldr.online/docs) ou o [repositório de código-fonte](https://github.com/Open-Laboratory-Data-Repository/openldr). O repositório contém os ficheiros de instalação e a CLI. Confira as instruções para a versão utilizada.

![Use o site do projeto ou o repositório de código-fonte para os documentos de instalação e desenvolvimento.](advanced-docs-guide-repository.png)

**Resultado esperado:** consegue escolher a documentação adequada sem tratar o manual integrado como uma consola de administração do servidor.

## Guardar as instruções antes da paragem

Guarde as instruções de atualização ou recuperação fora do Studio antes de parar os serviços que fornecem este manual.

### 1. Abrir Download documentation

Selecione o botão de descarga no topo do guia.

![Descarregue um guia antes de colocar o Studio offline.](advanced-docs-guide-download.png)

### 2. Escolher This page

Selecione **This page**. Escolha All docs quando precisar do manual completo.

![Escolha This page apenas para este guia.](advanced-docs-guide-this-page.png)

### 3. Escolher um formato de ficheiro

Selecione Markdown, PDF ou Word. O exemplo testado descarrega **Markdown (.md)**. Guarde o ficheiro onde o consiga ler com o Studio offline.

![Escolha Markdown, PDF ou Word.](advanced-docs-guide-format.png)

**Resultado esperado:** o navegador descarrega uma cópia autónoma do conteúdo escolhido. Uma exportação de documentação não é uma cópia de segurança da base de dados ou dos ficheiros.

## Ler o guia num telemóvel

O manual integrado adapta-se à largura do telemóvel.

### 1. Ler o tema selecionado

Abra o guia e desloque a área de leitura. Use os controlos do cabeçalho para navegar e descarregar.

![Leia o guia à largura de um telemóvel.](advanced-docs-guide-phone.png)

## Escolher o guia adequado

| Tarefa | Guia |
| --- | --- |
| Instalar o OpenLDR ou escolher os requisitos do servidor | Requirements e Install no site. |
| Definir domínios, certificados ou armazenamento externo | [Variáveis de ambiente](/docs/environment) e documentação de instalação. |
| Executar o OpenLDR a partir do código-fonte | Development no site, depois as instruções do repositório para essa versão. |
| Usar comandos de operação | [Começar aqui](/docs/start-here) e documentação da CLI. |
| Alterar o fornecedor de identidade ou o endereço do emissor | [Fornecedores de autenticação](/docs/auth-providers). |
| Atualizar uma instalação existente | [Atualizações planeadas](/docs/upgrading). |
| Configurar o comportamento do Studio | [Definições](/docs/settings). |

## Ler os factos do modelo e das origens

O armazenamento FHIR canónico conserva os recursos clínicos. O armazém projeta-os em tabelas para consultas e relatórios. Os factos ficam vazios quando a origem não os fornece.

Os factos comuns dos pedidos têm colunas tipadas em lab_requests. Os atributos adicionais usam lab_request_attributes com o sistema de códigos request-attribute. São linhas, não colunas específicas de um país. Leia-os através de Custom Queries.

O ficheiro de terminologia `packages/terminology/codesystems/openldr-request-attribute.json` fornece os nomes de apresentação. Importe-o a partir do repositório com `pnpm openldr terminology import resource packages/terminology/codesystems/openldr-request-attribute.json` quando a instalação precisar desses nomes. Os atributos podem existir sem esse dicionário.

Um resultado abaixo ou acima de um limite guarda esse limite em numeric_value e a comparação em numeric_comparator. O estado do resultado e os campos de ausência de dados descrevem resultados cancelados ou indisponíveis. Qualifique status com o alias da tabela correta se a consulta juntar tabelas que também têm colunas status.

O texto livre clinical_info está oculto por predefinição no construtor de painéis. Consulte Data exposure antes de o disponibilizar. O SQL dos conectores tem as permissões próprias da conta da base de dados.

## Hora de chegada e reconstruções do armazém

Use ingest_events quando um relatório pedir a hora de chegada de um recurso clínico ao OpenLDR. Os valores created_at das tabelas projetadas descrevem as escritas de projeção. Não representam cada chegada de versões corrigidas.

`pnpm openldr db reproject --force` reconstrói o armazém a partir dos recursos canónicos, incluindo o registo de chegadas. Reescreve as linhas projetadas e recusa executar sem --force. Planeie o custo e o momento antes de a usar numa instalação grande. O comando antigo terminology reproject está obsoleto e faz a mesma reconstrução completa.

Após uma falha temporária de projeção, as novas tentativas persistentes releem o recurso canónico atual. Cada ciclo repete até 100 recursos em fila e continua as novas alterações. As falhas repetidas esperam mais, até cinco minutos. Uma dependência recuperada pode permitir a repetição sem intervenção. A reconstrução completa continua a ser uma operação de manutenção separada.

## Limites das verificações

As capturas vêm do manual integrado real. A exportação Markdown foi descarregada e inspecionada. As verificações de navegação não executaram a instalação externa, a configuração do Windows Server, a compilação do código-fonte ou comandos destrutivos de manutenção.

Para alterar uma instalação, siga a documentação da versão e verifique os serviços afetados. Um link no Studio não prova que uma operação externa foi testada no seu servidor.

## Resolução de problemas

**Um guia não aparece na pesquisa.** Confira o idioma e a versão atuais da documentação e pesquise pelo título ou tema.

**A descarga contém o guia errado.** Abra o guia pretendido e escolha This page em Download documentation.

## Guias relacionados

[Começar aqui](/docs/start-here), [Variáveis de ambiente](/docs/environment), [Fornecedores de autenticação](/docs/auth-providers) e [Atualizações planeadas](/docs/upgrading).
