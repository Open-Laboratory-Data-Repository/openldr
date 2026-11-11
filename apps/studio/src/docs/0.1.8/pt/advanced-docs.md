# Documentação de implementação e técnica

Este manual integrado cobre as tarefas feitas na aplicação por um utilizador com sessão iniciada. A implementação, a configuração e o desenvolvimento estão documentados no **site do OpenLDR**, na secção Docs:

- **Requirements & Install**: o que é preciso, e o instalador numa linha (incluindo um domínio público com um certificado Let's Encrypt).
- **Environment variables**: cada valor do ficheiro `.env` da implementação.
- **Windows Server (WSL2)**: a implementação em Windows Server com WSL2.
- **Development**: correr o OpenLDR a partir do código-fonte, com recarregamento automático.
- **Command-line interface (CLI)**: a linha de comandos `openldr` do operador (base de dados, terminologia, ingestão, plugins, relatórios, utilizadores, marketplace).
  - **`openldr db reproject --force`** reconstrói todo o modelo de leitura do armazém a partir do armazenamento FHIR canónico, incluindo o registo de chegadas `ingest_events`. Recusa sem `--force`, porque reescreve todas as linhas projetadas.
  - **`openldr terminology reproject` está obsoleto** e faz exatamente o mesmo. Sempre fez: apesar do nome, nunca reconstruiu só `terminology_codes`. Use `db reproject`.
  - **`ingest_events` é o registo de quando os dados chegaram ao OpenLDR.** Uma linha por chegada de cada recurso clínico, por recurso e versão, reconstruída a partir do armazenamento canónico. A coluna `created_at` de `lab_requests`, `specimens` e das outras tabelas projetadas **não** é uma hora de chegada: regista a primeira escrita da linha pela projeção, guarda um só momento por mais correções que o recurso tenha, e volta a zero para qualquer linha reinserida. Para saber "quando é que isto nos chegou", leia `ingest_events`.

Tudo isto está no site do projeto e no repositório do código-fonte: <https://github.com/Open-Laboratory-Data-Repository/openldr>.

## Novas tentativas de projeção

O serviço guarda escritas falhadas de recursos e do registo para tentar novamente de forma automática.
As tentativas sobrevivem ao reinício e releem o recurso canónico atual, incluindo eliminações.
Cada ciclo repete no máximo 100 recursos pendentes e depois trata as novas alterações.
As falhas repetidas aguardam 1, 2, 4 segundos e assim por diante, até cinco minutos.
As tentativas continuam até terem sucesso. Um recurso com falha não bloqueia as alterações válidas seguintes.
Uma nova alteração desse recurso pode iniciar uma tentativa antes do fim da espera.
Se não conseguir guardar uma tentativa, o serviço mantém o cursor.
O sucesso remove a tentativa pendente. Os erros de captura auxiliar ficam nos registos, sem nova tentativa.
Após uma falha temporária, não é necessária intervenção.
Para reconstruir todas as tabelas de leitura, use `openldr db reproject --force`.

## Factos da requisição e atributos da requisição

Cada requisição de laboratório traz, quando a origem os envia: o conjunto OBR, a hora da análise,
o ponto de cuidado, o tipo de requisição, quem a registou e testou, o médico requisitante, a idade
na requisição, a informação clínica, o analisador, e o código e o motivo de rejeição. Cada relatório
traz a sua secção e quem o autorizou.

Os factos mais raros são linhas em `lab_request_attributes`, uma linha por requisição e atributo.
Os códigos de atributo formam o sistema de codificação `urn:openldr:cs:request-attribute`.
Carregue-o uma vez com:

    openldr terminology import resource packages/terminology/codesystems/openldr-request-attribute.json

Execute isto a partir de um checkout de código-fonte do OpenLDR CE, onde o ficheiro está nesse
caminho. Sem o import, as linhas de atributo continuam a ser guardadas. Só faltam os nomes de
apresentação dos códigos.

Um facto que a origem não envia fica vazio. Nada é preenchido no lugar.

Um resultado numérico fora do intervalo de medição do método do laboratório chega como o limite
com um comparador, por exemplo `< 20`. `lab_results.numeric_comparator` guarda `<`, `<=`, `>=` ou `>`, e
fica vazio para um número comum. `numeric_value` guarda o limite nesse caso.

Cada resultado traz o seu estado FHIR em `lab_results.status`. Um teste rejeitado na introdução de resultados fica guardado como uma linha com estado `cancelled`, sem valor, e com o motivo em `data_absent_code` e `data_absent_reason`, por exemplo `HAEM` e `Haemolysed`. Para contar resultados, acrescente `(l.status is null or l.status <> 'cancelled')` à consulta. Para contar testes rejeitados, use `l.status = 'cancelled'`. Qualifique `status` com o alias de lab_results, porque lab_requests, specimens e diagnostic_reports também têm uma coluna `status`; uma consulta antiga que os junta e usa `status` sozinho precisa de ser qualificada. Uma instalação atualizada a partir de uma versão anterior não tem estado nas linhas que já tinha. Execute `openldr db reproject --force` uma vez depois de atualizar para as preencher.

`clinical_info` fica oculto do construtor de painéis por predefinição, porque pode conter texto
livre ou um identificador de doente pseudonimizado. Torne-o visível em Definições, depois
Exposição de Dados. A tabela `lab_request_attributes` não está no construtor de painéis. Leia-a
com consultas personalizadas.

## Guias relacionados

- [Definições](/docs/settings)
