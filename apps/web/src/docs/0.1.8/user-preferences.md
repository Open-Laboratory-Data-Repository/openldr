# User preferences

## English

Each user's theme, sidebar state, start page and language are saved to their account on the server. They follow the user to any browser or phone. Before this, they were kept in one browser only.

A user changes the theme with the header button, collapses the sidebar with its button, and picks a start page or a language from the user menu, under **Start page** and **Language**. Each change saves at once. The start page list shows only the pages that user's role can open. The start page opens once after sign-in; the Dashboard link still opens the Dashboard.

Preferences are per user, not lab-wide, and need no role or capability. An administrator can read or fix one user's preferences with `openldr user preferences show <user-id>` and `openldr user preferences set <user-id> <key> <value>`. The keys are `theme`, `sidebarCollapsed`, `startPage` and `language`. The value `none` clears a key.

## Français

Le thème, l'état de la barre latérale, la page de démarrage et la langue de chaque utilisateur sont enregistrés dans son compte, sur le serveur. Ils suivent l'utilisateur sur chaque navigateur ou téléphone. Avant, ils restaient dans un seul navigateur.

L'utilisateur change le thème avec le bouton de l'en-tête, réduit la barre latérale avec son bouton, et choisit une page de démarrage ou une langue dans le menu utilisateur. Chaque changement est enregistré tout de suite. La liste ne montre que les pages que le rôle de l'utilisateur peut ouvrir. La page de démarrage s'ouvre une fois après la connexion ; le lien Tableau de bord ouvre toujours le Tableau de bord.

Les préférences sont propres à chaque utilisateur, pas au laboratoire, et ne demandent ni rôle ni capacité. Un administrateur peut lire ou corriger les préférences d'un utilisateur avec `openldr user preferences show <user-id>` et `openldr user preferences set <user-id> <key> <value>`. Les clés sont `theme`, `sidebarCollapsed`, `startPage` et `language`. La valeur `none` efface une clé.

## Português

O tema, o estado da barra lateral, a página inicial e o idioma de cada utilizador ficam guardados na sua conta, no servidor. Acompanham o utilizador em qualquer navegador ou telemóvel. Antes, ficavam num único navegador.

O utilizador muda o tema com o botão do cabeçalho, recolhe a barra lateral com o respetivo botão, e escolhe uma página inicial ou um idioma no menu do utilizador. Cada alteração é guardada de imediato. A lista mostra só as páginas que o papel do utilizador pode abrir. A página inicial abre uma vez depois de iniciar sessão; a ligação Painel continua a abrir o Painel.

As preferências são de cada utilizador, não do laboratório, e não exigem papel nem capacidade. Um administrador pode ler ou corrigir as preferências de um utilizador com `openldr user preferences show <user-id>` e `openldr user preferences set <user-id> <key> <value>`. As chaves são `theme`, `sidebarCollapsed`, `startPage` e `language`. O valor `none` limpa uma chave.
