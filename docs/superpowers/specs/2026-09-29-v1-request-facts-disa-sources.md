# Where DISA keeps each v1 request fact

24 facts: 14 source found, 4 source found differs from v1, 6 no source found.

Date: 2026-09-29. Task 1 of the v1 request facts plan. Background: `2026-09-29-v1-request-facts-design.md` sections 4 and 6.

All file:line citations below are in `D:/Projects/Repositories/cdr-toolchain` unless they say otherwise.

## How this was measured

- Data: the local `sqlserver` container. DISA is `DisalabData`, `DisaGlobal` and `DisalabDict`. v1 is `OpenLDRData.dbo.Requests`, joined on `RequestID = 'TZDISA' + LabNo`.
- All data is Tanzania (TDS). Nothing here proves anything about Mozambique.
- Sample: `abs(checksum([LabNo])) % 500 = 0` gives 211 labs. I took the stable subset `abs(checksum([LabNo])) % 2000 = 0`. Every lab in it is also in the `% 500` set. That gives 75 labs. 66 of them are in v1, with 136 v1 rows (one row per ordered panel).
- Two facts are rare in that sample, so I added targeted samples. Rejection: v1 labs with a rejection code, filtered by `% 80 = 0`, which gives 84 labs and 177 rows. Therapy: all 9 TDS labs where v1 has therapy, 68 rows.
- Where a candidate source was clean on the sample, I also checked it against the whole TDS population with one SQL query over the raw blob bytes.
- Empty means a trimmed empty string. For numbers, 0 counts as empty, because v1 writes 0 as a filler.
- "Match" in my own counts means both sides hold the same value. "Both empty" is counted separately.
- The compare gate (`apps/cli/src/compare/v2-mapping.ts`) already grades the V2 payload. I ran `compare-batch --v2` on the same 75 labs and quote its figures in the "V2 today" column.
- My own comparison script is `facts.mts` in the session scratch folder. It reads DISA through the disalab decoders and reads the raw blob bytes. Every query was read-only.

## The facts

"In V2" means the field already exists in `V2LabRequest` (`apps/cli/src/export/types.ts:30-71`).

