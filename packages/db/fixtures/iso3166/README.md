# ISO 3166-1 country fixture

`iso3166-1.csv` is the authoritative source for the seeded country ValueSet
(`urn:openldr:valueset:country`, migration `073`).

- **Source:** https://github.com/lukes/ISO-3166-Countries-with-Regional-Codes (`all/all.csv`)
- **Licence:** public domain
- **Fetched:** 2026-08-05
- **Verified on fetch:** 249 rows / 249 unique `alpha-3` / 249 unique `alpha-2` / 249 unique
  `name` / 0 malformed alpha-3 codes. 249 is exactly ISO 3166-1's officially-assigned count.

## Why this file exists rather than a derived list

Deriving the list from CLDR (Node's `Intl.DisplayNames`) was tried and **rejected**: it resolves
280 codes, cannot be filtered to 249 without fitting-to-a-target, and it *aliases withdrawn codes
to modern names* (`AN`→Curaçao, `ZR`→Congo - Kinshasa, `SU`→Russia), producing duplicate country
names under different codes.

## How it is used

Migration `073` **inlines** the 249 `[alpha-3, name]` pairs as frozen literals — a migration must
never read a moving file — and a test asserts those literals still equal this fixture. Update both
together, or the test fails.

⚠ Six names carry diacritics (`Åland Islands`, `Côte d'Ivoire`, `Curaçao`, `Réunion`,
`Saint Barthélemy`, `Türkiye`). Keep this file and the migration UTF-8.
