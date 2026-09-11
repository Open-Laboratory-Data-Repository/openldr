# Facilities

Use Registry to add one facility or import a facility list. Use Observed to review facility
codes received in results and their resolution. Adding a registry row and reviewing an observed
code are separate tasks. The import instructions below cover uploading a whole list.

## English

### Registering a facility by hand

1. Open Facilities, select Registry, then choose Add facility from the ⋯ menu.
2. Choose System from the registered sources. The laboratory setting may prefill it.
   System identifies the register. Its displayed name selects the register's canonical URI.
   An unknown or inactive register is refused. Register a source through the import
   wizard's Source step first if the required register is missing.
3. Enter Facility code and Name. Facility code is the site's code within that register.
   There is one code field, not separate National code and Local code fields.
4. Complete the required fields shown by your published facility form. An administrator
   can change this form, so fields and required markers may differ between installations.
   Add and Edit require permission to manage facilities and a published facility form.
5. For terminology fields such as Country, Level and Status, search and select a result.
   Typing a search does not select an answer. The selected label represents a stored code.
   If no result fits, ask the administrator to check the configured terminology.
6. Choose Create from the sheet's ⋯ menu. When editing, choose Save. A successful save closes the sheet and updates
   the registry table. If validation fails, correct the field errors or the message in
   the sheet, then save again. Reopen the row to check the recorded values.

### Codes and identity

System and Facility code identify the site together. Use the register's exact code,
including leading zeros. The table's Code column shows this same facility code.
A duplicate pair is refused when adding a facility. Find and edit the existing row instead.

You can correct System or Facility code in Edit. A changed System must name an active
registered source. The internal record id stays unchanged. A later import finds the row
by its current System and Facility code; its conflict policy decides which values to keep.
Do not delete and recreate a facility just to correct its code.

## Français

Utilisez Registre pour ajouter un établissement ou importer une liste. Utilisez Observés pour examiner
les codes reçus dans les résultats et leur résolution.

### Enregistrer un établissement à la main

1. Ouvrez Établissements, choisissez Registre, puis Ajouter un établissement dans le menu ⋯.
2. Choisissez le champ System parmi les sources enregistrées. Le paramètre du laboratoire peut le préremplir.
   Système identifie le registre. Le nom affiché sélectionne son URI canonique.
   Un registre inconnu ou inactif est refusé. Si le registre manque, enregistrez une source
   dans l'étape Source de l'assistant d'importation avant de continuer.
3. Renseignez Facility code et Name dans le formulaire par défaut. Ce code identifie le site dans ce registre.
   Le formulaire contient un seul code, sans champs distincts Code national et Code local.
4. Remplissez les champs obligatoires du formulaire d'établissement publié. Un administrateur
   peut modifier ce formulaire. Les champs et leurs obligations peuvent donc varier.
   Ajouter et Modifier nécessitent le droit de gérer les établissements et un formulaire publié.
5. Pour les champs terminologiques comme Pays, Niveau et Statut, recherchez puis sélectionnez un résultat.
   Saisir une recherche ne sélectionne aucune réponse. Le libellé sélectionné représente un code enregistré.
   Sans résultat adapté, demandez à l'administrateur de vérifier la terminologie configurée.
6. Choisissez Créer dans le menu ⋯ du panneau. Pour une modification, choisissez Enregistrer. Après succès, le panneau se ferme
   et le tableau du registre est mis à jour. En cas d'échec, corrigez les erreurs
   indiquées dans les champs ou le panneau, puis réessayez. Rouvrez la ligne pour vérifier les valeurs.

### Codes et identité

Système et Code de l'établissement identifient ensemble le site. Utilisez le code exact du registre,
y compris les zéros initiaux. La colonne Code du tableau affiche ce même code.
L'ajout refuse une paire déjà présente. Recherchez et modifiez plutôt la ligne existante.

Vous pouvez corriger Système ou Code de l'établissement dans Modifier. Un nouveau Système doit désigner
une source enregistrée active. L'identifiant interne reste inchangé. Un import ultérieur retrouve la ligne
par son Système et son Code actuels. Sa politique de conflit décide quelles valeurs conserver.
Ne supprimez pas un établissement pour corriger son code.

