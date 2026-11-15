//! The SELECT statements the import host runs against an OpenLDR v1 SQL Server, and the options
//! an admin can set.
//!
//! The host fills in three tokens and checks every statement is a single SELECT before it runs:
//! `{{after}}` (the last key of the page before, quoted), `{{limit}}` (the page size) and
//! `{{keys}}` (the page's keys, quoted). Option values never reach SQL unchecked: each is matched
//! against a strict pattern here, so nothing an admin types can change a statement's shape.
//!
//! Column lists and ordering are those of cdr-toolchain `apps/v1-push/src/read.ts`.

use crate::text::{fhir_datetime, is_tz_offset, js_trim};
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct Options {
    /// UTC offset of the v1 site: "+02:00", "-05:00" or "Z". v1 stores local time with no zone.
    pub tz: String,
    /// Database that holds the v1 tables. None means the connector's own database.
    pub database: Option<String>,
    /// Only requests registered on or after this date (YYYY-MM-DD).
    pub from: Option<String>,
    /// Only requests registered on or before this date (YYYY-MM-DD).
    pub to: Option<String>,
    /// Only requests with one of these panel codes. Empty means all.
    pub panels: Vec<String>,
}

const KNOWN: &[&str] = &["tz", "database", "from", "to", "panels"];

fn is_name(s: &str, max: usize, extra: &str) -> bool {
    !s.is_empty() && s.len() <= max && s.chars().all(|c| c.is_ascii_alphanumeric() || extra.contains(c))
}

