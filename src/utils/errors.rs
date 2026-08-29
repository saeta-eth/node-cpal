use cpal::{Error, ErrorKind};
use neon::prelude::*;

pub fn error_kind_code(kind: ErrorKind) -> &'static str {
    match kind {
        ErrorKind::DeviceBusy => "DEVICE_BUSY",
        ErrorKind::DeviceChanged => "DEVICE_CHANGED",
        ErrorKind::DeviceNotAvailable => "DEVICE_NOT_AVAILABLE",
        ErrorKind::HostUnavailable => "HOST_UNAVAILABLE",
        ErrorKind::InvalidInput => "INVALID_INPUT",
        ErrorKind::PermissionDenied => "PERMISSION_DENIED",
        ErrorKind::RealtimeDenied => "REALTIME_DENIED",
        ErrorKind::ResourceExhausted => "RESOURCE_EXHAUSTED",
        ErrorKind::StreamInvalidated => "STREAM_INVALIDATED",
        ErrorKind::UnsupportedConfig => "UNSUPPORTED_CONFIG",
        ErrorKind::UnsupportedOperation => "UNSUPPORTED_OPERATION",
        ErrorKind::Xrun => "XRUN",
        ErrorKind::BackendError => "BACKEND_ERROR",
        ErrorKind::Other => "OTHER",
        _ => "OTHER",
    }
}

pub fn throw_cpal_error<'a, T>(
    cx: &mut FunctionContext<'a>,
    error: &Error,
    operation: &'static str,
) -> NeonResult<T> {
    let js_error = cx.error(error.to_string())?;
    let code = cx.string(error_kind_code(error.kind()));
    js_error.set(cx, "code", code)?;
    let message: Handle<JsValue> = match error.message() {
        Some(message) => cx.string(message).upcast(),
        None => cx.null().upcast(),
    };
    js_error.set(cx, "cpalMessage", message)?;
    let operation = cx.string(operation);
    js_error.set(cx, "operation", operation)?;
    cx.throw(js_error)
}

pub fn throw_binding_error<'a, T>(
    cx: &mut FunctionContext<'a>,
    code: &'static str,
    message: impl AsRef<str>,
    operation: &'static str,
) -> NeonResult<T> {
    let js_error = cx.error(message.as_ref())?;
    let code = cx.string(code);
    js_error.set(cx, "code", code)?;
    let operation = cx.string(operation);
    js_error.set(cx, "operation", operation)?;
    cx.throw(js_error)
}
