# Export and import queries

## English

Use the actions menu in the Explorer header. Choose Export queries or Import queries.

The file holds each query's name, SQL and parameters. It does not hold the id or the connector.

Import follows these rules:

- A new name is created.
- A name that already exists is skipped, unless you choose to replace it.
- Replace keeps the query's id and connector, so reports that use it keep working.
- Replacing a built-in query that ships with CE is undone the next time CE seeds its built-in queries.
- If a replaced query changes a parameter's id, reports that set the old parameter lose it.
- One bad query stops the whole file. Nothing is written.

New queries use `Target Warehouse (Postgres)` unless you pick another connector.

From the command line:

```
openldr query export --out queries.json [--name <name>...]
openldr query import queries.json [--connector <name>] [--force]
```

`--out` overwrites an existing file. `--force` replaces queries that already exist.

Content written for one lab system is shared as these files. They live in the operator's `packs/` folder, not in CE itself.

## Français

Utilisez le menu d'actions dans l'en-tête de l'Explorateur. Choisissez Exporter les requêtes ou Importer des requêtes.

Le fichier contient le nom, le SQL et les paramètres de chaque requête. Il ne contient ni l'identifiant ni le connecteur.

L'importation suit ces règles :

- Un nouveau nom est créé.
- Un nom qui existe déjà est ignoré, sauf si vous choisissez de le remplacer.
- Le remplacement conserve l'identifiant et le connecteur de la requête. Les rapports qui l'utilisent continuent donc de fonctionner.
- Remplacer une requête intégrée livrée avec CE est annulé la prochaine fois que CE recharge ses requêtes intégrées.
- Si une requête remplacée change l'identifiant d'un paramètre, les rapports qui définissent l'ancien paramètre le perdent.
- Une seule requête invalide arrête tout le fichier. Rien n'est écrit.

Les nouvelles requêtes utilisent `Target Warehouse (Postgres)`, sauf si vous choisissez un autre connecteur.

En ligne de commande :

```
openldr query export --out queries.json [--name <name>...]
openldr query import queries.json [--connector <name>] [--force]
```

`--out` écrase un fichier existant. `--force` remplace les requêtes qui existent déjà.

Le contenu écrit pour un système de laboratoire est partagé sous forme de ces fichiers. Ils sont gardés dans le dossier `packs/` de l'opérateur, pas dans CE.

## Português

Use o menu de ações no cabeçalho do Explorador. Escolha Exportar consultas ou Importar consultas.

O ficheiro contém o nome, o SQL e os parâmetros de cada consulta. Não contém o id nem o conector.

A importação segue estas regras:

- Um nome novo é criado.
- Um nome que já existe é ignorado, a menos que escolha substituí-lo.
- Substituir mantém o id e o conector da consulta, por isso os relatórios que a usam continuam a funcionar.
- Substituir uma consulta integrada que vem com o CE é desfeito da próxima vez que o CE carregar as suas consultas integradas.
- Se uma consulta substituída mudar o id de um parâmetro, os relatórios que definem o parâmetro antigo perdem-no.
- Uma só consulta inválida pára o ficheiro inteiro. Nada é escrito.

As consultas novas usam `Target Warehouse (Postgres)`, a menos que escolha outro conector.

Na linha de comandos:

```
openldr query export --out queries.json [--name <name>...]
openldr query import queries.json [--connector <name>] [--force]
```

`--out` substitui um ficheiro existente. `--force` substitui as consultas que já existem.

O conteúdo escrito para um sistema de laboratório é partilhado como estes ficheiros. Ficam na pasta `packs/` do operador, não no CE.
