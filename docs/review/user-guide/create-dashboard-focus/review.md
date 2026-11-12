# Create a dashboard review

The three actions were exercised against the live Studio and API. No dashboard API responses were mocked.

| Instruction | Current app evidence | Screenshot |
| --- | --- | --- |
| Open Dashboard in the main menu | `apps/studio/src/shell/AppShell.tsx:32` defines the Dashboard link. The capture selected it from Docs. | `raw/open-dashboard.png` |
| Open the dots menu beside Refresh | `apps/studio/src/dashboard/DashboardPage.tsx:254` renders the dropdown after Refresh. The capture clicked its Dashboard menu button. | `raw/open-actions.png` |
| Select New dashboard | `apps/studio/src/dashboard/DashboardPage.tsx:261` calls handleNewDashboard. The capture received a successful POST. | `raw/choose-new-dashboard.png` |
| Expect an empty dashboard in edit mode | `apps/studio/src/dashboard/DashboardPage.tsx:95` builds the empty dashboard and line 111 enables editing. The captured response and persisted record had no widgets, layout entries or filters. Add widget and Done were visible. | `raw/dashboard-created.png` |

`node capture.cjs` reported:

```
Created through the UI: New dashboard; empty dashboard persisted; edit-mode actions verified
```

The captured checks confirm:

- The temporary dashboard was deleted after the screenshots.
- The sidebar preference was restored.
- Existing dashboard records match the initial list.

The image treatment is only a CSS display effect over untouched full-screen PNGs.
Each figure is 500 pixels wide on desktop and shrinks to fit narrow screens.
The Focused and Unblurred controls compare the same captures.
Selecting a screenshot opens its full-size, unblurred capture.

The original Dashboard preview, article, create steps and evidence files retain their saved SHA-256 hashes.
The application source and published documentation were not edited.

This review covers the existing-dashboard menu flow on desktop. It does not test the separate no-dashboards empty-state button or real-phone browser behavior.
