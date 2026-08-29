use cpal::{
    traits::{DeviceTrait, StreamTrait},
    BufferSize, SampleFormat, Stream, StreamConfig, StreamInstant,
};
use crossbeam_channel::{bounded, select, Receiver, Sender};
use neon::{prelude::*, types::JsBigInt};
use once_cell::sync::Lazy;
use parking_lot::{Mutex, RwLock};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc,
    },
    time::Duration,
};
use uuid::Uuid;

use crate::{
    cpal_api::canonical_device,
    utils::{
        audio_data::{bytes_from_js_typed_array, js_typed_array_from_bytes, parse_sample_format},
        errors::{error_kind_code, throw_binding_error, throw_cpal_error},
    },
};

const STATE_PAUSED: u8 = 0;
const STATE_PLAYING: u8 = 1;
const STATE_CLOSED: u8 = 2;

struct DirectStream {
    stream: Mutex<Option<Stream>>,
    state: AtomicU8,
    shutdown: Arc<AtomicBool>,
    shutdown_tx: Mutex<Option<Sender<()>>>,
}

static STREAMS: Lazy<RwLock<HashMap<String, Arc<DirectStream>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

#[derive(Clone, Copy)]
enum CallbackTimestamp {
    Input { callback: u128, capture: u128 },
    Output { callback: u128, playback: u128 },
}

fn fill_silence(data: &mut [u8], sample_format: SampleFormat) {
    fn fill_pattern(data: &mut [u8], pattern: &[u8]) {
        for sample in data.chunks_exact_mut(pattern.len()) {
            sample.copy_from_slice(pattern);
        }
    }

    match sample_format {
        SampleFormat::I8
        | SampleFormat::I16
        | SampleFormat::I24
        | SampleFormat::I32
        | SampleFormat::I64
        | SampleFormat::F32
        | SampleFormat::F64 => data.fill(0),
        SampleFormat::U8 => data.fill(1 << 7),
        SampleFormat::U16 => fill_pattern(data, &(1u16 << 15).to_ne_bytes()),
        SampleFormat::U24 => fill_pattern(data, &(1u32 << 23).to_ne_bytes()),
        SampleFormat::U32 => fill_pattern(data, &(1u32 << 31).to_ne_bytes()),
        SampleFormat::U64 => fill_pattern(data, &(1u64 << 63).to_ne_bytes()),
        SampleFormat::DsdU8 | SampleFormat::DsdU16 | SampleFormat::DsdU32 => data.fill(0x69),
        _ => data.fill(0),
    }
}

fn serialize_callback_info<'a>(
    cx: &mut TaskContext<'a>,
    timestamp: CallbackTimestamp,
) -> JsResult<'a, JsObject> {
    let object = cx.empty_object();
    match timestamp {
        CallbackTimestamp::Input { callback, capture } => {
            let kind = cx.string("input");
            let callback = JsBigInt::from_u128(cx, callback);
            let capture = JsBigInt::from_u128(cx, capture);
            object.set(cx, "kind", kind)?;
            object.set(cx, "callbackTimeNs", callback)?;
            object.set(cx, "captureTimeNs", capture)?;
        }
        CallbackTimestamp::Output { callback, playback } => {
            let kind = cx.string("output");
            let callback = JsBigInt::from_u128(cx, callback);
            let playback = JsBigInt::from_u128(cx, playback);
            object.set(cx, "kind", kind)?;
            object.set(cx, "callbackTimeNs", callback)?;
            object.set(cx, "playbackTimeNs", playback)?;
        }
    }
    Ok(object)
}

struct CallbackRequest {
    bytes: Vec<u8>,
    timestamp: CallbackTimestamp,
    output: bool,
}

fn dispatch_audio_callback(
    channel: &Channel,
    callback: Arc<Root<JsFunction>>,
    sample_format: SampleFormat,
    request: CallbackRequest,
    shutdown: Arc<AtomicBool>,
    shutdown_rx: &Receiver<()>,
) -> Option<Vec<u8>> {
    if shutdown.load(Ordering::Acquire) {
        return None;
    }

    let (response_tx, response_rx) = bounded::<Vec<u8>>(1);
    let output = request.output;
    if channel
        .try_send(move |mut cx| {
            if shutdown.load(Ordering::Acquire) {
                let _ = response_tx.send(request.bytes);
                return Ok(());
            }

            let result = (|| {
                let data = js_typed_array_from_bytes(&mut cx, sample_format, &request.bytes)?;
                let info = serialize_callback_info(&mut cx, request.timestamp)?;
                let callback = callback.to_inner(&mut cx);
                let this = cx.undefined();
                callback.call(&mut cx, this, vec![data, info.upcast::<JsValue>()])?;
                if output {
                    bytes_from_js_typed_array(&mut cx, sample_format, data).map(Some)
                } else {
                    Ok(None)
                }
            })();

            match result {
                Ok(Some(bytes)) => {
                    let _ = response_tx.send(bytes);
                    Ok(())
                }
                Ok(None) => {
                    let _ = response_tx.send(request.bytes);
                    Ok(())
                }
                Err(error) => {
                    let _ = response_tx.send(request.bytes);
                    Err(error)
                }
            }
        })
        .is_err()
    {
        return None;
    }

    select! {
        recv(response_rx) -> response => response.ok(),
        recv(shutdown_rx) -> _ => None,
    }
}