| Fact | DISA source | In V2 | V2 today (gate, 136 rows) | Candidate vs v1 | Verdict |
|---|---|---|---|---|---|
| obr_set_id | 1-based position in REGDAT4 TestOrders (`apps/cli/src/export/obr-sets.ts:56-64`, `packages/disalab/src/lib/DisalabData/REGDAT4.ts:145-151`) | yes | 136 match | same as gate | source found |
| analysis_at | TESTDATA_STATUS header bytes 15-20: day, month, year (2 bytes), minute, hour. Not decoded today. | yes, always null (`apps/cli/src/export/v2-transform.ts:333`) | 136 only v1 | sample 136 of 136 match. Population: 169,844 match, 836 only DISA, 0 mismatch | source found |
| point_of_care | Facility name from LOCNDIC4 (`packages/disalab/src/lib/Forms/specimenrecpt.ts:98-116`) plus ward (`specimenrecpt.ts:118`, WARDDICT) | yes, as two parts (facility display name and `source_payload.ward`) | not graded, see exception at `v2-mapping.ts:465-483` | DISA gate grades the split: facility_name 66 of 66, ward 66 of 66 labs (`apps/cli/src/compare/mapping.ts:104`, `:119`) | source found |
| section_code | DisaGlobal TESTDICT.SECTION, a real SQL column (`apps/cli/src/export/codebook.ts:170-184`) | yes, the raw letter (`v2-transform.ts:321`, `:343`) | 0 match, 83 mismatch, 53 only v1 | with the v1-transform letter map (`apps/cli/src/export/v1-transform.ts:34-44`): 129 of 136 match. The 7 misses are letter L and blank sections | source found, differs from v1 |
| request_type | REGDAT4 blob byte 333: 0 means D, 8 means E. Not decoded today. | no | 136 only v1 | sample 136 of 136. Population: 93,161 of 93,161 D and 5,098 of 5,098 E requests agree | source found |
| registered_by | REGDAT4 blob bytes 135-138, user initials. Decoded as `ReceivedBy` (`REGDAT4.ts:99`) but SpecimenRecpt drops it. Names from DisalabDict USERDIC6. | no | 2 match, 134 only v1 | population: 170,284 match, 3,631 mismatch, 346 both empty | source found, differs from v1 |
| tested_by | TESTDATA_STATUS header bytes 74-77, tester initials, named through USERDIC6. Not decoded today. | yes, from the wrong field (`v2-transform.ts:359` uses ReceivedInLabBy) | 4 match, 68 mismatch, 63 only v1 | population: 158,327 match, 7,506 mismatch, 811 only DISA | source found, differs from v1 |
| authorised_by | TESTDATA_STATUS header bytes 77-80, reviewer initials. Already decoded for status (`packages/disalab/src/lib/DisalabData/testdata-header.ts:20-22`), not used for the name. | yes, always null (`v2-transform.ts:360`) | 16 match, 120 only v1 | population: 153,239 match, 3,830 mismatch, 849 only DISA | source found, differs from v1 |
| requester_practitioner | REGDAT4 `Ref_Dr` bytes 513-548, else `Ref_Dr_ID` 507-511 (`REGDAT4.ts:130-131`) | yes (`v2-transform.ts:358`) | 121 match, 15 only V2 | same as gate | source found |
| age_years | REGDAT4 blob byte 414. Not decoded as an age today. | yes, computed from date of birth (`v2-transform.ts:818`) | 54 match, 82 only v1 | sample 104 match, 0 mismatch. Population: 124,736 match, 0 mismatch, 49,525 both empty | source found |
| age_days | REGDAT4 blob bytes 417-418, little-endian total days. Not decoded today. | yes, computed from date of birth (`v2-transform.ts:819`) | 12 match, 42 mismatch, 82 only v1 | sample 113 match, 0 mismatch. Population: 139,113 match, 0 mismatch, 35,148 both empty | source found |
| clinical_info | TXT1DATA frame 12, else REGDAT4 `DiagCln` bytes 334-339 (`REGDAT4.ts:128`, `:186-187`) | yes (`v2-transform.ts:335`) | 136 match, 26 of them non-empty in v1 | same as gate. v1 wraps codes in brackets (`v1-transform.ts:289-295`) | source found |
| analyzer_code | TESTDATA_STATUS header bytes 56-61, instrument code. Not decoded today. | no | 61 match, 75 only v1 | sample 75 of 75 non-empty match. Population: 170,465 agree, 215 only DISA, 0 mismatch | source found |
| rejection_code | RJREA observation on the rejected panel, raw code (`OrderItem.RawValue`, `packages/disalab/src/lib/orderitem.ts:15-21`). Read today only as a yes/no (`apps/cli/src/compare/result-mapping.ts:660-712`). | no | 135 match, 1 only v1 | rejected sample, 177 rows: 98 match, 79 both empty, 0 mismatch | source found |
| rejection_reason | Same RJREA observation, decoded text (`OrderItem.Value`) | no | 135 match, 1 only v1 | same 177 rows: 98 match, 79 both empty, 0 mismatch | source found |
| therapy | TXT1DATA frame 21, else REGDAT4 `Therapy` bytes 340-344 (`REGDAT4.ts:126`, `:184-185`) | yes (`v2-transform.ts:337`) | 136 match, but v1 has no therapy in this sample | therapy sample, 9 labs and 68 rows: 68 match | source found |
| ordering_notes | REGDAT4 `FolderNumber` bytes 427-442 (`REGDAT4.ts:107`, `specimenrecpt.ts:119`) | no | 136 only v1 | sample 136 of 136. Rejected sample 177 of 177 | source found |
| collection_volume | none | no | 104 match, 32 only v1 | every non-zero v1 row holds the same value, 5.76e19. That is 36,374 TDS rows. It is not a volume. | no source found (ships empty) |
| cost_units | none | no | not graded | all 36,374 non-zero v1 rows hold values like 4.2e72 and 2.1e106. None is a plausible cost. | no source found (ships empty) |
| encrypted_patient_id | none | no | not graded | v1 fills 88,115 of 174,261 TDS rows with 20 hex digits, for example `0000000AE5F386BA9A97` | no source found (ships empty) |
| vendor_code | none in the data | no | 92 match, 44 only v1 | v1 holds the literal `DISA` on 46,381 TDS rows and NULL on 127,880 | no source found (ships empty) |
| deceased | none | no | not graded | v1 has 0 deceased TDS rows, so nothing to test | no source found (ships empty) |
| newborn | REGDAT4 blob byte 409, bit value 2. Not decoded today. | no | not graded | population: 3 of 3 v1 newborn requests have the bit. 0 of the other 98,256 requests have it. | source found |
| repeated | none | no | not graded | best candidate fires on 1,435 panels. v1 marks only 3 of them. | no source found (ships empty) |

