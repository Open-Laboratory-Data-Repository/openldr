# Definições

**Definições** reúne as escolhas que um administrador faz uma vez para toda a instalação e depois raramente muda: a versão e a verificação de atualizações, os indicadores de funcionalidades, os limites, o cabeçalho dos relatórios, a sincronização, os conectores, o marketplace, as funções e as colunas extra que o Builder dos painéis pode oferecer.

Este guia cobre a página **Geral** e aponta para o guia de cada outra página. Leva cerca de 5 minutos.


## Quem pode fazer o quê

Cada página de Definições tem a sua própria capacidade. Uma página para a qual não tem a capacidade não aparece no menu lateral.

| Capacidade | O que abre em Geral |
| --- | --- |
| **View settings** | Abre Definições, Geral e Laboratório. Mostra o cartão **Sobre** |
| **Edit general settings** | O interruptor **Verificação automática de atualizações**, **Limites e afinação**, **Validação de dados**, e guardar a página Laboratório |
| **Manage feature flags** | O cartão **Indicadores de funcionalidades** |
| **Danger zone** | As três ações de reposição. Dê-a ao menor número de pessoas possível |

Um cartão para o qual não tem a capacidade não aparece.

## As páginas de Definições

| Página | Para que serve | Guia |
| --- | --- | --- |
| Geral | Versão, verificação de atualizações, indicadores, limites, zona de perigo | Esta página |
| Laboratório | Cabeçalho de todos os relatórios, registo de unidades predefinido, fuso horário | [Laboratório](/docs/laboratory) |
| Notificações | As notificações que recebe | Ainda sem guia |
| Sites | Os sites para os quais esta instalação reporta | Ainda sem guia |
| Sincronização distribuída | Ligar um laboratório a um servidor central. O separador **Definições** configura a ligação e a direção. O separador **Atividade** mostra o estado ao vivo e os eventos recentes | [Sincronização distribuída](/docs/sync) |
| Conectores | Bases de dados externas e integrações fornecidas por plugins | [Conectores](/docs/connectors) |
| Marketplace | Procurar artefactos instaláveis, gerir registos, rever pacotes instalados | [Marketplace](/docs/marketplace) |
| Funções | Funções baseadas em capacidades e as funções de sistema incluídas | [Funções](/docs/roles) |
| Exposição de dados | As colunas extra que o Builder dos painéis pode oferecer | [Exposição de dados](/docs/data-exposure) |

As definições lidas no arranque do servidor, como o endereço público, TLS, a base de dados, o armazenamento e os segredos, não estão aqui. Veja [Variáveis de ambiente](/docs/environment).

Este manual cobre as páginas acima. Uma página de definições que não esteja aqui fica fora do âmbito atual da documentação integrada.

## Versão e verificação de atualizações

1. Abra **Definições**. Abre em **Geral**.
2. Leia o cartão **Sobre**. **Versão** é o que esta instalação executa. A linha por baixo, **Versão mais recente**, diz em que ponto está essa versão.
3. Leia **Última verificação** por baixo do interruptor **Verificação automática de atualizações** para saber a idade dessa resposta.

**Resultado esperado numa instalação nova:** o seu número de versão seguido de *atualizado*, ou *ainda não verificado* se a instalação arrancou há menos de um dia sem rede.

A linha **Versão mais recente** tem uma de seis formas:

| Mostra | Significado |
| --- | --- |
| uma versão e *atualizado* | Executa a versão mais recente |
| uma versão mais nova, a data de publicação e **Notas da versão** | Existe uma atualização. Segue-se uma ligação para o [procedimento de atualização planeada](/docs/upgrading) |
| *nenhuma atualização encontrada* | A última verificação viu uma versão mais antiga do que a sua. Veja abaixo |
| *verificação de atualizações desativada* | **Verificação automática de atualizações** está desligada |
| *não é possível confirmar* | A última verificação falhou, ou não foi possível ler a versão em execução |
| *ainda não verificado* | Não houve nenhuma verificação desde o arranque |

*Nenhuma atualização encontrada* quer dizer que a última verificação bem-sucedida viu uma versão **mais antiga** do que a que executa. Por isso não tem nada para dizer. **Neste caso não aparece nenhum número de versão, de propósito.** Um número inferior ao seu não pede nenhuma ação, e lê-lo como um convite para voltar atrás seria um erro.

Isto acontece quando atualiza pouco depois de uma publicação. A verificação corre uma vez por dia, e a resposta em cache é anterior à sua versão. Corrige-se na verificação seguinte, ou logo se reiniciar o contentor api.

### O que faz a verificação

A verificação está **ligada por predefinição**. Uma vez por dia transfere um pequeno ficheiro do GitHub, com um limite de 10 segundos para esse único pedido, e compara números de versão. Nunca transfere uma imagem e nunca reinicia nada. Atualizar é sempre algo que faz por si.

**O que envia:** um pedido web normal por um ficheiro público. Nenhum nome de site, nenhuma versão, nenhum identificador. Como em qualquer pedido web, o servidor que responde vê o endereço IP da sua rede e a hora do pedido.

**Para a desligar,** desligue **Verificação automática de atualizações**. A instalação deixa de fazer qualquer pedido para fora, e a linha da versão mostra só o que executa. Um laboratório sem Internet pode deixá-la ligada. Uma falha é silenciosa, e a última resposta conhecida é mantida. Não há opção na linha de comandos para isto. É uma definição só do studio.

**Na linha de comandos,** `openldr update check` mostra a mesma informação:

