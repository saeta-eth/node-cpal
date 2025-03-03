use cpal::{
    traits::{DeviceTrait, HostTrait},
    Device,
};
use neon::prelude::*;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use std::collections::HashMap;

use crate::utils::types::{DeviceId, sample_format_to_js_string};

static DEVICES: Lazy<RwLock<HashMap<DeviceId, Device>>> = Lazy::new(|| RwLock::new(HashMap::new()));

pub fn get_hosts(mut cx: FunctionContext) -> JsResult<JsArray> {
    let array = cx.empty_array();
    
    // Use CPAL's built-in host enumeration
    let available_hosts = cpal::available_hosts();
    
    for (i, host_id) in available_hosts.iter().enumerate() {
        let host_obj = cx.empty_object();
        let host_id_str = cx.string(host_id.name());
        let host_name_str = cx.string(host_id.name()); // Using name as both ID and name for now
        
        host_obj.set(&mut cx, "id", host_id_str)?;
        host_obj.set(&mut cx, "name", host_name_str)?;
        
        array.set(&mut cx, i as u32, host_obj)?;
    }
    
    Ok(array)
}

pub fn get_devices(mut cx: FunctionContext) -> JsResult<JsArray> {
    // Create an empty array to return
    let array = cx.empty_array();
    
    // Check if a host ID was provided
    let host = if cx.len() > 0 {
        // Get the host based on the provided host ID
        let host_id_str = cx.argument::<JsString>(0)?.value(&mut cx);
        
        let host_id = cpal::available_hosts()
            .into_iter()
            .find(|id| id.name() == host_id_str);
        
        let host_id = match host_id {
            Some(id) => id,
            None => return cx.throw_error(format!("Host not found: {}", host_id_str)),
        };
        
        match cpal::host_from_id(host_id) {
            Ok(host) => host,
            Err(err) => return cx.throw_error(format!("Failed to initialize host: {}", err)),
        }
    } else {
        // Use the default host
        cpal::default_host()
    };
    
    // Try to get devices from the host
    let devices = match host.devices() {
        Ok(devices) => devices.collect::<Vec<_>>(),
        Err(err) => {
            return cx.throw_error(format!("Failed to enumerate devices: {}", err));
        }
    };

    // Process each device
    for (i, device) in devices.iter().enumerate() {
        let device_id = match device.name() {
            Ok(name) => name,
            Err(_) => "Unknown Device".to_string(),
        };
        
        // Store the device in our cache
        DEVICES.write().insert(device_id.clone(), device.clone());

        // Create a device object
        let obj = cx.empty_object();
        let id_str = cx.string(&device_id);
        let name_str = cx.string(&device_id);
        let host_id_str = cx.string(host.id().name());
        
        // Check if this is a default device
        let is_default_input = host.default_input_device()
            .map(|d| d.name().map(|n| n == device_id).unwrap_or(false))
            .unwrap_or(false);
            
        let is_default_output = host.default_output_device()
            .map(|d| d.name().map(|n| n == device_id).unwrap_or(false))
            .unwrap_or(false);
            
        let is_default_input_bool = cx.boolean(is_default_input);
        let is_default_output_bool = cx.boolean(is_default_output);
        
        // Set the properties on the object
        obj.set(&mut cx, "name", name_str)?;
        obj.set(&mut cx, "deviceId", id_str)?;
        obj.set(&mut cx, "hostId", host_id_str)?;
        obj.set(&mut cx, "isDefaultInput", is_default_input_bool)?;
        obj.set(&mut cx, "isDefaultOutput", is_default_output_bool)?;
        
        // Add the object to the array
        array.set(&mut cx, i as u32, obj)?;
    }
    
    Ok(array)
}

