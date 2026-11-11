# Import from OpenLDR v1

The **OpenLDR v1 import** plugin copies requests, patients, results and AST results from an OpenLDR v1 SQL Server database into CE. The plugin never opens a database connection itself. It supplies read-only queries, and CE runs them on a connector an admin allows.

Allow the connector first. Open **Settings > Connectors**, open the **⋯** menu of the v1 SQL Server connector, choose **Plugin access**, and turn on the switch for the plugin.

Then open **OpenLDR v1 import** in the sidebar. The page has five steps: pick the connector, set the options, check the v1 tables, try a few requests without saving, and run the import. The site time zone is required, in `+02:00` style, because v1 dates have no time zone.

The import runs on the CE server, so you can leave the page. **Stop** ends it after the page of 500 requests it is working on. **Resume** carries on from the last request done, also after a server restart. A request imported before is replaced, not duplicated. A failed request does not stop the import. CE lists it with a reason code and never stores the row's content. Each import run shows on the Activity page as one entry, and the Audit page records who allowed, started, stopped and resumed it. CE writes the audit entry first and refuses to start if it cannot.

Headless servers use `openldr import allow`, `openldr import start --plugin openldr-v1-import --connector <connector-id> --option tz=+02:00`, and `openldr import status`, `stop`, `resume` and `failures`.
