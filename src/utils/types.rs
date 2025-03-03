use cpal::SampleFormat;

pub type DeviceId = String;
pub type StreamId = String;

pub fn sample_format_to_js_string(format: SampleFormat) -> &'static str {
    match format {
        SampleFormat::I16 => "i16",
        SampleFormat::U16 => "u16",
        SampleFormat::F32 => "f32",
        _ => "unknown",
    }
}