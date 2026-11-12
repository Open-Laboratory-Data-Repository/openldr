# Marketplace

Use Marketplace para rever e instalar plugins, modelos de formulário, relatórios e pacotes de conteúdo. Os pacotes vêm de registos, listas de ficheiros fornecidas por um editor.

**View marketplace** permite consultar pacotes disponíveis e instalados. **Manage marketplace** permite instalar, desativar, remover e gerir registos.

Comece pelo registo aprovado pela organização. Uma instalação nova inclui Default registry no GitHub. O servidor tem de chegar a esse registo para ler os pacotes.

As imagens usam um plugin de destino de treino assinado de um registo local de prática. Siga as mesmas tarefas com o pacote aprovado. Não precisa dos exemplos da documentação. A configuração de prática opcional está no fim.

## Encontrar o pacote

Verifique a origem e a finalidade antes de escolher um pacote. Instalar um plugin concede as capacidades declaradas.

### 1. Abrir Marketplace

Abra **Settings** e depois **Marketplace**.

![Abra Settings e depois Marketplace.](marketplace-guide-open.png)

### 2. Escolher Browse

Use **Browse** para ver pacotes dos registos ativados.

![Browse lista os pacotes oferecidos pelos registos ativados.](marketplace-guide-browse.png)

### 3. Pesquisar o pacote

Introduza o identificador do pacote em Search. O exemplo fictício de prática usa `test-sink`.

![Pesquise pelo identificador do pacote.](marketplace-guide-search.png)

### 4. Escolher um tipo se for útil

Use **All types** para limitar a lista a plugins, modelos de formulário, relatórios ou pacotes de conteúdo.

![Filtre por tipo quando precisar de um plugin, formulário, relatório ou pacote de conteúdo.](marketplace-guide-filter.png)

### 5. Verificar o cartão

Leia o identificador, a versão, o editor e o registo. Abra o cartão do pacote certo.

![Leia o identificador, a versão, o editor e o registo do pacote.](marketplace-guide-card.png)

**Resultado esperado:** abre o detalhe do pacote. A abertura obtém a informação necessária às verificações de assinatura, permissões e compatibilidade.

## Ler o pacote antes de instalar

A verificação de assinatura confirma se o ficheiro corresponde à chave do editor. Decida se confia nesse editor e nas ações do pacote.

### 1. Verificar a assinatura

Leia **Verified** ou a falha de verificação. Um cartão remoto ainda não aberto pode mostrar Unverified até os detalhes carregarem.

![Abrir os detalhes verifica a assinatura do editor.](marketplace-guide-signature.png)

### 2. Ler a descrição

Leia o que o pacote faz e a configuração necessária. Este pacote de treino não tem um destino real.

![Leia a descrição do pacote antes de instalar.](marketplace-guide-readme.png)

### 3. Ler permissões e requisitos

Verifique o editor, a versão selecionada, as permissões e a compatibilidade. Loading permissions ou Permissions unavailable não significa que não pede permissões. Espere pelos detalhes confirmados.

![Leia a versão selecionada, as permissões e a compatibilidade.](marketplace-guide-permissions.png)

**Resultado esperado:** Install fica disponível apenas quando a versão selecionada passa as verificações exigidas. Selecionar outra versão reinicia as verificações.

## Aprovar e instalar um pacote

Faça esta tarefa apenas depois de rever o pacote selecionado e as capacidades.

### 1. Escolher Install

Abra os pontos do detalhe do pacote e selecione **Install**.

![Escolha Install após rever os detalhes.](marketplace-guide-install.png)

### 2. Rever a aprovação

Verifique a versão e **Requested capabilities**. Um pacote de conteúdo mostra as etapas incluídas em alternativa.

![Reveja a versão e as capacidades pedidas antes de aprovar.](marketplace-guide-consent.png)

### 3. Aprovar esta instalação

Selecione **Approve & install** para avançar. Cancel fecha a aprovação sem instalar.

![Approve & install autoriza apenas esta instalação revista.](marketplace-guide-approve.png)

### 4. Verificar Installed

Use os pontos do detalhe e Back, depois escolha **Installed**. Verifique o identificador instalado e o estado Active.

