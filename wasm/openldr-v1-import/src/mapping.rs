//! OpenLDR v1 rows -> FHIR R4 resources, one group of resources per v1 request.
//!
//! A port of the TypeScript mapping in the cdr-toolchain repo:
//!   apps/v1-push/src/to-payload.ts, ast-payload.ts, attributes.ts   (v1 rows -> payload)
//!   packages/ce-fhir/src/fhir-transform.ts                          (payload -> FHIR)
//! That mapping was accepted by a live CE on 2026-11-11 (100 viral load requests). The reasons
//! behind each choice are documented there and not repeated here. tests/golden.rs holds this
//! port to the TypeScript's exact output, so change the TypeScript first, regenerate the golden
//! files, then change this file until the test passes.
//!
//! Dates arrive from the import host as local wall-clock text with no zone
//! ("2024-03-05T14:30:07.120"). The site's UTC offset is added here, from the `tz` option.

use crate::rules::{AttrKind, RULES};
use crate::text::{
    col, col_i64, fhir_datetime, fhir_id, js_number_string, json_number, parse_plain_number, parse_range,
    parse_reported_number, text, to_local_iso, Row,
};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

// Code-system ids, as cdr-toolchain's DEFAULT_SITE names them. Each becomes urn:openldr:<lowercase>.
const SYS_FACILITY: &str = "DEFAULT_FAC";
const SYS_LAB: &str = "DEFAULT_LAB";
const SYS_PANEL: &str = "DEFAULT_TEST";
const SYS_SPECIMEN: &str = "DEFAULT_SPEC";
const SYS_OBSERVATION: &str = "DEFAULT_RESULT";
const SYS_ORGANISM: &str = "DEFAULT_ORG";
const SYS_ANTIBIOTIC: &str = "DEFAULT_ABX";

/// Prefix of every OpenLDR extension URL that CE reads on a ServiceRequest.
const EXT: &str = "urn:openldr:ext:";
const REQUEST_ATTRIBUTE_SYSTEM: &str = "urn:openldr:cs:request-attribute";
const SECTION_SYSTEM: &str = "http://terminology.hl7.org/CodeSystem/v2-0074";
const INTERPRETATION_SYSTEM: &str = "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";

// Why one request could not be mapped. The import host stores the code, never row text.
pub const NO_REQUEST_ROWS: &str = "NO_REQUEST_ROWS";
pub const NO_OBR_SET_ID: &str = "NO_OBR_SET_ID";
pub const NO_OBX_ID: &str = "NO_OBX_ID";
pub const BAD_REQUEST_ID: &str = "BAD_REQUEST_ID";

struct Concept {
    system: &'static str,
    code: String,
    display: Option<String>,
}

fn concept(system: &'static str, code: Option<String>, display: Option<String>) -> Option<Concept> {
    code.map(|code| Concept { system, code, display })
}

fn system_uri(system: &str) -> String {
    format!("urn:openldr:{}", system.to_lowercase())
}

/// A small JSON object builder that leaves out absent values, like `compact()` in ce-fhir.
struct Obj(Map<String, Value>);

impl Obj {
    fn new() -> Self {
        Obj(Map::new())
    }
    fn set(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.0.insert(key.to_string(), value.into());
        self
    }
    fn opt(mut self, key: &str, value: Option<impl Into<Value>>) -> Self {
        if let Some(v) = value {
            self.0.insert(key.to_string(), v.into());
        }
        self
    }
    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    fn build(self) -> Value {
        Value::Object(self.0)
    }
}

fn reference(target: &str) -> Value {
    json!({ "reference": target })
}

fn codeable(c: Option<&Concept>) -> Option<Value> {
    let c = c?;
    let code = text(Some(&c.code))?;
    let display = text(c.display.as_deref());
    let coding = Obj::new().set("system", system_uri(c.system)).set("code", code).opt("display", display.clone()).build();
    Some(Obj::new().set("coding", vec![coding]).opt("text", display).build())
}

/// CE requires a code. When v1 has none, say so honestly.
fn unknown_code() -> Value {
    json!({
        "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/data-absent-reason", "code": "unknown" }],
        "text": "unknown",
    })
}

