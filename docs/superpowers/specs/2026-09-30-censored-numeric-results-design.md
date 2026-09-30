# Numeric results outside the reporting range ("< 20", "> 10000000")

Date: 2026-09-30. Status: design agreed in chat, awaiting spec review.
Spans cdr-toolchain (decoder and wire) and CE (one column and the projection).

## 1. The user action that is broken today

A viral load report in CE undercounts suppressed results. 227 Tanzania viral loads that v1 shows as
`< 20` never reach CE: CE holds only the comment `SCOM=TLINT` for them. Any VL suppression or
"target not detected" count on CE is wrong by that amount (found while checking the DISA VL pack,
2026-09-30).

## 2. Evidence

| Fact | Proof |
|---|---|
| DISA stores "below the limit" as a numeric 0 | TESTDATA item HIVVM for TDS0054052: value bytes 7-10 all zero |
| Byte 6 of each 12-byte item marks "a value was entered" | Sample of 2,497 HIVVL rows: zero value + byte 6 = 9 gives v1 `< 20` (210 rows); zero value + byte 6 = 0 gives no v1 row (1,241); non-zero + byte 6 = 9 gives a number (796) |
| disalab never reads byte 6 and drops all-zero values | `cdr-toolchain packages/disalab/src/lib/orderitem.ts:46` (`IsResulted` from non-empty value bytes); `:112` reads byte 5 a second time |
| The reporting range is in the parameter record | PARMDICT_STATUS float at byte 103 = high limit, byte 107 = low limit: HIVVM 10,000,000 / 20, HIVVQ 3,000,000 / 40, HIVTL 6.7 / 0 |
| v1 shows every numeric result outside the range as `< low` or `> high` | v1 LabResults (Tanzania): HIVVM `< 20` 27,378 rows, HIVVM `> 10000000` 818, HIVVQ `< 40` 1,693, SUREA `< 1.00` 758, TSH `< 0.14` 357 |
| v1 treats a limit of 0 as a real limit, which is wrong | ARTCD `> 0` on 14,625 rows: every value above a high limit of 0 |
| CE cannot store a comparator today | `packages/db/src/relational/observation.ts` ignores `valueQuantity.comparator`; `lab_results` has no column for it |
| Only stored zeros are lost; measured values outside the range already reach CE as plain numbers | 94 censored HIVVM results entered as the coded value `<20CP` arrive; SUREA 0.5 and HIVVM 12,000,000 arrive as numbers |

## 3. Decisions

| # | Decision |
|---|---|
| D1 | Apply v1's rule to every numeric result (operator, 2026-09-30): below the low limit is sent as `<` with the low limit; above the high limit as `>` with the high limit. |
| D2 | A limit of 0 means "no limit". This departs from v1 on purpose, so ARTCD's `> 0` is not copied. |
| D3 | An entered numeric 0 (byte 6 not 0) is a result, not an empty slot. |
| D4 | The measured value is not sent when a comparator applies. DISA keeps it, so a re-push can restore it if the rule changes (operator: "if that's what they want we will change it later"). |
| D5 | The limit offsets (103, 107) are measured on Tanzania only and go in `config/<country>.yaml`, like the other DISA offsets. An unconfigured deployment sends plain numbers (after D3) and no comparator. |
| D6 | The entered flag (byte 6) is part of the fixed 12-byte item layout the decoder already hardcodes, so it stays in disalab code. |
| D7 | CE gains `lab_results.numeric_comparator`. The slot is standard (FHIR `Quantity.comparator`, HL7 v2 SN data type), so it passes the warehouse column rule in AGENTS.md section 8. |

## 4. Design: cdr-toolchain

### 4.1 Decoder (disalab)

`OrderItem.Parse` reads byte 6 of each item as the entered flag and passes it to the constructor.
For a numeric item (type 1 or 2), `IsResulted` is true when the flag is not 0, even if the value
bytes are all zero; the value then decodes to 0. Other types are unchanged.

### 4.2 The limits (config and codebook)

- `config/tanzania.yaml` gains `disa_parmdict_offsets: { high_limit: 103, low_limit: 107 }` (floats,
  little-endian), with the measurement noted.
- The codebook's parameter entry gains `lowLimit` and `highLimit` (`number | null`), read from the
  PARMDICT record with those offsets. 0 and unconfigured both give null.

### 4.3 The rule (v2-transform)

For each numeric result with a numeric value `v` and its parameter's limits:

- `lowLimit !== null && v < lowLimit`: comparator `<`, value `lowLimit`.
- else `highLimit !== null && v > highLimit`: comparator `>`, value `highLimit`.
- else: no comparator, value `v`.

A value equal to a limit is not censored. The V2 result carries `numeric_value` (the limit when a
comparator applies), `result_value` as `< 20` or `> 10000000` (v1's text form), and the comparator in
`raw_result.numeric_comparator` (v2 stores `raw_result` as free JSON; no new V2 field).

### 4.4 The wire (fhir-transform)

The Observation's `valueQuantity` gains `comparator` (`<` or `>`) when present. The value is the
limit. The unit is unchanged.

## 5. Design: CE

- Warehouse migration `020`: `lab_results.numeric_comparator` (text, nullable), on Postgres, SQL
  Server and MySQL.
- `projectObservation` reads `valueQuantity.comparator`, keeping only `<`, `<=`, `>=`, `>`; anything
  else is null. `result_type` stays `NM`.
- Types, `EXTERNAL_TABLE_COLUMNS`, and any test that pins the `lab_results` column list are updated.
- Docs (en, fr, pt) and the web docs: one line where the warehouse's result columns are described.
- The DISA pack query (outside git) builds v1's `LIMSRptResult` as the comparator, a space and the
  number when a comparator is present.

## 6. Order of work

1. CE: migration 020, projection, docs. Additive and safe to merge first.
2. cdr-toolchain: decoder, limits, rule, wire.
3. Re-push the Tanzania sample and compare with v1: the 227 `< 20` rows, `> 10000000`, `< 40`,
   `< 1.00`, and that ARTCD values stay plain numbers.

## 7. Testing

- CE: projection tests for each comparator and for an unknown one; migration tests on three engines.
- cdr-toolchain: decoder tests (entered zero, never-entered zero, non-numeric types unchanged);
  config loader tests; rule tests (below, above, equal, limit 0, unconfigured); FHIR tests and the
  HL7 validator run.
- Live: re-push and compare as in section 6.3.

## 8. Out of scope

- Keeping the measured value next to the comparator (D4).
- v1's decimal formatting of the limit in `result_value` (`< 1.00`); CE stores a number.
- Mozambique's own limits and item layout (HONEST NON-PROOF until measured).
