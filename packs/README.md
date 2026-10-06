# packs

Content written for one lab system or one country never lives in this repo.

A content pack is a signed marketplace bundle. It installs, in order, code systems, value sets,
a facility register, link-matching and custom queries. A lab installs it from Settings,
Marketplace, or with `openldr market install <bundle-dir>`. See the Marketplace docs.

Pack sources live in the cdr-toolchain repo, under `packs/<pack-id>/`. Each one has a build
script and a README with its steps and what it cannot provide. The signed bundles are published
to the marketplace repo.

This folder stays as a local scratch area. Only this README is tracked. Everything else under
`packs/` is ignored by git and Docker.