fn to_gender(sex: Option<&str>) -> Option<&'static str> {
    match sex.unwrap_or("").to_uppercase().as_str() {
        "M" => Some("male"),
        "F" => Some("female"),
        "U" => Some("unknown"),
        "I" => Some("other"),
        _ => None,
    }
}

fn to_report_status(rs: Option<&str>) -> &'static str {
    match rs.unwrap_or("").to_uppercase().as_str() {
        "F" => "final",
        "P" => "preliminary",
        "C" => "corrected",
        "X" => "cancelled",
        "R" => "registered",
        "I" => "partial",
        _ => "unknown",
    }
}

fn to_request_status(rs: Option<&str>) -> &'static str {
    if rs.unwrap_or("").to_uppercase() == "X" {
        "revoked"
    } else {
        "completed"
    }
}

fn to_priority(p: Option<&str>) -> Option<&'static str> {
    match p.unwrap_or("").to_uppercase().as_str() {
        "R" => Some("routine"),
        "U" => Some("urgent"),
        "S" => Some("stat"),
        _ => None,
    }
}

fn date_col(row: &Row, name: &str) -> Option<String> {
    to_local_iso(row.get(name).and_then(Value::as_str))
}

// ---- one lab result -------------------------------------------------------------------------

struct LabResult {
    obr: i64,
    obx_set: String,
    code: Concept,
    result_value: Option<String>,
    numeric: Option<f64>,
    comparator: Option<char>,
    coded: Option<String>,
    text_value: Option<String>,
    numeric_units: Option<String>,
    rpt_units: Option<String>,
    abnormal_flag: Option<String>,
    rpt_range: Option<String>,
}

fn rpt_range(r: &Row) -> Option<String> {
    if let Some(given) = col(r, "LIMSRptRange") {
        return Some(given);
    }
    // v1 stores 0 for an empty range bound.
    let zero = serde_json::Number::from(0);
    let lo = r.get("SILoRange").and_then(Value::as_number).unwrap_or(&zero);
    let hi = r.get("SIHiRange").and_then(Value::as_number).unwrap_or(&zero);
    if lo.as_f64() != Some(0.0) || hi.as_f64() != Some(0.0) {
        Some(format!("{}-{}", js_number_string(lo), js_number_string(hi)))
    } else {
        None
    }
}

fn lab_result(r: &Row, obr: i64) -> Result<LabResult, &'static str> {
    let obx_set = r.get("OBXSetID").and_then(Value::as_number);
    let obx_sub = r.get("OBXSubID").and_then(Value::as_number);
    let (Some(obx_set), Some(_)) = (obx_set, obx_sub) else {
        return Err(NO_OBX_ID);
    };
    // The value is LIMSRptResult, the reported result the v1 views show. SIValue and
    // HL7ResultTypeCode are not used; see to-payload.ts for why.
    let rpt = col(r, "LIMSRptResult");
    let coded = col(r, "LIMSCodedValue");
    let parsed = rpt.as_deref().and_then(parse_reported_number);
    let numeric = parsed.map(|(_, n)| n);
    Ok(LabResult {
        obr,
        obx_set: js_number_string(obx_set),
        code: Concept {
            system: SYS_OBSERVATION,
            code: col(r, "LIMSObservationCode").unwrap_or_default(),
            display: col(r, "LIMSObservationDesc"),
        },
        result_value: rpt.clone().or_else(|| coded.clone()),
        numeric,
        comparator: parsed.and_then(|(c, _)| c),
        text_value: if numeric.is_none() && coded.is_none() { rpt } else { None },
        coded,
        numeric_units: col(r, "SIUnits"),
        rpt_units: col(r, "LIMSRptUnits"),
        abnormal_flag: col(r, "HL7AbnormalFlagCodes"),
        rpt_range: rpt_range(r),
    })
}

fn reference_range(range: Option<&str>, unit: Option<&str>) -> Option<Value> {
    let t = text(range)?;
    if let Some((low, high)) = parse_range(&t) {
        let bound = |v: f64| Obj::new().set("value", json_number(v)).opt("unit", unit).build();
        return Some(json!({ "low": bound(low), "high": bound(high) }));
    }
    Some(json!({ "text": t }))
}

