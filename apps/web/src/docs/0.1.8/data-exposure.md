# Data exposure

## English

Settings → Data Exposure controls additional table columns available through joins in the internal dashboard builder. Access requires the `data_exposure.manage` capability.

### Understand the scope

The policy checks additional table columns selected through builder joins. Built-in model dimensions remain available. This is not a blanket filter over every returned field.

For these additional columns, the policy applies during selection, query execution, and conversion to SQL. It does not filter raw SQL widget results. Converting a builder query to SQL does not make later SQL executions follow future policy changes.

Custom Queries run through database connectors. Reports bound to those queries, Report Designer query data, and workflow Database nodes use connector SQL. They do not apply this policy, even when a connector points at the OpenLDR database.

Configure the database account used by each connector to read only approved tables, columns, or restricted views. Review database grants and query access before sharing a report. SELECT validation and row limits do not hide sensitive columns. Restrict the database account used for raw SQL widgets too.

### Change column visibility

1. Open Settings → Data Exposure and find the table and column.
2. Switch off a column to mark it Hidden. Switch on to mark it Shown.
3. PII means personally identifiable information. Showing a column with this badge requires confirmation. Confirm only when its use in the internal builder is intended.
4. Changes remain local until you open the page's ⋯ menu and choose Save. Check the saved notification. On an error, do not assume every change persisted.
5. Choose Discard in the same menu to reload saved values and abandon local edits.
6. Reopen the page after saving and check the column states. Then reload the internal dashboard builder and check its column choices. Run a safe test query to verify the intended result or rejection.

### Verify the correct query path

Use non-sensitive test data when checking exposure. A saved Hidden state proves the stored choice only. Verify the internal builder separately from raw SQL and connector-backed reports. For a connector, test the configured database account against approved views and prohibited columns. Check the resulting report before distributing it.

Changing this policy does not remove data from stored records or files already exported.


## Français

Paramètres → Exposition des données règle les colonnes supplémentaires accessibles dans les tables jointes du constructeur de tableaux de bord interne. L'accès exige la capacité `data_exposure.manage`.

### Comprendre la portée

La politique contrôle les colonnes supplémentaires choisies dans les tables jointes du constructeur. Les dimensions prédéfinies du modèle restent disponibles. Elle ne filtre pas tous les champs retournés.

Pour ces colonnes supplémentaires, la politique concerne la sélection, les requêtes et la conversion en SQL. Elle ne filtre pas les résultats des widgets SQL brut. Après conversion en SQL, les exécutions ne suivent pas les modifications ultérieures de cette politique.

Les requêtes personnalisées passent par les connecteurs de bases de données. Les rapports liés à ces requêtes, les données de requêtes du concepteur de rapports et les nœuds Base de données des workflows utilisent le SQL des connecteurs. Ils ne suivent pas cette politique, même si le connecteur pointe vers la base OpenLDR.

Limitez le compte de base de données de chaque connecteur aux tables, colonnes ou vues autorisées. Vérifiez ses droits et l'accès aux requêtes avant de partager un rapport. La validation SELECT et les limites de lignes ne masquent pas les colonnes sensibles. Limitez aussi le compte utilisé par les widgets SQL brut.

### Modifier la visibilité

1. Ouvrez Paramètres → Exposition des données et trouvez la table et la colonne.
2. Désactivez une colonne pour la marquer Masquée. Activez-la pour la marquer Visible.
3. Le badge DPI désigne les données personnelles. Rendre une telle colonne visible exige une confirmation. Confirmez uniquement si son utilisation dans le constructeur interne est prévue.
4. Les modifications restent locales jusqu'au choix Enregistrer dans le menu ⋯ de la page. Vérifiez la notification. En cas d'erreur, ne supposez pas que toutes les modifications ont été enregistrées.
5. Choisissez Annuler les modifications dans ce menu pour recharger les valeurs enregistrées.
6. Rouvrez la page et vérifiez les états. Rechargez ensuite le constructeur interne et contrôlez les colonnes proposées. Exécutez une requête de test sans données sensibles pour vérifier le résultat ou le refus attendu.

### Vérifier le chemin de la requête

Utilisez des données de test non sensibles. Un état Masquée enregistré prouve seulement le choix sauvegardé. Vérifiez séparément le constructeur interne, le SQL brut et les rapports utilisant des connecteurs. Pour un connecteur, testez le compte configuré sur les vues autorisées et les colonnes interdites. Contrôlez le rapport obtenu avant sa diffusion.

Cette politique ne supprime pas les données des enregistrements ni des fichiers déjà exportés.


## Português

Definições → Exposição de dados controla as colunas adicionais das tabelas ligadas no construtor de painéis interno. O acesso exige a capacidade `data_exposure.manage`.

### Compreender o alcance

A política controla as colunas adicionais escolhidas nas tabelas ligadas no construtor. As dimensões predefinidas do modelo continuam disponíveis. Não filtra todos os campos devolvidos.

Para estas colunas adicionais, a política aplica-se à seleção, à execução de consultas e à conversão para SQL. Não filtra os resultados dos widgets SQL direto. Após a conversão para SQL, as execuções não seguem futuras alterações desta política.

As consultas personalizadas usam conectores. Os relatórios ligados a essas consultas, os dados de consultas do desenhador de relatórios e os nós Base de dados dos workflows usam SQL dos conectores. Não aplicam esta política, mesmo quando o conector aponta para a base OpenLDR.

Limite a conta de base de dados de cada conector às tabelas, colunas ou vistas autorizadas. Reveja as permissões e o acesso às consultas antes de partilhar um relatório. A validação SELECT e os limites de linhas não ocultam colunas sensíveis. Restrinja também a conta usada pelos widgets SQL direto.

### Alterar a visibilidade

1. Abra Definições → Exposição de dados e encontre a tabela e a coluna.
2. Desative uma coluna para a marcar Oculta. Ative-a para a marcar Visível.
3. O distintivo DPI indica dados pessoais. Tornar essa coluna visível exige confirmação. Confirme apenas quando pretende usá-la no construtor interno.
4. As alterações ficam locais até escolher Guardar no menu ⋯. Verifique a notificação. Se ocorrer um erro, não presuma que todas as alterações foram guardadas.
5. Escolha Descartar no mesmo menu para recarregar os valores guardados e abandonar as alterações locais.
6. Volte a abrir a página e confirme os estados. Recarregue depois o construtor interno e verifique as colunas disponíveis. Execute uma consulta de teste sem dados sensíveis para confirmar o resultado ou a rejeição esperada.

### Verificar o percurso da consulta

Use dados de teste não sensíveis. Um estado Oculta guardado prova apenas a escolha persistida. Verifique separadamente o construtor interno, o SQL direto e os relatórios com conectores. Para um conector, teste a conta configurada nas vistas autorizadas e nas colunas proibidas. Confira o relatório resultante antes de o distribuir.

Esta política não elimina dados dos registos nem dos ficheiros já exportados.


[Environment variables](/docs/environment)
