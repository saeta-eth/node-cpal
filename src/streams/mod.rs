use cpal::{
    traits::{DeviceTrait, StreamTrait},
    BufferSize, SampleFormat, Stream, StreamConfig, StreamInstant,
};
use crossbeam_channel::{bounded, select, Receiver, Sender};
use neon::prelude::*;
use neon::types::JsBigInt;
use once_cell::sync::Lazy;
use parking_lot::{Mutex, RwLock};
use std::{
    borrow::Cow,
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, AtomicU8, AtomicUsize, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use crate::{
    devices::get_device,
    utils::{
        audio_data::{bytes_from_js_typed_array, js_typed_array_from_bytes, parse_sample_format},
        errors::{error_kind_code, throw_binding_error, throw_cpal_error},
        types::{sample_format_to_js_string, StreamId},
    },
};

const STATE_PAUSED: u8 = 0;
const STATE_PLAYING: u8 = 1;
const STATE_CLOSED: u8 = 2;
const DEFAULT_QUEUE_CAPACITY: usize = 32;
// Each error code has one coalescing bit, so this bounds priority callbacks
// without sharing capacity with ordinary audio notifications.
const ERROR_QUEUE_CAPACITY: usize = 16;

struct StreamWrapper {
    stream: Stream,
    state: AtomicU8,
    is_input: bool,
    sample_format: SampleFormat,
    channels: u16,
    output_tx: Option<Sender<Vec<u8>>>,
    buffered_bytes: Arc<AtomicUsize>,
    drain_requested: Arc<AtomicU8>,
    shutdown_tx: Sender<()>,
    event_worker: Mutex<Option<JoinHandle<()>>>,
}

impl StreamWrapper {
    fn state_name(&self) -> &'static str {
        match self.state.load(Ordering::Acquire) {
            STATE_PLAYING => "playing",
            STATE_CLOSED => "closed",
            _ => "paused",
        }
    }
}

static STREAMS: Lazy<RwLock<HashMap<StreamId, Arc<StreamWrapper>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

enum NativeEvent {
    InputData {
        bytes: Vec<u8>,
        frames: usize,
        callback_time_ns: u128,
        capture_time_ns: u128,
    },
    Output {
        frames: usize,
        callback_time_ns: u128,
        playback_time_ns: u128,
        underrun_frames: usize,
    },
    Error {
        code: &'static str,
        message: Cow<'static, str>,
        pending_bit: u32,
    },
    Drain,
}

fn error_pending_bit(code: &str) -> u32 {
    let index = match code {
        "DEVICE_BUSY" => 0,
        "DEVICE_CHANGED" => 1,
        "DEVICE_NOT_AVAILABLE" => 2,
        "HOST_UNAVAILABLE" => 3,
        "INVALID_INPUT" => 4,
        "PERMISSION_DENIED" => 5,
        "REALTIME_DENIED" => 6,
        "RESOURCE_EXHAUSTED" => 7,
        "STREAM_INVALIDATED" => 8,
        "UNSUPPORTED_CONFIG" => 9,
        "UNSUPPORTED_OPERATION" => 10,
        "XRUN" => 11,
        "BACKEND_ERROR" => 12,
        "INPUT_OVERFLOW" => 13,
        _ => 14,
    };
    1 << index
}

fn try_send_stream_error(
    error_tx: &Sender<NativeEvent>,
    pending_error_bits: &AtomicU32,
    code: &'static str,
    message: Cow<'static, str>,
) {
    let pending_bit = error_pending_bit(code);
    if pending_error_bits.fetch_or(pending_bit, Ordering::AcqRel) & pending_bit != 0 {
        return;
    }
    if error_tx
        .try_send(NativeEvent::Error {
            code,
            message,
            pending_bit,
        })
        .is_err()
    {
        pending_error_bits.fetch_and(!pending_bit, Ordering::AcqRel);
    }
}

fn uses_audio_task_quota(event: &NativeEvent) -> bool {
    matches!(
        event,
        NativeEvent::InputData { .. } | NativeEvent::Output { .. }
    )
}

fn try_reserve_event_task(
    event: &NativeEvent,
    outstanding_tasks: &AtomicUsize,
    max_outstanding_tasks: usize,
) -> bool {
    !uses_audio_task_quota(event)
        || outstanding_tasks
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < max_outstanding_tasks).then_some(count + 1)
            })
            .is_ok()
}

#[derive(Default)]
struct OutputBufferState {
    pending_buffer: Vec<u8>,
    pending_offset: usize,
}