#[allow(clippy::too_many_arguments)]
fn observation_resource(
    r: &LabResult,
    patient_ref: &str,
    root: &str,
    obr_id: &str,
    specimen_id: Option<&str>,
    collection: Option<&str>,
    index: usize,
    tz: &str,
) -> Value {
    let unit = r.numeric_units.clone().or_else(|| r.rpt_units.clone());
    let mut out = Obj::new()
        .set("resourceType", "Observation")
        .opt("id", fhir_id(&format!("{root}-obs-{index}")))
        .set("status", "final")
        .set("code", codeable(Some(&r.code)).unwrap_or_else(unknown_code))
        .set("subject", reference(patient_ref))
        .set("identifier", json!([{ "system": "urn:openldr:obx-set-id", "value": r.obx_set }]))
        .set("basedOn", json!([{ "reference": format!("ServiceRequest/{obr_id}") }]))
        .opt("specimen", specimen_id.map(|s| reference(&format!("Specimen/{s}"))))
        .opt("effectiveDateTime", fhir_datetime(collection, tz));

    // value[x]: at most one.
    if let Some(n) = r.numeric {
        let q = Obj::new()
            .set("value", json_number(n))
            .opt("comparator", r.comparator.map(|c| c.to_string()))
            .opt("unit", unit.clone())
            .build();
        out = out.set("valueQuantity", q);
    } else if let Some(coded) = &r.coded {
        let display = r.result_value.clone();
        let coding = Obj::new().set("code", coded.clone()).opt("display", display.clone()).build();
        out = out.set("valueCodeableConcept", Obj::new().set("coding", vec![coding]).opt("text", display).build());
    } else if let Some(s) = r.result_value.clone().or_else(|| r.text_value.clone()) {
        out = out.set("valueString", s);
    }

    if let Some(flag) = &r.abnormal_flag {
        out = out.set("interpretation", json!([{ "coding": [{ "system": INTERPRETATION_SYSTEM, "code": flag }] }]));
    }
    if let Some(range) = reference_range(r.rpt_range.as_deref(), unit.as_deref()) {
        out = out.set("referenceRange", vec![range]);
    }
    out.build()
}

// ---- AST: isolates and drug results ---------------------------------------------------------

struct Isolate {
    index: usize,
    obr: i64,
    organism: Concept,
}

struct Susceptibility {
    isolate_index: usize,
    obr: i64,
    antibiotic: Concept,
    test_method: &'static str,
    result_raw: Option<String>,
    result_numeric: Option<f64>,
    sir: Option<&'static str>,
    guideline: Option<String>,
}

fn sir(v: Option<String>) -> Option<&'static str> {
    match v?.to_uppercase().as_str() {
        "S" => Some("S"),
        "I" => Some("I"),
        "R" => Some("R"),
        _ => None,
    }
}

/// One isolate per panel (OBRSetID) and organism. Rows whose OBRSetID is null or matches no
/// request panel are left out.
fn build_ast(rows: &[&Row], obr_set_ids: &HashSet<i64>) -> (Vec<Isolate>, Vec<Susceptibility>) {
    let mut kept: Vec<(&Row, i64, String)> = Vec::new();
    for row in rows {
        match col_i64(row, "OBRSetID") {
            Some(obr) if obr_set_ids.contains(&obr) => kept.push((row, obr, col(row, "ORGANISM").unwrap_or_default())),
            _ => {}
        }
    }

    // First row seen for each (panel, organism), then ordered by panel and organism. JavaScript
    // compares strings by UTF-16 code unit, so this does too.
    let mut firsts: Vec<(i64, String, &Row)> = Vec::new();
    for (row, obr, organism) in &kept {
        if !firsts.iter().any(|(o, org, _)| o == obr && org == organism) {
            firsts.push((*obr, organism.clone(), row));
        }
    }
    firsts.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.encode_utf16().cmp(b.1.encode_utf16())));

    let mut index_by_key: HashMap<(i64, String), usize> = HashMap::new();
    let mut isolates = Vec::new();
    for (i, (obr, organism, row)) in firsts.iter().enumerate() {
        let index = i + 1;
        index_by_key.insert((*obr, organism.clone()), index);
        let named = !organism.is_empty();
        isolates.push(Isolate {
            index,
            obr: *obr,
            organism: Concept {
                system: SYS_ORGANISM,
                code: col(row, "LIMSOrganismCode").unwrap_or_else(|| if named { organism.clone() } else { "unknown".to_string() }),
                display: if named { Some(organism.clone()) } else { None },
            },
        });
    }

    let tests = kept
        .iter()
        .map(|(row, obr, organism)| {
            let raw = col(row, "ASTValue");
            Susceptibility {
                isolate_index: index_by_key[&(*obr, organism.clone())],
                obr: *obr,
                antibiotic: Concept {
                    system: SYS_ANTIBIOTIC,
                    code: col(row, "LIMSSubstanceCode").or_else(|| col(row, "LIMSSubstanceName")).unwrap_or_else(|| "unknown".to_string()),
                    display: col(row, "LIMSSubstanceName"),
                },
                test_method: if col(row, "Units").map(|u| u.to_lowercase()).as_deref() == Some("mm") { "DISK" } else { "MIC" },
                result_numeric: raw.as_deref().and_then(parse_plain_number),
                result_raw: raw,
                sir: sir(col(row, "ASTResult")),
                guideline: col(row, "BreakpointType"),
            }
        })
        .collect();
    (isolates, tests)
}

