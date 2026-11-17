# Publishing the cdr-source plugin to the marketplace

Date: 2026-11-17. Size: a small change. Status: approved by the operator in conversation.

## 1. Intent

The cdr-source plugin installs today from a file on the server. The operator wants every plugin
in the marketplace, so a lab installs it from Browse like the others. This puts version 0.1.0
there, signed by the same publisher as the other four plugins.

## 2. Goals and non-goals

Goals:

- `bundles/cdr-source-0.1.0/` in the public marketplace, listed once in `index.json`.
- Signed with the reference publisher's key. The private key never leaves the Windows laptop.
- A CE that never saw the plugin installs it from a registry and loads its page.
- The steps are written down, so 0.1.1 repeats them.

Non-goals:

- Publishing `openldr-v1-import`. Updating `whonet-sqlite` with the July fix.
- Fixing `openldr artifact publish`, which writes `<id>/<version>` and no index entry.
- Fixing `scripts/make-marketplace-bundle.ts`, which names a folder that does not exist here.
- Changing what the plugin does.

What would make this a failure even if it works: the private key copied to another machine, a
bundle pushed that a clean CE cannot install, or the source system's name in the description,
the guide or the index summary.

## 3. What is true today

- The marketplace is public. CE reads `raw.githubusercontent.com/Open-Laboratory-Data-Repository/marketplace/main`.
  Its layout is `bundles/<id>-<version>/` plus `index.json`. CE over HTTP sees only what the index lists.
- `scripts/build.mjs` in cdr-source writes `dist/` with `plugin.wasm`, `ui.html` and an unsigned
  `manifest.json`. The manifest has no `publisher`.
- The packer needs `publisher.id`. The schema is at `packages/marketplace/src/artifact-manifest.ts:144`.
- `openldr artifact pack` could not pack a plugin with a page. It passed no page bytes
  (`packages/cli/src/artifact.ts:142`), and the packer refused (`packages/marketplace/src/pack.ts:60`).
  The operator chose to fix the command. That fix is its own commit in `openldr_ce`.
- The reference key is on the laptop at `D:\Projects\Repositories\openldr_ce\scripts\.marketplace-keys\whonet.priv`.
  Its public half equals the `publisher.pub` of the published plugins, fingerprint `5ac92136...`.
- The scratch CE on port 3990 has the plugin installed from a file, with real copied rows. What
  an uninstall does with those rows is not settled, so that CE is not used for the install proof.

## 4. Approaches

| Way | What it costs | Verdict |
|---|---|---|
| Build here, sign on the laptop, finish here | One copy of three public files each way | Chosen |
| Copy the private key to the Linux box | The key lives in two places | Rejected by the operator's choice |
| A new publisher with a key made here | Installs show a second publisher | Not chosen |
| Sign through studio's publish page | Unchecked whether it can use the reference key | Not chosen |

The operator's choices on 2026-11-17: public marketplace, the reference key on the other
machine, a private repository for the source, fix the CLI, and wait for the label change of the
"OpenLDR_CE plugins review" session so 0.1.0 carries it.

## 5. The design

1. **The manifest gets a publisher only when asked.** `scripts/build.mjs` reads `PUBLISHER_ID` and
   `PUBLISHER_NAME`. With both set it adds `publisher: { id, name, keyFingerprint }`, the
   fingerprint 64 zeros. The packer overwrites the fingerprint. With neither set the manifest is
   as today, so a file install is unchanged. With one set the build stops.
2. **Build on the Linux box** from the `main` commit that holds the label change, with
   `PUBLISHER_ID=openldr-ref` and `PUBLISHER_NAME="OpenLDR Reference Publisher"`.
3. **Sign on the laptop.** Copy the three files of `dist/` there. Run the fixed
   `openldr artifact pack` from a temporary worktree of `openldr_ce` at `origin/main`, so the
   laptop's own checkout is not touched. The key is passed by path and is never printed or copied.
4. **Finish on the Linux box.** Copy the signed bundle back. Put it at
   `bundles/cdr-source-0.1.0/` in the marketplace checkout and add one index entry.
5. **Check before any push.** CE's `readBundle` and `verifyBundle` pass on every bundle, the
   index lists each id once, and the bundle's bytes equal what the laptop signed.
6. **Prove an install.** A throwaway CE on port 3991, with its own scratch databases and the
   marketplace checkout as a local registry, installs the plugin and serves its page.
7. **Push on the operator's yes.** Then read the public index at the new commit.

## 6. Left to the builder

- The exact copy commands between the machines.
- How the throwaway CE is started, following the scratch CE already used on port 3990.

## 7. Calls of mine

- The first public version is 0.1.0, the version in `Cargo.toml`.
- The index summary is the manifest's description, word for word.
- The publisher block is opt-in by environment variable, not a second script.
- The install proof uses a new throwaway CE, not the one on port 3990.