## Detail per fact

### analysis_at

The first 80 bytes of `TESTDATA_STATUS` are a header (`testdata-header.ts:9`). Bytes 15-20 use the same six-byte datetime layout as `FromDisaDatetime` (`packages/disalab/src/lib/core.ts:78-117`, the function starts at `:101`): day, month, year low byte, year high byte, minute, hour.

Example, lab TDS0012383, panel PROT: the header gives 2013-08-05 20:55, and v1 has 2013-08-05 20:55. The audit log has the first insert at 20:53 and a change at 20:55, so the header holds the time of the latest result entry.

The v1 exporter reads this fact from audit code WL101 (`v1-transform.ts:192-199`). My sample labs log result entry as WP101 or SL101, so that path would miss them.

Use the first iteration of a panel when a panel has reruns. On the therapy sample, the first iteration matched 68 of 68 and the last matched 67. On the rejected sample, the first matched 177 of 177 and the last matched 169.

### tested_by, authorised_by, registered_by

The initials in DISA match v1. The names differ in 2 to 4% of rows. v1 stores the name from USERDIC6 as it was when v1 was loaded. Today's USERDIC6 has changed some names. Examples:

- initials SMM: USERDIC6 says "Sylvester Mattunda", v1 says "Sylvester Mbanga  Medical Technologist".
- initials RJB: USERDIC6 says "Regnald Julius (RJB Medical Sc", v1 says "Regnald Julius  Medical Scientist".
- v1 often adds a job title after two spaces, for example "Ester Mwavika  Medical Technologist". My population counts treat a v1 name that starts with the USERDIC6 name as a match.
- v1 keeps raw initials for some users, for example "SBS" and "RIS". Those count as a match on the initials.

The tested and authorised counts use panels that appear once per lab in both DISA and v1. That is 170,680 of 174,261 TDS rows. The registered by count uses all 174,261 rows.

Registered by: the audit log's first WS100 event names the same user as REGDAT4 bytes 135-138. The audit path gave 18 extra names on rows where v1 is empty. The blob path gave none. I prefer the blob bytes.

### section_code

TESTDICT.SECTION against v1 HL7SectionCode, whole TDS population (174,261 rows):

| DISA letter | v1 code | rows |
|---|---|---|
| V | VR | 55,134 |
| S | SR | 12,713 |
| L | OTH | 6,327 |
| C | CH | 4,433 |
| M | MB | 1,869 |
| H | HM | 1,544 |
| P | PAR | 29 |
| B | BLB | 1 |
| G, HT, TB | OTH | 7 |
| blank | OTH | 91,679 |
| blank | SR, MB, BLB | 514 |
| panel not in TESTDICT | CH, OTH | 11 |

So the letter maps one to one, except 520 rows (0.3%) where the letter is blank or missing and v1 has a real code. The v1 exporter's map (`v1-transform.ts:34-44`) passes L, P, B, G, HT and TB through unchanged. All six are wrong that way. Other Tanzanian labs in v1 also use SP and CP, which TDS never produces. AGENTS.md section 8 says this map must come from config, not source.

### request_type

Every TDS request in v1 is D (93,161 requests) or E (5,098). REGDAT4 byte 333 is 0 on every D request and 8 on every E request, with no exceptions. E requests are quality and proficiency panels: QS001, QS002, QSFIN, QSPIN and EQAM1 are almost only E.