#[allow(clippy::too_many_arguments)]
fn isolate_resource(
    iso: &Isolate,
    patient_ref: &str,
    root: &str,
    obr_id: &str,
    specimen_id: Option<&str>,
    collection: Option<&str>,
    members: Vec<Value>,
    tz: &str,
) -> Value {
    Obj::new()
        .set("resourceType", "Observation")
        .opt("id", fhir_id(&format!("{root}-iso-{}", iso.index)))
        .set("status", "final")
        .set(
            "code",
            json!({
                "coding": [{ "system": "http://loinc.org", "code": "634-6", "display": "Bacteria identified" }],
                "text": "Bacteria identified",
            }),
        )
        .set("subject", reference(patient_ref))
        .set("basedOn", json!([{ "reference": format!("ServiceRequest/{obr_id}") }]))
        .opt("specimen", specimen_id.map(|s| reference(&format!("Specimen/{s}"))))
        .opt("effectiveDateTime", fhir_datetime(collection, tz))
        .set("valueCodeableConcept", codeable(Some(&iso.organism)).unwrap_or_else(unknown_code))
        .opt("hasMember", if members.is_empty() { None } else { Some(members) })
        .build()
}

#[allow(clippy::too_many_arguments)]
fn ast_resource(
    s: &Susceptibility,
    patient_ref: &str,
    root: &str,
    obr_id: &str,
    specimen_id: Option<&str>,
    collection: Option<&str>,
    index: usize,
    tz: &str,
) -> Value {
    let component = s.result_numeric.map(|n| {
        let label = if s.test_method == "MIC" { "MIC" } else { "Zone diameter" };
        json!([{ "code": { "text": label }, "valueQuantity": { "value": json_number(n) } }])
    });
    Obj::new()
        .set("resourceType", "Observation")
        .opt("id", fhir_id(&format!("{root}-ast-{index}")))
        .set("status", "final")
        .set("code", codeable(Some(&s.antibiotic)).unwrap_or_else(unknown_code))
        .set("subject", reference(patient_ref))
        .set("basedOn", json!([{ "reference": format!("ServiceRequest/{obr_id}") }]))
        .opt("specimen", specimen_id.map(|sp| reference(&format!("Specimen/{sp}"))))
        .opt("effectiveDateTime", fhir_datetime(collection, tz))
        // S/I/R is an interpretation, not a value.
        .opt("interpretation", s.sir.map(|v| json!([{ "coding": [{ "system": INTERPRETATION_SYSTEM, "code": v }] }])))
        .opt("valueString", s.result_raw.clone())
        .set("method", json!({ "text": s.test_method }))
        .opt("component", component)
        .opt("note", s.guideline.clone().map(|g| json!([{ "text": g }])))
        .build()
}

// ---- one request row (one panel): ServiceRequest + DiagnosticReport --------------------------

struct LabRequest<'a> {
    row: &'a Row,
    obr: i64,
    requesting: Option<Concept>,
    testing: Option<Concept>,
}

fn lab_request(row: &Row, obr: i64) -> LabRequest<'_> {
    let clinic = col(row, "RequestingFacilityCode");
    let lab = col(row, "TestingFacilityCode");
    LabRequest {
        row,
        obr,
        requesting: concept(SYS_FACILITY, clinic.clone(), clinic),
        testing: concept(SYS_LAB, lab.clone(), lab),
    }
}

