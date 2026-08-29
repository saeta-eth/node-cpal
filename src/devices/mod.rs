use cpal::{
    traits::{DeviceTrait, HostTrait},
    Device, DeviceDirection, DeviceId as CpalDeviceId, DeviceType, Error, ErrorKind, Host, HostId,
    InterfaceType, SupportedBufferSize,
};
use neon::prelude::*;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use std::{collections::HashMap, str::FromStr};

use crate::utils::{
    errors::{throw_binding_error, throw_cpal_error},
    types::{sample_format_to_js_string, DeviceId},
};

#[derive(Clone)]
struct CachedDevice {
    device: Device,
    configured_host: bool,
}

static DEVICES: Lazy<RwLock<HashMap<DeviceId, CachedDevice>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

fn should_replace_cached_device(existing_configured: bool, incoming_configured: bool) -> bool {
    incoming_configured || !existing_configured
}

fn cache_device(id: DeviceId, device: &Device, configured_host: bool) {
    let mut devices = DEVICES.write();
    if devices.get(&id).is_some_and(|existing| {
        !should_replace_cached_device(existing.configured_host, configured_host)
    }) {
        return;
    }
    devices.insert(
        id,
        CachedDevice {
            device: device.clone(),
            configured_host,
        },
    );
}

fn device_id(device: &Device) -> Result<DeviceId, Error> {
    device.id().map(|id| id.to_string())
}

fn device_ids_match(device_id: Option<&str>, default_device_id: Option<&str>) -> bool {
    matches!(
        (device_id, default_device_id),
        (Some(device_id), Some(default_device_id)) if device_id == default_device_id
    )
}

fn host_id_from_string(value: &str) -> Option<HostId> {
    cpal::available_hosts().into_iter().find(|id| {
        id.to_string().eq_ignore_ascii_case(value) || id.name().eq_ignore_ascii_case(value)
    })
}

fn optional_host_options<'a>(
    cx: &mut FunctionContext<'a>,
    argument_index: usize,
) -> NeonResult<Option<Handle<'a, JsObject>>> {
    if cx.len() <= argument_index {
        return Ok(None);
    }
    let value = cx.argument::<JsValue>(argument_index)?;
    if value.is_a::<JsUndefined, _>(cx) || value.is_a::<JsNull, _>(cx) {
        return Ok(None);
    }
    match value.downcast::<JsObject, _>(cx) {
        Ok(value) => Ok(Some(value)),
        Err(_) => cx.throw_type_error("hostOptions must be an object, null, or undefined"),
    }
}

#[cfg(all(
    feature = "backend-pipewire",
    any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd"
    )
))]
fn optional_boolean(
    cx: &mut FunctionContext,
    options: Handle<JsObject>,
    key: &'static str,
) -> NeonResult<Option<bool>> {
    let value = options.get::<JsValue, _, _>(cx, key)?;
    if value.is_a::<JsUndefined, _>(cx) {
        return Ok(None);
    }
    match value.downcast::<JsBoolean, _>(cx) {
        Ok(value) => Ok(Some(value.value(cx))),
        Err(_) => cx.throw_type_error(format!("hostOptions.{key} must be a boolean")),
    }
}

#[cfg(all(
    feature = "backend-pipewire",
    any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd"
    )
))]
fn optional_string(
    cx: &mut FunctionContext,
    options: Handle<JsObject>,
    key: &'static str,
) -> NeonResult<Option<String>> {
    let value = options.get::<JsValue, _, _>(cx, key)?;
    if value.is_a::<JsUndefined, _>(cx) {
        return Ok(None);
    }
    match value.downcast::<JsString, _>(cx) {
        Ok(value) => {
            let value = value.value(cx);
            if value.is_empty() {
                cx.throw_range_error(format!("hostOptions.{key} must not be empty"))
            } else {
                Ok(Some(value))
            }
        }
        Err(_) => cx.throw_type_error(format!("hostOptions.{key} must be a string")),
    }
}

#[cfg(all(
    feature = "backend-pipewire",
    any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd"
    )
))]
fn configured_pipewire_host(
    cx: &mut FunctionContext,
    options: Handle<JsObject>,
) -> NeonResult<Host> {
    if optional_string(cx, options, "clientName")?.is_some()
        || optional_boolean(cx, options, "startServerAutomatically")?.is_some()
    {
        return throw_binding_error(
            cx,
            "UNSUPPORTED_OPERATION",
            "PipeWire only supports the connectAutomatically host option",
            "openHost",
        );
    }
    let mut host = cpal::platform::PipeWireHost::new()
        .or_else(|error| throw_cpal_error(cx, &error, "openHost"))?;
    if let Some(connect) = optional_boolean(cx, options, "connectAutomatically")? {
        host.set_connect_automatically(connect);
    }
    Ok(host.into())
}

