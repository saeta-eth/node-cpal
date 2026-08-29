mod cpal_api;
mod devices;
mod direct_streams;
mod streams;
mod utils;

use neon::prelude::*;

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    // Canonical CPAL API
    cx.export_function("_cpalAllHosts", cpal_api::all_hosts)?;
    cx.export_function("_cpalAvailableHosts", cpal_api::available_hosts)?;
    cx.export_function("_cpalDefaultHost", cpal_api::default_host)?;
    cx.export_function("_cpalHostFromId", cpal_api::host_from_id)?;
    cx.export_function("_cpalReleaseHost", cpal_api::release_host)?;
    cx.export_function("_cpalHostDevices", cpal_api::host_devices)?;
    cx.export_function("_cpalHostDeviceById", cpal_api::host_device_by_id)?;
    cx.export_function("_cpalHostDefaultDevice", cpal_api::host_default_device)?;
    cx.export_function("_cpalHostSetOption", cpal_api::host_set_option)?;
    cx.export_function("_cpalJackNamedDevice", cpal_api::jack_named_device)?;
    cx.export_function("_cpalReleaseDevice", cpal_api::release_device)?;
    cx.export_function("_cpalCloneDevice", cpal_api::clone_device)?;
    cx.export_function("_cpalDeviceDescription", cpal_api::device_description)?;
    cx.export_function("_cpalDeviceId", cpal_api::device_id)?;
    cx.export_function("_cpalDeviceToString", cpal_api::device_to_string)?;
    cx.export_function("_cpalDeviceEquals", cpal_api::device_equals)?;
    cx.export_function("_cpalDeviceSupports", cpal_api::device_supports)?;
    cx.export_function(
        "_cpalDeviceSupportedConfigs",
        cpal_api::device_supported_configs,
    )?;
    cx.export_function("_cpalDeviceDefaultConfig", cpal_api::device_default_config)?;
    cx.export_function("_cpalBuildStream", direct_streams::build_stream)?;
    cx.export_function("_cpalStreamPlay", direct_streams::play)?;
    cx.export_function("_cpalStreamPause", direct_streams::pause)?;
    cx.export_function("_cpalStreamBufferSize", direct_streams::buffer_size)?;
    cx.export_function("_cpalStreamNow", direct_streams::now)?;
    cx.export_function("_cpalStreamState", direct_streams::state)?;
    cx.export_function("_cpalStreamClose", direct_streams::close)?;

    // Device management
    cx.export_function("getHosts", devices::get_hosts)?;
    cx.export_function("getDevices", devices::get_devices)?;
    cx.export_function("getDeviceById", devices::get_device_by_id)?;
    cx.export_function(
        "getSupportedInputConfigs",
        devices::get_supported_input_configs,
    )?;
    cx.export_function(
        "getSupportedOutputConfigs",
        devices::get_supported_output_configs,
    )?;
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
    cx.export_function(
        "getSupportedSampleRates",
        devices::get_supported_sample_rates,
    )?;
    cx.export_function("getMaxChannels", devices::get_max_channels)?;

    // Stream management
    cx.export_function("_createStream", streams::create_stream)?;
    cx.export_function("_writeToStream", streams::write_to_stream)?;
    cx.export_function("_pauseStream", streams::pause_stream)?;
    cx.export_function("_playStream", streams::resume_stream)?;
    cx.export_function("_closeStream", streams::close_stream)?;
    cx.export_function("_getStreamState", streams::get_stream_state)?;
    cx.export_function("_getStreamBufferSize", streams::get_stream_buffer_size)?;
    cx.export_function("_getStreamNow", streams::get_stream_now)?;
    cx.export_function("_getBufferedFrames", streams::get_buffered_frames)?;

    Ok(())
}
