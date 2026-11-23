# Laboratório

Laboratory guarda o nome, a morada, os contactos e o logótipo do laboratório emissor usados nos modelos de relatório. Também define o registo de unidades predefinido e o fuso horário local.

Use os dados reais e o logótipo aprovado do laboratório. As imagens mostram um laboratório fictício numa instalação de teste. Não precisa de dados de prática. View settings permite abrir a página. Edit general settings permite guardar.

O laboratório emissor produz os relatórios. As unidades enviam os pedidos. Escolher aqui um registo predefinido não cria nem importa unidades.

## Guardar os dados do laboratório

Faça esta tarefa após a instalação ou quando os dados do laboratório emissor mudarem.

### 1. Abrir Settings e Laboratory

Abra o menu do utilizador no canto inferior esquerdo, escolha **Settings** e depois **Laboratory**.

![Abra o menu do utilizador no canto inferior esquerdo.](laboratory-guide-user-menu.png)

![Escolha Settings.](laboratory-guide-settings-menu.png)

![Selecione Laboratory em Settings.](laboratory-guide-laboratory-page.png)

### 2. Introduzir o nome do laboratório

Introduza o nome do laboratório emissor em **Laboratory name**. O exemplo usa `Documentation laboratory`.

![Introduza o nome do laboratório emissor.](laboratory-guide-name.png)

### 3. Introduzir a morada

Introduza em **Address** a morada a imprimir no cabeçalho. Pode ocupar várias linhas.

![Introduza a morada que os modelos de relatório devem imprimir.](laboratory-guide-address.png)

### 4. Introduzir os contactos

Introduza os contactos aprovados em **Contact**. A imagem usa um endereço de email example.invalid.

![Introduza os contactos do laboratório emissor.](laboratory-guide-contact.png)

### 5. Escolher o registo de unidades

Em **Facility register**, selecione uma origem já registada. Se faltar, registe-a primeiro em Facilities. Esta escolha fornece o registo predefinido do formulário Facility.

![Escolha um registo existente. Registe a origem em Facilities se faltar.](laboratory-guide-register.png)

### 6. Definir o fuso horário quando aplicável

Para PostgreSQL ou MySQL, introduza um fuso com nome, como `Africa/Dar_es_Salaam`. Leia a ajuda abaixo do campo. SQL Server exige um nome de fuso Windows em cada execução de relatório. Deixe este campo vazio nesse caso.

![Introduza um fuso com nome para PostgreSQL ou MySQL. Leia a exceção SQL Server abaixo.](laboratory-guide-timezone.png)

### 7. Guardar os dados

Abra os pontos da página no canto superior direito e selecione **Save**.

![Abra o menu de pontos de Laboratory.](laboratory-guide-page-actions.png)

![Escolha Save para guardar as definições do laboratório.](laboratory-guide-save-identity.png)

**Resultado esperado:** os dados guardados permanecem ao reabrir Laboratory.

![A identidade guardada do laboratório permanece após reabrir a página.](laboratory-guide-identity-result.png)

## Remover um logótipo antigo

Faça esta tarefa quando o logótipo atual já não deva aparecer nos modelos que usam o logótipo do laboratório.

### 1. Limpar o logótipo do rascunho

Selecione **Clear** junto a Logo. Isto altera apenas o rascunho.

![Clear remove o logótipo atual do rascunho.](laboratory-guide-clear-logo.png)

### 2. Guardar a remoção

Abra os pontos da página e selecione **Save**.

![Escolha Save para guardar as definições do laboratório.](laboratory-guide-save-clear-logo.png)

**Resultado esperado:** as definições guardadas do laboratório deixam de conter um logótipo.

## Carregar o logótipo do laboratório

Use um ficheiro PNG ou JPEG até 256 KB. Um PNG transparente é útil para um logótipo de cabeçalho.

### 1. Escolher a imagem

Selecione **Choose file…** junto a Logo e escolha a imagem local aprovada.

![Choose file abre a seleção de um ficheiro de imagem.](laboratory-guide-choose-logo.png)

### 2. Verificar a pré-visualização

Confirme que a imagem esperada aparece junto a Logo. A imagem reutiliza a marca fornecida na instalação de teste.

![O PNG escolhido aparece na pré-visualização antes de guardar.](laboratory-guide-logo-preview.png)

### 3. Guardar o logótipo

Abra os pontos da página e selecione **Save**.

![Escolha Save para guardar as definições do laboratório.](laboratory-guide-save-logo.png)

**Resultado esperado:** o logótipo permanece ao reabrir Laboratory. Um modelo de relatório tem de usar as variáveis do laboratório para mostrar estes valores.

![O logótipo guardado permanece ao reabrir Laboratory.](laboratory-guide-logo-result.png)

## Alterar os dados num telemóvel

Use os mesmos campos no telemóvel. A página desloca-se verticalmente.

### 1. Editar os campos de identidade

Introduza o nome do laboratório e os outros dados no formulário adaptado ao telemóvel.

![Os campos de Laboratory cabem na largura do telemóvel.](laboratory-guide-phone-name.png)

### 2. Deslocar até Logo

Desça até à pré-visualização do logótipo e ao controlo Choose file. Guarde pelo menu de pontos da página.

![Desça até Logo. A pré-visualização e os controlos continuam disponíveis.](laboratory-guide-phone-logo.png)

## Usar os dados nos modelos de relatório

Os modelos podem usar `{{lab.name}}`, `{{lab.address}}`, `{{lab.contact}}` e `{{lab.logo}}`. A página mostra estes nomes abaixo da descrição. Coloque-os num modelo com Report Designer. Guardar Laboratory não altera um modelo.

## Prática opcional

Numa instalação de teste, guarde um nome de laboratório fictício e um contacto example.invalid. Reutilize um PNG ou JPEG de teste aprovado para o exercício de carregamento. Depois reponha as definições pretendidas.

## Limites

O logótipo aceita PNG e JPEG até 256 KB. SVG, WebP e endereços web de imagens não são aceites. O seletor de registos lista origens existentes. Não permite registar uma origem.

## Resolução de problemas

**A lista de registos está vazia.** Abra Facilities e registe a origem antes de voltar aqui.

**O fuso horário é recusado.** Use um fuso com nome, sem desvio fixo. Siga a exceção SQL Server indicada abaixo do campo.

**O logótipo é recusado.** Verifique o formato e o tamanho. Escolha um PNG ou JPEG até 256 KB.

**Um relatório não mostra os dados guardados.** Verifique se o modelo usa as variáveis do laboratório.

## Guias relacionados

Leia [Unidades](/docs/facilities) para registar uma origem. Leia [Verificações de configuração](/docs/setup-checks) para avaliar a preparação. Leia [Começar aqui](/docs/start-here) para configurar a linha de comandos.