fn open_host(
    cx: &mut FunctionContext,
    host_id: HostId,
    options: Option<Handle<JsObject>>,
) -> NeonResult<Host> {
    let Some(options) = options else {
        return cpal::host_from_id(host_id)
            .or_else(|error| throw_cpal_error(cx, &error, "openHost"));
    };

    #[cfg(all(
        feature = "backend-pipewire",
        any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd"
        )
    ))]
    if host_id.to_string() == "pipewire" {
        return configured_pipewire_host(cx, options);
    }

    #[cfg(all(
        feature = "backend-jack",
        any(target_os = "linux", target_os = "macos", target_os = "windows")
    ))]
    if host_id.to_string() == "jack" {
        let _ = options;
        return throw_binding_error(
            cx,
            "UNSUPPORTED_OPERATION",
            "JACK host options cannot be applied before device initialization by this CPAL version",
            "openHost",
        );
    }

    let _ = options;
    throw_binding_error(
        cx,
        "UNSUPPORTED_OPERATION",
        format!("The {} backend has no host-specific options", host_id),
        "openHost",
    )
}

fn get_host(
    cx: &mut FunctionContext,
    host_argument_index: usize,
    options_argument_index: usize,
) -> NeonResult<Host> {
    let options = optional_host_options(cx, options_argument_index)?;
    if cx.len() <= host_argument_index {
        if options.is_none() {
            return Ok(cpal::default_host());
        }
        let default_id = cpal::default_host().id();
        return open_host(cx, default_id, options);
    }
    let value = cx.argument::<JsValue>(host_argument_index)?;
    if value.is_a::<JsUndefined, _>(cx) || value.is_a::<JsNull, _>(cx) {
        if options.is_none() {
            return Ok(cpal::default_host());
        }
        let default_id = cpal::default_host().id();
        return open_host(cx, default_id, options);
    }
    let host_id = match value.downcast::<JsString, _>(cx) {
        Ok(value) => value.value(cx),
        Err(_) => return cx.throw_type_error("hostId must be a string, null, or undefined"),
    };
    let Some(host_id_value) = host_id_from_string(&host_id) else {
        return throw_binding_error(
            cx,
            "HOST_UNAVAILABLE",
            format!("Host not found: {host_id}"),
            "openHost",
        );
    };
    open_host(cx, host_id_value, options)
}

fn device_type_name(value: DeviceType) -> &'static str {
    match value {
        DeviceType::Speaker => "speaker",
        DeviceType::Microphone => "microphone",
        DeviceType::Headphones => "headphones",
        DeviceType::Headset => "headset",
        DeviceType::Earpiece => "earpiece",
        DeviceType::Handset => "handset",
        DeviceType::HearingAid => "hearing-aid",
        DeviceType::Dock => "dock",
        DeviceType::Tuner => "tuner",
        DeviceType::Virtual => "virtual",
        DeviceType::Unknown => "unknown",
        _ => "unknown",
    }
}

fn interface_type_name(value: InterfaceType) -> &'static str {
    match value {
        InterfaceType::BuiltIn => "built-in",
        InterfaceType::Usb => "usb",
        InterfaceType::Bluetooth => "bluetooth",
        InterfaceType::Pci => "pci",
        InterfaceType::FireWire => "firewire",
        InterfaceType::Thunderbolt => "thunderbolt",
        InterfaceType::Hdmi => "hdmi",
        InterfaceType::Line => "line",
        InterfaceType::Spdif => "spdif",
        InterfaceType::Network => "network",
        InterfaceType::Virtual => "virtual",
        InterfaceType::DisplayPort => "display-port",
        InterfaceType::Aggregate => "aggregate",
        InterfaceType::Unknown => "unknown",
        _ => "unknown",
    }
}

fn direction_name(value: DeviceDirection) -> &'static str {
    match value {
        DeviceDirection::Input => "input",
        DeviceDirection::Output => "output",
        DeviceDirection::Duplex => "duplex",
        DeviceDirection::Unknown => "unknown",
        _ => "unknown",
    }
}

