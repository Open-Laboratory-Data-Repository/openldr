# Conectores

Um **conector** é uma ligação guardada a outro sistema: uma base de dados, um servidor de e-mail, um servidor de ficheiros, ou um destino fornecido por um plugin instalado. Os nós dos fluxos de trabalho, as consultas personalizadas e os relatórios usam um conector **pelo nome**. Nenhum deles guarda palavras-passe. O servidor fornece-a quando o trabalho corre.

Leva cerca de 15 minutos. Selecione uma imagem ou um clip para o ampliar.

![Definições, Conectores numa instalação nova: um conector, Target Warehouse (Postgres).](connectors-tour.png)

## Quem pode fazer o quê

Uma só capacidade cobre esta página: **Manage connectors**. Sem ela, Conectores não aparece em Definições. A função incluída **Administrator** tem-na.

## O que tem uma instalação nova

Um conector, **Target Warehouse (Postgres)**. Aponta para o armazém do laboratório, a base de dados onde o OpenLDR escreve os dados laboratoriais. Os relatórios incluídos e as consultas personalizadas leem através dele. Não o remova.

A lista mostra de cada conector o **Nome**, o **Tipo**, o **Host permitido do plugin** e um interruptor **Ativado**. **Host permitido do plugin** é o único host de rede que um conector de plugin pode alcançar. Não é o endereço de ligação guardado, e os conectores de anfitrião deixam-no vazio. Abra **Editar** para ver o endereço de um conector de anfitrião.

## Exemplo 1: testar o conector do armazém

![Abrir o menu da linha Target Warehouse e selecionar Testar. Aparece Ligação OK.](connectors-test.mp4)

1. Abra **Definições** e depois **Conectores**.
2. Na linha **Target Warehouse (Postgres)**, abra o menu **⋯** e selecione **Testar**.

**Resultado esperado:** **Ligação OK** por baixo do menu da linha. O teste corre a partir do servidor OpenLDR, não do seu navegador. Prova assim que o servidor chega à base de dados.

Cada teste fica registado na [Auditoria](/docs/audit) como `connector.test`, com o resultado.

## Exemplo 2: adicionar um conector só de leitura para relatórios

Um relatório ou uma consulta personalizada precisa de ler os dados, não de os mudar, e raramente precisa do nome dos pacientes. Dê-lhe uma conta de base de dados que só lê as tabelas de que precisa. Assim, nem uma consulta errada pode mudar dados ou ler o nome de um paciente.

Este exemplo cria uma conta que lê pedidos, resultados, amostras, relatórios e unidades, mas não pacientes.

### Criar a conta na base de dados

