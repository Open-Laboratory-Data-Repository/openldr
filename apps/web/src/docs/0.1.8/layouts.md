# Layouts

## English

A layout is a named sidebar: the pages it shows and the page that opens first. An administrator makes layouts in Settings, Layouts, and picks one as the default for a role. Each user can pick another from the user menu, under **Layout**, or the full sidebar. The pick is saved to the user's account, so it follows them to any device.

A layout only hides pages. It never shows a page a role cannot open, and a hidden page still opens from a link. Docs always shows. The page that opens first is the user's own start page, else the layout's, else the Dashboard, and only if it is in the user's sidebar. A user with several roles gets the default of the first of them in Roles page order.

Changing layouts needs `settings.edit_general`. The same work runs from the command line with `openldr layouts list`, `openldr layouts set <name> --pages <paths> [--start-page <path>] [--roles <slugs>]` and `openldr layouts delete <name> --force`. One user's pick is set with `openldr user preferences set <user-id> layout <id|full|none>`. Changes are audited as `layout.create`, `layout.update` and `layout.delete`.

## Français

Une disposition est une barre latérale nommée : les pages qu'elle affiche et la page ouverte en premier. Un administrateur crée les dispositions dans Paramètres, Dispositions, et en choisit une par défaut pour chaque rôle. Chaque utilisateur peut en choisir une autre dans le menu utilisateur, sous **Disposition**, ou la barre latérale complète. Le choix est enregistré dans le compte et suit l'utilisateur sur chaque appareil.

Une disposition ne fait que masquer des pages. Elle n'affiche jamais une page qu'un rôle ne peut pas ouvrir, et une page masquée s'ouvre toujours depuis un lien. La documentation reste affichée. La page ouverte en premier est la page de démarrage de l'utilisateur, sinon celle de la disposition, sinon le Tableau de bord, et seulement si elle figure dans sa barre latérale. Un utilisateur avec plusieurs rôles reçoit la valeur par défaut du premier, dans l'ordre de la page Rôles.

Modifier les dispositions demande `settings.edit_general`. Les mêmes opérations existent en ligne de commande avec `openldr layouts list`, `openldr layouts set` et `openldr layouts delete --force`. Le choix d'un utilisateur se fixe avec `openldr user preferences set <user-id> layout <id|full|none>`. Les changements sont audités sous `layout.create`, `layout.update` et `layout.delete`.

## Português

Uma disposição é uma barra lateral com nome: as páginas que mostra e a página que abre primeiro. Um administrador cria as disposições em Definições, Disposições, e escolhe uma como predefinição para cada função. Cada utilizador pode escolher outra no menu do utilizador, em **Disposição**, ou a barra lateral completa. A escolha fica guardada na conta e acompanha o utilizador em qualquer dispositivo.

Uma disposição só esconde páginas. Nunca mostra uma página que uma função não pode abrir, e uma página escondida continua a abrir a partir de uma ligação. A documentação aparece sempre. A página que abre primeiro é a página inicial do utilizador, senão a da disposição, senão o Painel, e só se estiver na sua barra lateral. Um utilizador com várias funções recebe a predefinição da primeira, pela ordem da página Funções.

Mudar disposições exige `settings.edit_general`. As mesmas operações existem na linha de comandos com `openldr layouts list`, `openldr layouts set` e `openldr layouts delete --force`. A escolha de um utilizador define-se com `openldr user preferences set <user-id> layout <id|full|none>`. As alterações ficam auditadas como `layout.create`, `layout.update` e `layout.delete`.