fn supports_loopback(host_id: HostId, supports_input: bool, supports_output: bool) -> bool {
    supports_loopback_for_host(
        &host_id.to_string(),
        supports_input,
        supports_output,
        coreaudio_loopback_available(),
    )
}

fn supports_loopback_for_host(
    host_id: &str,
    supports_input: bool,
    supports_output: bool,
    coreaudio_available: bool,
) -> bool {
    match host_id {
        "coreaudio" => coreaudio_available && supports_output && !supports_input,
        "wasapi" => supports_output,
        _ => false,
    }
}

#[cfg(any(target_os = "macos", test))]
fn darwin_version_supports_coreaudio_loopback(major: u32, minor: u32) -> bool {
    // macOS 14.6 is Darwin 23.6; later Darwin releases preserve availability.
    major > 23 || (major == 23 && minor >= 6)
}

#[cfg(target_os = "macos")]
fn coreaudio_loopback_available() -> bool {
    use std::{ffi::CStr, mem::MaybeUninit};

    static AVAILABLE: Lazy<bool> = Lazy::new(|| {
        let mut system = MaybeUninit::<libc::utsname>::uninit();
        if unsafe { libc::uname(system.as_mut_ptr()) } != 0 {
            return false;
        }
        let system = unsafe { system.assume_init() };
        let Some(version) = unsafe { CStr::from_ptr(system.release.as_ptr()) }
            .to_str()
            .ok()
        else {
            return false;
        };
        let mut components = version.split('.');
        let Some((major, minor)) = components
            .next()
            .and_then(|value| value.parse::<u32>().ok())
            .zip(
                components
                    .next()
                    .and_then(|value| value.parse::<u32>().ok()),
            )
        else {
            return false;
        };
        darwin_version_supports_coreaudio_loopback(major, minor)
    });
    *AVAILABLE
}

#[cfg(not(target_os = "macos"))]
fn coreaudio_loopback_available() -> bool {
    false
}

fn set_optional_string<'a>(
    cx: &mut FunctionContext<'a>,
    object: Handle<'a, JsObject>,
    key: &'static str,
    value: Option<&str>,
) -> NeonResult<()> {
    let value: Handle<JsValue> = match value {
        Some(value) => cx.string(value).upcast(),
        None => cx.null().upcast(),
    };
    object.set(cx, key, value).map(|_| ())
}

fn serialize_device<'a>(
    cx: &mut FunctionContext<'a>,
    host_id: HostId,
    device: &Device,
    default_input_id: Option<&str>,
    default_output_id: Option<&str>,
    configured_host: bool,
) -> JsResult<'a, JsObject> {
    let description = device
        .description()
        .or_else(|error| throw_cpal_error(cx, &error, "describeDevice"))?;
    let stable_id =
        device_id(device).or_else(|error| throw_cpal_error(cx, &error, "getDeviceId"))?;
    cache_device(stable_id.clone(), device, configured_host);

    let supports_input = device.supports_input();
    let supports_output = device.supports_output();
    let object = cx.empty_object();
    let name = cx.string(description.name());
    let id = cx.string(&stable_id);
    let host_id_value = cx.string(host_id.to_string());
    let is_default_input = cx.boolean(device_ids_match(Some(stable_id.as_str()), default_input_id));
    let is_default_output = cx.boolean(device_ids_match(
        Some(stable_id.as_str()),
        default_output_id,
    ));
    let supports_input_value = cx.boolean(supports_input);
    let supports_output_value = cx.boolean(supports_output);
    let supports_loopback_value =
        cx.boolean(supports_loopback(host_id, supports_input, supports_output));
    let device_type = cx.string(device_type_name(description.device_type()));
    let interface_type = cx.string(interface_type_name(description.interface_type()));
    let direction = cx.string(direction_name(description.direction()));

    object.set(cx, "name", name)?;
    object.set(cx, "deviceId", id)?;
    object.set(cx, "hostId", host_id_value)?;
    object.set(cx, "isDefaultInput", is_default_input)?;
    object.set(cx, "isDefaultOutput", is_default_output)?;
    object.set(cx, "supportsInput", supports_input_value)?;
    object.set(cx, "supportsOutput", supports_output_value)?;
    object.set(cx, "supportsLoopback", supports_loopback_value)?;
    object.set(cx, "deviceType", device_type)?;
    object.set(cx, "interfaceType", interface_type)?;
    object.set(cx, "direction", direction)?;
    set_optional_string(cx, object, "manufacturer", description.manufacturer())?;
    set_optional_string(cx, object, "driver", description.driver())?;
    set_optional_string(cx, object, "address", description.address())?;

    let extended = cx.empty_array();
    for (index, line) in description.extended().enumerate() {
        let line = cx.string(line);
        extended.set(cx, index as u32, line)?;
    }
    object.set(cx, "extended", extended)?;
    Ok(object)
}