## Português

Use Registo para adicionar uma unidade ou importar uma lista. Use Observadas para rever os códigos
recebidos nos resultados e a sua resolução.

### Registar uma unidade manualmente

1. Abra Unidades, escolha Registo e selecione Adicionar unidade no menu ⋯.
2. Escolha o campo System entre as fontes registadas. A definição do laboratório pode preenchê-lo previamente.
   Sistema identifica o registo. O nome apresentado seleciona o URI canónico desse registo.
   Um registo desconhecido ou inativo é recusado. Se faltar o registo, registe uma fonte
   no passo Origem do assistente de importação antes de continuar.
3. Preencha Facility code e Name no formulário predefinido. O código identifica o local dentro desse registo.
   Existe um único campo de código, sem campos separados para Código nacional e Código local.
4. Preencha os campos obrigatórios do formulário de unidade publicado. Um administrador pode
   alterar esse formulário. Os campos e os requisitos podem variar entre instalações.
   Adicionar e Editar exigem permissão para gerir unidades e um formulário publicado.
5. Nos campos de terminologia, como País, Nível e Estado, pesquise e selecione um resultado.
   Escrever uma pesquisa não seleciona uma resposta. O nome selecionado representa um código guardado.
   Sem um resultado adequado, peça ao administrador para verificar a terminologia configurada.
6. Escolha Criar no menu ⋯ do painel. Ao editar, escolha Guardar. Após guardar, o painel fecha e a tabela
   do registo é atualizada. Se a validação falhar, corrija os erros dos campos ou a mensagem
   do painel e tente novamente. Reabra a linha para verificar os valores guardados.

### Códigos e identidade

Sistema e Código da unidade identificam o local em conjunto. Use o código exato do registo,
incluindo zeros iniciais. A coluna Código da tabela apresenta esse mesmo código.
A criação recusa um par já existente. Procure e edite a linha existente.

Pode corrigir Sistema ou Código da unidade em Editar. Um novo Sistema deve identificar uma fonte
registada ativa. O identificador interno permanece igual. Uma importação posterior encontra a linha pelo
Sistema e Código atuais. A política de conflitos decide quais os valores a manter.
Não elimine uma unidade apenas para corrigir o código.

## The import contract

Every import — from the Studio wizard or the CLI — targets the same fixed set of fields:
`national_code` and `name` (required), plus `level`, `ownership`, `status`, `country`, `zone`,
`region`, `district`, `council`, `ward`, `village`, `address`, `phone`, `latitude`, and
`longitude` (optional). A national file's headers rarely match these names exactly — a Zambian
export might call the code column `MFL Code` and the region column `Province`.

## What a column map is

A **column map** is the translation from a file's own headers to the contract above. Its keys
are **the file's own header text, exactly as it appears in the file** — never the contract's
field names. A header you choose to map ends up in one of three places:

- **Mapped** to one contract field. Two headers can never map to the same field: the importer
  refuses rather than guess which one should win.
- **A fixed value (`constants`)**, for a contract field no column in the file carries at all. A
  national file usually has no `country` column, so `country` is normally supplied this way.
  `level`, `status` and `country` are bound to value sets. A value differing from the vocabulary only
by capitals, or by writing Centre where it writes Center, resolves automatically to the vocabulary's
code, with the register's own words kept on the row; a mapping made by hand always takes precedence
over that. In the studio their fixed value is picked
  from a list and stored as the code; through the CLI's `--column-map` file a `constants` entry for
  one of those three should be a code or a display from that field's value set, or the import writes
  it through as typed and reports it as unmapped.
- **`extras`**, kept on the record but not treated as a contract field.

Not every header needs a decision. One left out of the map still claims its field on its own if
it already spells a contract field's name exactly (a **passthrough** column) — and one that
spells nothing on the contract is refused, unless `allowUnknownColumns` is set, which routes it
to `extras` the same way listing it there explicitly would.

