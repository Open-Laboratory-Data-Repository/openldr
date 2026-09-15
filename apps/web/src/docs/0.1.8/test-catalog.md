# Test catalog

## English

The **Test catalog** page lists the national list of tests: code, name, category, specimen types, LOINC code (or **No LOINC**) and whether this lab runs each test. You need Terminology view to open it and Terminology manage to change anything.

An install that did not receive its catalog from central owns it, and can add, edit, retire and restore tests. A lab that receives the catalog from central cannot change its tests. It can switch tests on or off, narrow their specimens and set a local name. Sync never sends those settings.

Add a test from the page's ⋯ menu, and edit one from its row's ⋯ menu. The same row menu switches a test on or off at this lab, and retires or restores it. Search matches the code, name, short name and local name. Filter by category, LOINC, on or off, and status. Retired tests are hidden unless you filter for them.

A LOINC code is searched when LOINC is loaded on this install. Otherwise it is typed, and only its format is checked. Specimen types come from CE's specimen-type list, and categories from **Test categories** on the Terminology page.

Import a national list from a CSV or Excel (.xlsx) file with **Import** in the page's ⋯ menu, where this install owns the catalog. The sheet reads the file, matches its headers to the fields for you to check, asks what each unmatched category or specimen means, and shows new, changed, unchanged and refused rows before anything is written. A file holds at most 5,000 tests. Tests match on their code, so the same file twice changes nothing, and a test missing from the file is not retired. **Export CSV** writes the active tests in the same columns, so an export imports back as it is.

The Lab order's Tests field lists the catalog tests switched on at this lab, under their local names, and its Specimen Type field offers only the specimens the chosen tests accept. A submitted order lists each test's LOINC code first, then its catalog code, so reports that read an order's first code keep matching LOINC. Switch tests on before taking orders: an empty list lets no order through.

## Français

La page **Catalogue des examens** présente la liste nationale des examens : code, nom, catégorie, types de prélèvement, code LOINC (ou **Sans LOINC**) et si ce laboratoire réalise chaque examen. Il faut la permission de consulter la Terminologie pour l'ouvrir, et celle de la gérer pour modifier quoi que ce soit.

Une installation qui n'a pas reçu son catalogue du site central en est propriétaire et peut ajouter, modifier, retirer et rétablir des examens. Un laboratoire qui reçoit le catalogue du site central ne peut pas modifier ses examens. Il peut activer ou désactiver des examens, restreindre leurs prélèvements et définir un nom local. La synchronisation n'envoie jamais ces réglages.

Ajoutez un examen depuis le menu ⋯ de la page, et modifiez-en un depuis le menu ⋯ de sa ligne. Ce même menu active ou désactive un examen dans ce laboratoire, et le retire ou le rétablit. La recherche porte sur le code, le nom, le nom court et le nom local. Filtrez par catégorie, LOINC, activé ou non, et statut. Les examens retirés sont masqués, sauf si vous filtrez sur eux.

Un code LOINC est recherché quand LOINC est chargé sur cette installation. Sinon il est saisi, et seul son format est vérifié. Les types de prélèvement viennent de la liste des types de prélèvement de CE, et les catégories de **Test categories** sur la page Terminologie.

Importez une liste nationale depuis un fichier CSV ou Excel (.xlsx) avec **Importer** dans le menu ⋯ de la page, si cette installation est propriétaire du catalogue. Le panneau lit le fichier, associe ses en-têtes aux champs pour que vous les vérifiiez, demande ce que signifie chaque catégorie ou prélèvement sans correspondance, et montre les lignes nouvelles, modifiées, inchangées et refusées avant toute écriture. Un fichier contient au plus 5 000 examens. Les examens sont rapprochés par leur code : le même fichier importé deux fois ne change rien, et un examen absent du fichier n'est pas retiré. **Exporter en CSV** écrit les examens actifs dans les mêmes colonnes, pour qu'un export s'importe tel quel.

Le champ Tests de la demande d'examens liste les examens du catalogue activés dans ce laboratoire, sous leurs noms locaux, et son champ Specimen Type ne propose que les prélèvements acceptés par les examens choisis. Une demande envoyée donne d'abord le code LOINC de chaque examen, puis son code du catalogue, pour que les rapports qui lisent le premier code d'une demande trouvent toujours LOINC. Activez des examens avant de prendre des demandes : une liste vide ne laisse passer aucune demande.

## Português

A página **Catálogo de exames** mostra a lista nacional de exames: código, nome, categoria, tipos de amostra, código LOINC (ou **Sem LOINC**) e se este laboratório realiza cada exame. Precisa da permissão de ver a Terminologia para a abrir, e da permissão de a gerir para alterar qualquer coisa.

Uma instalação que não recebeu o catálogo do nível central é dona dele, e pode adicionar, editar, retirar e repor exames. Um laboratório que recebe o catálogo do nível central não pode alterar os seus exames. Pode ativar ou desativar exames, restringir as suas amostras e definir um nome local. A sincronização nunca envia essas definições.

Adicione um exame no menu ⋯ da página, e edite-o no menu ⋯ da sua linha. Esse mesmo menu ativa ou desativa um exame neste laboratório, e retira-o ou repõe-no. A pesquisa abrange o código, o nome, o nome curto e o nome local. Filtre por categoria, LOINC, ativado ou não, e estado. Os exames retirados ficam ocultos, exceto se filtrar por eles.

Um código LOINC é pesquisado quando o LOINC está carregado nesta instalação. Caso contrário é escrito, e só o formato é verificado. Os tipos de amostra vêm da lista de tipos de amostra do CE, e as categorias de **Test categories** na página Terminologia.

Importe uma lista nacional de um ficheiro CSV ou Excel (.xlsx) com **Importar** no menu ⋯ da página, quando esta instalação é dona do catálogo. O painel lê o ficheiro, associa os cabeçalhos aos campos para que os verifique, pergunta o que significa cada categoria ou amostra sem correspondência, e mostra as linhas novas, alteradas, sem alteração e recusadas antes de escrever qualquer coisa. Um ficheiro tem no máximo 5000 exames. Os exames são comparados pelo código: o mesmo ficheiro importado duas vezes não muda nada, e um exame que não está no ficheiro não é retirado. **Exportar CSV** escreve os exames ativos nas mesmas colunas, para que uma exportação se importe tal como está.

O campo Tests do pedido de exames lista os exames do catálogo ativados neste laboratório, com os nomes locais, e o campo Specimen Type só oferece as amostras aceites pelos exames escolhidos. Um pedido enviado indica primeiro o código LOINC de cada exame e depois o código do catálogo, para que os relatórios que leem o primeiro código de um pedido continuem a encontrar LOINC. Ative exames antes de receber pedidos: uma lista vazia não deixa passar nenhum pedido.