fn default_ids(host: &Host) -> (Option<DeviceId>, Option<DeviceId>) {
    let input = host
        .default_input_device()
        .and_then(|device| device_id(&device).ok());
    let output = host
        .default_output_device()
        .and_then(|device| device_id(&device).ok());
    (input, output)
}

fn serialize_buffer_size<'a>(
    cx: &mut FunctionContext<'a>,
    value: &SupportedBufferSize,
) -> JsResult<'a, JsObject> {
    let object = cx.empty_object();
    match *value {
        SupportedBufferSize::Range { min, max } => {
            let kind = cx.string("range");
            let min = cx.number(min as f64);
            let max = cx.number(max as f64);
            object.set(cx, "type", kind)?;
            object.set(cx, "minFrames", min)?;
            object.set(cx, "maxFrames", max)?;
        }
        SupportedBufferSize::Unknown => {
            let kind = cx.string("unknown");
            object.set(cx, "type", kind)?;
        }
    }
    Ok(object)
}

pub fn get_hosts(mut cx: FunctionContext) -> JsResult<JsArray> {
    let array = cx.empty_array();
    for (index, host_id) in cpal::available_hosts().iter().enumerate() {
        let host = cx.empty_object();
        let id = cx.string(host_id.to_string());
        let name = cx.string(host_id.name());
        host.set(&mut cx, "id", id)?;
        host.set(&mut cx, "name", name)?;
        array.set(&mut cx, index as u32, host)?;
    }
    Ok(array)
}

pub fn get_devices(mut cx: FunctionContext) -> JsResult<JsArray> {
    let configured_host = optional_host_options(&mut cx, 2)?.is_some();
    let host = get_host(&mut cx, 0, 2)?;
    let direction = if cx.len() > 1 {
        let value = cx.argument::<JsValue>(1)?;
        if value.is_a::<JsUndefined, _>(&mut cx) || value.is_a::<JsNull, _>(&mut cx) {
            "all".to_string()
        } else {
            value
                .downcast_or_throw::<JsString, _>(&mut cx)?
                .value(&mut cx)
        }
    } else {
        "all".to_string()
    };
    if !matches!(direction.as_str(), "all" | "input" | "output") {
        return cx.throw_range_error("direction must be 'all', 'input', or 'output'");
    }

    let devices = host
        .devices()
        .or_else(|error| throw_cpal_error(&mut cx, &error, "getDevices"))?;
    let devices: Vec<_> = devices
        .filter(|device| match direction.as_str() {
            "input" => device.supports_input(),
            "output" => device.supports_output(),
            _ => true,
        })
        .collect();
    let (default_input_id, default_output_id) = default_ids(&host);
    let array = cx.empty_array();
    for (index, device) in devices.iter().enumerate() {
        let object = serialize_device(
            &mut cx,
            host.id(),
            device,
            default_input_id.as_deref(),
            default_output_id.as_deref(),
            configured_host,
        )?;
        array.set(&mut cx, index as u32, object)?;
    }
    Ok(array)
}

pub fn get_default_device(mut cx: FunctionContext, is_input: bool) -> JsResult<JsObject> {
    let configured_host = optional_host_options(&mut cx, 1)?.is_some();
    let host = get_host(&mut cx, 0, 1)?;
    let (default_input_id, default_output_id) = default_ids(&host);
    let device = if is_input {
        host.default_input_device()
    } else {
        host.default_output_device()
    };
    let Some(device) = device else {
        return throw_binding_error(
            &mut cx,
            "DEVICE_NOT_AVAILABLE",
            if is_input {
                "No default input device found"
            } else {
                "No default output device found"
            },
            if is_input {
                "getDefaultInputDevice"
            } else {
                "getDefaultOutputDevice"
            },
        );
    };
    serialize_device(
        &mut cx,
        host.id(),
        &device,
        default_input_id.as_deref(),
        default_output_id.as_deref(),
        configured_host,
    )
}