That refusal applies only when there is NO `columnMap`. A map is the decision about every column, so
with one present an unmapped column is carried into the record's `extras` and the file parses
normally. `unknownColumns` is still reported either way, as a statement about the file rather than a
refusal.

Without a map, a CSV with an unknown header parses nothing and the run reports `blocked` with
`blockedReason: "unknown-columns"`. That reason is therefore reachable only in the no-map case. The
flag is read by the parser, so it belongs to the upload, and a confirm carrying it is refused. A
JSONL release never blocks on this: each line names its own fields, and the flag is a documented
no-op.

```json
{
  "columns": { "MFL Code": "national_code", "Name": "name", "Province": "region" },
  "constants": { "country": "ZMB" },
  "extras": ["DHIS2 UID", "Hims code"]
}
```

## The import wizard's three steps

The Studio wizard has three steps: Source (pick the file and register), Mapping (every
decision: the column map, fixed values,
what to do with conflicts, absences and deletions, and the value map), and Review (a read-only
report of what the check found, plus Apply).

Move between them with the step strip at the top. There is no separate Back button.

### The status icon on each mapping row

Every row on the Mapping step carries a small icon next to its field picker, with four states:

- An amber information circle: the row has not been checked yet.
- A green tick in a circle: it has been checked, and nothing is wrong.
- A red circle: something is wrong. The row says what, in a line under it.
- A gray circular arrow: the mapping changed since its last check.
- A muted circle with a dash: the column is kept as extra data, claims no contract field, and has
  nothing to check. The icon does nothing on those rows.

Each state has its own shape, not just its own colour, so they still read apart on a phone.

Clicking the icon checks that one column only. It reads that column's values back from the file
already stored at Source, and does not re-check the whole file or send it again. No row turns green
on its own: the suggestion scores the column's NAME and cannot know what is inside the column. Use
Validate all when you want every column checked at once.

A controlled field's unrecognised values appear under the mapping row that produced them, each with
a pick list. There is no Save button: the row's status icon is the save. Pressing it writes that
row's picks, re-reads the column, and turns the row green if nothing is left. Validate all does the
same for every row first. Until then the row's line says what is waiting, for example "4 value(s)
are not recognised. 2 chosen, not saved yet". Writing does not make the rows vanish, so a choice can
still be corrected; the values that were written simply stop counting against the row.

A level value that belongs to no type can be picked as **Ignore this value**, at the top of the
list: it imports exactly as written and stops being counted, and the choice is remembered so the
next import of the same file does not ask again. Status and Country have no such option, because
their vocabularies are small and closed.

A level value the list does not have can instead be picked as **Add "…" as a new type**, at the
same spot. The confirm that opens lets you correct the name; the code it will get is shown but not
editable. The type reaches that register only, and every other register keeps its own list unchanged.
A name that already matches an entry is refused, naming what it matched, rather than added as a
second entry that would leave both unresolved. Adding a type needs the `terminology.manage`
capability as well as `facilities.manage`; without it the option is disabled, and mapping and
ignoring still work. The CLI has the same write:

```bash
./openldr facilities add-type "First-aid stations" --national-system urn:zm:mfl
```

Mapping decides; Review reports. If a check turns up something worth changing, go back to Mapping,
change it, and come forward again. **A file uploaded through the background door is checked again in
place**, against the copy the server already holds, so a national register is never sent twice to
fix one column map. Headless installs get the same thing as
`openldr facilities import-run-revalidate <id> --column-map <file.json>`. Changing anything on Mapping discards the last Review, so a
summary that no longer matches what is about to be imported is never left on screen. The conflict,
absent and deleted choices are the exception: they are applied at import time rather than when the
file is read, so they cannot change what a check found and do not discard it.

## Getting a suggested map

Both surfaces can propose a map from a file's headers offline, with no server round trip:

- **Studio wizard:** open **Facilities → Import**, choose the file, and the column-mapping step
  opens with a suggestion already filled in. Every row starts amber, because nothing has read the
  file yet; each row's status icon, described above, checks that one column on its own.