fn dispatch_stream_error(
    channel: &Channel,
    callback: Arc<Root<JsFunction>>,
    error: cpal::Error,
    shutdown: Arc<AtomicBool>,
    shutdown_rx: &Receiver<()>,
) {
    if shutdown.load(Ordering::Acquire) {
        return;
    }
    let code = error_kind_code(error.kind());
    let message = error.to_string();
    let cpal_message = error.message().map(str::to_owned);
    let (response_tx, response_rx) = bounded::<()>(1);
    if channel
        .try_send(move |mut cx| {
            if shutdown.load(Ordering::Acquire) {
                let _ = response_tx.send(());
                return Ok(());
            }
            let result = (|| {
                let object = cx.empty_object();
                let code = cx.string(code);
                let message = cx.string(message);
                object.set(&mut cx, "code", code)?;
                object.set(&mut cx, "message", message)?;
                let cpal_message: Handle<JsValue> = match cpal_message {
                    Some(message) => cx.string(message).upcast(),
                    None => cx.null().upcast(),
                };
                object.set(&mut cx, "cpalMessage", cpal_message)?;
                let callback = callback.to_inner(&mut cx);
                let this = cx.undefined();
                callback.call(&mut cx, this, vec![object.upcast()])?;
                Ok(())
            })();
            let _ = response_tx.send(());
            result
        })
        .is_err()
    {
        return;
    }

    select! {
        recv(response_rx) -> _ => {},
        recv(shutdown_rx) -> _ => {},
    }
}

fn get_required_number(
    cx: &mut FunctionContext,
    object: Handle<JsObject>,
    key: &'static str,
) -> NeonResult<f64> {
    object
        .get::<JsNumber, _, _>(cx, key)
        .map(|value| value.value(cx))
}

fn get_optional_number(
    cx: &mut FunctionContext,
    object: Handle<JsObject>,
    key: &'static str,
) -> NeonResult<Option<f64>> {
    let value = object.get::<JsValue, _, _>(cx, key)?;
    if value.is_a::<JsUndefined, _>(cx) || value.is_a::<JsNull, _>(cx) {
        return Ok(None);
    }
    value
        .downcast::<JsNumber, _>(cx)
        .map(|value| Some(value.value(cx)))
        .or_else(|_| cx.throw_type_error(format!("{key} must be a number or null")))
}

fn checked_integer<T>(
    cx: &mut FunctionContext,
    value: f64,
    key: &'static str,
    max: u64,
) -> NeonResult<T>
where
    T: TryFrom<u64>,
{
    if !value.is_finite() || value.fract() != 0.0 || value < 0.0 || value > max as f64 {
        return cx.throw_range_error(format!("{key} must be an integer between 0 and {max}"));
    }
    T::try_from(value as u64)
        .map_err(|_| ())
        .or_else(|_| cx.throw_range_error(format!("{key} is out of range")))
}

fn parse_timeout(cx: &mut FunctionContext, value: Handle<JsValue>) -> NeonResult<Option<Duration>> {
    if value.is_a::<JsUndefined, _>(cx) || value.is_a::<JsNull, _>(cx) {
        return Ok(None);
    }
    let value = match value.downcast::<JsBigInt, _>(cx) {
        Ok(value) => value,
        Err(_) => return cx.throw_type_error("timeout must be a bigint in nanoseconds or null"),
    };
    let nanos = match value.to_u128(cx) {
        Ok(value) => value,
        Err(_) => return cx.throw_range_error("timeout must be a non-negative bigint"),
    };
    let secs = nanos / 1_000_000_000;
    if secs > u64::MAX as u128 {
        return cx.throw_range_error("timeout is too large");
    }
    Ok(Some(Duration::new(
        secs as u64,
        (nanos % 1_000_000_000) as u32,
    )))
}

