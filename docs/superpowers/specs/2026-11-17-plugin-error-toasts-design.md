# cdr-source page errors as toasts

Small change in the `cdr-source` plugin page. Date: 2026-11-17.

## Why

The operator saw "The check could not load: This OpenLDR cannot run checks yet." as a red line
above an empty striped tab and expected a notification. CE's own studio shows errors as sonner
toasts. The plugin page should behave the same way.

## Goal

Every error the plugin page shows appears as a toast, styled as CE's. The page never claims a
false empty state when it failed to load.

Non-goals: no CE notification (bell) and no change to openldr_ce. No change to what the plugin
reads or saves.

## Approaches

- **A (picked). Copy CE's sonner `Toaster` into the plugin.** Same look as CE, little code.
- B. A hand-built Radix toast. More code for the same result.
- C. A CE bell notification raised by the plugin. Needs a new SDK operation and broker check in
  openldr_ce. The operator chose the plugin-only toast.

## Design

1. Add `sonner` to `ui/package.json`. Copy `apps/studio/src/components/ui/sonner.tsx` from
   openldr_ce into `ui/src/components/ui/sonner.tsx`, reading the plugin page's own theme
   attribute instead of `data-theme`. Mount one `<Toaster />` in `App`.
2. Two kinds of error toast:
   - **One-off**, the result of a click: start refused, stop/continue/restart failed, copy start
     refused, export failed, the connector test failed. Shown where the failure is caught, with
     sonner's default duration, as CE does.
   - **Lasting**, a state: a tab, list or detail could not load (including "needs a newer
     OpenLDR"), a run's last error, a rule that stops a copy from starting. It stays until closed,
     with a fixed id so polling does not stack copies. Once closed it comes back only when the
     message changes. It is dismissed when the error clears.
3. Every inline error line those replace is removed.
4. When a tab failed to load, its striped empty state says "This tab could not load." instead of
   a claim such as "No source has finished yet". One new string, `page.loadFailed`, in en, fr
   and pt.
5. Kept inline, because they are data and not page errors: a held request's own decode error in
   its detail sheet, and a copy row's last error in the Sources table.

On a phone the toasts sit at the bottom of the plugin frame. Only a real phone can confirm they
are not under the browser bar.

The operator approved this design on 2026-11-17.