fn date(options: &Value, key: &str) -> Result<Option<String>, String> {
    let Some(raw) = options.get(key).and_then(Value::as_str).map(js_trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    // A full, real calendar date only. fhir_datetime also accepts YYYY and YYYY-MM, so check the length.
    if raw.len() == 10 && fhir_datetime(Some(raw), "Z").is_some() {
        Ok(Some(raw.to_string()))
    } else {
        Err(format!("option {key} must be a date like 2024-01-31"))
    }
}

pub fn parse_options(options: &Value) -> Result<Options, String> {
    let empty = serde_json::Map::new();
    let map = match options {
        Value::Null => &empty,
        Value::Object(m) => m,
        _ => return Err("options must be an object".to_string()),
    };
    for (k, v) in map {
        if !KNOWN.contains(&k.as_str()) {
            return Err(format!("unknown option {k} (use {})", KNOWN.join(", ")));
        }
        if !v.is_string() {
            return Err(format!("option {k} must be text"));
        }
    }
    let tz = options.get("tz").and_then(Value::as_str).map(js_trim).unwrap_or("");
    if !is_tz_offset(tz) {
        return Err("option tz is required: the site's UTC offset, like +02:00, or Z".to_string());
    }
    let database = match options.get("database").and_then(Value::as_str).map(js_trim).filter(|s| !s.is_empty()) {
        None => None,
        Some(d) if is_name(d, 64, "_") => Some(d.to_string()),
        Some(_) => return Err("option database may hold letters, digits and _ only".to_string()),
    };
    let mut panels = Vec::new();
    if let Some(raw) = options.get("panels").and_then(Value::as_str) {
        for p in raw.split(',').map(js_trim).filter(|p| !p.is_empty()) {
            if !is_name(p, 40, "_.-") {
                return Err("option panels is a comma-separated list of panel codes (letters, digits, _ . -)".to_string());
            }
            if !panels.iter().any(|x| x == p) {
                panels.push(p.to_string());
            }
        }
        if panels.len() > 50 {
            return Err("option panels takes at most 50 codes".to_string());
        }
    }
    let from = date(options, "from")?;
    let to = date(options, "to")?;
    if let (Some(f), Some(t)) = (&from, &to) {
        if f > t {
            return Err("option from must not be after option to".to_string());
        }
    }
    Ok(Options { tz: tz.to_string(), database, from, to, panels })
}

const REQUEST_COLUMNS: &[&str] = &[
    "RequestID", "OBRSetID", "LIMSPanelCode", "LIMSPanelDesc",
    "LIMSSpecimenSourceCode", "LIMSSpecimenSourceDesc",
    "RequestingFacilityCode", "TestingFacilityCode",
    "SpecimenDateTime", "ReceivedDateTime", "RegisteredDateTime",
    "AnalysisDateTime", "AuthorisedDateTime",
    "ClinicalInfo", "ICD10ClinicalInfoCodes", "Therapy", "HL7PriorityCode",
    "AgeInYears", "AgeInDays", "HL7SexCode", "HL7PatientClassCode",
    "HL7SectionCode", "HL7ResultStatusCode", "AttendingDoctor",
    "TestedBy", "AuthorisedBy", "RegisteredBy", "RequestTypeCode",
    "LIMSAnalyzerCode", "LIMSRejectionCode", "LIMSRejectionDesc",
    "LIMSPointOfCareDesc",
    "LIMSPreReg_RegistrationDateTime", "LIMSPreReg_ReceivedDateTime",
    "LIMSPreReg_RegistrationFacilityCode", "LOINCPanelCode",
    "AdmitAttendDateTime", "CollectionVolume", "HL7SpecimenSourceCode",
    "HL7SpecimenSiteCode", "LIMSSpecimenSiteCode", "LIMSSpecimenSiteDesc",
    "WorkUnits", "CostUnits", "OrderingNotes",
    "EncryptedPatientID",
    "HL7EthnicGroupCode", "Deceased", "Newborn", "ReferringRequestID",
    "TargetTimeDays", "TargetTimeMins", "Repeated",
];

const RESULT_COLUMNS: &[&str] = &[
    "RequestID", "OBRSetID", "OBXSetID", "OBXSubID", "HL7ResultTypeCode",
    "SIValue", "SIUnits", "SILoRange", "SIHiRange", "HL7AbnormalFlagCodes",
    "CodedValue", "LIMSObservationCode", "LIMSObservationDesc",
    "LIMSRptResult", "LIMSRptUnits", "LIMSRptFlag", "LIMSRptRange",
    "LIMSCodedValue",
];

const PATIENT_COLUMNS: &[&str] = &[
    "RequestID", "SURNAME", "FIRSTNAME", "DOB", "NATIONALID",
    "MOBILE", "TELHOME", "EMAIL", "HOSPID",
];

const AST_COLUMNS: &[&str] = &[
    "RequestID", "OBRSetID", "OBXSetID", "OBXSubID", "LIMSSubstanceCode",
    "LIMSSubstanceName", "ORGANISM", "LIMSOrganismCode", "BreakpointType",
    "Methodology", "Units", "ASTValue", "ASTResult",
];

fn columns(names: &[&str]) -> String {
    names.iter().map(|n| format!("[{n}]")).collect::<Vec<_>>().join(", ")
}

/// "[db].[dbo].[Table]", or "[dbo].[Table]" in the connector's own database.
fn table(o: &Options, name: &str) -> String {
    match &o.database {
        Some(db) => format!("[{db}].[dbo].[{name}]"),
        None => format!("[dbo].[{name}]"),
    }
}

/// "[db].sys.tables", or "sys.tables".
fn sys(o: &Options, name: &str) -> String {
    match &o.database {
        Some(db) => format!("[{db}].sys.{name}"),
        None => format!("sys.{name}"),
    }
}

fn detail(o: &Options, name: &str, cols: &[&str], order_by: &str) -> String {
    format!("SELECT {} FROM {} WHERE [RequestID] IN ({{{{keys}}}}) ORDER BY {}", columns(cols), table(o, name), order_by)
}

/// The ORDER BY of each table, shared by the import and the copy so the two read rows in one order.
const REQUEST_ORDER: &str = "[RequestID], [OBRSetID]";
const RESULT_ORDER: &str = "[RequestID], [OBRSetID], [OBXSetID], [OBXSubID]";
const PATIENT_ORDER: &str = "[RequestID]";
const AST_ORDER: &str = "[RequestID], [OBRSetID], [OBXSetID], [OBXSubID], [LIMSSubstanceCode]";

/// A copy reads every column of its table, with the key first, so CE can file each row by it.
fn copy_detail(o: &Options, name: &str, order_by: &str) -> String {
    format!(
        "SELECT [RequestID] AS [__key], * FROM {} WHERE [RequestID] IN ({{{{keys}}}}) ORDER BY {}",
        table(o, name),
        order_by
    )
}

/// What `import_queries` returns: the key query and the four detail queries.
pub fn queries(o: &Options) -> Value {
    // One key per request. A request can have several Requests rows (one per panel), so DISTINCT.
    // Keyset paging: each page starts after the last key of the page before.
    let mut key = format!(
        "SELECT DISTINCT TOP ({{{{limit}}}}) [RequestID] FROM {} WHERE [RequestID] > {{{{after}}}}",
        table(o, "Requests")
    );
    if !o.panels.is_empty() {
        let list = o.panels.iter().map(|p| format!("'{p}'")).collect::<Vec<_>>().join(", ");
        key.push_str(&format!(" AND [LIMSPanelCode] IN ({list})"));
    }
    if let Some(from) = &o.from {
        key.push_str(&format!(" AND [RegisteredDateTime] >= '{from}'"));
    }
    if let Some(to) = &o.to {
        // Up to the end of that day.
        key.push_str(&format!(" AND [RegisteredDateTime] < DATEADD(day, 1, '{to}')"));
    }
    key.push_str(" ORDER BY [RequestID]");

    json!({
        "keyQuery": { "sql": key },
        "detailQueries": [
            { "name": "requests", "sql": detail(o, "Requests", REQUEST_COLUMNS, REQUEST_ORDER) },
            { "name": "results", "sql": detail(o, "LabResults", RESULT_COLUMNS, RESULT_ORDER) },
            { "name": "patients", "sql": detail(o, "Patients", PATIENT_COLUMNS, PATIENT_ORDER) },
            { "name": "ast", "sql": detail(o, "ASTResults", AST_COLUMNS, AST_ORDER) },
        ],
    })
}

/// What `import_copy` returns: one set, `requests`, paged by the import's own key query, with one
/// detail query per table. The import's column lists skip ten Requests columns that later parts
/// need, so a copy reads every column instead.
pub fn copy(o: &Options) -> Value {
    json!({
        "sets": [{
            "name": "requests",
            "keyQuery": queries(o)["keyQuery"].clone(),
            "detailQueries": [
                { "name": "requests", "sql": copy_detail(o, "Requests", REQUEST_ORDER) },
                { "name": "results", "sql": copy_detail(o, "LabResults", RESULT_ORDER) },
                { "name": "patients", "sql": copy_detail(o, "Patients", PATIENT_ORDER) },
                { "name": "ast", "sql": copy_detail(o, "ASTResults", AST_ORDER) },
            ],
        }],
    })
}

/// What `import_checks` returns: quick questions about the source, one value each.
///
/// Row counts come from SQL Server's own partition statistics, not `COUNT(*)`. On the Mozambique
/// sample a `COUNT(DISTINCT RequestID)` did not finish in 15 seconds, and the host stops a
/// statement at 30.
pub fn checks(o: &Options) -> Value {
    let rows = |t: &str| {
        format!(
            "SELECT SUM(p.rows) AS n FROM {} p JOIN {} t ON t.object_id = p.object_id WHERE t.name = '{t}' AND p.index_id IN (0, 1)",
            sys(o, "partitions"),
            sys(o, "tables")
        )
    };
    json!({
        "checks": [
            {
                "id": "tables_found",
                "sql": format!(
                    "SELECT COUNT(*) AS n FROM {} WHERE name IN ('Requests', 'LabResults', 'Patients', 'ASTResults')",
                    sys(o, "tables")
                ),
            },
            { "id": "request_rows", "sql": rows("Requests") },
            { "id": "result_rows", "sql": rows("LabResults") },
            { "id": "patient_rows", "sql": rows("Patients") },
            { "id": "ast_rows", "sql": rows("ASTResults") },
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(v: Value) -> Result<Options, String> {
        parse_options(&v)
    }

    #[test]
    fn tz_is_required_and_checked() {
        assert!(opts(json!({})).unwrap_err().contains("tz"));
        assert!(opts(json!({ "tz": "CAT" })).unwrap_err().contains("tz"));
        assert_eq!(opts(json!({ "tz": " +02:00 " })).unwrap().tz, "+02:00");
        assert_eq!(opts(json!({ "tz": "Z" })).unwrap().tz, "Z");
    }

    #[test]
    fn refuses_unknown_options_and_unsafe_values() {
        assert!(opts(json!({ "tz": "Z", "where": "1=1" })).unwrap_err().contains("unknown option where"));
        assert!(opts(json!({ "tz": "Z", "database": "x]; DROP" })).is_err());
        assert!(opts(json!({ "tz": "Z", "panels": "HIVVL, a'b" })).is_err());
        assert!(opts(json!({ "tz": "Z", "from": "2024-02-30" })).is_err());
        assert!(opts(json!({ "tz": "Z", "from": "2024-02" })).is_err());
        assert!(opts(json!({ "tz": "Z", "to": "01/02/2024" })).is_err());
        assert!(opts(json!({ "tz": "Z", "from": "2024-03-01", "to": "2024-02-01" })).is_err());
        assert!(opts(json!({ "tz": "Z", "panels": 5 })).is_err());
    }

    #[test]
    fn blank_options_mean_not_set() {
        let o = opts(json!({ "tz": "Z", "database": " ", "from": "", "to": "  ", "panels": " , " })).unwrap();
        assert_eq!(o, Options { tz: "Z".into(), database: None, from: None, to: None, panels: vec![] });
    }

    #[test]
    fn key_query_pages_by_keyset() {
        let q = queries(&opts(json!({ "tz": "+02:00" })).unwrap());
        assert_eq!(
            q["keyQuery"]["sql"],
            "SELECT DISTINCT TOP ({{limit}}) [RequestID] FROM [dbo].[Requests] WHERE [RequestID] > {{after}} ORDER BY [RequestID]"
        );
    }

    #[test]
    fn key_query_takes_the_filters_and_the_database() {
        let o = opts(json!({ "tz": "Z", "database": "OpenLDRData", "panels": "HIVVL, VIRAL,HIVVL", "from": "2024-01-01", "to": "2024-12-31" })).unwrap();
        assert_eq!(o.panels, vec!["HIVVL", "VIRAL"]);
        assert_eq!(
            queries(&o)["keyQuery"]["sql"],
            "SELECT DISTINCT TOP ({{limit}}) [RequestID] FROM [OpenLDRData].[dbo].[Requests] WHERE [RequestID] > {{after}} \
             AND [LIMSPanelCode] IN ('HIVVL', 'VIRAL') AND [RegisteredDateTime] >= '2024-01-01' \
             AND [RegisteredDateTime] < DATEADD(day, 1, '2024-12-31') ORDER BY [RequestID]"
        );
    }

    #[test]
    fn four_detail_queries_read_by_key_in_a_fixed_order() {
        let q = queries(&opts(json!({ "tz": "Z" })).unwrap());
        let details = q["detailQueries"].as_array().unwrap();
        let names: Vec<&str> = details.iter().map(|d| d["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["requests", "results", "patients", "ast"]);
        for d in details {
            let sql = d["sql"].as_str().unwrap();
            assert!(sql.starts_with("SELECT [RequestID], "), "{sql}");
            assert!(sql.contains(" WHERE [RequestID] IN ({{keys}}) ORDER BY [RequestID]"), "{sql}");
        }
        assert!(details[1]["sql"].as_str().unwrap().contains("FROM [dbo].[LabResults]"));
        assert!(details[3]["sql"].as_str().unwrap().ends_with("ORDER BY [RequestID], [OBRSetID], [OBXSetID], [OBXSubID], [LIMSSubstanceCode]"));
        // The same 53 Requests columns v1-push reads.
        assert_eq!(REQUEST_COLUMNS.len(), 53);
    }

    #[test]
    fn copy_is_one_set_with_the_import_queries() {
        let o = opts(json!({ "tz": "Z" })).unwrap();
        let c = copy(&o);
        let sets = c["sets"].as_array().unwrap();
        assert_eq!(sets.len(), 1);
        assert_eq!(sets[0]["name"], "requests");
        assert_eq!(sets[0]["keyQuery"], queries(&o)["keyQuery"]);
        let details = sets[0]["detailQueries"].as_array().unwrap();
        let names: Vec<&str> = details.iter().map(|d| d["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["requests", "results", "patients", "ast"]);
        for d in details {
            let sql = d["sql"].as_str().unwrap();
            assert!(sql.starts_with("SELECT [RequestID] AS [__key], * FROM "), "{sql}");
            assert!(sql.contains(" WHERE [RequestID] IN ({{keys}}) ORDER BY [RequestID]"), "{sql}");
        }
        // Each reads its own table, in the order the import reads it.
        assert_eq!(
            details[0]["sql"],
            "SELECT [RequestID] AS [__key], * FROM [dbo].[Requests] WHERE [RequestID] IN ({{keys}}) ORDER BY [RequestID], [OBRSetID]"
        );
        assert_eq!(
            details[1]["sql"],
            "SELECT [RequestID] AS [__key], * FROM [dbo].[LabResults] WHERE [RequestID] IN ({{keys}}) \
             ORDER BY [RequestID], [OBRSetID], [OBXSetID], [OBXSubID]"
        );
        assert_eq!(
            details[2]["sql"],
            "SELECT [RequestID] AS [__key], * FROM [dbo].[Patients] WHERE [RequestID] IN ({{keys}}) ORDER BY [RequestID]"
        );
        assert_eq!(
            details[3]["sql"],
            "SELECT [RequestID] AS [__key], * FROM [dbo].[ASTResults] WHERE [RequestID] IN ({{keys}}) \
             ORDER BY [RequestID], [OBRSetID], [OBXSetID], [OBXSubID], [LIMSSubstanceCode]"
        );
        // The copy orders each table as the import does.
        let import = queries(&o);
        for (c, i) in details.iter().zip(import["detailQueries"].as_array().unwrap()) {
            let order = |s: &Value| s["sql"].as_str().unwrap().split(" ORDER BY ").nth(1).unwrap().to_string();
            assert_eq!(order(c), order(i), "{}", c["name"]);
        }
    }

    #[test]
    fn copy_reads_the_database_the_option_names() {
        let o = opts(json!({ "tz": "Z", "database": "OpenLDRData" })).unwrap();
        let c = copy(&o);
        let set = &c["sets"][0];
        assert!(set["keyQuery"]["sql"].as_str().unwrap().contains("FROM [OpenLDRData].[dbo].[Requests] "));
        let tables = ["Requests", "LabResults", "Patients", "ASTResults"];
        for (d, t) in set["detailQueries"].as_array().unwrap().iter().zip(tables) {
            let sql = d["sql"].as_str().unwrap();
            assert!(sql.contains(&format!("FROM [OpenLDRData].[dbo].[{t}] WHERE ")), "{sql}");
            assert!(!sql.contains("FROM [dbo]."), "{sql}");
        }
    }

    #[test]
    fn copy_takes_the_same_options_and_refuses_the_same_bad_ones() {
        let o = opts(json!({ "tz": "+02:00", "database": "OpenLDRData", "panels": "HIVVL,VIRAL", "from": "2024-01-01", "to": "2024-12-31" })).unwrap();
        let c = copy(&o);
        // The filters reach the copy's key query exactly as they reach the import's.
        assert_eq!(c["sets"][0]["keyQuery"], queries(&o)["keyQuery"]);
        let key = c["sets"][0]["keyQuery"]["sql"].as_str().unwrap();
        assert!(key.contains("AND [LIMSPanelCode] IN ('HIVVL', 'VIRAL')"), "{key}");
        assert!(key.contains("AND [RegisteredDateTime] >= '2024-01-01'"), "{key}");
        assert!(key.contains("AND [RegisteredDateTime] < DATEADD(day, 1, '2024-12-31')"), "{key}");
        // The detail queries take no filter: the key query already chose the requests.
        for d in c["sets"][0]["detailQueries"].as_array().unwrap() {
            let sql = d["sql"].as_str().unwrap();
            assert!(!sql.contains("LIMSPanelCode") && !sql.contains("RegisteredDateTime"), "{sql}");
        }
        // The entrypoint parses options the same way, so a bad one fails before any SQL is made.
        let err = |options: Value| crate::import_copy(&json!({ "options": options })).unwrap_err();
        assert!(err(json!({ "tz": "Z", "where": "1=1" })).contains("unknown option where"));
        assert!(err(json!({ "tz": "Z", "database": "x]; DROP" })).contains("database"));
        assert!(err(json!({ "tz": "Z", "panels": "HIVVL, a'b" })).contains("panels"));
        assert!(err(json!({ "tz": "Z", "from": "2024-02-30" })).contains("from"));
        assert!(err(json!({ "tz": "Z", "from": "2024-03-01", "to": "2024-02-01" })).contains("from"));
        assert!(err(json!({})).contains("tz"));
        let ok = crate::import_copy(&json!({ "options": { "tz": "+02:00", "database": "OpenLDRData", "panels": "HIVVL,VIRAL", "from": "2024-01-01", "to": "2024-12-31" } })).unwrap();
        assert_eq!(ok, c);
    }

    #[test]
    fn checks_are_plain_selects_with_no_tokens() {
        let c = checks(&opts(json!({ "tz": "Z", "database": "OpenLDRData" })).unwrap());
        let list = c["checks"].as_array().unwrap();
        let ids: Vec<&str> = list.iter().map(|x| x["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["tables_found", "request_rows", "result_rows", "patient_rows", "ast_rows"]);
        for x in list {
            let sql = x["sql"].as_str().unwrap();
            assert!(sql.starts_with("SELECT "), "{sql}");
            assert!(!sql.contains("{{"), "{sql}");
            assert!(sql.contains("[OpenLDRData].sys."), "{sql}");
        }
    }
}