pub fn build_stream(mut cx: FunctionContext) -> JsResult<JsObject> {
    let device_handle = cx.argument::<JsString>(0)?.value(&mut cx);
    let input = cx.argument::<JsBoolean>(1)?.value(&mut cx);
    let config = cx.argument::<JsObject>(2)?;
    let sample_format_name = cx.argument::<JsString>(3)?.value(&mut cx);
    let data_callback = Arc::new(cx.argument::<JsFunction>(4)?.root(&mut cx));
    let error_callback = Arc::new(cx.argument::<JsFunction>(5)?.root(&mut cx));
    let timeout_value = cx.argument::<JsValue>(6)?;

    let Some(device) = canonical_device(&device_handle) else {
        return throw_binding_error(
            &mut cx,
            "INVALID_INPUT",
            "Device handle is closed or invalid",
            "device.buildStream",
        );
    };
    let sample_format = match parse_sample_format(&sample_format_name) {
        Some(format) => format,
        None => {
            return throw_binding_error(
                &mut cx,
                "INVALID_INPUT",
                format!("Unsupported sample format: {sample_format_name}"),
                "device.buildStream",
            )
        }
    };
    let channels_value = get_required_number(&mut cx, config, "channels")?;
    let channels = checked_integer::<u16>(&mut cx, channels_value, "channels", u16::MAX as u64)?;
    let sample_rate_value = get_required_number(&mut cx, config, "sampleRate")?;
    let sample_rate =
        checked_integer::<u32>(&mut cx, sample_rate_value, "sampleRate", u32::MAX as u64)?;
    let buffer_size = get_optional_number(&mut cx, config, "bufferSizeFrames")?
        .map(|value| {
            checked_integer::<u32>(&mut cx, value, "bufferSizeFrames", u32::MAX as u64)
                .map(BufferSize::Fixed)
        })
        .transpose()?
        .unwrap_or(BufferSize::Default);
    let timeout = parse_timeout(&mut cx, timeout_value)?;
    let stream_config = StreamConfig {
        channels,
        sample_rate,
        buffer_size,
    };

    let data_channel = cx.channel();
    let error_channel = cx.channel();
    let (shutdown_tx, shutdown_rx) = bounded::<()>(1);
    let shutdown = Arc::new(AtomicBool::new(false));

    let data_callback_native = Arc::clone(&data_callback);
    let shutdown_data = Arc::clone(&shutdown);
    let shutdown_rx_data = shutdown_rx.clone();
    let error_callback_native = Arc::clone(&error_callback);
    let shutdown_error = Arc::clone(&shutdown);
    let shutdown_rx_error = shutdown_rx.clone();
    let stream = if input {
        let data_callback = move |data: &cpal::Data, info: &cpal::InputCallbackInfo| {
            let timestamp = info.timestamp();
            let _ = dispatch_audio_callback(
                &data_channel,
                Arc::clone(&data_callback_native),
                sample_format,
                CallbackRequest {
                    bytes: data.bytes().to_vec(),
                    timestamp: CallbackTimestamp::Input {
                        callback: timestamp.callback.as_nanos(),
                        capture: timestamp.capture.as_nanos(),
                    },
                    output: false,
                },
                Arc::clone(&shutdown_data),
                &shutdown_rx_data,
            );
        };
        let error_callback = move |error| {
            dispatch_stream_error(
                &error_channel,
                Arc::clone(&error_callback_native),
                error,
                Arc::clone(&shutdown_error),
                &shutdown_rx_error,
            );
        };
        match device.build_input_stream_raw(
            stream_config,
            sample_format,
            data_callback,
            error_callback,
            timeout,
        ) {
            Ok(stream) => stream,
            Err(error) => return throw_cpal_error(&mut cx, &error, "device.buildInputStream"),
        }
    } else {
        let data_callback = move |data: &mut cpal::Data, info: &cpal::OutputCallbackInfo| {
            fill_silence(data.bytes_mut(), sample_format);
            let timestamp = info.timestamp();
            let response = dispatch_audio_callback(
                &data_channel,
                Arc::clone(&data_callback_native),
                sample_format,
                CallbackRequest {
                    bytes: data.bytes().to_vec(),
                    timestamp: CallbackTimestamp::Output {
                        callback: timestamp.callback.as_nanos(),
                        playback: timestamp.playback.as_nanos(),
                    },
                    output: true,
                },
                Arc::clone(&shutdown_data),
                &shutdown_rx_data,
            );
            if let Some(bytes) = response.filter(|bytes| bytes.len() == data.bytes().len()) {
                data.bytes_mut().copy_from_slice(&bytes);
            }
        };
        let error_callback = move |error| {
            dispatch_stream_error(
                &error_channel,
                Arc::clone(&error_callback_native),
                error,
                Arc::clone(&shutdown_error),
                &shutdown_rx_error,
            );
        };
        match device.build_output_stream_raw(
            stream_config,
            sample_format,
            data_callback,
            error_callback,
            timeout,
        ) {
            Ok(stream) => stream,
            Err(error) => return throw_cpal_error(&mut cx, &error, "device.buildOutputStream"),
        }
    };

    let id = Uuid::new_v4().to_string();
    STREAMS.write().insert(
        id.clone(),
        Arc::new(DirectStream {
            stream: Mutex::new(Some(stream)),
            state: AtomicU8::new(STATE_PAUSED),
            shutdown,
            shutdown_tx: Mutex::new(Some(shutdown_tx)),
        }),
    );
    let descriptor = cx.empty_object();
    let id = cx.string(id);
    descriptor.set(&mut cx, "id", id)?;
    Ok(descriptor)
}