pub fn get_supported_input_configs(mut cx: FunctionContext) -> JsResult<JsArray> {
    let device_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = match DEVICES.read().get(device_id.as_str()) {
        Some(device) => device.clone(),
        None => return cx.throw_error("Device not found"),
    };

    let configs = match device.supported_input_configs() {
        Ok(configs) => configs.collect::<Vec<_>>(),
        Err(e) => return cx.throw_error(format!("Failed to get input configs: {}", e)),
    };

    if configs.is_empty() {
        return cx.throw_error("Device does not support input");
    }

    let array = cx.empty_array();
    for (i, config) in configs.iter().enumerate() {
        let obj = cx.empty_object();
        
        // Create all JS values first
        let channels = cx.number(config.channels() as f64);
        let min_rate = cx.number(config.min_sample_rate().0 as f64);
        let max_rate = cx.number(config.max_sample_rate().0 as f64);
        let format = cx.string(sample_format_to_js_string(config.sample_format()));

        // Now set all the values
        obj.set(&mut cx, "channels", channels)?;
        obj.set(&mut cx, "minSampleRate", min_rate)?;
        obj.set(&mut cx, "maxSampleRate", max_rate)?;
        obj.set(&mut cx, "format", format)?;

        array.set(&mut cx, i as u32, obj)?;
    }

    Ok(array)
}

pub fn get_supported_output_configs(mut cx: FunctionContext) -> JsResult<JsArray> {
    let device_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = match DEVICES.read().get(device_id.as_str()) {
        Some(device) => device.clone(),
        None => return cx.throw_error("Device not found"),
    };

    let configs = match device.supported_output_configs() {
        Ok(configs) => configs.collect::<Vec<_>>(),
        Err(e) => return cx.throw_error(format!("Failed to get output configs: {}", e)),
    };

    if configs.is_empty() {
        return cx.throw_error("Device does not support output");
    }

    let array = cx.empty_array();
    for (i, config) in configs.iter().enumerate() {
        let obj = cx.empty_object();
        
        // Create all JS values first
        let channels = cx.number(config.channels() as f64);
        let min_rate = cx.number(config.min_sample_rate().0 as f64);
        let max_rate = cx.number(config.max_sample_rate().0 as f64);
        let format = cx.string(sample_format_to_js_string(config.sample_format()));

        // Now set all the values
        obj.set(&mut cx, "channels", channels)?;
        obj.set(&mut cx, "minSampleRate", min_rate)?;
        obj.set(&mut cx, "maxSampleRate", max_rate)?;
        obj.set(&mut cx, "format", format)?;

        array.set(&mut cx, i as u32, obj)?;
    }

    Ok(array)
}

pub fn get_default_device(mut cx: FunctionContext, is_input: bool) -> JsResult<JsObject> {
    let host = cpal::default_host();
    let device = if is_input {
        host.default_input_device()
    } else {
        host.default_output_device()
    };

    let device = match device {
        Some(device) => device,
        None => return cx.throw_error(if is_input {
            "No default input device found"
        } else {
            "No default output device found"
        }),
    };

    let device_id = device.name().unwrap_or_default();
    DEVICES.write().insert(device_id.clone(), device.clone());
    
    // Create a device object
    let obj = cx.empty_object();
    let id_str = cx.string(&device_id);
    let name_str = cx.string(&device_id);
    let host_id_str = cx.string(host.id().name());
    
    // Set default flags based on what we're looking for
    let is_default_input_bool = cx.boolean(is_input);
    let is_default_output_bool = cx.boolean(!is_input);
    
    // Set the properties on the object
    obj.set(&mut cx, "name", name_str)?;
    obj.set(&mut cx, "deviceId", id_str)?;
    obj.set(&mut cx, "hostId", host_id_str)?;
    obj.set(&mut cx, "isDefaultInput", is_default_input_bool)?;
    obj.set(&mut cx, "isDefaultOutput", is_default_output_bool)?;
    
    Ok(obj)
}