impl OutputBufferState {
    fn fill(&mut self, data: &mut [u8], receiver: &Receiver<Vec<u8>>) -> (usize, usize) {
        let mut data_offset = 0;

        while data_offset < data.len() {
            if self.pending_offset >= self.pending_buffer.len() {
                match receiver.try_recv() {
                    Ok(buffer) => {
                        self.pending_buffer = buffer;
                        self.pending_offset = 0;
                    }
                    Err(_) => {
                        self.pending_buffer = Vec::new();
                        self.pending_offset = 0;
                        break;
                    }
                }
            }

            let byte_count = std::cmp::min(
                data.len() - data_offset,
                self.pending_buffer.len() - self.pending_offset,
            );
            data[data_offset..data_offset + byte_count].copy_from_slice(
                &self.pending_buffer[self.pending_offset..self.pending_offset + byte_count],
            );
            data_offset += byte_count;
            self.pending_offset += byte_count;
        }

        if self.pending_offset >= self.pending_buffer.len() {
            self.pending_buffer = Vec::new();
            self.pending_offset = 0;
        }

        (data_offset, data.len() - data_offset)
    }
}

fn fill_silence(data: &mut [u8], sample_format: SampleFormat) {
    fn fill_pattern(data: &mut [u8], pattern: &[u8]) {
        debug_assert_eq!(data.len() % pattern.len(), 0);
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
    match value.downcast::<JsNumber, _>(cx) {
        Ok(value) => Ok(Some(value.value(cx))),
        Err(_) => cx.throw_type_error(format!("{key} must be a number or null")),
    }
}

fn checked_integer<T>(
    cx: &mut FunctionContext,
    value: f64,
    key: &'static str,
    min: u64,
    max: u64,
) -> NeonResult<T>
where
    T: TryFrom<u64>,
{
    if !value.is_finite() || value.fract() != 0.0 || value < min as f64 || value > max as f64 {
        return cx.throw_range_error(format!("{key} must be an integer between {min} and {max}"));
    }
    T::try_from(value as u64)
        .map_err(|_| ())
        .or_else(|_| cx.throw_range_error(format!("{key} is out of range")))
}

fn stream_instant_to_nanos(value: StreamInstant) -> u128 {
    value.as_nanos()
}

struct EventWorkerConfig {
    channel: Channel,
    callback: Arc<Root<JsFunction>>,
    sample_format: SampleFormat,
    event_rx: Receiver<NativeEvent>,
    error_rx: Receiver<NativeEvent>,
    shutdown_rx: Receiver<()>,
    input_recycle_tx: Option<Sender<Vec<u8>>>,
    error_tx: Sender<NativeEvent>,
    pending_error_bits: Arc<AtomicU32>,
    drain_event_pending: Arc<AtomicU8>,
    max_outstanding_tasks: usize,
}

fn spawn_event_worker(config: EventWorkerConfig) -> JoinHandle<()> {
    let EventWorkerConfig {
        channel,
        callback,
        sample_format,
        event_rx,
        error_rx,
        shutdown_rx,
        input_recycle_tx,
        error_tx,
        pending_error_bits,
        drain_event_pending,
        max_outstanding_tasks,
    } = config;
    let outstanding_tasks = Arc::new(AtomicUsize::new(0));
    thread::spawn(move || loop {
        let event = select! {
            recv(shutdown_rx) -> _ => break,
            recv(error_rx) -> event => match event {
                Ok(event) => event,
                Err(_) => break,
            },
            recv(event_rx) -> event => match event {
                Ok(event) => event,
                Err(_) => break,
            }
        };

        let uses_audio_quota = uses_audio_task_quota(&event);
        if !try_reserve_event_task(&event, &outstanding_tasks, max_outstanding_tasks) {
            if let NativeEvent::InputData { bytes, .. } = event {
                if let Some(recycle_tx) = &input_recycle_tx {
                    let _ = recycle_tx.try_send(bytes);
                }
                try_send_stream_error(
                    &error_tx,
                    &pending_error_bits,
                    "INPUT_OVERFLOW",
                    Cow::Borrowed(
                        "JavaScript callback queue is full; input audio data was dropped",
                    ),
                );
            }
            continue;
        }

        let completion = match &event {
            NativeEvent::Error { pending_bit, .. } => Some((*pending_bit, false)),
            NativeEvent::Drain => Some((0, true)),
            _ => None,
        };
        let callback = callback.clone();
        let input_recycle_tx = input_recycle_tx.clone();
        let outstanding_tasks_callback = outstanding_tasks.clone();
        let pending_error_bits_callback = pending_error_bits.clone();
        let drain_event_pending_callback = drain_event_pending.clone();
        if channel
            .try_send(move |mut cx| {
                let result = (|| {
                    let event_object = cx.empty_object();
                    match event {
                        NativeEvent::InputData {
                            bytes,
                            frames,
                            callback_time_ns,
                            capture_time_ns,
                        } => {
                            let event_type = cx.string("data");
                            event_object.set(&mut cx, "type", event_type)?;
                            let data =
                                match js_typed_array_from_bytes(&mut cx, sample_format, &bytes) {
                                    Ok(data) => data,
                                    Err(error) => {
                                        if let Some(recycle_tx) = &input_recycle_tx {
                                            let _ = recycle_tx.try_send(bytes);
                                        }
                                        return Err(error);
                                    }
                                };
                            if let Some(recycle_tx) = &input_recycle_tx {
                                let _ = recycle_tx.try_send(bytes);
                            }
                            event_object.set(&mut cx, "data", data)?;

                            let info = cx.empty_object();
                            let frames = cx.number(frames as f64);
                            let callback_time = JsBigInt::from_u128(&mut cx, callback_time_ns);
                            let capture_time = JsBigInt::from_u128(&mut cx, capture_time_ns);
                            info.set(&mut cx, "frames", frames)?;
                            info.set(&mut cx, "callbackTimeNs", callback_time)?;
                            info.set(&mut cx, "captureTimeNs", capture_time)?;
                            event_object.set(&mut cx, "info", info)?;
                        }
                        NativeEvent::Output {
                            frames,
                            callback_time_ns,
                            playback_time_ns,
                            underrun_frames,
                        } => {
                            let event_type = cx.string("output");
                            event_object.set(&mut cx, "type", event_type)?;
                            let info = cx.empty_object();
                            let frames = cx.number(frames as f64);
                            let callback_time = JsBigInt::from_u128(&mut cx, callback_time_ns);
                            let playback_time = JsBigInt::from_u128(&mut cx, playback_time_ns);
                            let underrun_frames = cx.number(underrun_frames as f64);
                            info.set(&mut cx, "frames", frames)?;
                            info.set(&mut cx, "callbackTimeNs", callback_time)?;
                            info.set(&mut cx, "playbackTimeNs", playback_time)?;
                            info.set(&mut cx, "underrunFrames", underrun_frames)?;
                            event_object.set(&mut cx, "info", info)?;
                        }
                        NativeEvent::Error {
                            code,
                            message,
                            pending_bit: _,
                        } => {
                            let event_type = cx.string("error");
                            event_object.set(&mut cx, "type", event_type)?;
                            let error = cx.empty_object();
                            let code = cx.string(code);
                            let message = cx.string(message.as_ref());
                            error.set(&mut cx, "code", code)?;
                            error.set(&mut cx, "message", message)?;
                            event_object.set(&mut cx, "error", error)?;
                        }
                        NativeEvent::Drain => {
                            let event_type = cx.string("drain");
                            event_object.set(&mut cx, "type", event_type)?;
                        }
                    }

                    let callback = callback.to_inner(&mut cx);
                    let this = cx.undefined();
                    callback.call(&mut cx, this, vec![event_object.upcast()])?;
                    Ok(())
                })();
                if uses_audio_quota {
                    outstanding_tasks_callback.fetch_sub(1, Ordering::AcqRel);
                }
                if let Some((pending_bit, is_drain)) = completion {
                    if is_drain {
                        drain_event_pending_callback.store(0, Ordering::Release);
                    } else {
                        pending_error_bits_callback.fetch_and(!pending_bit, Ordering::AcqRel);
                    }
                }
                result
            })
            .is_err()
        {
            if uses_audio_quota {
                outstanding_tasks.fetch_sub(1, Ordering::AcqRel);
            }
            if let Some((pending_bit, is_drain)) = completion {
                if is_drain {
                    drain_event_pending.store(0, Ordering::Release);
                } else {
                    pending_error_bits.fetch_and(!pending_bit, Ordering::AcqRel);
                }
            }
            break;
        }
    })
}

pub fn create_stream(mut cx: FunctionContext) -> JsResult<JsObject> {
    let device_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let is_input = cx.argument::<JsBoolean>(1)?.value(&mut cx);
    let config = cx.argument::<JsObject>(2)?;
    let event_callback = Arc::new(cx.argument::<JsFunction>(3)?.root(&mut cx));

    let device = match get_device(device_id.clone()) {
        Ok(device) => device,
        Err(error) => return throw_cpal_error(&mut cx, &error, "createStream"),
    };

    let channels_value = get_required_number(&mut cx, config, "channels")?;
    let channels: u16 = checked_integer(&mut cx, channels_value, "channels", 1, u16::MAX as u64)?;
    let sample_rate_value = get_required_number(&mut cx, config, "sampleRate")?;
    let sample_rate: u32 =
        checked_integer(&mut cx, sample_rate_value, "sampleRate", 1, u32::MAX as u64)?;
    let sample_format_name = config
        .get::<JsString, _, _>(&mut cx, "sampleFormat")?
        .value(&mut cx);
    let sample_format = match parse_sample_format(&sample_format_name) {
        Some(format) => format,
        None => {
            return throw_binding_error(
                &mut cx,
                "INVALID_INPUT",
                format!("Unsupported sample format: {sample_format_name}"),
                "createStream",
            )
        }
    };
    let fixed_buffer_size = get_optional_number(&mut cx, config, "bufferSizeFrames")?
        .map(|value| checked_integer::<u32>(&mut cx, value, "bufferSizeFrames", 1, u32::MAX as u64))
        .transpose()?;
    let timeout = get_optional_number(&mut cx, config, "timeoutMs")?
        .map(|value| {
            checked_integer::<u64>(&mut cx, value, "timeoutMs", 0, u64::MAX)
                .map(Duration::from_millis)
        })
        .transpose()?;
    let queue_capacity = get_optional_number(&mut cx, config, "queueCapacityBuffers")?
        .map(|value| checked_integer::<usize>(&mut cx, value, "queueCapacityBuffers", 2, 4096))
        .transpose()?
        .unwrap_or(DEFAULT_QUEUE_CAPACITY);

    let stream_config = StreamConfig {
        channels,
        sample_rate,
        buffer_size: fixed_buffer_size
            .map(BufferSize::Fixed)
            .unwrap_or(BufferSize::Default),
    };

    let (event_tx, event_rx) = bounded::<NativeEvent>(queue_capacity);
    let (error_tx, error_rx) = bounded::<NativeEvent>(ERROR_QUEUE_CAPACITY);
    let (shutdown_tx, shutdown_rx) = bounded::<()>(1);
    let (input_recycle_tx, input_recycle_rx) = bounded::<Vec<u8>>(queue_capacity);
    let buffered_bytes = Arc::new(AtomicUsize::new(0));
    let drain_requested = Arc::new(AtomicU8::new(0));
    let drain_event_pending = Arc::new(AtomicU8::new(0));
    let pending_error_bits = Arc::new(AtomicU32::new(0));

    let (stream, output_tx) = if is_input {
        let event_tx_data = event_tx.clone();
        let error_tx_data = error_tx.clone();
        let pending_error_bits_data = pending_error_bits.clone();
        let input_recycle_tx_callback = input_recycle_tx.clone();
        let input_callback = move |data: &cpal::Data, info: &cpal::InputCallbackInfo| {
            let timestamp = info.timestamp();
            let frames = data.len() / channels as usize;
            let source = data.bytes();
            let Ok(mut bytes) = input_recycle_rx.try_recv() else {
                try_send_stream_error(
                    &error_tx_data,
                    &pending_error_bits_data,
                    "INPUT_OVERFLOW",
                    Cow::Borrowed("Input buffer pool is exhausted; audio data was dropped"),
                );
                return;
            };
            bytes.clear();
            bytes.extend_from_slice(source);
            let event = NativeEvent::InputData {
                bytes,
                frames,
                callback_time_ns: stream_instant_to_nanos(timestamp.callback),
                capture_time_ns: stream_instant_to_nanos(timestamp.capture),
            };
            if let Err(error) = event_tx_data.try_send(event) {
                if let NativeEvent::InputData { bytes, .. } = error.into_inner() {
                    let _ = input_recycle_tx_callback.try_send(bytes);
                }
                try_send_stream_error(
                    &error_tx_data,
                    &pending_error_bits_data,
                    "INPUT_OVERFLOW",
                    Cow::Borrowed("Input callback queue is full; audio data was dropped"),
                );
            }
        };
        let error_tx_stream = error_tx.clone();
        let pending_error_bits_stream = pending_error_bits.clone();
        let error_callback = move |error: cpal::Error| {
            try_send_stream_error(
                &error_tx_stream,
                &pending_error_bits_stream,
                error_kind_code(error.kind()),
                Cow::Owned(error.to_string()),
            );
        };

        match device.build_input_stream_raw(
            stream_config,
            sample_format,
            input_callback,
            error_callback,
            timeout,
        ) {
            Ok(stream) => (stream, None),
            Err(error) => return throw_cpal_error(&mut cx, &error, "createInputStream"),
        }
    } else {
        let (output_tx, output_rx) = bounded::<Vec<u8>>(queue_capacity);
        let mut output_buffer = OutputBufferState::default();
        let event_tx_output = event_tx.clone();
        let buffered_bytes_callback = buffered_bytes.clone();
        let drain_requested_callback = drain_requested.clone();
        let drain_event_pending_callback = drain_event_pending.clone();
        let bytes_per_frame = sample_format.sample_size() * channels as usize;
        let output_callback = move |data: &mut cpal::Data, info: &cpal::OutputCallbackInfo| {
            let frame_count = data.len() / channels as usize;
            fill_silence(data.bytes_mut(), sample_format);
            let (consumed_bytes, missing_bytes) = output_buffer.fill(data.bytes_mut(), &output_rx);
            if consumed_bytes > 0 {
                buffered_bytes_callback.fetch_sub(consumed_bytes, Ordering::AcqRel);
            }
            if !output_rx.is_full()
                && drain_requested_callback.load(Ordering::Acquire) == 1
                && drain_event_pending_callback
                    .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
            {
                if drain_requested_callback
                    .compare_exchange(1, 0, Ordering::AcqRel, Ordering::Acquire)
                    .is_err()
                {
                    drain_event_pending_callback.store(0, Ordering::Release);
                } else if event_tx_output.try_send(NativeEvent::Drain).is_err() {
                    drain_event_pending_callback.store(0, Ordering::Release);
                    drain_requested_callback.store(1, Ordering::Release);
                }
            }
            let timestamp = info.timestamp();
            let _ = event_tx_output.try_send(NativeEvent::Output {
                frames: frame_count,
                callback_time_ns: stream_instant_to_nanos(timestamp.callback),
                playback_time_ns: stream_instant_to_nanos(timestamp.playback),
                underrun_frames: missing_bytes / bytes_per_frame,
            });
        };
        let error_tx_stream = error_tx.clone();
        let pending_error_bits_stream = pending_error_bits.clone();
        let error_callback = move |error: cpal::Error| {
            try_send_stream_error(
                &error_tx_stream,
                &pending_error_bits_stream,
                error_kind_code(error.kind()),
                Cow::Owned(error.to_string()),
            );
        };

        match device.build_output_stream_raw(
            stream_config,
            sample_format,
            output_callback,
            error_callback,
            timeout,
        ) {
            Ok(stream) => (stream, Some(output_tx)),
            Err(error) => return throw_cpal_error(&mut cx, &error, "createOutputStream"),
        }
    };

    let negotiated_buffer_size = match stream.buffer_size() {
        Ok(frames) => Some(frames),
        Err(error) if !is_input => {
            try_send_stream_error(
                &error_tx,
                &pending_error_bits,
                error_kind_code(error.kind()),
                Cow::Owned(error.to_string()),
            );
            None
        }
        Err(_) => None,
    };

    if is_input {
        let estimated_frames =
            negotiated_buffer_size.or(fixed_buffer_size).unwrap_or(1024) as usize;
        let estimated_bytes = estimated_frames * channels as usize * sample_format.sample_size();
        for _ in 0..queue_capacity {
            let _ = input_recycle_tx.try_send(Vec::with_capacity(estimated_bytes));
        }
    }

    let event_worker = spawn_event_worker(EventWorkerConfig {
        channel: cx.channel(),
        callback: event_callback,
        sample_format,
        event_rx,
        error_rx,
        shutdown_rx,
        input_recycle_tx: is_input.then_some(input_recycle_tx),
        error_tx,
        pending_error_bits,
        drain_event_pending: drain_event_pending.clone(),
        max_outstanding_tasks: queue_capacity,
    });
    let stream_id = uuid::Uuid::new_v4().to_string();
    let stream_wrapper = Arc::new(StreamWrapper {
        stream,
        state: AtomicU8::new(STATE_PAUSED),
        is_input,
        sample_format,
        channels,
        output_tx,
        buffered_bytes,
        drain_requested,
        shutdown_tx,
        event_worker: Mutex::new(Some(event_worker)),
    });
    STREAMS.write().insert(stream_id.clone(), stream_wrapper);

    let result = cx.empty_object();
    let id = cx.string(stream_id);
    let direction = cx.string(if is_input { "input" } else { "output" });
    let format = cx.string(sample_format_to_js_string(sample_format));
    let channels = cx.number(channels as f64);
    let sample_rate = cx.number(sample_rate as f64);
    result.set(&mut cx, "id", id)?;
    result.set(&mut cx, "direction", direction)?;
    result.set(&mut cx, "sampleFormat", format)?;
    result.set(&mut cx, "channels", channels)?;
    result.set(&mut cx, "sampleRate", sample_rate)?;
    match negotiated_buffer_size {
        Some(frames) => {
            let frames = cx.number(frames as f64);
            result.set(&mut cx, "bufferSizeFrames", frames)?;
        }
        None => {
            let null = cx.null();
            result.set(&mut cx, "bufferSizeFrames", null)?;
        }
    }

    Ok(result)
}

pub fn write_to_stream(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let stream_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let value = cx.argument::<JsValue>(1)?;
    let stream = match STREAMS.read().get(stream_id.as_str()) {
        Some(stream) => stream.clone(),
        None => {
            return throw_binding_error(
                &mut cx,
                "STREAM_CLOSED",
                "Stream is closed or does not exist",
                "write",
            )
        }
    };

    if stream.is_input {
        return throw_binding_error(
            &mut cx,
            "UNSUPPORTED_OPERATION",
            "Cannot write to an input stream",
            "write",
        );
    }
    if stream.state.load(Ordering::Acquire) == STATE_CLOSED {
        return throw_binding_error(&mut cx, "STREAM_CLOSED", "Stream is closed", "write");
    }

    let bytes = bytes_from_js_typed_array(&mut cx, stream.sample_format, value)?;
    let bytes_per_frame = stream.sample_format.sample_size() * stream.channels as usize;
    if bytes.is_empty() || bytes.len() % bytes_per_frame != 0 {
        return throw_binding_error(
            &mut cx,
            "INVALID_BUFFER",
            format!(
                "Audio data must contain one or more complete {}-channel frames",
                stream.channels
            ),
            "write",
        );
    }

    let Some(output_tx) = &stream.output_tx else {
        return throw_binding_error(
            &mut cx,
            "UNSUPPORTED_OPERATION",
            "Stream does not accept output data",
            "write",
        );
    };
    Ok(cx.boolean(enqueue_output_buffer(
        output_tx,
        bytes,
        &stream.buffered_bytes,
        &stream.drain_requested,
    )))
}

fn enqueue_output_buffer(
    output_tx: &Sender<Vec<u8>>,
    bytes: Vec<u8>,
    buffered_bytes: &AtomicUsize,
    drain_requested: &AtomicU8,
) -> bool {
    let byte_count = bytes.len();
    buffered_bytes.fetch_add(byte_count, Ordering::AcqRel);
    if output_tx.try_send(bytes).is_ok() {
        true
    } else {
        buffered_bytes.fetch_sub(byte_count, Ordering::AcqRel);
        drain_requested.store(1, Ordering::Release);
        false
    }
}

pub fn pause_stream(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let stream_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let stream = match STREAMS.read().get(stream_id.as_str()) {
        Some(stream) => stream.clone(),
        None => {
            return throw_binding_error(
                &mut cx,
                "STREAM_CLOSED",
                "Stream is closed or does not exist",
                "pause",
            )
        }
    };

    if stream.state.load(Ordering::Acquire) == STATE_PLAYING {
        if let Err(error) = stream.stream.pause() {
            return throw_cpal_error(&mut cx, &error, "pause");
        }
        stream.state.store(STATE_PAUSED, Ordering::Release);
    }
    Ok(cx.undefined())
}

pub fn resume_stream(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let stream_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let stream = match STREAMS.read().get(stream_id.as_str()) {
        Some(stream) => stream.clone(),
        None => {
            return throw_binding_error(
                &mut cx,
                "STREAM_CLOSED",
                "Stream is closed or does not exist",
                "play",
            )
        }
    };

    if stream.state.load(Ordering::Acquire) == STATE_PAUSED {
        if let Err(error) = stream.stream.play() {
            return throw_cpal_error(&mut cx, &error, "play");
        }
        stream.state.store(STATE_PLAYING, Ordering::Release);
    }
    Ok(cx.undefined())
}

pub fn close_stream(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let stream_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let stream = STREAMS.write().remove(stream_id.as_str());
    let Some(stream) = stream else {
        return Ok(cx.undefined());
    };

    let pause_error = if stream.state.load(Ordering::Acquire) == STATE_PLAYING {
        stream.stream.pause().err()
    } else {
        None
    };
    stream.state.store(STATE_CLOSED, Ordering::Release);
    let _ = stream.shutdown_tx.try_send(());
    if let Some(worker) = stream.event_worker.lock().take() {
        let _ = worker.join();
    }

    if let Some(error) = pause_error {
        return throw_cpal_error(&mut cx, &error, "close");
    }
    Ok(cx.undefined())
}

pub fn get_stream_state(mut cx: FunctionContext) -> JsResult<JsString> {
    let stream_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let state = STREAMS
        .read()
        .get(stream_id.as_str())
        .map(|stream| stream.state_name())
        .unwrap_or("closed");
    Ok(cx.string(state))
}

pub fn get_stream_buffer_size(mut cx: FunctionContext) -> JsResult<JsValue> {
    let stream_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let stream = match STREAMS.read().get(stream_id.as_str()) {
        Some(stream) => stream.clone(),
        None => {
            return throw_binding_error(
                &mut cx,
                "STREAM_CLOSED",
                "Stream is closed or does not exist",
                "bufferSize",
            )
        }
    };
    match stream.stream.buffer_size() {
        Ok(frames) => Ok(cx.number(frames as f64).upcast()),
        Err(error) => throw_cpal_error(&mut cx, &error, "bufferSize"),
    }
}

pub fn get_stream_now(mut cx: FunctionContext) -> JsResult<JsBigInt> {
    let stream_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let stream = match STREAMS.read().get(stream_id.as_str()) {
        Some(stream) => stream.clone(),
        None => {
            return throw_binding_error(
                &mut cx,
                "STREAM_CLOSED",
                "Stream is closed or does not exist",
                "now",
            )
        }
    };
    Ok(JsBigInt::from_u128(
        &mut cx,
        stream_instant_to_nanos(stream.stream.now()),
    ))
}

pub fn get_buffered_frames(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let stream_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let stream = match STREAMS.read().get(stream_id.as_str()) {
        Some(stream) => stream.clone(),
        None => return Ok(cx.number(0)),
    };
    let bytes_per_frame = stream.sample_format.sample_size() * stream.channels as usize;
    let frames = stream.buffered_bytes.load(Ordering::Acquire) / bytes_per_frame;
    Ok(cx.number(frames as f64))
}

#[cfg(test)]
mod tests {
    use super::{
        enqueue_output_buffer, fill_silence, try_reserve_event_task, try_send_stream_error,
        uses_audio_task_quota, NativeEvent, OutputBufferState, ERROR_QUEUE_CAPACITY,
    };
    use cpal::SampleFormat;
    use crossbeam_channel::bounded;
    use std::{
        borrow::Cow,
        sync::atomic::{AtomicU32, AtomicU8, AtomicUsize, Ordering},
    };

    #[test]
    fn preserves_prefilled_silence_on_underrun() {
        let (_sender, receiver) = bounded(1);
        let mut state = OutputBufferState::default();
        let mut output = [0x69; 8];
        let (consumed, missing) = state.fill(&mut output, &receiver);
        assert_eq!(consumed, 0);
        assert_eq!(missing, 8);
        assert_eq!(output, [0x69; 8]);
    }

    #[test]
    fn preserves_unconsumed_bytes_between_callbacks() {
        let (sender, receiver) = bounded(1);
        sender.send(vec![1, 2, 3, 4]).unwrap();
        let mut state = OutputBufferState::default();
        let mut first = [0; 2];
        let mut second = [0; 2];
        assert_eq!(state.fill(&mut first, &receiver), (2, 0));
        assert_eq!(state.fill(&mut second, &receiver), (2, 0));
        assert_eq!(first, [1, 2]);
        assert_eq!(second, [3, 4]);
    }

    #[test]
    fn spans_multiple_queued_buffers() {
        let (sender, receiver) = bounded(2);
        sender.send(vec![1, 2]).unwrap();
        sender.send(vec![3, 4]).unwrap();
        let mut state = OutputBufferState::default();
        let mut output = [0; 4];
        assert_eq!(state.fill(&mut output, &receiver), (4, 0));
        assert_eq!(output, [1, 2, 3, 4]);
    }

    #[test]
    fn releases_consumed_buffer_allocation() {
        let (sender, receiver) = bounded(1);
        sender.send(vec![1; 1024 * 1024]).unwrap();
        let mut state = OutputBufferState::default();
        let mut output = vec![0; 1024 * 1024];

        assert_eq!(state.fill(&mut output, &receiver), (output.len(), 0));
        assert_eq!(state.pending_buffer.capacity(), 0);
    }

    #[test]
    fn requests_drain_only_after_a_rejected_write() {
        let (sender, _receiver) = bounded(1);
        let buffered_bytes = AtomicUsize::new(0);
        let drain_requested = AtomicU8::new(0);

        assert!(enqueue_output_buffer(
            &sender,
            vec![1, 2],
            &buffered_bytes,
            &drain_requested,
        ));
        assert_eq!(drain_requested.load(Ordering::Acquire), 0);
        assert!(!enqueue_output_buffer(
            &sender,
            vec![3, 4],
            &buffered_bytes,
            &drain_requested,
        ));
        assert_eq!(drain_requested.load(Ordering::Acquire), 1);
        assert_eq!(buffered_bytes.load(Ordering::Acquire), 2);
    }

    #[test]
    fn reserves_callback_capacity_for_errors_and_drain() {
        let outstanding = AtomicUsize::new(1);
        let data = NativeEvent::Output {
            frames: 1,
            callback_time_ns: 0,
            playback_time_ns: 0,
            underrun_frames: 0,
        };
        let error = NativeEvent::Error {
            code: "STREAM_INVALIDATED",
            message: Cow::Borrowed("invalidated"),
            pending_bit: 1,
        };

        assert!(uses_audio_task_quota(&data));
        assert!(!uses_audio_task_quota(&error));
        assert!(!uses_audio_task_quota(&NativeEvent::Drain));
        assert!(!try_reserve_event_task(&data, &outstanding, 1));
        assert!(try_reserve_event_task(&error, &outstanding, 1));
        assert!(try_reserve_event_task(&NativeEvent::Drain, &outstanding, 1));
        assert_eq!(outstanding.load(Ordering::Acquire), 1);
    }

    #[test]
    fn coalesces_errors_until_their_callback_completes() {
        let (sender, receiver) = bounded(ERROR_QUEUE_CAPACITY);
        let pending = AtomicU32::new(0);

        try_send_stream_error(&sender, &pending, "INPUT_OVERFLOW", Cow::Borrowed("first"));
        try_send_stream_error(&sender, &pending, "INPUT_OVERFLOW", Cow::Borrowed("second"));

        assert_eq!(receiver.len(), 1);
        let NativeEvent::Error { pending_bit, .. } = receiver.recv().unwrap() else {
            panic!("expected an error event");
        };
        pending.fetch_and(!pending_bit, Ordering::AcqRel);
        try_send_stream_error(&sender, &pending, "INPUT_OVERFLOW", Cow::Borrowed("third"));
        assert_eq!(receiver.len(), 1);
    }

    #[test]
    fn fills_unsigned_and_dsd_silence() {
        let mut u16_data = [0; 4];
        fill_silence(&mut u16_data, SampleFormat::U16);
        assert_eq!(&u16_data[..2], &(1u16 << 15).to_ne_bytes());
        assert_eq!(&u16_data[2..], &(1u16 << 15).to_ne_bytes());

        let mut u24_data = [0; 8];
        fill_silence(&mut u24_data, SampleFormat::U24);
        assert_eq!(&u24_data[..4], &(1u32 << 23).to_ne_bytes());
        assert_eq!(&u24_data[4..], &(1u32 << 23).to_ne_bytes());

        let mut dsd_data = [0; 8];
        fill_silence(&mut dsd_data, SampleFormat::DsdU32);
        assert_eq!(dsd_data, [0x69; 8]);
    }

    #[test]
    fn fills_signed_and_float_silence_with_zero() {
        for format in [
            SampleFormat::I8,
            SampleFormat::I16,
            SampleFormat::I24,
            SampleFormat::I32,
            SampleFormat::I64,
            SampleFormat::F32,
            SampleFormat::F64,
        ] {
            let mut data = [0xff; 8];
            fill_silence(&mut data, format);
            assert_eq!(data, [0; 8]);
        }
    }
}
