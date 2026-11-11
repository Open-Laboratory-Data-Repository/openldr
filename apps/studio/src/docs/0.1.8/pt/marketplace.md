# Marketplace

O **Marketplace** é onde os administradores encontram e instalam extras para o OpenLDR: **plugins** que leem ou enviam dados (um importador de CSV, um leitor HL7 v2, um envio para o DHIS2), **modelos de formulário**, e **pacotes de conteúdo** com dados de referência como sistemas de códigos, um registo de unidades e consultas de relatórios. Tudo vem de um **registo**, uma lista publicada de artefactos. Uma instalação nova tem um, **Default registry**, no GitHub.

Leva cerca de 10 minutos, com acesso de rede ao GitHub. Selecione uma imagem ou um clip para o ampliar.

![Marketplace, Explorar: os artefactos do registo predefinido, com tipo, editor, versão e estado da assinatura.](marketplace-tour.png)

## Quem pode fazer o quê

| Capacidade | O que permite |
| --- | --- |
| **View marketplace** | Abrir Definições, Marketplace, e ver os artefactos disponíveis e instalados |
| **Manage marketplace** | Instalar, ativar, desativar, remover e gerir registos |

## Os três separadores

- **Explorar** lista o que os registos oferecem. **Todos os tipos** filtra por plugin, formulário ou pacote de conteúdo.
- **Instalados (N)** lista o que esta instalação tem, com o estado de cada artefacto.
- **Registos** lista de onde vêm os artefactos.

Cada cartão mostra **Não verificado** até a assinatura ser verificada. Abri-lo verifica a assinatura e o cartão passa a **Verificado**.

## Exemplo 1: ler um plugin antes de o instalar

![Abrir tabular. Os detalhes, permissões e requisitos carregam e passa a Verificado.](marketplace-read.mp4)

1. Abra **Definições** e depois **Marketplace**. **Explorar** está aberto.
2. Selecione **tabular**.

**Resultado esperado:** ao fim de alguns segundos a página mostra **Verificado**, com a descrição **CSV/Excel -> FHIR R4 ingestion plugin (configurable mapping)**. Mostra:

| Campo | Valor |
| --- | --- |
| Entry point | `convert` |
| Checksum (sha256) | a impressão digital do ficheiro, verificada antes de correr |
| Sandbox | WASI enabled |
| Memory limit | 256 MB |
| Time limit | 30000 ms |
| Permissões | `read-input`, `emit-fhir` (Patient, Specimen, Observation) |
| Requisitos | Compatible with CE 0.1.11 |

![Os detalhes de tabular: o que corre, o que pode fazer e do que precisa.](marketplace-read-full.png)

Um plugin corre numa caixa de areia com memória e tempo fixos. As permissões dizem o que pode fazer: `tabular` pode ler o ficheiro que recebe e escrever pacientes, amostras e observações FHIR, mais nada.

## Exemplo 2: instalá-lo

![Abrir o menu, selecionar Instalar, ler as capacidades e aprovar.](marketplace-install.mp4)

1. Na página **tabular**, abra **⋯** e selecione **Instalar**.
2. **Rever e aprovar: tabular** lista a versão e as **Capacidades solicitadas**. Leia-as.
3. Selecione **Aprovar e instalar**.

**Resultado esperado:** o separador mostra **Instalados (1)**, e **tabular** aparece lá como **Ativo**.

![tabular instalado e Ativo.](marketplace-installed.png)

A aprovação vale para as capacidades da versão escolhida. Escolher outra versão volta a fazer a verificação.

## Exemplo 3: removê-lo

![Abrir o plugin instalado, escolher Remover e confirmar.](marketplace-remove.mp4)

1. Em **Instalados**, selecione **tabular**. Abra **⋯**. Oferece **Desativar**, **Remover** e **Voltar**.
2. Selecione **Remover**, e outra vez **Remover** em **Remover tabular?**. Isto desinstala o artefacto desta instalação.

**Resultado esperado:** **Instalados (0)**.

**Desativar** mantém um plugin instalado mas impede-o de carregar. **Rollback**, quando há uma versão mais antiga instalada, volta a ativá-la.

## Registos

![O separador Registos: Default registry, Remoto (HTTP), no GitHub.](marketplace-registry-list.png)

1. Abra o separador **Registos**. **Default registry** é um registo **Remoto (HTTP)** em `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/marketplace/main`.
2. Para adicionar um, abra o menu **⋯** da página e selecione **Adicionar registo**. Preencha **Nome**, **Tipo** e **Localização (URL ou diretório)**, e escolha **Guardar** no menu **⋯** do painel. Feche o painel sem guardar para desistir.

![O painel Adicionar registo.](marketplace-add-registry.png)

Um registo pode ser um endereço web ou uma pasta no servidor. Um laboratório sem Internet pode apontar um registo de pasta para uma cópia do marketplace.

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

Um pacote pode associar códigos de teste do laboratório a testes do catálogo (**Correspondências de testes**). Indica o código LOINC de cada código, e o CE associa-o ao teste do catálogo ligado a esse LOINC. Um código que o pacote não consegue resolver é ignorado e listado: nenhum teste do catálogo tem esse LOINC, ou dois têm. Um código já associado aqui é mantido. A simulação na linha de comandos (`openldr market install <dir> --dry-run`) lista o que associaria, manteria e ignoraria.

Escolha **Desanexar** para esquecer o registo de instalação. Tudo o que o pacote escreveu fica. Não existe desinstalação.

Na linha de comandos, `openldr market install <bundle-dir> --dry-run` executa as verificações e mostra os passos, com quantos códigos cada passo de correspondência de ligações ligaria. Não escreve nada.

## Na linha de comandos

A CLI instala a partir de uma pasta de bundle no servidor, não a partir de um registo.

```bash
./openldr market list
./openldr market verify <bundle-dir>
./openldr market install <bundle-dir> --dry-run
./openldr market disable tabular
./openldr market remove tabular
```

`verify` verifica o manifesto, o ficheiro e a chave do editor de um bundle. `install --dry-run` corre todas as verificações sem escrever nada. `update` só instala um pacote de conteúdo se o bundle for mais recente do que o instalado. `rollback <id> <version>` volta a ativar uma versão mais antiga de um plugin.

## Num telemóvel

O Marketplace funciona num telemóvel. Os cartões empilham-se numa coluna. Na página de um artefacto, os detalhes, permissões e requisitos vêm primeiro, por cima da descrição.

## Resolução de problemas

- **Explorar está vazio.** O registo está inacessível ou desativado. Veja **Registos**, e se o servidor chega ao endereço do registo.
- **O cartão continua Não verificado.** Abra-o. A assinatura é verificada quando os detalhes carregam.
- **As permissões mostram Permissões indisponíveis.** Não foi possível ler os detalhes. Isso não quer dizer que o artefacto não precise de permissões. Instalar continua desativado.
- **A instalação falha.** Veja a compatibilidade, as capacidades e a disponibilidade do registo.
- **Um artefacto instalado não aparece noutro sítio.** Confirme que está ativo e que essa parte da aplicação o suporta.

## Guias relacionados

- [Definições](/docs/settings)
- [Conectores](/docs/connectors)
- [Formulários](/docs/forms)
- [Unidades](/docs/facilities)