![Installed lista o plugin guardado com o estado ativo.](marketplace-guide-installed.png)

**Resultado esperado:** o pacote está instalado nesta instância OpenLDR. A instalação não configura todas as dependências externas nem prova que o plugin importa os seus dados.

## Desativar ou ativar um plugin instalado

Desativar mantém os ficheiros e o registo instalado. Impede o carregamento do plugin.

### 1. Escolher Disable

Em Installed, abra o plugin. Abra os pontos e selecione **Disable**.

![Disable mantém o plugin instalado, mas impede o carregamento.](marketplace-guide-disable.png)

### 2. Ativar novamente quando adequado

Depois de desativar, abra os mesmos pontos dos detalhes e selecione **Enable**. A ação muda após cada alteração bem-sucedida; pode manter os detalhes abertos.

![Enable permite voltar a carregar o plugin instalado.](marketplace-guide-enable.png)

**Resultado esperado:** o plugin instalado pode voltar a carregar quando ativado. Isto não altera as definições de ligações externas.

## Remover um plugin instalado

Verifique os workflows e as importações dependentes antes de remover um plugin.

### 1. Escolher Remove

Abra os pontos do detalhe do plugin instalado e selecione **Remove**.

![Remove desinstala este plugin.](marketplace-guide-remove.png)

### 2. Confirmar o identificador do plugin

Na confirmação, escolha **Remove** para desinstalar ou Cancel para manter. A captura de prática remove test-sink.

![Confirme o identificador antes de remover o plugin.](marketplace-guide-remove-confirm.png)

**Resultado esperado:** o plugin removido já não está instalado. O cartão do registo pode continuar a aparecer em Browse.

## Adicionar um registo

Use o URL do registo ou a pasta do servidor fornecidos pela organização. Uma pasta de registo local contém diretórios de pacotes. Tem de estar acessível ao servidor OpenLDR.

### 1. Abrir Registries

Escolha o separador **Registries**. Verifique as origens existentes antes de criar um duplicado.

![Registries lista as origens dos pacotes.](marketplace-guide-registries.png)

### 2. Escolher Add registry

Abra os pontos da barra de separadores e selecione **Add registry**.

![Escolha Add registry nos pontos da barra de separadores.](marketplace-guide-add-registry.png)

### 3. Dar nome à origem

Introduza um **Name** útil. O exemplo usa Example local registry.

![Use um nome que identifique o dono do registo.](marketplace-guide-registry-name.png)

### 4. Escolher o tipo

Escolha **Local directory** para uma pasta no servidor da API ou **Remote (HTTP)** para um registo web.

![Um registo local é uma pasta no servidor OpenLDR.](marketplace-guide-registry-type.png)

### 5. Introduzir a localização

Preencha **Location** com a pasta do servidor ou o URL base do registo. A imagem usa uma pasta de prática isolada.

![Introduza a pasta visível para o servidor da API, não a do portátil.](marketplace-guide-registry-location.png)

### 6. Guardar a origem

Abra os pontos do painel e selecione **Save**.

![Save adiciona o registo.](marketplace-guide-registry-save.png)

**Resultado esperado:** o registo ativado aparece na lista. Os pacotes disponíveis aparecem em Browse. Uma pasta do portátil não fica automaticamente visível para um servidor ou contentor.

![O registo local aparece na lista e está ativado.](marketplace-guide-registry-saved.png)

## Alterar um registo

Um registo desativado deixa de fornecer pacotes disponíveis. Não desinstala os pacotes já instalados.

### 1. Escolher Edit

Abra os pontos da linha do registo e selecione **Edit**.

![Edit altera o nome, o tipo, a localização ou a ativação de um registo.](marketplace-guide-registry-edit.png)

### 2. Verificar as definições e Enabled

Atualize o nome, o tipo, a localização ou o estado Enabled. Guarde pelos pontos do painel. Feche sem Save para descartar alterações.

![Verifique a localização guardada e Enabled antes de alterar um registo.](marketplace-guide-registry-settings.png)

## Rever pacotes num telemóvel

