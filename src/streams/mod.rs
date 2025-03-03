use cpal::{
    traits::{DeviceTrait, StreamTrait},
    Stream, StreamConfig,
};
use crossbeam_channel::{bounded, Sender};
use neon::prelude::*;
use neon::types::buffer::TypedArray;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use std::{collections::HashMap, sync::Arc, thread, sync::atomic::{AtomicBool, Ordering}};

use crate::{
    devices::get_device,
    utils::types::StreamId,
};

struct StreamWrapper {
    stream: Stream,
    is_active: Arc<AtomicBool>,
    output_tx: Option<Sender<Vec<f32>>>,
}

// The Stream type from cpal contains non-Send/Sync types internally,
// but we know it's safe to use across threads in this context
unsafe impl Send for StreamWrapper {}
unsafe impl Sync for StreamWrapper {}

static STREAMS: Lazy<RwLock<HashMap<StreamId, Arc<StreamWrapper>>>> = Lazy::new(|| RwLock::new(HashMap::new()));

pub struct AudioCallback {
    channel_tx: Option<Sender<Vec<f32>>>,
}

pub fn create_stream(mut cx: FunctionContext) -> JsResult<JsString> {
    let device_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let is_input = cx.argument::<JsBoolean>(1)?.value(&mut cx);
    let config = cx.argument::<JsObject>(2)?;
    let js_callback = Arc::new(cx.argument::<JsFunction>(3)?.root(&mut cx));

    let device = match get_device(device_id) {
        Some(device) => device,
        None => return cx.throw_error("Device not found"),
    };

    let channels = config.get::<JsNumber, _, _>(&mut cx, "channels")?.value(&mut cx) as u16;
    let sample_rate = config.get::<JsNumber, _, _>(&mut cx, "sampleRate")?.value(&mut cx) as u32;

    let stream_config = StreamConfig {
        channels,
        sample_rate: cpal::SampleRate(sample_rate),
        buffer_size: cpal::BufferSize::Default,
    };

    let stream_id = uuid::Uuid::new_v4().to_string();
    let is_active = Arc::new(AtomicBool::new(true));

    if is_input {
        let (tx, rx) = bounded::<Vec<f32>>(32);
        let callback = AudioCallback {
            channel_tx: Some(tx),
        };

        let input_callback = move |data: &[f32], _: &cpal::InputCallbackInfo| {
            if let Some(tx) = &callback.channel_tx {
                let _ = tx.try_send(data.to_vec());
            }
        };

        let stream = match device.build_input_stream(&stream_config, input_callback, err_fn, None) {
            Ok(stream) => stream,
            Err(e) => return cx.throw_error(format!("Failed to build input stream: {}", e)),
        };

        stream.play().unwrap();
        let stream_wrapper = Arc::new(StreamWrapper { 
            stream, 
            is_active: is_active.clone(),
            output_tx: None,
        });
        STREAMS.write().insert(stream_id.clone(), stream_wrapper);

        let channel = cx.channel();
        let js_callback = js_callback.clone();
        thread::spawn(move || {
            while let Ok(data) = rx.recv() {
                let js_callback = js_callback.clone();
                channel.send(move |mut cx| {
                    let mut array = JsTypedArray::<f32>::new(&mut cx, data.len())?;
                    array.as_mut_slice(&mut cx).copy_from_slice(&data);

                    let this = cx.undefined();
                    let args = vec![array.upcast()];
                    let callback = js_callback.to_inner(&mut cx);
                    callback.call(&mut cx, this, args)?;

                    Ok(())
                });
            }
        });

        Ok(cx.string(stream_id))
    } else {
        // For output streams, create a channel to send audio data
        let (tx, rx) = bounded::<Vec<f32>>(32);
        let rx = Arc::new(parking_lot::Mutex::new(rx));
        
        let output_callback = move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
            // Try to get data from the channel
            if let Ok(buffer) = rx.lock().try_recv() {
                // Copy as much data as possible from the buffer to the output
                let len = std::cmp::min(data.len(), buffer.len());
                data[..len].copy_from_slice(&buffer[..len]);
                
                // Fill the rest with silence if needed
                if len < data.len() {
                    for sample in &mut data[len..] {
                        *sample = 0.0;
                    }
                }
            } else {
                // If no data is available, fill with silence
                for sample in data.iter_mut() {
                    *sample = 0.0;
                }
            }
        };

        match device.build_output_stream(&stream_config, output_callback, err_fn, None) {
            Ok(stream) => {
                stream.play().unwrap();
                let stream_wrapper = Arc::new(StreamWrapper { 
                    stream, 
                    is_active: is_active.clone(),
                    output_tx: Some(tx),
                });
                STREAMS.write().insert(stream_id.clone(), stream_wrapper);
                
                Ok(cx.string(stream_id))
            },
            Err(e) => cx.throw_error(format!("Failed to build output stream: {}", e)),
        }
    }
}

