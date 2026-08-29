use cpal::{
    traits::{DeviceTrait, HostTrait},
    Device, DeviceDirection, DeviceId, DeviceType, Error, Host, HostId, InterfaceType,
    SupportedBufferSize, SupportedStreamConfig, SupportedStreamConfigRange,
};
use neon::prelude::*;
use once_cell::sync::Lazy;
use parking_lot::{Mutex, RwLock};
use std::{collections::HashMap, str::FromStr, sync::Arc};
use uuid::Uuid;

use crate::utils::{
    errors::{throw_binding_error, throw_cpal_error},
    types::sample_format_to_js_string,
};

#[cfg(all(
    feature = "backend-jack",
    any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "macos",
        target_os = "windows"
    )
))]
type JackHost = cpal::platform::JackHost;

#[cfg(all(
    feature = "backend-pipewire",
    any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd"
    )
))]
type PipeWireHost = cpal::platform::PipeWireHost;

enum HostKind {
    Dynamic(Host),
    #[cfg(all(
        feature = "backend-jack",
        any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "macos",
            target_os = "windows"
        )
    ))]
    Jack(JackHost),
    #[cfg(all(
        feature = "backend-pipewire",
        any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd"
        )
    ))]
    PipeWire(PipeWireHost),
}

impl HostKind {
    fn platform_kind(&self) -> &'static str {
        match self {
            Self::Dynamic(_) => "dynamic",
            #[cfg(all(
                feature = "backend-jack",
                any(
                    target_os = "linux",
                    target_os = "dragonfly",
                    target_os = "freebsd",
                    target_os = "netbsd",
                    target_os = "macos",
                    target_os = "windows"
                )
            ))]
            Self::Jack(_) => "jack",
            #[cfg(all(
                feature = "backend-pipewire",
                any(
                    target_os = "linux",
                    target_os = "dragonfly",
                    target_os = "freebsd",
                    target_os = "netbsd"
                )
            ))]
            Self::PipeWire(_) => "pipewire",
        }
    }

    fn devices(&self) -> Result<Vec<Device>, Error> {
        match self {
            Self::Dynamic(host) => host.devices().map(Iterator::collect),
            #[cfg(all(
                feature = "backend-jack",
                any(
                    target_os = "linux",
                    target_os = "dragonfly",
                    target_os = "freebsd",
                    target_os = "netbsd",
                    target_os = "macos",
                    target_os = "windows"
                )
            ))]
            Self::Jack(host) => host
                .devices()
                .map(|devices| devices.map(Device::from).collect()),
            #[cfg(all(
                feature = "backend-pipewire",
                any(
                    target_os = "linux",
                    target_os = "dragonfly",
                    target_os = "freebsd",
                    target_os = "netbsd"
                )
            ))]
            Self::PipeWire(host) => host
                .devices()
                .map(|devices| devices.map(Device::from).collect()),
        }
    }

    fn device_by_id(&self, id: &DeviceId) -> Option<Device> {
        match self {
            Self::Dynamic(host) => host.device_by_id(id),
            #[cfg(all(
                feature = "backend-jack",
                any(
                    target_os = "linux",
                    target_os = "dragonfly",
                    target_os = "freebsd",
                    target_os = "netbsd",
                    target_os = "macos",
                    target_os = "windows"
                )
            ))]
            Self::Jack(host) => host.device_by_id(id).map(Device::from),
            #[cfg(all(
                feature = "backend-pipewire",
                any(
                    target_os = "linux",
                    target_os = "dragonfly",
                    target_os = "freebsd",
                    target_os = "netbsd"
                )
            ))]
            Self::PipeWire(host) => host.device_by_id(id).map(Device::from),
        }
    }

    fn default_input_device(&self) -> Option<Device> {
        match self {
            Self::Dynamic(host) => host.default_input_device(),
            #[cfg(all(
                feature = "backend-jack",
                any(
                    target_os = "linux",
                    target_os = "dragonfly",
                    target_os = "freebsd",
                    target_os = "netbsd",
                    target_os = "macos",
                    target_os = "windows"
                )
            ))]
            Self::Jack(host) => host.default_input_device().map(Device::from),
            #[cfg(all(
                feature = "backend-pipewire",
                any(
                    target_os = "linux",
                    target_os = "dragonfly",
                    target_os = "freebsd",
                    target_os = "netbsd"
                )
            ))]
            Self::PipeWire(host) => host.default_input_device().map(Device::from),
        }
    }

    fn default_output_device(&self) -> Option<Device> {
        match self {
            Self::Dynamic(host) => host.default_output_device(),
            #[cfg(all(
                feature = "backend-jack",
                any(
                    target_os = "linux",
                    target_os = "dragonfly",
                    target_os = "freebsd",
                    target_os = "netbsd",
                    target_os = "macos",
                    target_os = "windows"
                )
            ))]
            Self::Jack(host) => host.default_output_device().map(Device::from),
            #[cfg(all(
                feature = "backend-pipewire",
                any(
                    target_os = "linux",
                    target_os = "dragonfly",
                    target_os = "freebsd",
                    target_os = "netbsd"
                )
            ))]
            Self::PipeWire(host) => host.default_output_device().map(Device::from),
        }
    }
}

