# Dashboard examples

- `lab-overview.dashboard.json` is a full dashboard with 13 widgets: counts, charts and a table of
  recent orders. It has three filters: Period, Test and Priority. It is the same dashboard a seeded
  install ships as Lab Overview (Sample), under the name `Example: lab overview`.
- `one-widget.dashboard.json` is the smallest dashboard that imports. It has one widget that counts
  orders. Start from it when you write your own dashboard file.

## Import in studio

1. Open the Dashboard page.
2. Open the dashboard actions menu and choose Import. On an install with no dashboards, choose the
   Import button instead.
3. Choose one of the files.

You need permission to create dashboards. A name that already exists gets a number added, such as
`Example: one widget (2)`.

## Import from the command line

There is no command for this. Use the Dashboard page.

## What you see afterwards

The new dashboard opens with its widgets. The widgets show numbers once the install has orders and
results. On an empty install they show zero or no rows.
