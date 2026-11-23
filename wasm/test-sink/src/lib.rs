//! Trivial sink plugin: proves the sink ABI (named entrypoints, JSON in/out, dry-run echo).
//! Not a reference plugin — used only to validate the host sink runtime.

#[cfg(target_arch = "wasm32")]
mod plugin {
    use extism_pdk::*;
    use serde_json::{json, Value};

    /// Cheap liveness probe. Input ignored; returns { ok, version }.
    #[plugin_fn]
    pub fn health_check(_input: Vec<u8>) -> FnResult<String> {
        Ok(json!({ "ok": true, "version": "test-sink" }).to_string())
    }

    /// Dry-run echo: empty dataValues payload + the parsed input echoed back. No egress.
    #[plugin_fn]
    pub fn push_aggregate(input: Vec<u8>) -> FnResult<String> {
        let parsed: Value = if input.is_empty() {
            json!({})
        } else {
            serde_json::from_slice(&input)
                .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid input JSON: {e}")), 1))?
        };
        Ok(json!({ "payload": { "dataValues": [] }, "skipped": [], "echo": parsed }).to_string())
    }

    /// Converter ABI: raw bytes in (UTF-8 text) → { items: one per non-empty line }.
    #[plugin_fn]
    pub fn wf_convert(input: Vec<u8>) -> FnResult<String> {
        let text = String::from_utf8_lossy(&input);
        let items: Vec<Value> = text
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .map(|l| json!({ "json": { "line": l } }))
            .collect();
        Ok(json!({ "items": items }).to_string())
    }

    /// Emit a produced file as inline base64 on an output item (base64 of "hello" = aGVsbG8=).
    #[plugin_fn]
    pub fn wf_emit(_input: Vec<u8>) -> FnResult<String> {
        Ok(json!({ "items": [{
            "json": { "ok": true },
            "binary": { "out": { "contentType": "text/plain", "fileName": "hello.txt", "dataBase64": "aGVsbG8=" } }
        }] }).to_string())
    }

    /// Workflow-node ABI echo: parse { items, config }, return { items, meta:{count,config} }.
    #[plugin_fn]
    pub fn wf_echo(input: Vec<u8>) -> FnResult<String> {
        let parsed: Value = if input.is_empty() {
            json!({})
        } else {
            serde_json::from_slice(&input)
                .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid input JSON: {e}")), 1))?
        };
        let items = parsed.get("items").cloned().unwrap_or_else(|| json!([]));
        let config = parsed.get("config").cloned().unwrap_or_else(|| json!({}));
        let count = items.as_array().map(|a| a.len()).unwrap_or(0);
        Ok(json!({ "items": items, "meta": { "count": count, "config": config } }).to_string())
    }
}

/// Host-function entrypoints (feature `host`). Each passes its input to one CE host function
/// through the SDK wrappers and answers `{ ok: true, result }` or `{ ok: false, error }`, so a test
/// sees exactly what CE answered.
#[cfg(all(target_arch = "wasm32", feature = "host"))]
mod host_plugin {
    use extism_pdk::*;
    use openldr_plugin_sdk::host::{self, HostError};
    use serde_json::{json, Value};

    fn input_json(input: &[u8]) -> FnResult<Value> {
        if input.is_empty() {
            return Ok(json!({}));
        }
        serde_json::from_slice(input)
            .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid input JSON: {e}")), 1))
    }

    fn answer(r: Result<Value, HostError>) -> String {
        match r {
            Ok(result) => json!({ "ok": true, "result": result }),
            Err(e) => json!({ "ok": false, "error": e.to_json() }),
        }
        .to_string()
    }

    /// Input: a db_select request.
    #[plugin_fn]
    pub fn host_db_select(input: Vec<u8>) -> FnResult<String> {
        Ok(answer(host::db_select(&input_json(&input)?)))
    }

    /// Input: a db_write request.
    #[plugin_fn]
    pub fn host_db_write(input: Vec<u8>) -> FnResult<String> {
        Ok(answer(host::db_write(&input_json(&input)?)))
    }

    /// Input: `{ table, values, select }`. Inserts one row, then reads with `select`, in one call.
    /// Answers `{ write, select }`, each as CE answered it.
    #[plugin_fn]
    pub fn host_db_roundtrip(input: Vec<u8>) -> FnResult<String> {
        let i = input_json(&input)?;
        let table = i.get("table").cloned().unwrap_or(Value::Null);
        let values = i.get("values").cloned().unwrap_or_else(|| json!({}));
        let write = host::db_write(&json!({ "steps": [{ "op": "insert", "table": table, "values": values }] }));
        let select = host::db_select(i.get("select").unwrap_or(&json!({})));
        let parse = |s: String| serde_json::from_str::<Value>(&s).unwrap_or(Value::Null);
        Ok(json!({ "write": parse(answer(write)), "select": parse(answer(select)) }).to_string())
    }

    /// Input: `{ op, input }`.
    #[plugin_fn]
    pub fn host_ce_read(input: Vec<u8>) -> FnResult<String> {
        let i = input_json(&input)?;
        let op = i.get("op").and_then(Value::as_str).unwrap_or("").to_string();
        Ok(answer(host::ce_read(&op, i.get("input").cloned().unwrap_or_else(|| json!({})))))
    }

    /// Input: `{ resources: [...] }`.
    #[plugin_fn]
    pub fn host_fhir_emit(input: Vec<u8>) -> FnResult<String> {
        let i = input_json(&input)?;
        let resources = i.get("resources").and_then(Value::as_array).cloned().unwrap_or_default();
        Ok(answer(host::fhir_emit(&resources)))
    }
}

// The host (non-wasm) build needs at least one item so `cargo check`/`clippy` succeed.
#[cfg(not(target_arch = "wasm32"))]
pub fn _host_placeholder() {}