pub(crate) struct HostEntry {
    id: HostId,
    kind: Mutex<HostKind>,
}

struct DeviceEntry {
    device: Device,
    _host: Arc<HostEntry>,
}

static HOSTS: Lazy<RwLock<HashMap<String, Arc<HostEntry>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));
static DEVICES: Lazy<RwLock<HashMap<String, Arc<DeviceEntry>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

fn host_id_from_string(value: &str) -> Result<HostId, Error> {
    HostId::from_str(value)
}

fn open_host(id: HostId) -> Result<HostKind, Error> {
    #[cfg(all(
        feature = "backend-jack",
        any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "macos",
            target_os = "windows"
        )
    ))]
    if id.to_string() == "jack" {
        return JackHost::new().map(HostKind::Jack);
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
    if id.to_string() == "pipewire" {
        return PipeWireHost::new().map(HostKind::PipeWire);
    }

    cpal::host_from_id(id).map(HostKind::Dynamic)
}

fn insert_host(id: HostId, kind: HostKind) -> (String, Arc<HostEntry>) {
    let handle = Uuid::new_v4().to_string();
    let entry = Arc::new(HostEntry {
        id,
        kind: Mutex::new(kind),
    });
    HOSTS.write().insert(handle.clone(), Arc::clone(&entry));
    (handle, entry)
}

fn host_entry(handle: &str) -> Option<Arc<HostEntry>> {
    HOSTS.read().get(handle).cloned()
}

fn device_entry(handle: &str) -> Option<Arc<DeviceEntry>> {
    DEVICES.read().get(handle).cloned()
}

pub(crate) fn canonical_device(handle: &str) -> Option<Device> {
    device_entry(handle).map(|entry| entry.device.clone())
}

fn insert_device(device: Device, host: Arc<HostEntry>) -> String {
    let handle = Uuid::new_v4().to_string();
    DEVICES.write().insert(
        handle.clone(),
        Arc::new(DeviceEntry {
            device,
            _host: host,
        }),
    );
    handle
}

fn serialize_host<'a>(
    cx: &mut FunctionContext<'a>,
    handle: &str,
    entry: &HostEntry,
) -> JsResult<'a, JsObject> {
    let object = cx.empty_object();
    let handle_value = cx.string(handle);
    let id = cx.string(entry.id.to_string());
    let name = cx.string(entry.id.name());
    let platform_kind = cx.string(entry.kind.lock().platform_kind());
    object.set(cx, "handle", handle_value)?;
    object.set(cx, "id", id)?;
    object.set(cx, "name", name)?;
    object.set(cx, "platformKind", platform_kind)?;
    Ok(object)
}

fn serialize_host_id<'a>(cx: &mut FunctionContext<'a>, id: HostId) -> JsResult<'a, JsObject> {
    let object = cx.empty_object();
    let id_value = cx.string(id.to_string());
    let name = cx.string(id.name());
    object.set(cx, "id", id_value)?;
    object.set(cx, "name", name)?;
    Ok(object)
}

fn serialize_device_handle<'a>(
    cx: &mut FunctionContext<'a>,
    device: Device,
    host: Arc<HostEntry>,
) -> JsResult<'a, JsObject> {
    let object = cx.empty_object();
    let handle = insert_device(device, host);
    let handle = cx.string(handle);
    object.set(cx, "handle", handle)?;
    Ok(object)
}