No servidor, com o utilizador que corre o OpenLDR, execute isto a partir da pasta da instalação. Troque a palavra-passe pela sua.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U openldr -d openldr_target <<'SQL'
CREATE ROLE report_reader LOGIN PASSWORD 'choose-a-strong-password';
GRANT CONNECT ON DATABASE openldr_target TO report_reader;
GRANT USAGE ON SCHEMA public TO report_reader;
GRANT SELECT ON lab_requests, lab_results, specimens, diagnostic_reports, facilities TO report_reader;
SQL
```

### Adicionar o conector

![Adicionar Warehouse (read only): Anfitrião, Postgres, o endereço, a base de dados, o utilizador e a palavra-passe, depois Guardar e Testar.](connectors-add.mp4)

1. Em **Conectores**, abra o menu **⋯** da página e selecione **Adicionar conector**.
2. Em **Nome**, escreva `Warehouse (read only)`. É o nome que se escolhe nos nós dos fluxos e nas consultas.
3. Defina **Categoria** como **Anfitrião**. Deixe **Plugin** para destinos fornecidos por um plugin instalado.
4. Defina **Tipo de base de dados** como **Postgres**.
5. Preencha a ligação:

   | Campo | Valor |
   | --- | --- |
   | Host | `postgres` |
   | Porta | `5432` |
   | Base de dados | `openldr_target` |
   | Utilizador | `report_reader` |
   | Palavra-passe | a palavra-passe que escolheu |

6. Abra o menu **⋯** do painel e selecione **Guardar**. Aparece **Warehouse (read only) guardado**, e a linha nova. Começa ativada.
7. Na linha dele, abra **⋯** e selecione **Testar**.

**Resultado esperado:** **Ligação OK**.

O clip foi feito numa instalação de desenvolvimento, onde a base de dados está em `localhost` porta `5433`. Numa instalação normal, o servidor chega a ela em `postgres` porta `5432`, como na tabela.

### Ver o que consegue ler, e o que não consegue

![Uma consulta em Warehouse (read only): 60 pedidos, depois a tabela patients recusada.](connectors-readonly-query.mp4)

1. Abra **Consulta** e abra um separador novo. Veja [Consultas personalizadas, Exemplo 2](/docs/query#exemplo-2-escrever-uma-consulta).
2. Escolha o conector **Warehouse (read only)**.
3. Escreva `SELECT COUNT(*) AS orders FROM lab_requests` e selecione **Executar**.
4. Troque por `SELECT COUNT(*) AS patients FROM patients` e selecione **Executar**.

**Resultado esperado:** a primeira consulta devolve **60**, os pedidos do exemplo. A segunda falha. Aparece uma marca vermelha à esquerda do conector. Aponte para ela para ler **permission denied for table patients**. A tabela por baixo mantém o último resultado que funcionou, por isso veja a marca, não a tabela. A conta não consegue ler nomes de pacientes, seja qual for a consulta.

![A mensagem da marca vermelha: permission denied for table patients.](connectors-readonly-denied.png)

É assim que se mantêm colunas privadas nos caminhos dos conectores. A [Exposição de dados](/docs/data-exposure) não cobre os conectores.

## Exemplo 3: mudar uma palavra-passe

Quando a palavra-passe de uma base de dados muda, atualize o conector. Aqui a palavra-passe de `report_reader` muda primeiro, por isso o conector deixa de funcionar até ser atualizado.

1. Mude a palavra-passe na base de dados:

   ```bash
   docker compose -f docker-compose.prod.yml exec -T postgres psql -U openldr -d openldr_target \
     -c "ALTER ROLE report_reader PASSWORD 'the-new-password'"
   ```

2. Teste outra vez **Warehouse (read only)**. Falha com **Falha no teste: password authentication failed for user "report_reader"**, porque o conector ainda tem a palavra-passe antiga.

![O teste a falhar depois da mudança de palavra-passe.](connectors-test-failed.png)

![Editar o conector, escrever a palavra-passe nova, guardar e testar outra vez.](connectors-rotate.mp4)

3. Na linha dele, abra **⋯** e selecione **Editar**. **Palavra-passe** está vazia e mostra **••• definido (deixe em branco para manter)**. A palavra-passe antiga nunca é mostrada.
4. Escreva a palavra-passe nova em **Palavra-passe**. Deixe os outros campos como estão.
5. Abra o menu **⋯** do painel e selecione **Guardar**.
6. Teste outra vez.

**Resultado esperado:** **Ligação OK**. Os fluxos, consultas e relatórios que usam o conector apanham a palavra-passe nova na próxima execução. Não é preciso mudar mais nada.

## Como os fluxos de trabalho usam conectores

Um nó **Postgres**, **MySQL** ou **Microsoft SQL**, ou um nó **Send Email**, mostra uma lista de conectores, não campos de palavra-passe. A lista é filtrada por tipo:

- Um nó **Postgres** só lista conectores Postgres.
- Um nó **Send Email (SMTP)** só lista conectores SMTP.

Por isso crie primeiro o conector, depois abra o nó e escolha-o. Se um conector não aparece na lista de um nó, é do tipo errado ou está desativado.

**O tipo do conector define o dialeto SQL.** O nome do nó é só um nome. O dialeto vem do conector ligado, por isso escolha um cujo tipo corresponda à sua base de dados real.

Veja [Fluxos de trabalho](/docs/workflows) para um exemplo completo com o conector do armazém.

## Segurança

- As palavras-passe e os tokens são encriptados em repouso com a chave de encriptação do servidor. Depois de guardados, nunca mais são mostrados.
- Para mudar um segredo, edite o conector, escreva o novo, salve e teste, como no Exemplo 3. Deixe um segredo em branco para manter o guardado.
- Desligue **Ativado** para impedir qualquer uso de um conector, sem o apagar.
- **Remover**, no menu da linha, apaga o conector e os segredos guardados. Tudo o que apontava para ele falha até o apontar para outro.
- Dê a cada conector uma conta de base de dados só com os direitos de que precisa, como no Exemplo 2.
- Nunca ponha segredos em nomes, notas, capturas de ecrã ou nomes de fluxos.
- Mantenha um conector por destino real. Assim, mudá-lo ou desativá-lo tem um só efeito claro.

## Os endereços são vistos a partir do servidor

O host e a porta têm de ser alcançáveis **a partir do servidor OpenLDR**, não do seu computador.

- Numa instalação normal, o OpenLDR corre em Docker Compose. Use o nome do serviço e a porta interna, por exemplo `postgres` e `5432`.
- Se o OpenLDR corre diretamente numa máquina, use o endereço e a porta publicada que usaria nessa máquina, por exemplo `localhost` e `5433`.

## Tipos de conector

Defina **Categoria** como **Anfitrião** para estes. A lista **Tipo de base de dados** inclui também os serviços de e-mail e de ficheiros, apesar do nome.

| Tipo | Usado por | Campos |
| --- | --- | --- |
| Postgres | Nó Postgres, consultas personalizadas, relatórios | Host, Porta (5432), Base de dados, Utilizador, Palavra-passe, Usar SSL |
| MySQL / MariaDB | Nó MySQL, consultas personalizadas, relatórios | Host, Porta (3306), Base de dados, Utilizador, Palavra-passe, Usar SSL |
| Microsoft SQL | Nó Microsoft SQL, consultas personalizadas, relatórios | Host, Porta (1433), Base de dados, Utilizador, Palavra-passe, Encriptar, Confiar no certificado do servidor |
| MongoDB | Nó MongoDB | Dados de ligação e base de dados |
| Redis | Nó Redis | Host, Porta, Palavra-passe, Índice de BD |
| SMTP Email | Nó Send Email | Host, Porta, Utilizador, Palavra-passe, Usar TLS |
| IMAP Email | Nó Email Trigger | Host, Porta, Utilizador, Palavra-passe, Usar TLS |
| Gmail, Microsoft Outlook | Nó Send Email | ID do cliente, Segredo do cliente, Token de atualização, e Inquilino no Outlook |
| SFTP | Nós de transferência de ficheiros | Host, Porta, Utilizador, Palavra-passe |

No Microsoft SQL, ligue **Encriptar** para exigir TLS. Ligue **Confiar no certificado do servidor** só para um certificado autoassinado numa instalação de teste.

Defina **Categoria** como **Plugin** para um destino fornecido por um plugin de saída instalado, como um envio para o DHIS2. Escolha o plugin em **Plugin de saída** e preencha **URL base**, **Utilizador** e **Palavra-passe**. Se a lista disser que não há plugins de saída instalados, instale um a partir do [Marketplace](/docs/marketplace).

## Conectores de e-mail

Use **SMTP Email** para o nó **Send Email**. Funciona com qualquer fornecedor SMTP, incluindo o Gmail com uma palavra-passe de aplicação, o Outlook e o Office 365, e serviços de envio como o smtp2go ou o Mailtrap.

Use **Gmail** ou **Microsoft Outlook** só se já tiver uma aplicação Google Cloud ou Microsoft Entra com ID do cliente, segredo do cliente e token de atualização. Dá mais trabalho do que a maioria dos laboratórios precisa. Para o Gmail, o SMTP é mais simples.

| Campo | Valor |
| --- | --- |
| Host | O servidor de e-mail, por exemplo `smtp.gmail.com` |
| Porta | `587` com **Usar TLS** desligado (STARTTLS), ou `465` com **Usar TLS** ligado |
| Utilizador | A conta que envia. É também o endereço do remetente |
| Palavra-passe | A palavra-passe da conta, ou uma palavra-passe de aplicação no Gmail |

O destinatário define-se depois, no campo **To** do nó Send Email.

### Enviar do Gmail com uma palavra-passe de aplicação

Com a verificação em dois passos ligada, o Gmail recusa a sua palavra-passe normal por SMTP com `534-5.7.9 Application-specific password required`. Use antes uma **palavra-passe de aplicação**: uma palavra-passe de 16 caracteres que o Gmail cria para uma só aplicação. Salta o segundo passo só para essa aplicação, protege a sua palavra-passe real e pode ser revogada a qualquer momento.

1. Ligue a **verificação em dois passos** em `myaccount.google.com`, em Segurança. As palavras-passe de aplicação precisam dela.
2. Vá a `myaccount.google.com/apppasswords`, dê-lhe um nome, por exemplo `OpenLDR`, e selecione **Criar**. Copie o código de 16 caracteres, mostrado como `abcd efgh ijkl mnop`.
3. Adicione um conector com **Categoria** **Anfitrião** e **Tipo de base de dados** **SMTP Email**:

   | Campo | Valor |
   | --- | --- |
   | Host | `smtp.gmail.com` |
   | Porta | `587` |
   | Utilizador | `you@gmail.com` |
   | Palavra-passe | a palavra-passe de aplicação de 16 caracteres |
   | Usar TLS | Desligado |

4. Salve, teste e escolha este conector no nó Send Email.

Se a página das palavras-passe de aplicação disser que não estão disponíveis, a verificação em dois passos não está totalmente ligada, ou um administrador do Google Workspace desligou-as. Use um serviço como o **Mailtrap** para testes, ou o **smtp2go**.

| Fornecedor | Host | Porta | Usar TLS |
| --- | --- | --- | --- |
| Gmail | `smtp.gmail.com` | 587 | Desligado, com palavra-passe de aplicação |
| Outlook / Office 365 | `smtp.office365.com` | 587 | Desligado |
| smtp2go | `mail.smtp2go.com` | 2525 ou 587 | Desligado |
| Mailtrap (testes) | `sandbox.smtp.mailtrap.io` | 587 | Desligado |

## Na linha de comandos

A linha de comandos pode ler e mudar um conector de anfitrião. Adicionar, testar e remover um conector faz-se no studio.

```bash
./openldr connectors inspect <id>
./openldr connectors update <id> --file patch.json
```

- `inspect` mostra JSON com a `config` normal e um `secretsSet` verdadeiro ou falso para cada segredo. Nunca mostra um segredo.
- `update` recebe uma correção JSON. Os campos omitidos ficam como estão, e um segredo em branco mantém o guardado. Exemplo: `{"config":{"host":"db.internal","port":"5432"}}`. Só mudar o nome: `{"name":"Lab database"}`.
- A saída e os registos de auditoria nunca têm valores de segredos. Proteja qualquer ficheiro com um segredo novo, e apague-o depois.

O id do conector está em `GET /api/connectors`.

## Editar as definições guardadas

**Editar** mostra os campos normais guardados de um conector de anfitrião: host, porta, base de dados e utilizador quando o tipo os tem. Um segredo já definido fica em branco. Deixe-o em branco para o manter, mesmo que mude o host. Os URL, os campos desconhecidos e as definições de plugins não são mostrados.

Num conector de plugin, preencha **URL base**, **Utilizador** e **Palavra-passe** juntos, ou deixe os três em branco para manter os valores guardados.

## Limite das consultas

As consultas dos conectores PostgreSQL, MySQL e Microsoft SQL têm um limite de 30 segundos. Uma consulta lenta falha em vez de deixar um fluxo ou relatório à espera para sempre. A ligação tem o seu próprio limite de 30 segundos. O formulário do conector não tem campo de tempo limite.

- O PostgreSQL e o Microsoft SQL cancelam o pedido em curso.
- O MySQL abre uma segunda ligação com a mesma conta para parar a consulta. Pode levar mais um segundo, e a conta tem de poder abrir outra ligação e terminar as suas próprias sessões.

Se uma consulta atingir o limite, reduza o período ou os filtros e veja o plano na base de dados. Se o erro disser `server cancellation failed`, o OpenLDR fechou a sua ligação mas não confirmou que a base de dados parou a consulta. Peça ao operador da base de dados que veja as consultas ativas.

## Paragem do servidor

Com SIGTERM ou SIGINT, a API deixa de aceitar pedidos e de consultar a fila. Espera pelos pedidos ativos, pelo lote da fila reservado e pelo ciclo de projeção em curso, e depois fecha as bases de dados. Um segundo sinal não inicia outra paragem.

Um processador que nunca termina pode deixar a paragem à espera para sempre. Dê tempo às importações em curso antes de o gestor de serviços forçar a paragem. Depois de o worker parar, os esvaziamentos manuais continuam possíveis até o contexto fechar.

## Num telemóvel

Num telemóvel, a tabela de conectores é mais larga do que o ecrã. Deslize-a para o lado para chegar ao menu **⋯** de cada linha, no fim da linha. O painel **Adicionar conector** ocupa o ecrã, com as etiquetas à esquerda de cada campo.

## Resolução de problemas

- **`534-5.7.9 Application-specific password required` (Gmail).** Use uma palavra-passe de aplicação, não a sua palavra-passe de início de sessão.
- **Credenciais inválidas, ou falha de autenticação.** O utilizador ou a palavra-passe está errado. Edite o conector e escreva o segredo outra vez.
- **Ligação recusada, ou tempo esgotado.** O host ou a porta está errado, ou o servidor não lhe chega. Compare o nome do serviço Docker com `localhost`.
- **Erro TLS ou SSL.** Acerte **Usar SSL**, **Usar TLS** ou **Encriptar** com o que o servidor pede. No SMTP, 587 quer dizer **Usar TLS** desligado e 465 ligado.
- **permission denied for table.** A conta da base de dados não tem direitos sobre essa tabela. Pode ser de propósito, como no Exemplo 2.
- **Uma consulta falha mas o resultado antigo continua no ecrã.** A página Consulta mantém o último resultado que funcionou. A marca vermelha à esquerda do conector tem o erro. Aponte para ela para o ler.
- **Um conector não aparece na lista de um nó.** O tipo não corresponde ao nó, ou está desativado.
- **O teste passa mas um fluxo falha.** Abra o separador de execuções do fluxo e leia o erro do nó. Veja [Fluxos de trabalho, Exemplo 3](/docs/workflows#exemplo-3-ler-a-execucao). A consulta ou os direitos são a causa habitual.

## Guias relacionados

- [Fluxos de trabalho](/docs/workflows)
- [Consultas personalizadas](/docs/query)
- [Exposição de dados](/docs/data-exposure)
- [Relatórios agendados](/docs/report-pipeline)
- [Marketplace](/docs/marketplace)
- [Definições](/docs/settings)
