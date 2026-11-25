# Lab plugin errors in the page's language: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every error the lab plugin makes reaches a French or Portuguese page in that language,
while the CLI and logs keep the same English.

**Architecture:** One catalog file in Rust, `src/messages.rs`, holds every error's key and English
template. `LabError`'s constructors take an entry of that catalog and the values, so the compiler
refuses an error without a key. The answer adds `key` and `params`. The page puts the fr or pt
sentence together from `ui/src/error-words.ts`; a test reads the catalog and checks both languages.

**Tech Stack:** Rust (`cargo test`, `tests/fake_host.rs`), React + vitest UI.

**Spec:** `docs/superpowers/specs/2026-11-25-lab-error-language-design.md`

## Global Constraints

- The English `message` of every error stays word for word what it is today.
- Answer shape: `{ "error": { "code", "message", "key", "params" } }`; `params` is an object of
  strings or numbers, `{}` when the template has none. `code` is unchanged.
- Errors from CE (`From<HostError>`) and the broker keep CE's text and have no `key`.
- Text outside `error` (`autoReleaseError`, a send's `error`) is not in scope: it stays English.
- In en the page shows `message`. In fr or pt it shows `error.<key>` from `error-words.ts` with
  the values put in, else `message`.
- No em dashes in any text written.

## Review Focus

1. A value that is a status code inside a sentence (`This test is {status}`): fr shows the status in French.
2. A template whose placeholder has no value: the English shows the placeholder, never panics.
3. The `keep_held` error in `results.rs` that wraps another error's message: still keyed, still English inside.
4. A keyed error passed through `?` into another action's answer: it keeps its key.
5. Two catalog entries with the same key: the UI test fails.

---

### Task 1 (plugin): the catalog, keyed errors, every call site

**Files:**
- Create: `src/messages.rs` (`pub struct Msg { pub key: &'static str, pub en: &'static str }`, one
  `pub const` per message, grouped by file area: `order.*`, `sample.*`, `result.*`, `reject.*`,
  `return.*`, `patient.*`, `list.*`, `settings.*`, `send.*`, `facility.*`, `desk.*`)
- Modify: `src/error.rs` (`key: Option<&'static str>`, `params: Value`; `not_found`, `conflict`,
  `invalid`, `refused` become `(msg: &'static Msg, params: Value) -> LabError`; `fn render(en, &params) -> String`
  replaces `{name}` with the value as text and leaves an unknown placeholder as is; `to_json` adds
  `key` and `params` when `key` is set), `src/lib.rs` (`pub mod messages`), every `src/*.rs` call
  site, the `keep_held` build at `src/results.rs:1365`, the string constants `HELD_BY_CE`,
  `BEING_AUTHORISED`, `HOLD_STALE` (become `Msg`s; tests compare `.en`).
- Test: `tests/errors.rs` (new), existing tests updated only where they named a constant.

**Interfaces:**
- Produces: the answer shape above; `src/messages.rs` lines of the form
  `pub const NAME: Msg = Msg { key: "area.what", en: "English {placeholder} text." };` on one line
  each, which Task 2's test reads.

- [ ] **Step 1: Failing tests** in `tests/errors.rs`:
  - `a_keyed_error_answers_its_key_params_and_the_english_message`: submit with a missing required
    parameter answers `code: "invalid"`, `key: "result.missing_required"`, `params.missing` the names,
    and the same `message` as before.
  - `a_template_value_that_is_missing_leaves_its_placeholder`: `render("A {x} b", {})` is `"A {x} b"`.
  - `an_error_from_ce_has_no_key`: a `HostError` turned into a `LabError` answers no `key`.
  - `a_keyed_error_passed_on_keeps_its_key`: a not-found order read inside another action answers `order.not_found`.
- [ ] **Step 2: Run** `cargo test --test errors`. Expected: fails (no `messages` module).
- [ ] **Step 3: Implement** the catalog and constructors, then convert each file's call sites,
  one file at a time, running `cargo test` after each. Messages built with `format!` become a
  template with named placeholders and a `json!({...})` of the values.
- [ ] **Step 4: Run** `cargo test --no-fail-fast`, `cargo clippy --all-targets -- -D warnings`,
  `UPDATE_CONTRACT=1 cargo test --test contract`. Expected: pass; contract files gain `key`/`params` only.
- [ ] **Step 5: Commit** `feat: every lab error carries a key and its values`.

### Task 2 (plugin UI): the page shows errors in its language

**Files:**
- Create: `ui/src/error-words.ts` (`export const ERROR_WORDS: { fr: Record<string, string>; pt: Record<string, string> }`),
  `ui/src/error-words.test.ts`
- Modify: `ui/src/api.ts` (`LabError` keeps `key?: string` and `params?: Record<string, string | number>`),
  `ui/src/i18n.ts` (`export function errorText(e: { key?, params?, message }): string`; a value
  under a name listed in `STATUS_PARAMS` is shown with the page's status words), `ui/src/notify.ts`
  (`messageOf` uses `errorText` for a `LabError`), `README.md` (the error answer shape)

- [ ] **Step 1: Failing tests:**
  - `error-words.test.ts`: `every catalog key has fr and pt with the same placeholders` (reads
    `../../src/messages.rs` with `node:fs`, matches each `key:` and `en:` pair); `no key appears twice`;
    `no fr or pt entry is left for a key the catalog no longer has`.
  - in an existing tab test: `a French page shows a refusal in French with its values`, and
    `a key the page has no words for shows the English`.
- [ ] **Step 2: Run** `pnpm --dir ui exec vitest run`. Expected: the new tests fail.
- [ ] **Step 3: Implement**, and write the fr and pt words for every key.
- [ ] **Step 4: Run** `pnpm --dir ui exec vitest run` and `pnpm --dir ui exec tsc --noEmit -p .`. Expected: pass.
- [ ] **Step 5: Commit** `feat(ui): plugin errors in French and Portuguese`.

### Task 3: Live check and screenshot

- [ ] **Step 1:** In `tools/live-check/run-c.mjs`, after c4: three refusals (submit with nothing
  saved, an unknown order, a limited caller changing a setting) each answer a `key` and `params`,
  and their `message` is the English one. Run
  `TARGET=dev CE=/home/fredrick/Projects/Repositories/openldr_ce tools/live-check/all.sh`. Expected: all pass.
- [ ] **Step 2:** Screenshot one refusal toast with the page in French, desktop and 375 px, on the
  screenshot Artifact page.
- [ ] **Step 3: Commit** `test: live check for keyed errors`.
