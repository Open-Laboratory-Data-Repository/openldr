# Formulaires

## Conditions de soumission

La publication permet le partage et les éditeurs intégrés. Elle ne garantit pas les soumissions View/Run. La saisie prend actuellement en charge ServiceRequest et les champs de réponse actifs avec Observation Extract et au moins un code. Un formulaire texte personnalisé sans extraction ne peut pas être soumis. Les modèles Patient et Facility restent utilisables dans leurs éditeurs dédiés.

L’éditeur et la page de saisie indiquent cette capacité avant la saisie. Pour une observation, ouvrez la fiche du champ, sélectionnez un code terminologique sous Codes et cochez Observation Extract sous Mapping. Activez le champ, enregistrez et publiez. Renseignez au moins un champ d'extraction : un champ vide ou masqué ne produit aucune Observation.

Ce contrôle porte sur la configuration. Les réponses obligatoires, les références et le workflow d'ingestion actif doivent encore être validés.

## Exemple : soumettre une demande de laboratoire

Utilisez une installation de test avec un patient existant, la terminologie LOINC chargée et le workflow d'ingestion actif. Il faut pouvoir modifier et publier les formulaires et soumettre des réponses.

1. Dans Forms, ouvrez le menu ⋯ de la page et choisissez New. Nommez le formulaire Exemple de demande.
2. Sélectionnez R4, le type ServiceRequest et la page cible Forms. Ouvrez l'éditeur.
3. Ajoutez un champ reference actif et obligatoire, nommé Patient. Sous Mapping, ouvrez Advanced et définissez Reference Target sur Patient et FHIR Path sur ServiceRequest.subject.
4. Ajoutez un champ reference actif et obligatoire, nommé Tests. Définissez Reference Target sur l'URL du système LOINC installé, http://loinc.org, et FHIR Path sur ServiceRequest.code. Sélectionnez les codes dans la terminologie, sans inventer de code.
5. Enregistrez chaque champ dans son menu ⋯. Vérifiez le message de configuration. Observation Extract n'est pas nécessaire pour ce formulaire ServiceRequest.
6. Dans le menu ⋯ de l'éditeur, choisissez Publish. Corrigez les erreurs éventuelles. La publication enregistre aussi le schéma actuel.
7. Revenez à Forms et choisissez View/Run dans le menu ⋯ du formulaire. Sélectionnez un patient existant et un test chargé dans les listes.
8. Choisissez Submit dans Form actions. Attendez Response captured. La réponse et le ServiceRequest dérivé passent par le workflow d'ingestion.
9. Vérifiez l'exécution du workflow et la demande enregistrée avant de recommencer. En cas de stockage partiel, inspectez d'abord l'exécution : une nouvelle soumission peut créer des doublons.

Si une liste est vide, vérifiez sa source et la terminologie chargée. Activez un workflow désactivé avant de réessayer. Les messages de champ obligatoire utilisent le libellé visible.
