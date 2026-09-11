# Rapports

Ce guide explique comment planifier un rapport et récupérer son fichier.

![Rapport et résultats](reports-run-result.png)

## Planifier un rapport

1. Sélectionnez un rapport, puis **⋯ → Planifications**. Votre rôle doit autoriser la gestion des rapports.
2. Choisissez **Nouvelle planification**, puis la fréquence. Une fréquence hebdomadaire demande un jour de la semaine. Une fréquence mensuelle propose les jours 1 à 28.
3. Choisissez CSV, XLSX ou PDF. Vérifiez les filtres requis, dont l'établissement et le fuseau horaire. La nouvelle planification reprend les filtres courants du rapport, sauf les dates.
4. Choisissez **Enregistrer** et vérifiez la confirmation. La planification affiche un interrupteur, **Prochaine** et **Dernière**.
5. Utilisez le crayon pour modifier la fréquence, le format ou les filtres, puis enregistrez. L'interrupteur désactive la planification. L'icône de suppression demande une confirmation.

### Horaire et période

Toutes les fréquences utilisent 06:00 UTC. Vous ne pouvez pas choisir une autre heure ou un autre fuseau. Les dates Prochaine et Dernière utilisent le fuseau du navigateur. Le filtre Fuseau horaire du rapport agit sur les données, pas sur l'heure de lancement.

| Fréquence | Prochaine date après enregistrement | Période automatique |
| --- | --- | --- |
| Quotidien | Demain | Jour UTC précédent |
| Hebdomadaire | Prochain jour choisi, jamais aujourd'hui | Sept jours UTC précédents, jusqu'à hier |
| Mensuel | Jour choisi du mois suivant | Mois civil précédent en UTC |
| Trimestriel | Premier jour du trimestre suivant | Trimestre civil précédent en UTC |

La période dépend de la date réelle d'exécution, y compris avec **Exécuter**. Elle remplace automatiquement les dates des rapports ayant un paramètre de période. Les autres filtres enregistrés restent utilisés.

Une planification désactivée peut encore afficher Prochaine. Cette date conservée ne signifie pas qu'elle sera exécutée. Vérifiez l'interrupteur. Dernière peut désigner une tentative échouée. Consultez son statut dans l'historique.

### Exécuter et récupérer le fichier

1. Activez la planification, puis choisissez l'icône de lecture, **Exécuter**.
2. La notification confirme la demande, pas la réussite du rapport. Une planification désactivée peut afficher cette notification sans produire d'exécution.
3. Ouvrez **⋯ → Historique → Exécutions planifiées**. Les exécutions automatiques et celles lancées ici apparaissent après leur fin. **Activité** contient les exécutions interactives.
4. Vérifiez le statut, puis choisissez **Télécharger** pour récupérer le fichier CSV, XLSX ou PDF enregistré. Votre rôle doit autoriser l'exportation.
5. Si le résultat manque, quittez puis rouvrez **Exécutions planifiées**. La liste ne se rafraîchit pas automatiquement.

Une exécution échouée ne fournit pas de fichier. Sur ordinateur, survolez son statut pour lire l'erreur. Corrigez les filtres enregistrés et réessayez. Le fichier produit ne remplace pas le Document ou le Tableur actuellement affiché sur la page du rapport.

![Historique des rapports](reports-history-schedules.png)