fn stream_or_throw<'a>(
    cx: &mut FunctionContext<'a>,
    id: &str,
    operation: &'static str,
) -> NeonResult<Arc<DirectStream>> {
    match STREAMS.read().get(id).cloned() {
        Some(stream) => Ok(stream),
        None => throw_binding_error(cx, "STREAM_CLOSED", "Stream is closed", operation),
    }
}

pub fn play(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let stream = stream_or_throw(&mut cx, &id, "stream.play")?;
    if stream.state.load(Ordering::Acquire) == STATE_PAUSED {
        let result = stream.stream.lock().as_ref().map(StreamTrait::play);
        if let Some(Err(error)) = result {
            return throw_cpal_error(&mut cx, &error, "stream.play");
        }
        stream.state.store(STATE_PLAYING, Ordering::Release);
    }
    Ok(cx.undefined())
}

pub fn pause(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let stream = stream_or_throw(&mut cx, &id, "stream.pause")?;
    if stream.state.load(Ordering::Acquire) == STATE_PLAYING {
        let result = stream.stream.lock().as_ref().map(StreamTrait::pause);
        if let Some(Err(error)) = result {
            return throw_cpal_error(&mut cx, &error, "stream.pause");
        }
        stream.state.store(STATE_PAUSED, Ordering::Release);
    }
    Ok(cx.undefined())
}

pub fn buffer_size(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let stream = stream_or_throw(&mut cx, &id, "stream.bufferSize")?;
    let result = stream.stream.lock().as_ref().map(StreamTrait::buffer_size);
    match result {
        Some(Ok(frames)) => Ok(cx.number(frames as f64)),
        Some(Err(error)) => throw_cpal_error(&mut cx, &error, "stream.bufferSize"),
        None => throw_binding_error(
            &mut cx,
            "STREAM_CLOSED",
            "Stream is closed",
            "stream.bufferSize",
        ),
    }
}

pub fn now(mut cx: FunctionContext) -> JsResult<JsBigInt> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let stream = stream_or_throw(&mut cx, &id, "stream.now")?;
    let now = stream
        .stream
        .lock()
        .as_ref()
        .map(StreamTrait::now)
        .unwrap_or(StreamInstant::ZERO);
    Ok(JsBigInt::from_u128(&mut cx, now.as_nanos()))
}

pub fn state(mut cx: FunctionContext) -> JsResult<JsString> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let state = STREAMS
        .read()
        .get(&id)
        .map(|stream| stream.state.load(Ordering::Acquire))
        .unwrap_or(STATE_CLOSED);
    Ok(cx.string(match state {
        STATE_PAUSED => "paused",
        STATE_PLAYING => "playing",
        _ => "closed",
    }))
}

pub fn close(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let Some(stream) = STREAMS.write().remove(&id) else {
        return Ok(cx.undefined());
    };
    stream.state.store(STATE_CLOSED, Ordering::Release);
    stream.shutdown.store(true, Ordering::Release);
    // Disconnecting the sole sender wakes every cloned receiver, including
    // concurrent data and error callbacks waiting for the Node thread.
    stream.shutdown_tx.lock().take();
    let native_stream = stream.stream.lock().take();
    drop(native_stream);
    Ok(cx.undefined())
}

#[cfg(test)]
mod tests {
    use super::fill_silence;
    use cpal::SampleFormat;

    #[test]
    fn direct_output_starts_with_format_correct_silence() {
        let mut unsigned = [0; 8];
        fill_silence(&mut unsigned, SampleFormat::U24);
        assert_eq!(&unsigned[..4], &(1u32 << 23).to_ne_bytes());

        let mut dsd = [0; 8];
        fill_silence(&mut dsd, SampleFormat::DsdU16);
        assert_eq!(dsd, [0x69; 8]);
    }
}
