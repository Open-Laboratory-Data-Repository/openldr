# P09 auth portability implementation plan

Use the subagent-driven-development skill for independent tasks and a final whole-change review.

Goal: allow generic OIDC login without accidental Keycloak administration or identity reassignment.
Spec: `docs/superpowers/specs/2026-09-11-p09-auth-portability.md`.
Stack: TypeScript, Fastify, React, oidc-client-ts, jose, Kysely and PostgreSQL.
All changes stay in `.worktrees/p09-auth-portability`, branch `codex/p09-auth-portability`, base `1384454d`.
Do not commit or touch live services. Apply unslop to new text.

- [ ] Authentication task: add failing config/adapter/config-route tests; separate verifier/admin selection;
  preserve Keycloak defaults; publish resolved browser mode and capability flags; rerun tests and typechecks.
  Own config, adapter-auth, bootstrap auth wiring, server config route and its tests.
- [ ] Studio task: add failing login-mode and unavailable-action tests; implement discovery and logout fallback;
  reflect capabilities in existing menus; preserve local access controls; translate messages; verify mobile.
  Own Studio auth, API types, Users and sync administration UI. Coordinate public config fields first.
- [ ] Safety task: root owns atomic issuer binding and local-only account-status handling, DB migration if needed,
  shared bootstrap service and CLI/route status behavior. Test fail-closed issuer changes and local disable/enable.
- [ ] Docs task: publish provider setup/support matrix and issuer adoption limits in three languages;
  verify registry, links and public renderer. Keep a durable review ledger with actual command results.
- [ ] Integration: test disposable non-Keycloak protocol flow, local permissions and concurrent issuer binding.
  Inspect all changes, run focused combined checks, request independent review, resolve confirmed defects.

Ruling: automatic identity migration is excluded because subject mappings require operator evidence.
Ruling: support generic OIDC with JWT access tokens; do not claim every provider configuration works.
Ruling: existing sync provisioning stays Keycloak-specific; unsupported actions must fail without side effects.