/// One attribute per rule whose column has a value, in rule order. `buildAttributes` in v1-push.
fn attribute_extensions(row: &Row) -> Vec<Value> {
    let mut out = Vec::new();
    for rule in RULES {
        let v = row.get(rule.column).unwrap_or(&Value::Null);
        let value: Option<Value> = match rule.kind {
            // Sent as true or false, and skipped only when null: v1 stores an explicit 0.
            AttrKind::Boolean => match v {
                Value::Bool(b) => Some(json!({ "url": "value", "valueBoolean": b })),
                Value::Number(n) if n.as_f64() == Some(1.0) => Some(json!({ "url": "value", "valueBoolean": true })),
                Value::Number(n) if n.as_f64() == Some(0.0) => Some(json!({ "url": "value", "valueBoolean": false })),
                _ => None,
            },
            AttrKind::Datetime => v.as_str().and_then(|s| to_local_iso(Some(s)).or_else(|| text(Some(s)))).map(|s| json!({ "url": "value", "valueString": s })),
            AttrKind::Number | AttrKind::String => match v {
                Value::Number(n) => Some(json!({ "url": "value", "valueString": js_number_string(n) })),
                Value::String(s) => text(Some(s)).map(|s| json!({ "url": "value", "valueString": s })),
                _ => None,
            },
        };
        if let Some(value) = value {
            out.push(json!({
                "url": format!("{EXT}request-attribute"),
                "extension": [{ "url": "code", "valueCoding": { "system": REQUEST_ATTRIBUTE_SYSTEM, "code": rule.code } }, value],
            }));
        }
    }
    out
}

/// The v1 request facts as the extensions CE reads. `requestFactExtensions` in ce-fhir.
fn request_extensions(row: &Row, tz: &str) -> Vec<Value> {
    let mut out = Vec::new();
    if let Some(analysis) = fhir_datetime(date_col(row, "AnalysisDateTime").as_deref(), tz) {
        out.push(json!({ "url": format!("{EXT}analysis-time"), "valueDateTime": analysis }));
    }
    if let Some(v) = col(row, "RegisteredBy") {
        out.push(json!({ "url": format!("{EXT}registered-by"), "valueString": v }));
    }
    if let Some(v) = col(row, "TestedBy") {
        out.push(json!({ "url": format!("{EXT}tested-by"), "valueString": v }));
    }
    if let Some(v) = col(row, "RequestTypeCode") {
        out.push(json!({ "url": format!("{EXT}request-type"), "valueCode": v }));
    }

    let mut age = Vec::new();
    if let Some(Value::Number(n)) = row.get("AgeInYears") {
        age.push(json!({ "url": "years", "valueInteger": n }));
    }
    if let Some(Value::Number(n)) = row.get("AgeInDays") {
        age.push(json!({ "url": "days", "valueInteger": n }));
    }
    if !age.is_empty() {
        out.push(json!({ "url": format!("{EXT}age-at-request"), "extension": age }));
    }

    if let Some(v) = col(row, "LIMSAnalyzerCode") {
        out.push(json!({ "url": format!("{EXT}analyzer"), "valueCode": v }));
    }

    let mut rejection = Vec::new();
    if let Some(v) = col(row, "LIMSRejectionCode") {
        rejection.push(json!({ "url": "code", "valueCode": v }));
    }
    if let Some(v) = col(row, "LIMSRejectionDesc") {
        rejection.push(json!({ "url": "reason", "valueString": v }));
    }
    if !rejection.is_empty() {
        out.push(json!({ "url": format!("{EXT}rejection"), "extension": rejection }));
    }

    out.extend(attribute_extensions(row));
    out
}

/// The doctor and the requesting clinic travel together as a contained PractitionerRole.
fn requester_fields(lr: &LabRequest) -> Option<(Value, Value)> {
    let doctor = col(lr.row, "AttendingDoctor");
    let clinic = lr.requesting.as_ref();
    if doctor.is_none() && clinic.is_none() {
        return None;
    }
    let organization = clinic.map(|c| {
        Obj::new()
            .set("identifier", json!({ "system": system_uri(c.system), "value": c.code }))
            .opt("display", c.display.clone())
            .build()
    });
    let role = Obj::new()
        .set("resourceType", "PractitionerRole")
        .set("id", "requester")
        .opt("practitioner", doctor.map(|d| json!({ "display": d })))
        .opt("organization", organization)
        .build();
    Some((json!([role]), json!({ "reference": "#requester" })))
}

