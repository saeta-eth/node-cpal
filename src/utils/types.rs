use cpal::SampleFormat;

pub type DeviceId = String;
pub type StreamId = String;

pub fn sample_format_to_js_string(format: SampleFormat) -> String {
    format.to_string()
}

#[cfg(test)]
mod tests {
    use super::sample_format_to_js_string;
    use cpal::SampleFormat;

    #[test]
    fn serializes_all_cpal_sample_formats() {
        let formats = [
            (SampleFormat::I8, "i8"),
            (SampleFormat::I16, "i16"),
            (SampleFormat::I24, "i24"),
            (SampleFormat::I32, "i32"),
            (SampleFormat::I64, "i64"),
            (SampleFormat::U8, "u8"),
            (SampleFormat::U16, "u16"),
            (SampleFormat::U24, "u24"),
            (SampleFormat::U32, "u32"),
            (SampleFormat::U64, "u64"),
            (SampleFormat::F32, "f32"),
            (SampleFormat::F64, "f64"),
            (SampleFormat::DsdU8, "dsdu8"),
            (SampleFormat::DsdU16, "dsdu16"),
            (SampleFormat::DsdU32, "dsdu32"),
        ];

        for (format, expected) in formats {
            assert_eq!(sample_format_to_js_string(format), expected);
        }
    }
}
