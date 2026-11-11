# How-to template for in-app guides

Every in-app guide follows this shape. Copy it when you rewrite a section.

The in-app docs are a user guide. The reader is inside the studio and wants to get one thing done.
Installing, upgrading, environment variables and other setup work belong on the website, in
`apps/web/src/docs`, not here.

This file sits outside the version folders, so the docs viewer does not list it.

## Where the files go

- One file per language: `apps/studio/src/docs/<version>/en/<slug>.md`, and the same name under
  `fr/` and `pt/`.
- The three files have the same sections in the same order. Only the words change.
- Pictures and clips go in `apps/studio/src/docs/0.1.0/screenshots/`. A guide names them by file
  name only, such as `dashboard-new-widget.mp4`.
- The studio's language setting picks the file. The in-app docs have no language picker of their
  own.

## Page shape

1. **Title.** The feature's name, as the sidebar shows it.
2. **Summary.** Two or three sentences: what the feature is for, and who uses it.
3. **Clip.** One short clip of the feature at work. It plays muted and loops, like a GIF.
4. **Tasks.** One `##` heading per task, named for what the reader wants: "Add a widget", not
   "Widgets". Under it:
   - one sentence on when you would do this, if it is not obvious,
   - a clip of the task, only when words alone are hard to follow,
   - numbered steps,
   - an **Expected result** line.
5. **End of page.** Only what a reader needs after the tasks, in this order and each one short:
   limits, troubleshooting, related guides.

## Rules for steps

- One action per step. "Open the menu and select **Add widget**" is one action.
- Start each step with the verb: open, select, type, choose, drag.
- Write labels exactly as the screen shows them, in **bold**.
- Give the value to type in `code`.
- Say where a control is the first time it appears: "the dots menu at the top right".
- No explanations between steps. If a step needs a reason, put it in one short sentence after the
  steps.
- Five to eight steps per task. A longer task is two tasks.

## Rules for words

- Short sentences. Plain words. No em dashes.
- Say "you". Say what the reader sees, not how the code works.
- Write a known problem as one plain line under troubleshooting, with the workaround. Delete it
  when the bug is fixed.

## Skeleton

```markdown
# Dashboards

A dashboard is one page of charts, numbers and tables. Each tile is a widget. Lab managers use
dashboards to watch test volume and turnaround at a glance.

![Opening a dashboard, filtering it to one test, and adding a bar chart.](dashboard-intro.mp4)

## Add a widget

![Adding a bar chart of orders per test.](dashboard-new-widget.mp4)

1. Open the dots menu at the top right and select **Edit**.
2. Open the dots menu again and select **Add widget**.
3. Select the title at the top left and type `Orders by test`.
4. Select **Group by**, then choose **Test**.
5. Open the editor's dots menu, select **Charts**, then **Bar**.
6. Open the editor's dots menu and select **Save**.

**Expected result:** the bar chart appears at the bottom of the dashboard.

## Filter a dashboard

1. ...

**Expected result:** ...

## Limits

- ...

## Troubleshooting

- **A new widget is not on screen.** New widgets go to the bottom of the grid. Scroll down.

## Related guides

- [Reports](/docs/reports)
```