pub fn get_default_config(mut cx: FunctionContext, is_input: bool) -> JsResult<JsObject> {
    let device_id = cx.argument::<JsString>(0)?.value(&mut cx);
    
    // Try to find the device in our cache
    let device = match DEVICES.read().get(device_id.as_str()) {
        Some(device) => device.clone(),
        None => {
            // If not found, try to get the default device
            let host = cpal::default_host();
            let device = if is_input {
                host.default_input_device()
            } else {
                host.default_output_device()
            };
            
            match device {
                Some(device) => device,
                None => return cx.throw_error(if is_input {
                    "No default input device found"
                } else {
                    "No default output device found"
                }),
            }
        }
    };

    let config = if is_input {
        device.default_input_config()
    } else {
        device.default_output_config()
    };

    let config = match config {
        Ok(config) => config,
        Err(e) => return cx.throw_error(format!("Failed to get default config: {}", e)),
    };

    // Create a config object
    let obj = cx.empty_object();
    let sample_rate = cx.number(config.sample_rate().0 as f64);
    let channels = cx.number(config.channels() as f64);
    
    // Convert the sample format to a string
    let format_str = match config.sample_format() {
        cpal::SampleFormat::I16 => "i16",
        cpal::SampleFormat::U16 => "u16",
        cpal::SampleFormat::F32 => "f32",
        _ => "unknown", // Handle any future formats
    };
    let format = cx.string(format_str);
    
    // Set the properties on the object
    obj.set(&mut cx, "sampleRate", sample_rate)?;
    obj.set(&mut cx, "channels", channels)?;
    obj.set(&mut cx, "sampleFormat", format)?;
    
    Ok(obj)
}

pub fn get_device(device_id: String) -> Option<Device> {
    DEVICES.read().get(device_id.as_str()).cloned()
}

pub fn get_supported_formats(mut cx: FunctionContext) -> JsResult<JsArray> {
    let device_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = match DEVICES.read().get(device_id.as_str()) {
        Some(device) => device.clone(),
        None => return cx.throw_error("Device not found"),
    };

    let array = cx.empty_array();
    let mut index = 0;

    // Get supported formats from both input and output configs
    let mut formats = Vec::new();

    // Check input configs
    if let Ok(configs) = device.supported_input_configs() {
        for config in configs {
            let format = config.sample_format();
            if !formats.contains(&format) {
                formats.push(format);
            }
        }
    }

    // Check output configs
    if let Ok(configs) = device.supported_output_configs() {
        for config in configs {
            let format = config.sample_format();
            if !formats.contains(&format) {
                formats.push(format);
            }
        }
    }

    // Convert formats to strings and add to array
    for format in formats {
        let format_str = cx.string(sample_format_to_js_string(format));
        array.set(&mut cx, index, format_str)?;
        index += 1;
    }

    Ok(array)
}

pub fn get_supported_sample_rates(mut cx: FunctionContext) -> JsResult<JsArray> {
    let device_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = match DEVICES.read().get(device_id.as_str()) {
        Some(device) => device.clone(),
        None => return cx.throw_error("Device not found"),
    };

    let array = cx.empty_array();
    let mut index = 0;
    let mut rates = Vec::new();

    // Check input configs
    if let Ok(configs) = device.supported_input_configs() {
        for config in configs {
            let min_rate = config.min_sample_rate().0;
            let max_rate = config.max_sample_rate().0;
            if !rates.contains(&min_rate) {
                rates.push(min_rate);
            }
            if !rates.contains(&max_rate) {
                rates.push(max_rate);
            }
        }
    }

    // Check output configs
    if let Ok(configs) = device.supported_output_configs() {
        for config in configs {
            let min_rate = config.min_sample_rate().0;
            let max_rate = config.max_sample_rate().0;
            if !rates.contains(&min_rate) {
                rates.push(min_rate);
            }
            if !rates.contains(&max_rate) {
                rates.push(max_rate);
            }
        }
    }

    // Sort rates for consistency
    rates.sort_unstable();

    // Add rates to array
    for rate in rates {
        let rate_num = cx.number(rate as f64);
        array.set(&mut cx, index, rate_num)?;
        index += 1;
    }

    Ok(array)
}

pub fn get_max_channels(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let device_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let device = match DEVICES.read().get(device_id.as_str()) {
        Some(device) => device.clone(),
        None => return cx.throw_error("Device not found"),
    };

    let mut max_channels = 0u16;

    // Check input configs
    if let Ok(configs) = device.supported_input_configs() {
        for config in configs {
            max_channels = max_channels.max(config.channels());
        }
    }

    // Check output configs
    if let Ok(configs) = device.supported_output_configs() {
        for config in configs {
            max_channels = max_channels.max(config.channels());
        }
    }

    Ok(cx.number(max_channels as f64))
} 