pub fn write_to_stream(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let stream_id = cx.argument::<JsString>(0)?.value(&mut cx);
    let mut data = cx.argument::<JsTypedArray<f32>>(1)?;

    // Check if the buffer is empty
    let data_slice = data.as_mut_slice(&mut cx);
    if data_slice.is_empty() {
        return cx.throw_error("Invalid buffer size: buffer cannot be empty");
    }

    let stream = match STREAMS.read().get(stream_id.as_str()) {
        Some(stream) => stream.clone(),
        None => return cx.throw_error("Stream not found"),
    };

    if !stream.is_active.load(Ordering::SeqCst) {
        return cx.throw_error("Stream is not active");
    }

    // Write data to the stream through the channel
    if let Some(tx) = &stream.output_tx {
        // Clone the data to send it through the channel
        let data_vec = data_slice.to_vec();
        
        // Try to send the data, but don't block if the channel is full
        match tx.try_send(data_vec) {
            Ok(_) => Ok(cx.undefined()),
            Err(_) => cx.throw_error("Failed to write to stream: buffer full"),
        }
    } else {
        cx.throw_error("Cannot write to an input stream")
    }
}

pub fn pause_stream(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let stream_id = cx.argument::<JsString>(0)?.value(&mut cx);

    let streams = STREAMS.read();
    let stream = match streams.get(stream_id.as_str()) {
        Some(stream) => stream.clone(),
        None => return cx.throw_error("Stream not found"),
    };

    if stream.is_active.load(Ordering::SeqCst) {
        stream.stream.pause().unwrap_or_else(|_| {
            // Ignore errors when pausing
        });
        stream.is_active.store(false, Ordering::SeqCst);
    }

    Ok(cx.undefined())
}

pub fn resume_stream(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let stream_id = cx.argument::<JsString>(0)?.value(&mut cx);

    let streams = STREAMS.read();
    let stream = match streams.get(stream_id.as_str()) {
        Some(stream) => stream.clone(),
        None => return cx.throw_error("Stream not found"),
    };

    if !stream.is_active.load(Ordering::SeqCst) {
        stream.stream.play().unwrap_or_else(|_| {
            // Ignore errors when resuming
        });
        stream.is_active.store(true, Ordering::SeqCst);
    }

    Ok(cx.undefined())
}

pub fn close_stream(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let stream_id = cx.argument::<JsString>(0)?.value(&mut cx);

    let mut streams = STREAMS.write();
    streams.remove(stream_id.as_str());

    Ok(cx.undefined())
}

pub fn is_stream_active(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let stream_id = cx.argument::<JsString>(0)?.value(&mut cx);

    let streams = STREAMS.read();
    let is_active = match streams.get(stream_id.as_str()) {
        Some(stream) => stream.is_active.load(Ordering::SeqCst),
        None => false,
    };

    Ok(cx.boolean(is_active))
}

fn err_fn(err: cpal::StreamError) {
    eprintln!("an error occurred on stream: {}", err);
} 