fn request_resources(
    lr: &LabRequest,
    request_id: &str,
    patient_ref: &str,
    obr_id: &str,
    specimen_id: Option<&str>,
    results: Vec<Value>,
    tz: &str,
) -> [Value; 2] {
    let row = lr.row;
    let status = col(row, "HL7ResultStatusCode");
    let panel = codeable(concept(SYS_PANEL, col(row, "LIMSPanelCode"), col(row, "LIMSPanelDesc")).as_ref()).unwrap_or_else(unknown_code);
    let mut identifier = Vec::new();
    if let Some(id) = text(Some(request_id)) {
        identifier.push(json!({ "system": "urn:openldr:request-id", "value": id }));
    }
    identifier.push(json!({ "system": "urn:openldr:obr-set-id", "value": lr.obr.to_string() }));
    let ext = request_extensions(row, tz);

    let mut sr = Obj::new()
        .set("resourceType", "ServiceRequest")
        .set("id", obr_id)
        // Must not contradict the DiagnosticReport's status.
        .set("status", to_request_status(status.as_deref()))
        .set("intent", "order")
        .set("subject", reference(patient_ref))
        .set("code", panel.clone())
        .set("identifier", identifier.clone())
        .opt("priority", to_priority(col(row, "HL7PriorityCode").as_deref()))
        .opt("authoredOn", fhir_datetime(date_col(row, "RegisteredDateTime").as_deref(), tz))
        .opt("note", col(row, "ClinicalInfo").map(|t| json!([{ "text": t }])));
    if let Some((contained, requester)) = requester_fields(lr) {
        sr = sr.set("contained", contained).set("requester", requester);
    }
    let sr = sr
        .opt("locationCode", col(row, "LIMSPointOfCareDesc").map(|p| json!([{ "text": p }])))
        .opt("extension", if ext.is_empty() { None } else { Some(ext) })
        .build();

    let performer = lr.testing.as_ref().map(|t| {
        let who = Obj::new()
            .set("identifier", json!({ "system": system_uri(t.system), "value": t.code }))
            .opt("display", t.display.clone())
            .build();
        json!([who])
    });
    // The report is emitted even when the panel has no results; its status carries the truth.
    let dr = Obj::new()
        .set("resourceType", "DiagnosticReport")
        .set("id", obr_id)
        .set("status", to_report_status(status.as_deref()))
        .set("code", panel)
        .set("subject", reference(patient_ref))
        .set("identifier", identifier)
        .opt("category", col(row, "HL7SectionCode").map(|s| json!([{ "coding": [{ "system": SECTION_SYSTEM, "code": s }] }])))
        .opt("resultsInterpreter", col(row, "AuthorisedBy").map(|a| json!([{ "display": a }])))
        .opt("specimen", specimen_id.map(|s| json!([{ "reference": format!("Specimen/{s}") }])))
        .opt("effectiveDateTime", fhir_datetime(date_col(row, "SpecimenDateTime").as_deref(), tz))
        .opt("issued", fhir_datetime(date_col(row, "AuthorisedDateTime").as_deref(), tz))
        .set("basedOn", json!([{ "reference": format!("ServiceRequest/{obr_id}") }]))
        .opt("performer", performer)
        .opt("result", if results.is_empty() { None } else { Some(results) })
        .build();

    [sr, dr]
}

/// Organization for a clinic or a lab. The id comes from the code alone, so the same facility on
/// many requests is one Organization. A lab and a clinic are separate code spaces.
fn organization_resource(c: &Concept) -> Option<(String, Value)> {
    let prefix = if c.system == SYS_LAB { "lab" } else { "facility" };
    let id = fhir_id(&format!("{prefix}-{}", c.code))?;
    let org = Obj::new()
        .set("resourceType", "Organization")
        .set("id", id.clone())
        .set("identifier", json!([{ "system": system_uri(c.system), "value": c.code }]))
        .opt("name", c.display.clone())
        .build();
    Some((id, org))
}

