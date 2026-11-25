# Lab plugin errors in the page's language

Date: 2026-11-25. Lab plugin only (batch 3, item A10). Approach chosen by the operator on
2026-11-25: a key per error.

## Why

The plugin builds about 150 different English error sentences (`LabError::invalid`, `conflict`,
`refused`, `not_found` in `src/*.rs`; 58 of them fill in a name, code or number). The page shows
the text as sent (`ui/src/api.ts:148`, `ui/src/notify.ts:17`). A user whose page is in French or
Portuguese reads every refusal in English.

## How Corlix does it

Corlix gives each error a fixed code (`CorlixErrorException('AZ0403', ...)`,
`packages/shared-types/src/errors.ts:71`) and the screen shows one sentence per code from its
en, fr and pt files (`errors.AZ0403`). A test checks every code has all three
(`renderer/i18n/error-codes.test.ts`). The detailed English stays in the log. Ported: one key per
error, words in three languages, a test that none is missing. Not ported: one short sentence per
code. The lab's sentences say what to do next, and those words are kept.

## Approaches

- Chosen: a key and values on each error, the page puts the sentence together in its language.
- Not chosen: one sentence per error kind (Corlix's short form). It loses what to do next.
- Not chosen: the plugin translates. CE would need to pass the user's language to the plugin.

## Design

- **The error.** A keyed error carries `key` (for example `result.locked`), `params` (an object
  of strings or numbers) and the English `message` built from one template, so the CLI, the audit
  and the logs keep reading English. The answer becomes
  `{ "error": { "code", "message", "key", "params" } }`. `code` keeps its meaning.
- **One English template per key, in Rust.** A keyed error is made with the key and its English
  template, such as `"Enter every required parameter before submitting. Missing required:
  {missing}."`, and the values. The message is the template with the values put in.
- **Every plugin sentence gets a key.** Errors that pass CE's own refusal on (`From<HostError>`)
  keep CE's text and get no key: CE's words are CE's to translate. So do the CE broker's
  refusals ("the action ... needs one of these permissions").
- **The page.** `LabError` on the page keeps `key` and `params`. The text shown is: in fr or pt,
  the bundle's `error.<key>` with the values put in; in en, or when the bundle has no such key,
  the English `message`. A value that is a code the page has words for (a status) is shown in
  those words: the builder lists these.
- **Words.** `error.<key>` in fr and pt, in `ui/src/i18n.ts` or a file beside it. English lives
  only in Rust, so the two cannot drift.
- **Tests.** A UI test reads every key and template from `src/*.rs` and checks that fr and pt
  each have the key, with the same `{placeholders}` as the template. A Rust test checks that no
  `LabError` is made without a key, apart from CE's passed-on errors. Existing tests that compare
  a message keep working, because the English is unchanged.

## Not covered

- CE's own errors and the broker's refusals stay in CE's English.
- The French and Portuguese words are mine. A native speaker should read them (C10).

## Proof

- `cargo test`: a keyed error answers `key`, `params` and the same English message as before.
- UI tests: a French page shows the French sentence with its values; an unknown key shows the
  English; every key has fr and pt with matching placeholders.
- Live check on the dev stack: one refusal in each of three areas answers a key and values.
- Screenshot of one refusal toast in French, desktop and 375 px.

## Left to the builder

- Key names (`area.what`, for example `result.locked`, `order.not_found`).
- Which values are codes the page turns into words.
