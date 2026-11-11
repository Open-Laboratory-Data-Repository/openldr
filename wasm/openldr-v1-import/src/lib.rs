//! OpenLDR v1 import source plugin.
//!
//! CE's import host (packages/bootstrap/src/import-run.ts) drives an import by calling three
//! entrypoints, JSON in and JSON out:
//!
//!   import_queries  { options }                 -> { keyQuery: { sql }, detailQueries: [{ name, sql }] }
//!   import_checks   { options }                 -> { checks: [{ id, sql }] }
//!   import_map      { keys, rows, options }     -> { groups: [{ key, resources, error? }] }
//!
//! This plugin never opens a database connection. It supplies SELECT statements; the host runs
//! them on a connector an admin allowed, and hands the rows back to `import_map`.

pub mod mapping;
pub mod queries;
pub mod rules;
pub mod text;

use serde_json::{json, Value};

fn options(input: &Value) -> Result<queries::Options, String> {
    queries::parse_options(input.get("options").unwrap_or(&Value::Null))
}

pub fn import_queries(input: &Value) -> Result<Value, String> {
    Ok(queries::queries(&options(input)?))
}

pub fn import_checks(input: &Value) -> Result<Value, String> {
    Ok(queries::checks(&options(input)?))
}

pub fn import_map(input: &Value) -> Result<Value, String> {
    let o = options(input)?;
    let keys: Vec<String> = input
        .get("keys")
        .and_then(Value::as_array)
        .ok_or("keys must be an array")?
        .iter()
        .map(|k| k.as_str().map(str::to_string).ok_or("every key must be text"))
        .collect::<Result<_, _>>()?;
    let rows = input.get("rows").unwrap_or(&Value::Null);
    Ok(json!({ "groups": mapping::map_page(&keys, rows, &o.tz) }))
}

// The Extism glue links wasm host imports that do not exist natively, so it is compiled only
// for the wasm target. Native `cargo test` covers the pure functions above.
#[cfg(target_arch = "wasm32")]
mod plugin {
    use extism_pdk::*;
    use serde_json::Value;

    fn run(input: Vec<u8>, f: fn(&Value) -> Result<Value, String>) -> FnResult<String> {
        let parsed: Value = if input.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&input).map_err(|e| WithReturnCode::new(Error::msg(format!("invalid input JSON: {e}")), 1))?
        };
        f(&parsed).map(|v| v.to_string()).map_err(|e| WithReturnCode::new(Error::msg(e), 1))
    }

    #[plugin_fn]
    pub fn import_queries(input: Vec<u8>) -> FnResult<String> {
        run(input, crate::import_queries)
    }

    #[plugin_fn]
    pub fn import_checks(input: Vec<u8>) -> FnResult<String> {
        run(input, crate::import_checks)
    }

    #[plugin_fn]
    pub fn import_map(input: Vec<u8>) -> FnResult<String> {
        run(input, crate::import_map)
    }
}