fn patient_resource(id: &str, obr1: &Row, p: Option<&Row>, tz: &str) -> Value {
    let pcol = |name: &str| p.and_then(|p| col(p, name));
    let mut identifier = Vec::new();
    if let Some(folder) = pcol("HOSPID") {
        identifier.push(json!({ "system": "urn:openldr:folder-no", "value": folder }));
    }
    if let Some(nid) = pcol("NATIONALID") {
        identifier.push(json!({
            "system": "urn:openldr:national-id",
            "value": nid,
            "type": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v2-0203", "code": "NI" }] },
        }));
    }
    let name = Obj::new().opt("family", pcol("SURNAME")).opt("given", pcol("FIRSTNAME").map(|f| vec![f]));
    let mut telecom = Vec::new();
    if let Some(phone) = pcol("MOBILE").or_else(|| pcol("TELHOME")) {
        telecom.push(json!({ "system": "phone", "value": phone }));
    }
    if let Some(email) = pcol("EMAIL") {
        telecom.push(json!({ "system": "email", "value": email }));
    }
    // v1 holds a date of birth as a datetime at midnight; only the date is kept.
    let dob = p.and_then(|p| date_col(p, "DOB")).map(|d| d[..10].to_string());
    Obj::new()
        .set("resourceType", "Patient")
        .set("id", id)
        .opt("identifier", if identifier.is_empty() { None } else { Some(identifier) })
        .opt("name", if name.is_empty() { None } else { Some(vec![name.build()]) })
        .opt("gender", to_gender(col(obr1, "HL7SexCode").as_deref()))
        .opt("birthDate", fhir_datetime(dob.as_deref(), tz))
        .opt("telecom", if telecom.is_empty() { None } else { Some(telecom) })
        .build()
}

// ---- one v1 request -------------------------------------------------------------------------