fn get_host_or_throw<'a>(
    cx: &mut FunctionContext<'a>,
    handle: &str,
    operation: &'static str,
) -> NeonResult<Arc<HostEntry>> {
    match host_entry(handle) {
        Some(host) => Ok(host),
        None => throw_binding_error(
            cx,
            "INVALID_INPUT",
            "Host handle is closed or invalid",
            operation,
        ),
    }
}

fn get_device_or_throw<'a>(
    cx: &mut FunctionContext<'a>,
    handle: &str,
    operation: &'static str,
) -> NeonResult<Arc<DeviceEntry>> {
    match device_entry(handle) {
        Some(device) => Ok(device),
        None => throw_binding_error(
            cx,
            "INVALID_INPUT",
            "Device handle is closed or invalid",
            operation,
        ),
    }
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

fn serialize_description<'a>(
    cx: &mut FunctionContext<'a>,
    device: &Device,
) -> JsResult<'a, JsObject> {
    let description = device
        .description()
        .or_else(|error| throw_cpal_error(cx, &error, "device.description"))?;
    let object = cx.empty_object();
    let name = cx.string(description.name());
    let device_type = cx.string(device_type_name(description.device_type()));
    let interface_type = cx.string(interface_type_name(description.interface_type()));
    let direction = cx.string(direction_name(description.direction()));
    object.set(cx, "name", name)?;
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

fn serialize_supported_buffer_size<'a>(
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
            object.set(cx, "min", min)?;
            object.set(cx, "max", max)?;
        }
        SupportedBufferSize::Unknown => {
            let kind = cx.string("unknown");
            object.set(cx, "type", kind)?;
        }
    }
    Ok(object)
}

fn serialize_config_range<'a>(
    cx: &mut FunctionContext<'a>,
    config: &SupportedStreamConfigRange,
) -> JsResult<'a, JsObject> {
    let object = cx.empty_object();
    let channels = cx.number(config.channels() as f64);
    let min_sample_rate = cx.number(config.min_sample_rate() as f64);
    let max_sample_rate = cx.number(config.max_sample_rate() as f64);
    let sample_format = cx.string(sample_format_to_js_string(config.sample_format()));
    let buffer_size = serialize_supported_buffer_size(cx, config.buffer_size())?;
    object.set(cx, "channels", channels)?;
    object.set(cx, "minSampleRate", min_sample_rate)?;
    object.set(cx, "maxSampleRate", max_sample_rate)?;
    object.set(cx, "bufferSize", buffer_size)?;
    object.set(cx, "sampleFormat", sample_format)?;
    Ok(object)
}

fn serialize_supported_config<'a>(
    cx: &mut FunctionContext<'a>,
    config: &SupportedStreamConfig,
) -> JsResult<'a, JsObject> {
    let object = cx.empty_object();
    let channels = cx.number(config.channels() as f64);
    let sample_rate = cx.number(config.sample_rate() as f64);
    let sample_format = cx.string(sample_format_to_js_string(config.sample_format()));
    let buffer_size = serialize_supported_buffer_size(cx, config.buffer_size())?;
    object.set(cx, "channels", channels)?;
    object.set(cx, "sampleRate", sample_rate)?;
    object.set(cx, "bufferSize", buffer_size)?;
    object.set(cx, "sampleFormat", sample_format)?;
    Ok(object)
}

pub fn all_hosts(mut cx: FunctionContext) -> JsResult<JsArray> {
    let array = cx.empty_array();
    for (index, id) in cpal::ALL_HOSTS.iter().copied().enumerate() {
        let descriptor = serialize_host_id(&mut cx, id)?;
        array.set(&mut cx, index as u32, descriptor)?;
    }
    Ok(array)
}

pub fn available_hosts(mut cx: FunctionContext) -> JsResult<JsArray> {
    let array = cx.empty_array();
    for (index, id) in cpal::available_hosts().into_iter().enumerate() {
        let descriptor = serialize_host_id(&mut cx, id)?;
        array.set(&mut cx, index as u32, descriptor)?;
    }
    Ok(array)
}

pub fn default_host(mut cx: FunctionContext) -> JsResult<JsObject> {
    let host = cpal::default_host();
    let id = host.id();
    let (handle, entry) = insert_host(id, HostKind::Dynamic(host));
    serialize_host(&mut cx, &handle, &entry)
}

