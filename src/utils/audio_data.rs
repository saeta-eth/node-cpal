use cpal::SampleFormat;
use neon::{prelude::*, types::buffer::TypedArray};
use std::{mem, slice};

pub fn parse_sample_format(value: &str) -> Option<SampleFormat> {
    Some(match value {
        "i8" => SampleFormat::I8,
        "i16" => SampleFormat::I16,
        "i24" => SampleFormat::I24,
        "i32" => SampleFormat::I32,
        "i64" => SampleFormat::I64,
        "u8" => SampleFormat::U8,
        "u16" => SampleFormat::U16,
        "u24" => SampleFormat::U24,
        "u32" => SampleFormat::U32,
        "u64" => SampleFormat::U64,
        "f32" => SampleFormat::F32,
        "f64" => SampleFormat::F64,
        "dsdu8" => SampleFormat::DsdU8,
        "dsdu16" => SampleFormat::DsdU16,
        "dsdu32" => SampleFormat::DsdU32,
        _ => return None,
    })
}

fn typed_array_from_bytes<'a, C, T>(cx: &mut C, bytes: &[u8]) -> JsResult<'a, JsValue>
where
    C: Context<'a>,
    T: neon::types::buffer::Binary,
    JsTypedArray<T>: Value,
{
    let element_size = mem::size_of::<T>();
    if bytes.len() % element_size != 0 {
        return cx.throw_error("Native audio buffer has an invalid byte length");
    }

    let mut array = JsTypedArray::<T>::new(cx, bytes.len() / element_size)?;
    if bytes.is_empty() {
        return Ok(array.upcast());
    }
    let target = array.as_mut_slice(cx);
    let target_bytes = unsafe {
        slice::from_raw_parts_mut(target.as_mut_ptr().cast::<u8>(), mem::size_of_val(target))
    };
    target_bytes.copy_from_slice(bytes);
    Ok(array.upcast())
}

pub fn js_typed_array_from_bytes<'a, C>(
    cx: &mut C,
    format: SampleFormat,
    bytes: &[u8],
) -> JsResult<'a, JsValue>
where
    C: Context<'a>,
{
    match format {
        SampleFormat::I8 => typed_array_from_bytes::<C, i8>(cx, bytes),
        SampleFormat::I16 => typed_array_from_bytes::<C, i16>(cx, bytes),
        SampleFormat::I24 | SampleFormat::I32 => typed_array_from_bytes::<C, i32>(cx, bytes),
        SampleFormat::I64 => typed_array_from_bytes::<C, i64>(cx, bytes),
        SampleFormat::U8 | SampleFormat::DsdU8 => typed_array_from_bytes::<C, u8>(cx, bytes),
        SampleFormat::U16 | SampleFormat::DsdU16 => typed_array_from_bytes::<C, u16>(cx, bytes),
        SampleFormat::U24 | SampleFormat::U32 | SampleFormat::DsdU32 => {
            typed_array_from_bytes::<C, u32>(cx, bytes)
        }
        SampleFormat::U64 => typed_array_from_bytes::<C, u64>(cx, bytes),
        SampleFormat::F32 => typed_array_from_bytes::<C, f32>(cx, bytes),
        SampleFormat::F64 => typed_array_from_bytes::<C, f64>(cx, bytes),
        _ => cx.throw_error("Unsupported CPAL sample format"),
    }
}

fn bytes_from_typed_array<'a, C, T>(
    cx: &mut C,
    value: Handle<'a, JsValue>,
    expected: &'static str,
) -> NeonResult<Vec<u8>>
where
    C: Context<'a>,
    T: neon::types::buffer::Binary,
    JsTypedArray<T>: Value,
{
    let array = match value.downcast::<JsTypedArray<T>, _>(cx) {
        Ok(array) => array,
        Err(_) => {
            return cx.throw_type_error(format!("Expected {expected} for the configured format"))
        }
    };
    if array.len(cx) == 0 {
        return Ok(Vec::new());
    }
    let values = array.as_slice(cx);
    let bytes =
        unsafe { slice::from_raw_parts(values.as_ptr().cast::<u8>(), mem::size_of_val(values)) };
    Ok(bytes.to_vec())
}

pub fn bytes_from_js_typed_array<'a, C>(
    cx: &mut C,
    format: SampleFormat,
    value: Handle<'a, JsValue>,
) -> NeonResult<Vec<u8>>
where
    C: Context<'a>,
{
    let bytes = match format {
        SampleFormat::I8 => bytes_from_typed_array::<C, i8>(cx, value, "Int8Array")?,
        SampleFormat::I16 => bytes_from_typed_array::<C, i16>(cx, value, "Int16Array")?,
        SampleFormat::I24 | SampleFormat::I32 => {
            bytes_from_typed_array::<C, i32>(cx, value, "Int32Array")?
        }
        SampleFormat::I64 => bytes_from_typed_array::<C, i64>(cx, value, "BigInt64Array")?,
        SampleFormat::U8 | SampleFormat::DsdU8 => {
            bytes_from_typed_array::<C, u8>(cx, value, "Uint8Array")?
        }
        SampleFormat::U16 | SampleFormat::DsdU16 => {
            bytes_from_typed_array::<C, u16>(cx, value, "Uint16Array")?
        }
        SampleFormat::U24 | SampleFormat::U32 | SampleFormat::DsdU32 => {
            bytes_from_typed_array::<C, u32>(cx, value, "Uint32Array")?
        }
        SampleFormat::U64 => bytes_from_typed_array::<C, u64>(cx, value, "BigUint64Array")?,
        SampleFormat::F32 => bytes_from_typed_array::<C, f32>(cx, value, "Float32Array")?,
        SampleFormat::F64 => bytes_from_typed_array::<C, f64>(cx, value, "Float64Array")?,
        _ => return cx.throw_type_error("Unsupported CPAL sample format"),
    };

    if format == SampleFormat::I24 {
        for sample in bytes.chunks_exact(mem::size_of::<i32>()) {
            let sample = i32::from_ne_bytes(sample.try_into().expect("four-byte sample"));
            if !(-(1 << 23)..=(1 << 23) - 1).contains(&sample) {
                return cx.throw_range_error("i24 samples must be between -8388608 and 8388607");
            }
        }
    } else if format == SampleFormat::U24 {
        for sample in bytes.chunks_exact(mem::size_of::<u32>()) {
            let sample = u32::from_ne_bytes(sample.try_into().expect("four-byte sample"));
            if sample > (1 << 24) - 1 {
                return cx.throw_range_error("u24 samples must be between 0 and 16777215");
            }
        }
    }

    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::parse_sample_format;
    use cpal::SampleFormat;

    #[test]
    fn parses_every_public_sample_format() {
        let formats = [
            ("i8", SampleFormat::I8),
            ("i16", SampleFormat::I16),
            ("i24", SampleFormat::I24),
            ("i32", SampleFormat::I32),
            ("i64", SampleFormat::I64),
            ("u8", SampleFormat::U8),
            ("u16", SampleFormat::U16),
            ("u24", SampleFormat::U24),
            ("u32", SampleFormat::U32),
            ("u64", SampleFormat::U64),
            ("f32", SampleFormat::F32),
            ("f64", SampleFormat::F64),
            ("dsdu8", SampleFormat::DsdU8),
            ("dsdu16", SampleFormat::DsdU16),
            ("dsdu32", SampleFormat::DsdU32),
        ];

        for (name, expected) in formats {
            assert_eq!(parse_sample_format(name), Some(expected));
        }
        assert_eq!(parse_sample_format("invalid"), None);
    }
}
