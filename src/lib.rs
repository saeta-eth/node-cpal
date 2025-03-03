mod devices;
mod streams;
mod utils;

use neon::prelude::*;

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    // Device management
    cx.export_function("getHosts", devices::get_hosts)?;
    cx.export_function("getDevices", devices::get_devices)?;
    cx.export_function("getSupportedInputConfigs", devices::get_supported_input_configs)?;
    cx.export_function("getSupportedOutputConfigs", devices::get_supported_output_configs)?;
    cx.export_function("getDefaultInputDevice", |cx: FunctionContext| {
        devices::get_default_device(cx, true)
    })?;
    cx.export_function("getDefaultOutputDevice", |cx: FunctionContext| {
        devices::get_default_device(cx, false)
    })?;
    cx.export_function("getDefaultInputConfig", |cx: FunctionContext| {
        devices::get_default_config(cx, true)
    })?;
    cx.export_function("getDefaultOutputConfig", |cx: FunctionContext| {
        devices::get_default_config(cx, false)
    })?;
    cx.export_function("getSupportedFormats", devices::get_supported_formats)?;
    cx.export_function("getSupportedSampleRates", devices::get_supported_sample_rates)?;
    cx.export_function("getMaxChannels", devices::get_max_channels)?;

    // Stream management
    cx.export_function("createStream", streams::create_stream)?;
    cx.export_function("writeToStream", streams::write_to_stream)?;
    cx.export_function("pauseStream", streams::pause_stream)?;
    cx.export_function("resumeStream", streams::resume_stream)?;
    cx.export_function("closeStream", streams::close_stream)?;
    cx.export_function("isStreamActive", streams::is_stream_active)?;

    Ok(())
}
