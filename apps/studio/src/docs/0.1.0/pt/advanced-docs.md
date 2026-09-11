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

## Guias relacionados

- [Definições](/docs/settings)
