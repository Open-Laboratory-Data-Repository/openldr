# Implantação e documentação técnica

Os guias de implantação, configuração e desenvolvimento estão no
[site OpenLDR](https://github.com/Open-Laboratory-Data-Repository/openldr).

`openldr db reproject --force` reconstrói as tabelas de leitura a partir dos recursos FHIR canónicos,
incluindo o registo de chegadas `ingest_events`. O comando exige `--force`.
`openldr terminology reproject` está obsoleto e executa a mesma reconstrução.
O registo conserva cada chegada por recurso e versão.
O campo `created_at` das tabelas de leitura indica a primeira escrita, não a chegada dos dados.

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

Um resultado numérico fora do intervalo de relato do laboratório chega como o limite com um
comparador, por exemplo `< 20`. `lab_results.numeric_comparator` guarda `<`, `<=`, `>=` ou `>`, e
fica vazio para um número comum. `numeric_value` guarda o limite nesse caso.

`clinical_info` fica oculto do construtor de painéis por predefinição, porque pode conter texto
livre ou um identificador de doente pseudonimizado. Torne-o visível em Definições, depois
Exposição de Dados. A tabela `lab_request_attributes` não está no construtor de painéis. Leia-a
com consultas personalizadas.

## Guias relacionados

- [Definições](/docs/settings)