/// All rows of one v1 request as FHIR resources, or the code for why it cannot be mapped.
fn map_request(
    request_id: &str,
    requests: &[&Row],
    results: &[&Row],
    patient: Option<&Row>,
    ast: &[&Row],
    tz: &str,
) -> Result<Vec<Value>, &'static str> {
    if requests.is_empty() {
        return Err(NO_REQUEST_ROWS);
    }
    let mut lab_requests = Vec::new();
    let mut obr_set_ids = HashSet::new();
    for row in requests {
        let obr = col_i64(row, "OBRSetID").ok_or(NO_OBR_SET_ID)?;
        lab_requests.push(lab_request(row, obr));
        obr_set_ids.insert(obr);
    }

    // Results whose OBRSetID matches no Requests row are left out.
    let mut lab_results = Vec::new();
    for r in results {
        match col_i64(r, "OBRSetID") {
            Some(obr) if obr_set_ids.contains(&obr) => lab_results.push(lab_result(r, obr)?),
            _ => {}
        }
    }
    let (isolates, tests) = build_ast(ast, &obr_set_ids);

    let first = &lab_requests[0];
    let root = fhir_id(request_id).ok_or(BAD_REQUEST_ID)?;
    let obr_id = |obr: i64| format!("{root}-obr{obr}");
    // v1 has no patient identity across requests, so the patient is keyed on the request.
    let patient_ref = format!("Patient/{root}");
    let specimen_id = fhir_id(&format!("{root}-spec"));
    let specimen_id = specimen_id.as_deref();
    // v1 records one specimen per request, so its collection time serves every result.
    let collection = date_col(first.row, "SpecimenDateTime");
    let collection = collection.as_deref();

    let observations: Vec<Value> = lab_results
        .iter()
        .enumerate()
        .map(|(i, r)| observation_resource(r, &patient_ref, &root, &obr_id(r.obr), specimen_id, collection, i + 1, tz))
        .collect();
    let asts: Vec<Value> = tests
        .iter()
        .enumerate()
        .map(|(i, s)| ast_resource(s, &patient_ref, &root, &obr_id(s.obr), specimen_id, collection, i + 1, tz))
        .collect();
    // Each drug result hangs off its isolate.
    let isolate_resources: Vec<Value> = isolates
        .iter()
        .map(|iso| {
            let members = tests
                .iter()
                .zip(&asts)
                .filter(|(s, _)| s.isolate_index == iso.index)
                .map(|(_, res)| reference(&format!("Observation/{}", res["id"].as_str().unwrap_or_default())))
                .collect();
            isolate_resource(iso, &patient_ref, &root, &obr_id(iso.obr), specimen_id, collection, members, tz)
        })
        .collect();

    // One Organization per distinct lab and clinic, in first-seen order. A later one with the
    // same id replaces the earlier one in place.
    let mut organizations: Vec<(String, Value)> = Vec::new();
    for lr in &lab_requests {
        for c in [lr.testing.as_ref(), lr.requesting.as_ref()].into_iter().flatten() {
            if let Some((id, org)) = organization_resource(c) {
                match organizations.iter_mut().find(|(existing, _)| *existing == id) {
                    Some(slot) => slot.1 = org,
                    None => organizations.push((id, org)),
                }
            }
        }
    }

    // Each report lists the results and isolates of its own panel, not the drug results: those
    // are reached through their isolate.
    let report_results = |obr: i64| -> Vec<Value> {
        let obs = lab_results.iter().zip(&observations).filter(|(r, _)| r.obr == obr).map(|(_, res)| res);
        let iso = isolates.iter().zip(&isolate_resources).filter(|(i, _)| i.obr == obr).map(|(_, res)| res);
        obs.chain(iso).map(|res| reference(&format!("Observation/{}", res["id"].as_str().unwrap_or_default()))).collect()
    };

    let obr1 = requests.iter().find(|r| col_i64(r, "OBRSetID") == Some(1)).unwrap_or(&requests[0]);
    let specimen = Obj::new()
        .set("resourceType", "Specimen")
        .opt("id", specimen_id)
        .set("subject", reference(&patient_ref))
        .opt(
            "type",
            codeable(concept(SYS_SPECIMEN, col(first.row, "LIMSSpecimenSourceCode"), col(first.row, "LIMSSpecimenSourceDesc")).as_ref()),
        )
        .opt("receivedTime", fhir_datetime(date_col(first.row, "ReceivedDateTime").as_deref(), tz))
        .build();

    let mut out = vec![patient_resource(&root, obr1, patient, tz), specimen];
    out.extend(organizations.into_iter().map(|(_, org)| org));
    for lr in &lab_requests {
        out.extend(request_resources(lr, request_id, &patient_ref, &obr_id(lr.obr), specimen_id, report_results(lr.obr), tz));
    }
    out.extend(observations);
    out.extend(isolate_resources);
    out.extend(asts);
    Ok(out)
}

fn rows_named<'a>(rows: &'a Value, name: &str) -> Vec<&'a Row> {
    rows.get(name).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_object).collect()).unwrap_or_default()
}

fn by_request<'a>(rows: &[&'a Row]) -> HashMap<&'a str, Vec<&'a Row>> {
    let mut out: HashMap<&str, Vec<&Row>> = HashMap::new();
    for row in rows {
        if let Some(id) = row.get("RequestID").and_then(Value::as_str) {
            out.entry(id).or_default().push(row);
        }
    }
    out
}

/// Map one page: a group per key, in key order. A key that cannot be mapped gets an `error`
/// code and no resources; the others are unaffected.
pub fn map_page(keys: &[String], rows: &Value, tz: &str) -> Vec<Value> {
    let requests = rows_named(rows, "requests");
    let results = rows_named(rows, "results");
    let patients = rows_named(rows, "patients");
    let ast = rows_named(rows, "ast");
    let requests_by = by_request(&requests);
    let results_by = by_request(&results);
    let patients_by = by_request(&patients);
    let ast_by = by_request(&ast);
    let none: Vec<&Row> = Vec::new();

    keys.iter()
        .map(|key| {
            let k = key.as_str();
            let mapped = map_request(
                k,
                requests_by.get(k).unwrap_or(&none),
                results_by.get(k).unwrap_or(&none),
                patients_by.get(k).and_then(|p| p.first().copied()),
                ast_by.get(k).unwrap_or(&none),
                tz,
            );
            match mapped {
                Ok(resources) => json!({ "key": key, "resources": resources }),
                Err(code) => json!({ "key": key, "resources": [], "error": code }),
            }
        })
        .collect()
}
