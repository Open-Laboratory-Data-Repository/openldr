//! CE host functions a plugin's server code can call: `db_select`, `db_write`, `ce_read` and
//! `fhir_emit`. Each takes one JSON request and gives back one JSON answer.
//!
//! CE answers `{ "ok": true, "result": ... }` or `{ "ok": false, "error": { "code", "message" } }`.
//! The wrappers here turn that into `Ok(result)` or `Err(HostError)`.
//!
//! A host function exists only when the plugin's grant has its capability:
//! - `db_select` and `db_write` need `host:db`.
//! - `ce_read` needs `host:ce-read`.
//! - `fhir_emit` needs `emit-fhir` and `host:db`.
//!
//! A wasm module that imports a host function cannot load where CE does not give it. So call these
//! only from a plugin whose manifest declares the capability. The imports are made only when a
//! wrapper is used, so a plugin that never calls one imports nothing.

use serde_json::{json, Value};

/// A refused or failed host call. `code` is CE's code, such as `INVALID_REQUEST`, `REQUEST_TABLE`,
/// `RESOURCE_TYPE_NOT_ALLOWED` or `OUTSIDE_DATA_LIMIT`. `issues` holds validation issues when CE
/// sends them.
#[derive(Debug, Clone, PartialEq)]
pub struct HostError {
    pub code: String,
    pub message: String,
    pub issues: Option<Value>,
}

impl HostError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        HostError { code: code.to_string(), message: message.into(), issues: None }
    }

    /// The error as CE wrote it: `{ code, message }`, with `issues` when there are any.
    pub fn to_json(&self) -> Value {
        let mut v = json!({ "code": self.code, "message": self.message });
        if let Some(issues) = &self.issues {
            v["issues"] = issues.clone();
        }
        v
    }
}

impl std::fmt::Display for HostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for HostError {}

/// Reads CE's answer text. Public so a plugin can test its own handling natively.
pub fn parse_answer(text: &str) -> Result<Value, HostError> {
    let v: Value = serde_json::from_str(text)
        .map_err(|e| HostError::new("BAD_ANSWER", format!("CE's answer is not JSON: {e}")))?;
    match v.get("ok").and_then(Value::as_bool) {
        Some(true) => Ok(v.get("result").cloned().unwrap_or(Value::Null)),
        Some(false) => {
            let err = v.get("error").cloned().unwrap_or(Value::Null);
            let text_of = |k: &str| err.get(k).and_then(Value::as_str).map(str::to_string);
            Err(HostError {
                code: text_of("code").unwrap_or_else(|| "HOST_ERROR".to_string()),
                message: text_of("message").unwrap_or_default(),
                issues: err.get("issues").cloned(),
            })
        }
        None => Err(HostError::new("BAD_ANSWER", "CE's answer has no ok field")),
    }
}

/// The request `ce_read` takes: an op name and its input.
pub fn ce_read_request(op: &str, input: Value) -> Value {
    json!({ "op": op, "input": input })
}

/// The request `fhir_emit` takes: the records to save.
pub fn fhir_emit_request(resources: &[Value]) -> Value {
    json!({ "resources": resources })
}

#[cfg(target_arch = "wasm32")]
mod imports {
    use extism_pdk::*;

    #[host_fn]
    extern "ExtismHost" {
        pub fn db_select(input: String) -> String;
        pub fn db_write(input: String) -> String;
        pub fn ce_read(input: String) -> String;
        pub fn fhir_emit(input: String) -> String;
    }
}

#[cfg(target_arch = "wasm32")]
fn call(name: &str, f: unsafe fn(String) -> Result<String, extism_pdk::Error>, request: &Value) -> Result<Value, HostError> {
    // SAFETY: each import takes one memory offset and gives one back, as the macro declares, and
    // CE registers it under the same name in `extism:host/user`.
    let text = unsafe { f(request.to_string()) }
        .map_err(|e| HostError::new("HOST_CALL_FAILED", format!("{name}: {e}")))?;
    parse_answer(&text)
}

/// Reads rows from one of the plugin's own tables. `request` is
/// `{ table, columns?, where?, orderBy?, limit?, offset?, count? }`. The result is
/// `{ rows, count? }`.
#[cfg(target_arch = "wasm32")]
pub fn db_select(request: &Value) -> Result<Value, HostError> {
    call("db_select", imports::db_select, request)
}

/// Writes to the plugin's own tables in one transaction. `request` is `{ steps: [...] }`, each
/// step an `insert`, `update` or `delete`. The result is `{ results: [{ rowCount }] }`.
#[cfg(target_arch = "wasm32")]
pub fn db_write(request: &Value) -> Result<Value, HostError> {
    call("db_write", imports::db_write, request)
}

/// Reads CE's own records through one op, such as `patients.search` or `valueset.expand`.
#[cfg(target_arch = "wasm32")]
pub fn ce_read(op: &str, input: Value) -> Result<Value, HostError> {
    call("ce_read", imports::ce_read, &ce_read_request(op, input))
}

/// Sends finished FHIR records into CE. Every type must be in the plugin's `emit-fhir` list. Either
/// all are saved or none. The result is `{ saved }`.
#[cfg(target_arch = "wasm32")]
pub fn fhir_emit(resources: &[Value]) -> Result<Value, HostError> {
    call("fhir_emit", imports::fhir_emit, &fhir_emit_request(resources))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_answer_gives_the_result() {
        assert_eq!(parse_answer(r#"{"ok":true,"result":{"rows":[]}}"#), Ok(json!({ "rows": [] })));
    }

    #[test]
    fn refused_answer_gives_code_message_and_issues() {
        let e = parse_answer(r#"{"ok":false,"error":{"code":"VALIDATION_FAILED","message":"no","issues":[1]}}"#).unwrap_err();
        assert_eq!(e.code, "VALIDATION_FAILED");
        assert_eq!(e.message, "no");
        assert_eq!(e.issues, Some(json!([1])));
        assert_eq!(e.to_json(), json!({ "code": "VALIDATION_FAILED", "message": "no", "issues": [1] }));
    }

    #[test]
    fn an_answer_that_is_not_json_or_has_no_ok_is_bad() {
        assert_eq!(parse_answer("nope").unwrap_err().code, "BAD_ANSWER");
        assert_eq!(parse_answer("{}").unwrap_err().code, "BAD_ANSWER");
    }

    #[test]
    fn request_shapes() {
        assert_eq!(ce_read_request("patients.get", json!({ "ref": "p1" })), json!({ "op": "patients.get", "input": { "ref": "p1" } }));
        assert_eq!(fhir_emit_request(&[json!({ "resourceType": "Observation" })]), json!({ "resources": [{ "resourceType": "Observation" }] }));
    }
}