Os mesmos separadores e ações estão disponíveis no telemóvel.

### 1. Ler um cartão de pacote

Pesquise em Browse e abra o cartão certo. Os cartões ficam empilhados verticalmente.

![Os cartões de Browse ficam empilhados na largura do telemóvel.](marketplace-guide-phone.png)

### 2. Rever a versão e as permissões

Leia os detalhes acima da descrição e desça para as restantes secções.

![A versão e as permissões aparecem antes da descrição no telemóvel.](marketplace-guide-phone-details.png)

## Pacotes de conteúdo e outros tipos de pacote

Um pacote de conteúdo aplica as etapas declaradas de dados de referência por ordem. Reveja a lista e as contagens antes de instalar. Pode atualizar sistemas de códigos, conjuntos de valores, unidades, associações e consultas com nome. Uma nova tentativa pode substituir uma consulta alterada localmente.

Se um pacote falhar durante a aplicação, as etapas anteriores podem ficar guardadas. Leia Failed at step N e o erro, corrija a causa e escolha Install novamente. Um pacote recusa assinaturas inválidas e verificações prévias com falha antes de escrever.

**Detach** esquece o registo de um pacote ou modelo de formulário instalado, mantendo os dados criados. Não é uma desinstalação. Os plugins oferecem Remove. Uma versão antiga de plugin instalada pode oferecer Rollback. Estas opções dependem do tipo selecionado e das versões instaladas.

Um pacote cujos detalhes não carregam mantém a instalação desativada. Verifique a disponibilidade do registo antes de repetir. O teste documentado exercitou o percurso de plugin. Não aplicou pacotes de conteúdo nem reverteu uma versão antiga de plugin.

## Usar um pacote local pela CLI

Siga [Começar aqui](/docs/start-here) para configurar a CLI. Em `openldr_ce`, a instalação pela CLI lê um diretório de pacote no servidor. Não consulta a lista de registos do Studio. Verifique e simule antes de aplicar um pacote aprovado.

```shell
pnpm openldr market list
pnpm openldr market verify <bundle-directory>
pnpm openldr market install <bundle-directory> --dry-run
pnpm openldr market install <bundle-directory>
pnpm openldr market disable <plugin-id>
pnpm openldr market remove <plugin-id>
```

## Prática opcional com um destino de treino local

Use registos e pacotes aprovados no trabalho normal. O [manifesto de prática](https://openldr.online/docs-samples/user-guide/marketplace/manifest.json) opcional pertence a um pacote de treino assinado. Não tem dados clínicos e não envia nada para um destino real.

Numa cópia do código numa instalação temporária, `pnpm build:test-sink` e `pnpm make:docs-marketplace-bundle` criam o pacote de treino do repositório. Use a pasta gerada nesse servidor como registo local. As raízes locais contêm diretamente os diretórios dos pacotes. O formato do índice HTTP é diferente.

As imagens usam uma pasta de prática gerada separada. Não trate a chave do editor de teste como uma decisão de confiança para produção.

## Resolução de problemas

**Browse está vazio.** Limpe Search e o filtro de tipo. Verifique os registos ativados e o acesso da API à pasta ou URL. Use os pontos da barra de separadores e Refresh após alterar origens.

**Falta um pacote local.** Aponte o registo para o diretório cujos filhos imediatos são diretórios de pacotes legíveis, cada um com manifesto e conteúdo.

**Permissions unavailable.** Não foi possível obter os detalhes do pacote. Isto não prova uma lista de permissões vazia.

**A aprovação continua aberta após um erro.** Leia a notificação. Corrija os requisitos indicados de armazenamento, compatibilidade, assinatura ou outros antes de repetir.

**Um plugin está instalado, mas falta noutro local.** Confirme que está ativado e declara o importador, a página ou a capacidade esperada. Para cartões e painéis, veja [Cartões e painéis de plugins](/docs/plugin-sites).

## Guias relacionados

[Conectores](/docs/connectors) explica os destinos dos plugins. [Formulários](/docs/forms) explica a edição de formulários. [Cartões e painéis de plugins](/docs/plugin-sites) explica os locais opcionais dos plugins.
