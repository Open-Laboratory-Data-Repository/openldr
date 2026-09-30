# packs

Content written for one lab system or one country lives here, never in the repo.
A pack is a folder of files that an operator imports into a CE install:
custom queries (`openldr query import`), value sets (`openldr terminology import resource`)
and facility registers (`openldr facilities import`).

Only this README is tracked. Everything else under `packs/` is ignored by git and Docker,
so a pack can hold one system's codes and dictionary extracts without them entering the repo.

One subfolder per system, for example `packs/disa/` for the DISA ecosystem of apps.
Each pack has its own README with its import order and what it cannot provide.
