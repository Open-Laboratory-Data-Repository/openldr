//! Which v1 `Requests` columns become request attributes in CE, and under which code.
//!
//! A copy of cdr-toolchain `config/v1-request-attributes.yaml`. The codes are entries in CE's
//! `urn:openldr:cs:request-attribute` code system. tests/golden.rs compares this table with
//! `tests/fixtures/attribute-rules.json`, which is generated from that YAML, so a change there
//! fails a test here until this table is updated.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttrKind {
    String,
    Boolean,
    Datetime,
    Number,
}

impl AttrKind {
    pub fn name(self) -> &'static str {
        match self {
            AttrKind::String => "string",
            AttrKind::Boolean => "boolean",
            AttrKind::Datetime => "datetime",
            AttrKind::Number => "number",
        }
    }
}

pub struct AttrRule {
    pub column: &'static str,
    pub code: &'static str,
    pub kind: AttrKind,
}

const fn rule(column: &'static str, code: &'static str, kind: AttrKind) -> AttrRule {
    AttrRule { column, code, kind }
}

pub const RULES: &[AttrRule] = &[
    rule("LIMSPreReg_RegistrationDateTime", "prereg-registration-time", AttrKind::Datetime),
    rule("LIMSPreReg_ReceivedDateTime", "prereg-received-time", AttrKind::Datetime),
    rule("LIMSPreReg_RegistrationFacilityCode", "prereg-registration-facility", AttrKind::String),
    rule("LOINCPanelCode", "loinc-panel-code", AttrKind::String),
    rule("AdmitAttendDateTime", "admit-attend-time", AttrKind::Datetime),
    rule("CollectionVolume", "collection-volume", AttrKind::Number),
    rule("ICD10ClinicalInfoCodes", "icd10-clinical-info", AttrKind::String),
    rule("HL7SpecimenSourceCode", "hl7-specimen-source", AttrKind::String),
    rule("HL7SpecimenSiteCode", "hl7-specimen-site", AttrKind::String),
    rule("LIMSSpecimenSiteCode", "specimen-site-code", AttrKind::String),
    rule("LIMSSpecimenSiteDesc", "specimen-site-desc", AttrKind::String),
    rule("WorkUnits", "work-units", AttrKind::Number),
    rule("CostUnits", "cost-units", AttrKind::Number),
    rule("OrderingNotes", "ordering-notes", AttrKind::String),
    rule("EncryptedPatientID", "encrypted-patient-id", AttrKind::String),
    rule("HL7EthnicGroupCode", "ethnic-group", AttrKind::String),
    rule("Deceased", "deceased", AttrKind::Boolean),
    rule("Newborn", "newborn", AttrKind::Boolean),
    rule("HL7PatientClassCode", "patient-class", AttrKind::String),
    rule("ReferringRequestID", "referring-request-id", AttrKind::String),
    rule("Therapy", "therapy", AttrKind::String),
    rule("TargetTimeDays", "target-time-days", AttrKind::Number),
    rule("TargetTimeMins", "target-time-mins", AttrKind::Number),
    // Repeated is tinyint in v1, so it is a number, not a bit.
    rule("Repeated", "repeated", AttrKind::Number),
];
