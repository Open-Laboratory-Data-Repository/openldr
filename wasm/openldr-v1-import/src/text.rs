//! Text, number and date helpers. Each mirrors the JavaScript it was ported from
//! (cdr-toolchain `apps/v1-push` and `packages/ce-fhir`), so the golden files match exactly.

use serde_json::{Map, Number, Value};

pub type Row = Map<String, Value>;

/// The characters JavaScript's `trim()` and regex `\s` treat as whitespace. Rust's `trim()` is
/// close but not equal (it takes U+0085 and leaves U+FEFF), so the set is spelled out.
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}'..='\u{d}'
            | ' '
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// Trimmed text, with an empty string as None. This is `str()` in v1-push and `fhirText()` in ce-fhir.
pub fn text(s: Option<&str>) -> Option<String> {
    let t = js_trim(s?);
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// A string column, trimmed, with null, empty and non-string values as None.
pub fn col(row: &Row, name: &str) -> Option<String> {
    text(row.get(name).and_then(Value::as_str))
}

/// A numeric column as an integer. Null and non-numbers are None.
pub fn col_i64(row: &Row, name: &str) -> Option<i64> {
    let n = row.get(name)?.as_number()?;
    n.as_i64().or_else(|| n.as_f64().map(|f| f as i64))
}

/// A JSON number the way JavaScript's `String(n)` prints it.
pub fn js_number_string(n: &Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    js_f64_string(n.as_f64().unwrap_or(0.0))
}

pub fn js_f64_string(f: f64) -> String {
    let abs = f.abs();
    if abs != 0.0 && (abs >= 1e21 || abs < 1e-6) {
        // JavaScript switches to exponent form here and writes a sign on a positive exponent.
        let s = format!("{f:e}");
        return match s.split_once('e') {
            Some((m, e)) if !e.starts_with('-') => format!("{m}e+{e}"),
            _ => s,
        };
    }
    format!("{f}")
}

/// A float as a JSON number that prints like JavaScript's: 40, not 40.0.
pub fn json_number(f: f64) -> Value {
    if f.fract() == 0.0 && f.abs() < 9.0e15 {
        Value::from(f as i64)
    } else {
        Value::from(f)
    }
}

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

fn digits(s: &str, n: usize) -> Option<u32> {
    if s.len() == n && all_digits(s) {
        s.parse().ok()
    } else {
        None
    }
}

/// A v1 datetime as local wall clock, "YYYY-MM-DDTHH:mm:ss". The import host sends a SQL Server
/// datetime as "YYYY-MM-DDTHH:mm:ss.SSS" with no zone; `toLocalIso` in v1-push drops the fraction.
pub fn to_local_iso(s: Option<&str>) -> Option<String> {
    let s = s?;
    let b = s.as_bytes();
    if b.len() < 19 || !s.is_char_boundary(19) {
        return None;
    }
    let head = &s[..19];
    let ok = digits(&head[0..4], 4).is_some()
        && &head[4..5] == "-"
        && digits(&head[5..7], 2).is_some()
        && &head[7..8] == "-"
        && digits(&head[8..10], 2).is_some()
        && &head[10..11] == "T"
        && digits(&head[11..13], 2).is_some()
        && &head[13..14] == ":"
        && digits(&head[14..16], 2).is_some()
        && &head[16..17] == ":"
        && digits(&head[17..19], 2).is_some();
    if ok {
        Some(head.to_string())
    } else {
        None
    }
}

/// CE's id rule: `[A-Za-z0-9.-]{1,64}`. Other characters become hyphens, runs collapse, the
/// result is cut to 64 and then stripped of leading and trailing hyphens. `fhirId` in ce-fhir.
pub fn fhir_id(raw: &str) -> Option<String> {
    let mut out = String::new();
    let mut last_hyphen = false;
    for c in js_trim(raw).chars() {
        let c = if c.is_ascii_alphanumeric() || c == '.' { c } else { '-' };
        if c == '-' {
            if last_hyphen {
                continue;
            }
            last_hyphen = true;
        } else {
            last_hyphen = false;
        }
        out.push(c);
    }
    out.truncate(64);
    let cleaned = out.trim_matches('-');
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned.to_string())
    }
}

/// "Z", "+HH:MM" or "-HH:MM".
pub fn is_tz_offset(tz: &str) -> bool {
    if tz == "Z" {
        return true;
    }
    let b = tz.as_bytes();
    b.len() == 6
        && (b[0] == b'+' || b[0] == b'-')
        && b[1].is_ascii_digit()
        && b[2].is_ascii_digit()
        && b[3] == b':'
        && b[4].is_ascii_digit()
        && b[5].is_ascii_digit()
}

fn days_in_month(y: u32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            if (y.is_multiple_of(4) && !y.is_multiple_of(100)) || y.is_multiple_of(400) {
                29
            } else {
                28
            }
        }
    }
}