pub fn get_device_by_id(mut cx: FunctionContext) -> JsResult<JsObject> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let parsed = match CpalDeviceId::from_str(&id) {
        Ok(id) => id,
        Err(error) => return throw_cpal_error(&mut cx, &error, "getDeviceById"),
    };
    let host = match cpal::host_from_id(parsed.host()) {
        Ok(host) => host,
        Err(error) => return throw_cpal_error(&mut cx, &error, "getDeviceById"),
    };
    let configured_device = DEVICES
        .read()
        .get(&id)
        .filter(|entry| entry.configured_host)
        .cloned();
    let (device, configured_host) = if let Some(entry) = configured_device {
        (entry.device, true)
    } else {
        let Some(device) = host.device_by_id(&parsed) else {
            return throw_binding_error(
                &mut cx,
                "DEVICE_NOT_AVAILABLE",
                format!("Device not found: {id}"),
                "getDeviceById",
            );
        };
        (device, false)
    };
    let (default_input_id, default_output_id) = default_ids(&host);
    serialize_device(
        &mut cx,
        host.id(),
        &device,
        default_input_id.as_deref(),
        default_output_id.as_deref(),
        configured_host,
    )
}

fn supported_configs(mut cx: FunctionContext, is_input: bool) -> JsResult<JsArray> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = match get_device(id) {
        Ok(device) => device,
        Err(error) => return throw_cpal_error(&mut cx, &error, "getSupportedConfigs"),
    };
    let configs: Vec<_> = if is_input {
        match device.supported_input_configs() {
            Ok(configs) => configs.collect(),
            Err(error) => return throw_cpal_error(&mut cx, &error, "getSupportedInputConfigs"),
        }
    } else {
        match device.supported_output_configs() {
            Ok(configs) => configs.collect(),
            Err(error) => return throw_cpal_error(&mut cx, &error, "getSupportedOutputConfigs"),
        }
    };

    let array = cx.empty_array();
    for (index, config) in configs.iter().enumerate() {
        let object = cx.empty_object();
        let channels = cx.number(config.channels() as f64);
        let min_rate = cx.number(config.min_sample_rate() as f64);
        let max_rate = cx.number(config.max_sample_rate() as f64);
        let format = cx.string(sample_format_to_js_string(config.sample_format()));
        let buffer_size = serialize_buffer_size(&mut cx, config.buffer_size())?;
        object.set(&mut cx, "channels", channels)?;
        object.set(&mut cx, "minSampleRate", min_rate)?;
        object.set(&mut cx, "maxSampleRate", max_rate)?;
        object.set(&mut cx, "sampleFormat", format)?;
        object.set(&mut cx, "bufferSize", buffer_size)?;
        array.set(&mut cx, index as u32, object)?;
    }
    Ok(array)
}

pub fn get_supported_input_configs(cx: FunctionContext) -> JsResult<JsArray> {
    supported_configs(cx, true)
}

pub fn get_supported_output_configs(cx: FunctionContext) -> JsResult<JsArray> {
    supported_configs(cx, false)
}

pub fn get_default_config(mut cx: FunctionContext, is_input: bool) -> JsResult<JsObject> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = match get_device(id) {
        Ok(device) => device,
        Err(error) => return throw_cpal_error(&mut cx, &error, "getDefaultConfig"),
    };
    let config = if is_input {
        device.default_input_config()
    } else {
        device.default_output_config()
    };
    let config = match config {
        Ok(config) => config,
        Err(error) => return throw_cpal_error(&mut cx, &error, "getDefaultConfig"),
    };

    let object = cx.empty_object();
    let sample_rate = cx.number(config.sample_rate() as f64);
    let channels = cx.number(config.channels() as f64);
    let format = cx.string(sample_format_to_js_string(config.sample_format()));
    let requested_buffer_size = cx.empty_object();
    let requested_kind = cx.string("default");
    requested_buffer_size.set(&mut cx, "type", requested_kind)?;
    let supported_buffer_size = serialize_buffer_size(&mut cx, config.buffer_size())?;
    object.set(&mut cx, "sampleRate", sample_rate)?;
    object.set(&mut cx, "channels", channels)?;
    object.set(&mut cx, "sampleFormat", format)?;
    object.set(&mut cx, "bufferSize", requested_buffer_size)?;
    object.set(&mut cx, "supportedBufferSize", supported_buffer_size)?;
    Ok(object)
}

pub fn get_device(id: String) -> Result<Device, Error> {
    if let Some(entry) = DEVICES.read().get(id.as_str()).cloned() {
        return Ok(entry.device);
    }
    let parsed = CpalDeviceId::from_str(&id)?;
    let host = cpal::host_from_id(parsed.host())?;
    let device = host.device_by_id(&parsed).ok_or_else(|| {
        Error::with_message(
            ErrorKind::DeviceNotAvailable,
            format!("Device not found: {id}"),
        )
    })?;
    cache_device(id, &device, false);
    Ok(device)
}

