use cpal::{
    traits::{DeviceTrait, StreamTrait},
    Stream, StreamConfig,
};
use crossbeam_channel::{bounded, Receiver, Sender};
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

static STREAMS: Lazy<RwLock<HashMap<StreamId, Arc<StreamWrapper>>>> = Lazy::new(|| RwLock::new(HashMap::new()));

pub struct AudioCallback {
    channel_tx: Option<Sender<Vec<f32>>>,
}

#[derive(Default)]
struct OutputBufferState {
    pending_buffer: Vec<f32>,
    pending_offset: usize,
}

impl OutputBufferState {
    fn fill(&mut self, data: &mut [f32], receiver: &Receiver<Vec<f32>>) {
        data.fill(0.0);
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

            let sample_count = std::cmp::min(
                data.len() - data_offset,
                self.pending_buffer.len() - self.pending_offset,
            );
            data[data_offset..data_offset + sample_count].copy_from_slice(
                &self.pending_buffer[self.pending_offset..self.pending_offset + sample_count],
            );
            data_offset += sample_count;
            self.pending_offset += sample_count;
        }

        if self.pending_offset >= self.pending_buffer.len() {
            self.pending_buffer = Vec::new();
            self.pending_offset = 0;
        }
    }
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
        sample_rate,
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

        let stream = match device.build_input_stream(stream_config, input_callback, err_fn, None) {
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
        let mut output_buffer = OutputBufferState::default();
        
        let output_callback = move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
            output_buffer.fill(data, &rx);
        };

        match device.build_output_stream(stream_config, output_callback, err_fn, None) {
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

fn err_fn(err: cpal::Error) {
    eprintln!("an error occurred on stream: {}", err);
}

#[cfg(test)]
mod tests {
    use super::OutputBufferState;
    use crossbeam_channel::bounded;

    #[test]
    fn releases_exhausted_buffer_when_queue_is_idle() {
        let (sender, receiver) = bounded(1);
        sender.send(vec![1.0; 4096]).unwrap();

        let mut output_buffer = OutputBufferState::default();
        let mut output = vec![0.0; 4096];
        output_buffer.fill(&mut output, &receiver);

        assert_eq!(output, vec![1.0; 4096]);
        assert_eq!(output_buffer.pending_buffer.capacity(), 0);
        assert_eq!(output_buffer.pending_offset, 0);

        let mut idle_output = [1.0; 32];
        output_buffer.fill(&mut idle_output, &receiver);

        assert_eq!(idle_output, [0.0; 32]);
        assert_eq!(output_buffer.pending_buffer.capacity(), 0);
        assert_eq!(output_buffer.pending_offset, 0);
    }

    #[test]
    fn preserves_unconsumed_samples_between_callbacks() {
        let (sender, receiver) = bounded(1);
        sender.send(vec![1.0, 2.0, 3.0, 4.0]).unwrap();

        let mut output_buffer = OutputBufferState::default();
        let mut first_output = [0.0; 2];
        output_buffer.fill(&mut first_output, &receiver);

        assert_eq!(first_output, [1.0, 2.0]);
        assert_eq!(output_buffer.pending_offset, 2);

        let mut second_output = [0.0; 2];
        output_buffer.fill(&mut second_output, &receiver);

        assert_eq!(second_output, [3.0, 4.0]);
        assert_eq!(output_buffer.pending_buffer.capacity(), 0);
        assert_eq!(output_buffer.pending_offset, 0);
    }

    #[test]
    fn drains_multiple_queued_buffers_in_order() {
        let (sender, receiver) = bounded(2);
        sender.send(vec![1.0, 2.0]).unwrap();
        sender.send(vec![3.0, 4.0]).unwrap();

        let mut output_buffer = OutputBufferState::default();
        let mut output = [0.0; 4];
        output_buffer.fill(&mut output, &receiver);

        assert_eq!(output, [1.0, 2.0, 3.0, 4.0]);
        assert_eq!(output_buffer.pending_buffer.capacity(), 0);
        assert_eq!(output_buffer.pending_offset, 0);
    }

    #[test]
    fn zero_fills_output_after_queued_data_is_exhausted() {
        let (sender, receiver) = bounded(1);
        sender.send(vec![1.0, 2.0]).unwrap();

        let mut output_buffer = OutputBufferState::default();
        let mut output = [-1.0; 4];
        output_buffer.fill(&mut output, &receiver);

        assert_eq!(output, [1.0, 2.0, 0.0, 0.0]);
        assert_eq!(output_buffer.pending_buffer.capacity(), 0);
        assert_eq!(output_buffer.pending_offset, 0);
    }

    #[test]
    fn continues_pending_data_before_the_next_queued_buffer() {
        let (sender, receiver) = bounded(2);
        sender.send(vec![1.0, 2.0, 3.0]).unwrap();
        sender.send(vec![4.0, 5.0]).unwrap();

        let mut output_buffer = OutputBufferState::default();
        let mut first_output = [0.0; 2];
        output_buffer.fill(&mut first_output, &receiver);
        let mut second_output = [0.0; 3];
        output_buffer.fill(&mut second_output, &receiver);

        assert_eq!(first_output, [1.0, 2.0]);
        assert_eq!(second_output, [3.0, 4.0, 5.0]);
        assert_eq!(output_buffer.pending_buffer.capacity(), 0);
        assert_eq!(output_buffer.pending_offset, 0);
    }

    #[test]
    fn skips_empty_queued_buffers() {
        let (sender, receiver) = bounded(2);
        sender.send(Vec::new()).unwrap();
        sender.send(vec![7.0, 8.0]).unwrap();

        let mut output_buffer = OutputBufferState::default();
        let mut output = [0.0; 2];
        output_buffer.fill(&mut output, &receiver);

        assert_eq!(output, [7.0, 8.0]);
        assert_eq!(output_buffer.pending_buffer.capacity(), 0);
        assert_eq!(output_buffer.pending_offset, 0);
    }
}