fn is_real_date(y: u32, mo: u32, d: u32, h: u32, mi: u32, s: u32) -> bool {
    y >= 1000 && (1..=12).contains(&mo) && d >= 1 && d <= days_in_month(y, mo) && h <= 23 && mi <= 59 && s <= 59
}

/// True for an optional ".digits" fraction (or nothing).
fn is_fraction(s: &str) -> bool {
    s.is_empty() || (s.starts_with('.') && all_digits(&s[1..]))
}

/// `fhirDateTime` in ce-fhir. A date stays a date. A local date and time gets the offset. An
/// already-zoned value passes through. Anything else, or a date that does not exist, is None.
/// The caller has already checked `tz` with `is_tz_offset`.
pub fn fhir_datetime(raw: Option<&str>, tz: &str) -> Option<String> {
    let s = js_trim(raw?);
    if s.is_empty() || !s.is_ascii() {
        return None;
    }

    // Date only: YYYY, YYYY-MM or YYYY-MM-DD.
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() <= 3 && digits(parts[0], 4).is_some() && parts[1..].iter().all(|p| digits(p, 2).is_some()) {
        let y = digits(parts[0], 4)?;
        let mo = parts.get(1).and_then(|p| digits(p, 2)).unwrap_or(1);
        let d = parts.get(2).and_then(|p| digits(p, 2)).unwrap_or(1);
        return if is_real_date(y, mo, d, 0, 0, 0) { Some(s.to_string()) } else { None };
    }

    if s.len() < 19 {
        return None;
    }
    let (head, tail) = s.split_at(19);
    let sep = &head[10..11];
    let y = digits(&head[0..4], 4);
    let mo = digits(&head[5..7], 2);
    let d = digits(&head[8..10], 2);
    let h = digits(&head[11..13], 2);
    let mi = digits(&head[14..16], 2);
    let sec = digits(&head[17..19], 2);
    let shape = &head[4..5] == "-" && &head[7..8] == "-" && &head[13..14] == ":" && &head[16..17] == ":";
    let (Some(y), Some(mo), Some(d), Some(h), Some(mi), Some(sec), true) = (y, mo, d, h, mi, sec, shape) else {
        return None;
    };

    // Already zoned: left alone, as ce-fhir does.
    if sep == "T" {
        let zone_at = tail.find(['Z', '+', '-']);
        if let Some(i) = zone_at {
            if is_fraction(&tail[..i]) && is_tz_offset(&tail[i..]) {
                return Some(s.to_string());
            }
        }
    }

    // Local wall clock: stamp it with the offset, if it is a real instant.
    if (sep == "T" || sep == " ") && is_fraction(tail) {
        if !is_real_date(y, mo, d, h, mi, sec) {
            return None;
        }
        return Some(format!("{}{}", s.replacen(' ', "T", 1), tz));
    }
    None
}

/// Scan `-?digits(.digits)?` from the start of `s`. Returns the byte length, or None.
fn scan_plain(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let mut i = 0;
    if b.first() == Some(&b'-') {
        i += 1;
    }
    let start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    if i == start {
        return None;
    }
    if i + 1 < b.len() && b[i] == b'.' && b[i + 1].is_ascii_digit() {
        i += 1;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
    }
    Some(i)
}

/// `/^-?\d+(\.\d+)?$/`: a plain number and nothing else.
pub fn parse_plain_number(s: &str) -> Option<f64> {
    if scan_plain(s)? == s.len() {
        s.parse().ok()
    } else {
        None
    }
}

/// `/^([<>])?\s*(-?(?:\d+(?:\.\d*)?|\.\d+))$/`: a reported number with an optional < or > first.
/// Unlike a plain number it allows "20." and ".5".
pub fn parse_reported_number(s: &str) -> Option<(Option<char>, f64)> {
    let mut rest = s;
    let mut comparator = None;
    if let Some(c) = rest.chars().next() {
        if c == '<' || c == '>' {
            comparator = Some(c);
            rest = &rest[1..];
        }
    }
    rest = rest.trim_start_matches(is_js_space);
    let body = rest.strip_prefix('-').unwrap_or(rest);
    let (whole, frac) = match body.split_once('.') {
        Some((w, f)) => (w, Some(f)),
        None => (body, None),
    };
    let ok = match frac {
        None => all_digits(whole),
        Some(f) => (all_digits(whole) && (f.is_empty() || all_digits(f))) || (whole.is_empty() && all_digits(f)),
    };
    if !ok {
        return None;
    }
    // "20." and ".5" are not valid Rust float text, so give them the missing digit.
    let mut fixed = String::from(rest);
    if fixed.ends_with('.') {
        fixed.push('0');
    }
    let fixed = fixed.replacen("-.", "-0.", 1);
    let fixed = if fixed.starts_with('.') { format!("0{fixed}") } else { fixed };
    fixed.parse().ok().map(|n| (comparator, n))
}