The v1 exporter writes the constant D (`v1-transform.ts:283-287`). Its comment says 100% of rows are D. That is false for 5,098 TDS requests.

### age_years and age_days

REGDAT4 bytes 414 to 418 hold the age at registration: byte 414 is years, 415 is months, 416 is days, and bytes 417-418 are total days as a little-endian number. Example, lab TDS0014360: years 1, months 9, total days 640. v1 has 1 and 640.

Byte 414 equals v1 AgeInYears on every TDS row. Bytes 417-418 equal v1 AgeInDays on every TDS row.

The V2 payload instead computes age from date of birth and the received date (`v2-transform.ts:815-821`). The gate shows that misses 82 of 136 rows and gets days wrong on 42.

Side note, not fixed: `core.ts:199-201` reads byte 418 as hours when it builds the date of birth. Byte 418 is the high byte of total days.

### rejection_code and rejection_reason

v1 fills the rejection on the rejected panel only. The other panels of the same request stay empty. That matches reading RJREA per panel. Example, lab TDS0012201: code `CONU`, text "Spec contaminated with urine".

One exception: on TDS0012201 panel 2, DISA has RJREA and v1 has no rejection. That is one row in the newborn sample.

### newborn

Only 3 TDS requests are newborn in v1: TDS0010163, TDS0012201 and TDS0060093. All 3 have bit value 2 set in REGDAT4 byte 409. No other request has it. Three positives is a thin base. The bit is proven only for TDS.

The v1 exporter's rule, age under 28 days (`v1-transform.ts:321`), is wrong here. 376 TDS rows are under 28 days old and v1 does not mark them newborn.

### Facts with no source

- collection_volume and cost_units: v1's non-zero values are not data. Every non-zero CollectionVolume is 5.7646075230342349E+19. CostUnits takes six values between 7.7E+38 and 2.1E+106. They look like bytes read as a float by v1's own loader. Shipping empty loses nothing real.
- encrypted_patient_id: I searched the REGDAT4 blob of TDS0015318 for the v1 bytes and found nothing. I also checked the patient index tables RLNKIDX4, RIDNIDX4 and RLIDIDX4. None holds it. The name suggests v1's loader computed it.
- vendor_code: v1 holds `DISA` or NULL. That names the LIMS product. No DISA field decides which rows get it. A site config constant could send `DISA` if the operator wants it.
- deceased: TDS v1 has no deceased rows, so no candidate can be tested. REGDAT4 byte 409 is a bit field. Byte 409 holds the value 4 on 2 requests that v1 does not call deceased or newborn. HONEST NON-PROOF: a DISA site with deceased patients in v1 would prove or refute a bit in byte 409.
- repeated: v1 marks 3 panels as repeated. All 3 have more than one TESTDATA row for the panel. But 1,432 other panels also have more than one TESTDATA row, and v1 does not mark them. So that is not the rule. I found no other candidate.

### Plain SQL columns are not the source

REGDAT4 and TESTDATA both have plain columns with tempting names: Registered_By, Age_Years, Birth_Date, INSTRUMENT, TESTERINIT, REVIEWINIT, TESTEDDATE. On the 75 sample labs every one of the REGDAT4 columns is empty. On all 191,121 TESTDATA rows every one of those TESTDATA columns is empty. The values live in the blobs.

## Mozambique

Every offset above was measured on TDS data only. `testdata-header.ts:17-20` warns that DISA versions vary even inside one database. HONEST NON-PROOF for Mozambique on every row. What would prove it: a Mozambique DISA copy and its v1 `Requests` table, then the same script run against them.

## Things noticed, not fixed

- `cdr export --type v1` failed on 31 of the 75 sample labs with "raw.trim is not a function".
- `compare-batch` found 9 of the 75 sample labs missing from v1.
- The v1 exporter writes request type D for every row, derives newborn from age, and reads analysis time from audit code WL101. All three are wrong on TDS, as shown above.
- `core.ts:199-201` treats byte 418 as hours when building the date of birth.