pub fn host_from_id(mut cx: FunctionContext) -> JsResult<JsObject> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let id = match host_id_from_string(&id) {
        Ok(id) => id,
        Err(error) => return throw_cpal_error(&mut cx, &error, "hostFromId"),
    };
    let kind = match open_host(id) {
        Ok(host) => host,
        Err(error) => return throw_cpal_error(&mut cx, &error, "hostFromId"),
    };
    let (handle, entry) = insert_host(id, kind);
    serialize_host(&mut cx, &handle, &entry)
}

pub fn release_host(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    HOSTS.write().remove(&handle);
    Ok(cx.undefined())
}

pub fn host_devices(mut cx: FunctionContext) -> JsResult<JsArray> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    let direction = cx.argument::<JsString>(1)?.value(&mut cx);
    if !matches!(direction.as_str(), "all" | "input" | "output") {
        return cx.throw_range_error("direction must be 'all', 'input', or 'output'");
    }
    let host = get_host_or_throw(&mut cx, &handle, "host.devices")?;
    let devices = match host.kind.lock().devices() {
        Ok(devices) => devices,
        Err(error) => return throw_cpal_error(&mut cx, &error, "host.devices"),
    };
    let devices = devices
        .into_iter()
        .filter(|device| match direction.as_str() {
            "input" => device.supports_input(),
            "output" => device.supports_output(),
            _ => true,
        });
    let array = cx.empty_array();
    for (index, device) in devices.enumerate() {
        let descriptor = serialize_device_handle(&mut cx, device, Arc::clone(&host))?;
        array.set(&mut cx, index as u32, descriptor)?;
    }
    Ok(array)
}

pub fn host_device_by_id(mut cx: FunctionContext) -> JsResult<JsValue> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    let id = cx.argument::<JsString>(1)?.value(&mut cx);
    let id = match DeviceId::from_str(&id) {
        Ok(id) => id,
        Err(error) => return throw_cpal_error(&mut cx, &error, "host.deviceById"),
    };
    let host = get_host_or_throw(&mut cx, &handle, "host.deviceById")?;
    let device = host.kind.lock().device_by_id(&id);
    match device {
        Some(device) => serialize_device_handle(&mut cx, device, host).map(|value| value.upcast()),
        None => Ok(cx.null().upcast()),
    }
}

pub fn host_default_device(mut cx: FunctionContext) -> JsResult<JsValue> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    let input = cx.argument::<JsBoolean>(1)?.value(&mut cx);
    let host = get_host_or_throw(&mut cx, &handle, "host.defaultDevice")?;
    let device = if input {
        host.kind.lock().default_input_device()
    } else {
        host.kind.lock().default_output_device()
    };
    match device {
        Some(device) => serialize_device_handle(&mut cx, device, host).map(|value| value.upcast()),
        None => Ok(cx.null().upcast()),
    }
}

pub fn host_set_option(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    let option = cx.argument::<JsString>(1)?.value(&mut cx);
    let value = cx.argument::<JsBoolean>(2)?.value(&mut cx);
    let _ = value;
    let host = get_host_or_throw(&mut cx, &handle, "host.setOption")?;
    #[allow(unused_mut)]
    let mut kind = host.kind.lock();
    let supported = match (&mut *kind, option.as_str()) {
        #[cfg(all(
            feature = "backend-jack",
            any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "macos",
                target_os = "windows"
            )
        ))]
        (HostKind::Jack(host), "connectAutomatically") => {
            host.set_connect_automatically(value);
            true
        }
        #[cfg(all(
            feature = "backend-jack",
            any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "macos",
                target_os = "windows"
            )
        ))]
        (HostKind::Jack(host), "startServerAutomatically") => {
            host.set_start_server_automatically(value);
            true
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
        (HostKind::PipeWire(host), "connectAutomatically") => {
            host.set_connect_automatically(value);
            true
        }
        _ => false,
    };
    if !supported {
        return throw_binding_error(
            &mut cx,
            "UNSUPPORTED_OPERATION",
            format!("Host option {option} is not supported by this host"),
            "host.setOption",
        );
    }
    Ok(cx.undefined())
}