/// `/^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/`: "4.0-11.0" as (4, 11).
pub fn parse_range(s: &str) -> Option<(f64, f64)> {
    let s = js_trim(s);
    let n1 = scan_plain(s)?;
    let low: f64 = s[..n1].parse().ok()?;
    let rest = s[n1..].trim_start_matches(is_js_space);
    let rest = rest.strip_prefix('-')?.trim_start_matches(is_js_space);
    let n2 = scan_plain(rest)?;
    if n2 != rest.len() {
        return None;
    }
    Some((low, rest.parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_trims_and_drops_empty() {
        assert_eq!(text(Some("  a b \u{feff}")), Some("a b".to_string()));
        assert_eq!(text(Some("   ")), None);
        assert_eq!(text(None), None);
    }

    #[test]
    fn fhir_id_cleans_and_cuts() {
        assert_eq!(fhir_id("MZ/2024_000 12"), Some("MZ-2024-000-12".to_string()));
        assert_eq!(fhir_id("___"), None);
        assert_eq!(fhir_id(&format!("{}-x", "A".repeat(64))), Some("A".repeat(64)));
        assert_eq!(fhir_id(&format!("{}-spec", "A".repeat(63))), Some("A".repeat(63)));
    }

    #[test]
    fn datetime_gets_the_offset_and_refuses_what_is_not_a_date() {
        assert_eq!(fhir_datetime(Some("2024-03-05T14:30:07"), "+02:00"), Some("2024-03-05T14:30:07+02:00".to_string()));
        assert_eq!(fhir_datetime(Some("2024-03-05 14:30:07.120"), "Z"), Some("2024-03-05T14:30:07.120Z".to_string()));
        assert_eq!(fhir_datetime(Some("1990-01-15"), "+02:00"), Some("1990-01-15".to_string()));
        assert_eq!(fhir_datetime(Some("2024-03-05T14:30:07-05:00"), "+02:00"), Some("2024-03-05T14:30:07-05:00".to_string()));
        assert_eq!(fhir_datetime(Some("2023-02-29"), "+02:00"), None);
        assert_eq!(fhir_datetime(Some("2024-13-45T99:99:99"), "+02:00"), None);
        assert_eq!(fhir_datetime(Some("07/20/2024"), "+02:00"), None);
        assert_eq!(fhir_datetime(Some("0024-01-01"), "+02:00"), None);
        assert_eq!(fhir_datetime(None, "+02:00"), None);
    }

    #[test]
    fn tz_offsets() {
        for good in ["Z", "+02:00", "-05:30"] {
            assert!(is_tz_offset(good), "{good}");
        }
        for bad in ["", "z", "+2:00", "02:00", "+0200", "UTC"] {
            assert!(!is_tz_offset(bad), "{bad}");
        }
    }

    #[test]
    fn local_iso_drops_the_fraction() {
        assert_eq!(to_local_iso(Some("2024-03-05T14:30:07.120")), Some("2024-03-05T14:30:07".to_string()));
        assert_eq!(to_local_iso(Some("2024-03-05")), None);
        assert_eq!(to_local_iso(None), None);
    }

    #[test]
    fn reported_numbers() {
        assert_eq!(parse_reported_number("40"), Some((None, 40.0)));
        assert_eq!(parse_reported_number("< 20"), Some((Some('<'), 20.0)));
        assert_eq!(parse_reported_number(">10"), Some((Some('>'), 10.0)));
        assert_eq!(parse_reported_number("20."), Some((None, 20.0)));
        assert_eq!(parse_reported_number(".5"), Some((None, 0.5)));
        assert_eq!(parse_reported_number("-3.25"), Some((None, -3.25)));
        assert_eq!(parse_reported_number("-.5"), Some((None, -0.5)));
        for bad in ["1,200", "", ".", "-", "1e3", "<=1", "Target Not Detected", "1.2.3", "5 "] {
            assert_eq!(parse_reported_number(bad), None, "{bad}");
        }
    }

    #[test]
    fn plain_numbers_and_ranges() {
        assert_eq!(parse_plain_number("12"), Some(12.0));
        assert_eq!(parse_plain_number("-2"), Some(-2.0));
        assert_eq!(parse_plain_number("0.25"), Some(0.25));
        assert_eq!(parse_plain_number("1."), None);
        assert_eq!(parse_plain_number("<=1"), None);
        assert_eq!(parse_range("4.0-11.0"), Some((4.0, 11.0)));
        assert_eq!(parse_range(" -1.5 - 2 "), Some((-1.5, 2.0)));
        assert_eq!(parse_range("10-20-30"), None);
        assert_eq!(parse_range("see note"), None);
    }

    #[test]
    fn numbers_print_like_javascript() {
        assert_eq!(js_f64_string(2.5), "2.5");
        assert_eq!(js_f64_string(3.0), "3");
        assert_eq!(js_f64_string(1e21), "1e+21");
        assert_eq!(js_f64_string(1e-7), "1e-7");
        assert_eq!(json_number(40.0).to_string(), "40");
        assert_eq!(json_number(0.5).to_string(), "0.5");
    }
}
