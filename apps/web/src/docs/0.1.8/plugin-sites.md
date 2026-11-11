# Plugin cards and side panels

## English

A plugin with a webview page can also draw that page in two more places: a card on the home dashboard and a right side panel that stays open across pages. Declare them under `ui.sites` in the plugin manifest:

```json
"ui": {
  "entry": "ui.html",
  "sha256": "<sha256 of ui.html>",
  "nav": { "label": "Bench notes" },
  "sites": {
    "widget": { "title": "Today", "height": "small" },
    "panel": { "title": "Bench notes" }
  }
}
```

Both are optional. `height` is `small`, `medium` or `large`, which draw the card 160, 240 or 360 px tall. The default is `medium`. Titles are 1 to 60 characters. Only a webview plugin, one with `ui.entry`, may declare sites. `ui.sites` is part of the signed manifest, so the signature covers it. A manifest without it is unchanged, and bundles signed before this release still verify.

The plugin ships one `ui.html`. The host tells the page where it is drawn through `openldr.site`, which is `page`, `widget` or `panel`. Read it after `await openldr.ready` and render the view for that place. Every place uses the same broker calls, the same storage and the same role gate, `ui.requiredRoles`.

An administrator can switch a card or panel off for the whole lab, from **Places** in the plugin's menu under Settings, Marketplace, or with `openldr market sites <plugin-id> <widget|panel> <on|off>`. That hides the place only. The plugin page keeps working.

## Français

Une extension avec une page webview peut aussi afficher cette page à deux autres endroits : une carte sur le tableau de bord d'accueil et un panneau latéral à droite qui reste ouvert d'une page à l'autre. Déclarez-les sous `ui.sites` dans le manifeste, comme dans l'exemple ci-dessus.

Les deux sont facultatifs. `height` vaut `small`, `medium` ou `large`, soit une carte de 160, 240 ou 360 px de haut. La valeur par défaut est `medium`. Les titres font de 1 à 60 caractères. Seule une extension avec `ui.entry` peut déclarer des emplacements. `ui.sites` fait partie du manifeste signé, donc la signature le couvre. Un manifeste sans ce champ ne change pas, et les paquets signés avant cette version restent valides.

L'extension fournit un seul `ui.html`. L'hôte indique à la page où elle est affichée avec `openldr.site`, qui vaut `page`, `widget` ou `panel`. Lisez-le après `await openldr.ready` et affichez la vue adaptée. Chaque emplacement utilise les mêmes appels au broker, le même stockage et le même contrôle des rôles, `ui.requiredRoles`.

Un administrateur peut désactiver une carte ou un panneau pour tout le laboratoire, depuis **Emplacements** dans le menu de l'extension, ou avec `openldr market sites <plugin-id> <widget|panel> <on|off>`. Cela masque seulement l'emplacement. La page de l'extension continue de fonctionner.

## Português

Um plugin com uma página webview pode também mostrar essa página em mais dois sítios: um cartão no painel inicial e um painel lateral à direita que fica aberto de página em página. Declare-os em `ui.sites` no manifesto, como no exemplo acima.

Ambos são opcionais. `height` é `small`, `medium` ou `large`, ou seja, um cartão com 160, 240 ou 360 px de altura. O valor por omissão é `medium`. Os títulos têm de 1 a 60 caracteres. Só um plugin com `ui.entry` pode declarar locais. `ui.sites` faz parte do manifesto assinado, por isso a assinatura cobre-o. Um manifesto sem este campo não muda, e os pacotes assinados antes desta versão continuam válidos.

O plugin fornece um único `ui.html`. O anfitrião diz à página onde é mostrada através de `openldr.site`, que é `page`, `widget` ou `panel`. Leia-o depois de `await openldr.ready` e mostre a vista desse local. Todos os locais usam as mesmas chamadas ao broker, o mesmo armazenamento e o mesmo controlo de papéis, `ui.requiredRoles`.

Um administrador pode desligar um cartão ou um painel para todo o laboratório, em **Locais** no menu do plugin, ou com `openldr market sites <plugin-id> <widget|panel> <on|off>`. Isto só esconde o local. A página do plugin continua a funcionar.