pub fn jack_named_device(mut cx: FunctionContext) -> JsResult<JsValue> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    let name = cx.argument::<JsString>(1)?.value(&mut cx);
    let input = cx.argument::<JsBoolean>(2)?.value(&mut cx);
    let host = get_host_or_throw(&mut cx, &handle, "jackHost.namedDevice")?;
    #[allow(unused_mut)]
    let mut kind = host.kind.lock();
    #[cfg(all(
        feature = "backend-jack",
        any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "macos",
            target_os = "windows"
        )
    ))]
    if let HostKind::Jack(jack) = &mut *kind {
        let device = if input {
            jack.input_device_with_name(&name)
        } else {
            jack.output_device_with_name(&name)
        };
        drop(kind);
        return match device {
            Some(device) => serialize_device_handle(&mut cx, Device::from(device), host)
                .map(|value| value.upcast()),
            None => Ok(cx.null().upcast()),
        };
    }
    drop(kind);
    let _ = (name, input);
    throw_binding_error(
        &mut cx,
        "UNSUPPORTED_OPERATION",
        "This host is not a JACK host",
        "jackHost.namedDevice",
    )
}

pub fn release_device(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    DEVICES.write().remove(&handle);
    Ok(cx.undefined())
}

pub fn clone_device(mut cx: FunctionContext) -> JsResult<JsObject> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = get_device_or_throw(&mut cx, &handle, "device.clone")?;
    serialize_device_handle(&mut cx, device.device.clone(), Arc::clone(&device._host))
}

pub fn device_description(mut cx: FunctionContext) -> JsResult<JsObject> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = get_device_or_throw(&mut cx, &handle, "device.description")?;
    serialize_description(&mut cx, &device.device)
}

pub fn device_id(mut cx: FunctionContext) -> JsResult<JsString> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = get_device_or_throw(&mut cx, &handle, "device.id")?;
    let id = match device.device.id() {
        Ok(id) => id,
        Err(error) => return throw_cpal_error(&mut cx, &error, "device.id"),
    };
    Ok(cx.string(id.to_string()))
}

pub fn device_to_string(mut cx: FunctionContext) -> JsResult<JsString> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = get_device_or_throw(&mut cx, &handle, "device.toString")?;
    Ok(cx.string(device.device.to_string()))
}

pub fn device_equals(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let left = cx.argument::<JsString>(0)?.value(&mut cx);
    let right = cx.argument::<JsString>(1)?.value(&mut cx);
    let left = get_device_or_throw(&mut cx, &left, "device.equals")?;
    let right = get_device_or_throw(&mut cx, &right, "device.equals")?;
    Ok(cx.boolean(left.device == right.device))
}

pub fn device_supports(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    let input = cx.argument::<JsBoolean>(1)?.value(&mut cx);
    let device = get_device_or_throw(&mut cx, &handle, "device.supports")?;
    Ok(cx.boolean(if input {
        device.device.supports_input()
    } else {
        device.device.supports_output()
    }))
}

pub fn device_supported_configs(mut cx: FunctionContext) -> JsResult<JsArray> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    let input = cx.argument::<JsBoolean>(1)?.value(&mut cx);
    let device = get_device_or_throw(&mut cx, &handle, "device.supportedConfigs")?;
    let configs: Vec<_> = if input {
        match device.device.supported_input_configs() {
            Ok(configs) => configs.collect(),
            Err(error) => return throw_cpal_error(&mut cx, &error, "device.supportedInputConfigs"),
        }
    } else {
        match device.device.supported_output_configs() {
            Ok(configs) => configs.collect(),
            Err(error) => {
                return throw_cpal_error(&mut cx, &error, "device.supportedOutputConfigs")
            }
        }
    };
    let array = cx.empty_array();
    for (index, config) in configs.iter().enumerate() {
        let value = serialize_config_range(&mut cx, config)?;
        array.set(&mut cx, index as u32, value)?;
    }
    Ok(array)
}

pub fn device_default_config(mut cx: FunctionContext) -> JsResult<JsObject> {
    let handle = cx.argument::<JsString>(0)?.value(&mut cx);
    let input = cx.argument::<JsBoolean>(1)?.value(&mut cx);
    let device = get_device_or_throw(&mut cx, &handle, "device.defaultConfig")?;
    let config = if input {
        device.device.default_input_config()
    } else {
        device.device.default_output_config()
    };
    let config = match config {
        Ok(config) => config,
        Err(error) => return throw_cpal_error(&mut cx, &error, "device.defaultConfig"),
    };
    serialize_supported_config(&mut cx, &config)
}