- **CLI:** put the CSV in the install directory's `data/` folder first, so the wrapper can
  see it.

  ```bash
  ./openldr facilities suggest-map data/national-facilities.csv
  ```

  This prints the suggested map as a table, flags any collision the suggestion itself would
  cause, and tells you how to feed the result back in:

  ```bash
  ./openldr facilities import data/national-facilities.csv \
    --national-system urn:zm:mfl --column-map data/mapped.json
  ```

`import` without `--apply` is always a dry run: it parses, validates, and reports — it writes
nothing. Add `--apply` once the preview looks right.

## Refusals, and how to repair them

An import whose column map has a problem writes nothing, and reports every problem at once so
one fix pass repairs the file:

| Reason | Meaning | Repair |
| --- | --- | --- |
| `duplicate_target` | Two headers claim the same contract field — by being mapped to it, **or just by spelling it** (a `Zone` column claims `zone` even when shown as `Not mapped`). | Keep one; set the other to `Not mapped`, which moves its values to `extras`. |
| `constant_collision` | A fixed value and a mapped (or already-matching) header both claim the same field. | Keep only the fixed value or the column mapping for that field, not both. |
| `unknown_target` | A header maps to a name outside the contract. | Fix the target name, or route it to `extras` if it truly does not belong. |
| `missing_required` | `national_code` or `name` has neither a column nor a fixed value. | Map a column, or add a `constants` entry, for the missing required field. |

> **The real-file trap.** A national export commonly carries near-duplicate headers — both
> `Province` and `Zone`, both `Ownership` and `Ownership type`. Map each pair onto **different**
> contract fields (or send the extra one to `extras`); mapping both to the same field is exactly
> what `duplicate_target` exists to catch.

## Columns vs. values

A column map and a value map solve different problems, and behave differently when incomplete:

- **An unmapped required column blocks the whole import.** `national_code` and `name` must
  resolve from somewhere before any record is written.
- **An unmapped value imports anyway.** If a controlled field (`level`, `status`, `country`)
  contains a raw value your value set does not recognize, the row still imports with that raw
  text, and the value is reported so it can be mapped afterward — nothing blocks on it.

## Registering a facility by hand

Most facilities arrive by import. One can also be added from the Facilities page, and a facility that
exists in the national list should be registered as such rather than as a purely local one.

**Two codes, and they differ.** The **national code** is what the master facility list carries; the
**local code** is the site's own numbering. Both are optional, but at least one must be present. The
Facilities table shows the local code when there is one and falls back to the national code —
the same rule the rest of the system uses to give a facility its public code.

**The register decides the identity.** A facility's permanent id is derived from its facility
register plus its national code. Supply both and the facility is filed under exactly the identity a
CSV import of that register would give it, so a later import updates that row instead of creating a
second one. Leave the national code empty and the facility keeps a private id — correct for a site
that genuinely is not in the national list. The register must already exist on the install; an
unknown or deactivated one is refused.

**Neither is editable afterward.** The national code and the register are part of a facility's
identity, so they are fixed once it is created. Moving either would leave the row filed under an id
its own code no longer produces, and the next import would not find it. A facility created without a
national code cannot acquire one — delete it and register it again.

**Two fields are deliberately not required**, because no national register can be assumed to supply
them: the local code (an import never produces one) and the region (not every country has a tier
there). Editing an existing facility re-checks only the fields actually changed, so an imported
facility with a gap stays editable.

## Related

- [Load & push data](/docs/load-data)
- [CLI](/docs/cli)

## Deleting in bulk

`POST /api/facilities/bulk-delete` removes every facility a selection matches. The selection is the
same shape `GET /api/facilities` accepts, minus paging and sorting.

`expectedCount` is required and is the contract: the route re-resolves the selection and answers
409 unless it still matches exactly that many, so a set that moved between review and confirmation
deletes nothing. `POST /api/facilities/bulk-delete/preview` returns `total`, `inUse` (how many the
`facility_map` dimension points at, or `null` when the warehouse could not be reached) and a small
`sample` for the operator to recognise.

Two selections are refused outright rather than narrowed or widened: a `filters` string that does
not parse, and any selection carrying `health`, which is a join predicate the delete cannot express.