pub fn get_supported_formats(mut cx: FunctionContext) -> JsResult<JsArray> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = match get_device(id) {
        Ok(device) => device,
        Err(error) => return throw_cpal_error(&mut cx, &error, "getSupportedFormats"),
    };
    let mut formats = Vec::new();
    if let Ok(configs) = device.supported_input_configs() {
        for config in configs {
            if !formats.contains(&config.sample_format()) {
                formats.push(config.sample_format());
            }
        }
    }
    if let Ok(configs) = device.supported_output_configs() {
        for config in configs {
            if !formats.contains(&config.sample_format()) {
                formats.push(config.sample_format());
            }
        }
    }
    let array = cx.empty_array();
    for (index, format) in formats.into_iter().enumerate() {
        let value = cx.string(sample_format_to_js_string(format));
        array.set(&mut cx, index as u32, value)?;
    }
    Ok(array)
}

pub fn get_supported_sample_rates(mut cx: FunctionContext) -> JsResult<JsArray> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = match get_device(id) {
        Ok(device) => device,
        Err(error) => return throw_cpal_error(&mut cx, &error, "getSupportedSampleRates"),
    };
    let mut rates = Vec::new();
    if let Ok(configs) = device.supported_input_configs() {
        for config in configs {
            rates.push(config.min_sample_rate());
            rates.push(config.max_sample_rate());
        }
    }
    if let Ok(configs) = device.supported_output_configs() {
        for config in configs {
            rates.push(config.min_sample_rate());
            rates.push(config.max_sample_rate());
        }
    }
    rates.sort_unstable();
    rates.dedup();
    let array = cx.empty_array();
    for (index, rate) in rates.into_iter().enumerate() {
        let value = cx.number(rate as f64);
        array.set(&mut cx, index as u32, value)?;
    }
    Ok(array)
}

pub fn get_max_channels(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = match get_device(id) {
        Ok(device) => device,
        Err(error) => return throw_cpal_error(&mut cx, &error, "getMaxChannels"),
    };
    let mut max_channels = 0u16;
    if let Ok(configs) = device.supported_input_configs() {
        for config in configs {
            max_channels = max_channels.max(config.channels());
        }
    }
    if let Ok(configs) = device.supported_output_configs() {
        for config in configs {
            max_channels = max_channels.max(config.channels());
        }
    }
    Ok(cx.number(max_channels as f64))
}

#[cfg(test)]
mod tests {
    use super::{
        darwin_version_supports_coreaudio_loopback, device_ids_match, direction_name,
        interface_type_name, should_replace_cached_device, supports_loopback_for_host,
    };
    use cpal::{DeviceDirection, InterfaceType};

    #[test]
    fn matches_default_devices_by_stable_id() {
        assert!(device_ids_match(Some("wasapi:a"), Some("wasapi:a")));
        assert!(!device_ids_match(Some("wasapi:b"), Some("wasapi:a")));
        assert!(!device_ids_match(None, None));
    }

    #[test]
    fn serializes_metadata_enums_stably() {
        assert_eq!(direction_name(DeviceDirection::Duplex), "duplex");
        assert_eq!(interface_type_name(InterfaceType::Usb), "usb");
    }

    #[test]
    fn advertises_only_loopback_paths_the_generic_cpal_device_can_open() {
        assert!(supports_loopback_for_host("wasapi", false, true, false));
        assert!(!supports_loopback_for_host("coreaudio", false, true, false));
        assert!(supports_loopback_for_host("coreaudio", false, true, true));
        assert!(!supports_loopback_for_host("coreaudio", true, true, true));
        assert!(!supports_loopback_for_host("coreaudio", true, false, true));
    }

    #[test]
    fn requires_macos_14_6_for_coreaudio_loopback() {
        assert!(!darwin_version_supports_coreaudio_loopback(23, 5));
        assert!(darwin_version_supports_coreaudio_loopback(23, 6));
        assert!(darwin_version_supports_coreaudio_loopback(24, 0));
    }

    #[test]
    fn ordinary_lookup_does_not_replace_a_configured_device() {
        assert!(!should_replace_cached_device(true, false));
        assert!(should_replace_cached_device(false, false));
        assert!(should_replace_cached_device(false, true));
        assert!(should_replace_cached_device(true, true));
    }
}
