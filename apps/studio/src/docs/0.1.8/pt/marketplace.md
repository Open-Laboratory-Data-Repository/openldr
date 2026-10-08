# Marketplace

A criação e a edição de registos abrem um painel lateral. As etiquetas ficam ao lado dos campos. Escolha Salvar no menu ⋯ do painel. Feche o painel sem salvar para descartar as alterações.

O Marketplace permite aos administradores consultar pacotes, permissões e registos.

## Antes de começar

É necessário acesso de administrador. Verifique a origem do pacote antes de o instalar.

![Pacotes disponíveis no Marketplace](marketplace-browse.png)

## Consultar e instalar um pacote

1. Abra **Definições** e depois **Marketplace**.
2. Em **Explorar**, abra os detalhes do pacote.
3. Escolha a versão pretendida.
4. Consulte as permissões, a compatibilidade e a documentação.
5. Abra o menu dos detalhes e escolha **Instalar**.
6. Verifique as permissões no pedido de aprovação antes de confirmar.

![Versão, permissões e documentação do pacote](marketplace-detail.png)

## Compreender as permissões

**A carregar permissões** significa que os detalhes estão a ser obtidos. A instalação permanece desativada.

**Permissões indisponíveis** significa que não foi possível determinar as permissões. Não significa que o pacote não solicita permissões. Saia dos detalhes, verifique a disponibilidade do registo e volte a abrir o pacote.

**Nenhuma permissão especial solicitada** aparece apenas quando os detalhes carregados confirmam uma lista vazia. Para um pacote já instalado sem referência ao registo, as permissões vêm do registo local desse pacote.

Escolher outra versão inicia novamente esta verificação. A aprovação da instalação usa as permissões da versão selecionada. Não concede permissões antes da sua confirmação.

## Gerir pacotes e registos

Em **Instalados**, use o menu do pacote para as ações disponíveis, incluindo ativação, desativação e remoção.

Em **Registos**, abra o menu e escolha **Adicionar registo**. Preencha o nome, o tipo e a localização. Guarde e verifique a linha criada. Pode editar ou desativar o registo na lista.

![Lista e formulário dos registos](marketplace-registries.png)

## Pacotes de conteúdo

Um pacote de conteúdo é um conjunto assinado de dados de referência. Instala, por esta ordem, sistemas de códigos, conjuntos de valores, um registo de unidades, a correspondência de ligações e consultas personalizadas. Um pacote não declara capacidades.

Em **Explorar**, filtre por **Pacote de conteúdo**. Os detalhes de um pacote listam os seus passos com as contagens. A confirmação da instalação mostra a mesma lista. É necessária a permissão para gerir o Marketplace, como nos plugins.

A instalação verifica primeiro cada passo. Um pacote sem assinatura de editor é recusado. Verifica a assinatura e a chave do editor, o hash do ficheiro e a lista de passos. Verifica também que cada consulta é só de leitura (SELECT), que o ficheiro do registo é pré-visualizado sem erros e que o registo não está desativado. Se uma verificação falhar, nada é escrito.

A primeira instalação de um editor fixa a sua chave. Um pacote posterior assinado com outra chave é recusado.

Depois, a instalação aplica os passos por ordem. Se um passo falhar, os passos anteriores ficam escritos. O pacote mostra **Falha no passo N** com o erro no cartão e nos detalhes. Escolha **Instalar novamente** no menu `⋯` para o concluir.

Instalar duas vezes é seguro:

- Os sistemas de códigos e os conjuntos de valores são substituídos pelo URL.
- A origem do registo é reutilizada e as suas linhas são atualizadas pelo código.
- A correspondência de ligações corre outra vez.
- As consultas são substituídas pelo nome. Uma consulta editada por um administrador é substituída quando o pacote é instalado de novo.

As linhas que faltam no registo de um pacote mais recente são assinaladas. Nunca são retiradas.

Um passo de registo pode listar colunas extra. Os seus valores vão para os `extras` de cada unidade, com o nome da coluna em minúsculas. As consultas personalizadas leem-nos na tabela `facility_registry` do armazém. Qualquer outra coluna que o registo não conheça continua a fazer recusar o pacote. Uma versão mais antiga do CE recusa um pacote que liste colunas extra, e não escreve nada.

Escolha **Desanexar** para esquecer o registo de instalação. Tudo o que o pacote escreveu fica. Não existe desinstalação.

Na linha de comandos, `openldr market install <bundle-dir> --dry-run` executa as verificações e mostra os passos, com quantos códigos cada passo de correspondência de ligações ligaria. Não escreve nada.

## Resolver problemas

- Se a instalação falhar, verifique a compatibilidade, as permissões e a disponibilidade do registo.
- Se um pacote não aparecer, verifique se o registo está ativo e acessível.
- Se um pacote instalado não aparecer na aplicação, verifique a ativação e a compatibilidade.

## Guias relacionados

- [Definições](/docs/settings)
- [Conectores](/docs/connectors)
- [Formulários](/docs/forms)