```bash
./openldr update check
```

Sai com **1** quando existe uma atualização e com **0** em todos os outros casos, incluindo uma verificação falhada ou não confirmada. O código 1 quer dizer "existe uma atualização", não um erro, por isso um script pode agir logo. O código **2** só aparece quando a verificação nem conseguiu correr, por exemplo com a base de dados inacessível. Assim uma verificação avariada nunca parece uma versão nova.

## Ligar os widgets SQL

Os widgets de painel escritos em SQL estão desligados numa instalação nova. Ligue-os quando alguém precisar, como em [Painéis, Exemplo 5](/docs/dashboard#exemplo-5-um-widget-escrito-em-sql).

1. Em **Geral**, encontre **Indicadores de funcionalidades**.
2. Ligue **SQL bruto no painel**. Aparece a mensagem **Guardado**. A alteração tem efeito imediato, sem reiniciar.

**Resultado esperado:** o editor de widgets dos Painéis passa a oferecer SQL. Desligue-o e os widgets SQL deixam de correr. As consultas guardadas e aprovadas continuam a correr com ele desligado.

O mesmo na linha de comandos:

```bash
./openldr settings flags list
./openldr settings flags set dashboard.raw_sql true
```

## Indicadores de funcionalidades

| Indicador | Chave na linha de comandos | Predefinição | O que faz |
| --- | --- | --- | --- |
| SQL bruto no painel | `dashboard.raw_sql` | Desligado | Deixa os widgets correr SQL só de leitura no armazém PostgreSQL, MySQL ou SQL Server. O nó **SQL Query** dos fluxos de trabalho também precisa dele |
| Gatilhos de escuta de fluxo de trabalho | `workflow.listeners_enabled` | Ligado | Corre os gatilhos de escuta (Postgres LISTEN, leitura de e-mail IMAP). Desligado, para todos os ouvintes na verificação seguinte |
| Publicar conjuntos de dados de fluxo de trabalho | `workflow.dataset_publish_enabled` | Desligado | Publica os conjuntos de dados dos fluxos como tabelas reais no armazém Postgres, para o nó SQL e os painéis os poderem consultar |

## Limites e afinação

Estes valores mudam logo, sem reiniciar. Um valor fora do intervalo permitido passa para o limite mais próximo.

| Limite | Chave na linha de comandos | Predefinição | Intervalo permitido |
| --- | --- | --- | --- |
| Tempo limite de SQL do painel (ms) | `dashboard.sql_timeout_ms` | 5000 | 100 a 600000 |
| Limite de linhas de SQL do painel | `dashboard.sql_row_cap` | 10000 | 1 a 1000000 |
| Carga máxima do marketplace (bytes) | `marketplace.max_payload_bytes` | 67108864 (64 MB) | 1024 a 536870912 |

O limite de linhas age de duas formas. O SQL bruto devolve no máximo esse número de linhas. Uma consulta do Builder conta primeiro os seus grupos na base de dados, e devolve um erro se houver mais do que o limite.

```bash
./openldr settings numbers list
./openldr settings numbers set dashboard.sql_timeout_ms 10000
```

## Zona de perigo

O fundo de **Geral** tem ações que não se podem desfazer. Só tocam na base de dados interna. Os dados do armazém e as contas do Keycloak nunca são tocados.

| Ação | O que faz | Linha de comandos |
| --- | --- | --- |
| Validação de dados | Define o rigor da verificação dos dados laboratoriais recebidos: Baixo, Médio ou Alto. Mais baixo guarda dados incompletos. Mais alto pode recusar dados que antes eram aceites | `./openldr settings validation set medium` |
| Repor painéis | Elimina todos os painéis e recria o exemplo | `./openldr settings danger reset-dashboards --force` |
| Limpar registo de auditoria | Elimina todos os eventos de auditoria e o histórico de execuções de fluxos | `./openldr settings danger clear-audit --force` |
| Redefinição de fábrica | Apaga a base interna (formulários, conectores, painéis, fluxos, terminologia, utilizadores, auditoria) e recria as predefinições | `./openldr settings danger factory-reset --force` |

No studio, cada reposição pede que escreva uma frase antes de correr. Na linha de comandos, cada uma recusa correr sem `--force`.

## Num telemóvel

Num ecrã estreito, a lista de páginas de Definições passa para uma fila no topo. Deslize-a para o lado para chegar às últimas páginas, como **Exposição de dados**.

## Resolução de problemas

- **Falta uma página no menu lateral.** A sua função não tem a capacidade dela. Peça a um administrador que veja a sua função em [Funções](/docs/roles).
- **Falta um cartão em Geral.** A sua função não tem a capacidade dele. Veja a tabela em Quem pode fazer o quê.
- **A linha Versão mais recente diz *não é possível confirmar*.** A instalação não chegou ao GitHub, ou a versão em execução não se leu. Nada mais é afetado.
- **Um limite ficou guardado com outro número.** Estava fora do intervalo permitido e passou para o limite mais próximo.
- **Os widgets SQL continuam a recusar correr.** Confirme que **SQL bruto no painel** está ligado. Depois confirme que a consulta do widget é só de leitura.

## Guias relacionados

- [Laboratório](/docs/laboratory)
- [Exposição de dados](/docs/data-exposure)
- [Funções](/docs/roles)
- [Sincronização distribuída](/docs/sync)
- [Conectores](/docs/connectors)
- [Marketplace](/docs/marketplace)
- [Variáveis de ambiente](/docs/environment)
- [Atualizações planeadas](/docs/upgrading)
