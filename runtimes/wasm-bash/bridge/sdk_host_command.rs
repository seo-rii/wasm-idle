//! Trusted host-command registry and dispatch for real WASIX guests.
//!
//! JavaScript registers exact normalized absolute paths on a `Runtime`. When
//! a guest execs or spawns a registered path, WASIX hands the prepared child
//! to `HostCommandBridge` on the guest's Worker. The bridge never touches a
//! JavaScript value there: it moves the owned child to the scheduler thread
//! with a `SchedulerMessage`, where the handler registered on that same
//! thread runs. Handler functions never leave their thread-local table.
//!
//! The handler receives owned metadata and the child's descriptors 0, 1 and
//! 2 only. It receives no filesystem capability. Its promise resolves with
//! the child's exit status; any failure completes the child with
//! `HOST_COMMAND_FAILURE_STATUS`.

use std::{
    any::Any,
    cell::RefCell,
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, RwLock,
    },
};

use js_sys::{Array, Function, Object, Promise, Reflect, Uint8Array};
use wasm_bindgen::{prelude::wasm_bindgen, JsCast, JsValue};
use wasm_bindgen_futures::{future_to_promise, JsFuture};
use wasmer::FunctionEnvMut;
use wasmer_wasix::{
    os::{command::VirtualCommand, task::TaskJoinHandle},
    wasmer_wasix_types::wasi::{Errno, ExitCode},
    HostCommandDescriptor, HostCommandProcess, SpawnError, WasiEnv, HOST_COMMAND_FAILURE_STATUS,
    HOST_COMMAND_IO_BYTES,
};

use crate::{js_runtime::JsRuntime, tasks::ThreadPool, utils::Error};

const MAX_PATH_BYTES: usize = 4096;
const MAX_COMMANDS: usize = 1024;

static NEXT_KEY: AtomicU64 = AtomicU64::new(1);

thread_local! {
    static HANDLERS: RefCell<HashMap<u64, Function>> = RefCell::new(HashMap::new());
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Registration {
    key: u64,
    thread: u32,
}

/// Exact path registrations shared by every clone of one SDK `Runtime`.
#[derive(Debug, Default)]
pub(crate) struct HostCommands {
    entries: RwLock<HashMap<String, Registration>>,
}

impl HostCommands {
    /// Metadata-only lookup on the guest's thread. Nothing is fetched or run.
    pub(crate) fn lookup(
        &self,
        pool: &Arc<ThreadPool>,
        path: &str,
    ) -> Option<Arc<dyn VirtualCommand + Send + Sync>> {
        let registration = *self.entries.read().ok()?.get(path)?;
        Some(Arc::new(HostCommandBridge {
            path: path.to_string(),
            registration,
            pool: pool.clone(),
        }))
    }
}

impl Drop for HostCommands {
    fn drop(&mut self) {
        // Handlers registered on another thread are unreachable from here and
        // are released when that thread's table is dropped.
        let thread = wasmer::js::current_thread_id();
        if let Ok(entries) = self.entries.get_mut() {
            let _ = HANDLERS.try_with(|handlers| {
                let mut handlers = handlers.borrow_mut();
                for registration in entries.values().filter(|r| r.thread == thread) {
                    handlers.remove(&registration.key);
                }
            });
        }
    }
}

fn registry_error(message: &str) -> Error {
    Error::Rust(anyhow::anyhow!("{message}"))
}

fn validate_path(path: &str) -> Result<(), Error> {
    let normalized = path.len() > 1
        && path.len() <= MAX_PATH_BYTES
        && path.starts_with('/')
        && !path.contains('\0')
        && path[1..]
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..");
    if normalized {
        Ok(())
    } else {
        Err(registry_error(
            "host command path must be a normalized absolute path",
        ))
    }
}

#[wasm_bindgen(typescript_custom_section)]
const HOST_COMMAND_TYPES: &str = r#"
/**
 * Prepared child metadata and its explicitly delegated descriptors 0, 1 and 2.
 * A descriptor that is closed in the child is `null`. No filesystem access is
 * delegated.
 */
export interface HostCommandInvocation {
    readonly path: string;
    readonly argv: readonly string[];
    /** Raw `name=value` entries, without text decoding. */
    readonly env: readonly Uint8Array[];
    /** The child's actual WASIX cwd, independent of `PWD`. */
    readonly cwd: string;
    readonly stdin: HostCommandDescriptor | null;
    readonly stdout: HostCommandDescriptor | null;
    readonly stderr: HostCommandDescriptor | null;
}

/**
 * Resolve with an integer exit status from 0 to 255. Throwing, rejecting or
 * resolving with anything else completes the child with status 126.
 */
export type HostCommandHandler = (invocation: HostCommandInvocation) => Promise<number>;
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "HostCommandHandler")]
    pub type HostCommandHandler;
}

#[wasm_bindgen(js_class = "Runtime")]
impl JsRuntime {
    /// Route a guest's exec or spawn of exactly `path` to `handler`. The
    /// handler runs on this thread, which must also be the thread that starts
    /// the command using this runtime. Guests must still resolve `path` in
    /// their own filesystem before exec reaches this registry.
    #[wasm_bindgen(js_name = "registerHostCommand")]
    pub fn register_host_command(
        &self,
        path: String,
        handler: HostCommandHandler,
    ) -> Result<(), Error> {
        let handler: Function = handler
            .dyn_into()
            .map_err(|_| registry_error("host command handler must be a function"))?;
        validate_path(&path)?;
        let mut entries = self
            .host_commands()
            .entries
            .write()
            .map_err(|_| registry_error("host command registry is poisoned"))?;
        if entries.contains_key(&path) {
            return Err(registry_error("host command path is already registered"));
        }
        if entries.len() >= MAX_COMMANDS {
            return Err(registry_error("host command registry is full"));
        }
        let registration = Registration {
            key: NEXT_KEY.fetch_add(1, Ordering::Relaxed),
            thread: wasmer::js::current_thread_id(),
        };
        HANDLERS.with(|handlers| handlers.borrow_mut().insert(registration.key, handler));
        entries.insert(path, registration);
        Ok(())
    }

    /// Remove a registration made on this thread. Commands already dispatched
    /// keep running; later lookups fall back to the ordinary resolver.
    #[wasm_bindgen(js_name = "unregisterHostCommand")]
    pub fn unregister_host_command(&self, path: String) -> Result<bool, Error> {
        let mut entries = self
            .host_commands()
            .entries
            .write()
            .map_err(|_| registry_error("host command registry is poisoned"))?;
        let Some(registration) = entries.get(&path).copied() else {
            return Ok(false);
        };
        if registration.thread != wasmer::js::current_thread_id() {
            return Err(registry_error(
                "host command must be unregistered on its registering thread",
            ));
        }
        entries.remove(&path);
        HANDLERS.with(|handlers| handlers.borrow_mut().remove(&registration.key));
        Ok(true)
    }
}

/// The owned child and its registration, moved from the guest's Worker to the
/// scheduler thread. It contains no JavaScript value.
#[derive(Debug)]
pub(crate) struct HostCommandDispatch {
    path: String,
    registration: Registration,
    process: HostCommandProcess,
}

#[derive(Debug)]
struct HostCommandBridge {
    path: String,
    registration: Registration,
    pool: Arc<ThreadPool>,
}

impl VirtualCommand for HostCommandBridge {
    fn name(&self) -> &str {
        &self.path
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn exec(
        &self,
        _parent_ctx: &FunctionEnvMut<'_, WasiEnv>,
        path: &str,
        config: &mut Option<WasiEnv>,
    ) -> Result<TaskJoinHandle, SpawnError> {
        let handle = config
            .as_ref()
            .ok_or(SpawnError::UnknownError)?
            .thread
            .join_handle();
        let process = HostCommandProcess::take(config)?;
        // From here the child is owned and always completes. If delivery fails
        // the dropped child completes with the failure status, so the caller
        // never falls back to executing the file's bytes natively.
        let dispatch = HostCommandDispatch {
            path: path.to_string(),
            registration: self.registration,
            process,
        };
        if let Err(error) = self.pool.dispatch_host_command(dispatch) {
            tracing::warn!(error = &*error, path, "host command dispatch failed");
        }
        Ok(handle)
    }
}

/// Run on the scheduler thread for every dispatched child.
pub(crate) fn start(dispatch: HostCommandDispatch) {
    let HostCommandDispatch {
        path,
        registration,
        process,
    } = dispatch;
    let handler = if registration.thread == wasmer::js::current_thread_id() {
        HANDLERS.with(|handlers| handlers.borrow().get(&registration.key).cloned())
    } else {
        None
    };
    wasm_bindgen_futures::spawn_local(async move {
        let status = match handler {
            Some(handler) => run_handler(&handler, &path, &process).await,
            None => {
                tracing::warn!(path, "no host command handler on the scheduler thread");
                HOST_COMMAND_FAILURE_STATUS
            }
        };
        process.finish(ExitCode::from(status)).await;
    });
}

async fn run_handler(handler: &Function, path: &str, process: &HostCommandProcess) -> i32 {
    let invocation = match invocation(path, process) {
        Ok(invocation) => invocation,
        Err(error) => {
            tracing::warn!(?error, path, "unable to prepare host command invocation");
            return HOST_COMMAND_FAILURE_STATUS;
        }
    };
    let promise = match handler.call1(&JsValue::UNDEFINED, &invocation) {
        Ok(value) => match value.dyn_into::<Promise>() {
            Ok(promise) => promise,
            Err(_) => {
                tracing::warn!(path, "host command handler did not return a promise");
                return HOST_COMMAND_FAILURE_STATUS;
            }
        },
        Err(error) => {
            tracing::warn!(?error, path, "host command handler threw");
            return HOST_COMMAND_FAILURE_STATUS;
        }
    };
    match JsFuture::from(promise).await {
        Ok(value) => match value.as_f64() {
            Some(code) if code.fract() == 0.0 && (0.0..=255.0).contains(&code) => code as i32,
            _ => {
                tracing::warn!(path, "host command handler resolved with an invalid status");
                HOST_COMMAND_FAILURE_STATUS
            }
        },
        Err(error) => {
            tracing::warn!(?error, path, "host command handler rejected");
            HOST_COMMAND_FAILURE_STATUS
        }
    }
}

fn set(object: &Object, name: &str, value: &JsValue) -> Result<(), JsValue> {
    Reflect::set(object, &JsValue::from_str(name), value).map(|_| ())
}

fn invocation(path: &str, process: &HostCommandProcess) -> Result<Object, JsValue> {
    let snapshot = process.snapshot().map_err(errno_error)?;
    let argv: Array = snapshot
        .argv()
        .iter()
        .map(|argument| JsValue::from_str(argument))
        .collect();
    let env: Array = snapshot
        .environment()
        .iter()
        .map(|entry| JsValue::from(Uint8Array::from(entry.as_slice())))
        .collect();
    let invocation = Object::new();
    set(&invocation, "path", &JsValue::from_str(path))?;
    set(&invocation, "argv", &Object::freeze(&argv))?;
    set(&invocation, "env", &Object::freeze(&env))?;
    set(&invocation, "cwd", &JsValue::from_str(snapshot.cwd()))?;
    for (name, fd) in [("stdin", 0), ("stdout", 1), ("stderr", 2)] {
        let descriptor = match process.descriptor(fd) {
            Ok(inner) => JsValue::from(JsHostCommandDescriptor { inner }),
            Err(_) => JsValue::NULL,
        };
        set(&invocation, name, &descriptor)?;
    }
    Ok(Object::freeze(&invocation))
}

fn errno_error(errno: Errno) -> JsValue {
    let code = match errno {
        Errno::Access => "EACCES".to_string(),
        other => format!("E{}", other.name().to_uppercase()),
    };
    let error = js_sys::Error::new(&format!("{code}: {}", errno.message()));
    let _ = Reflect::set(
        &error,
        &JsValue::from_str("code"),
        &JsValue::from_str(&code),
    );
    let _ = Reflect::set(
        &error,
        &JsValue::from_str("errno"),
        &JsValue::from(errno as u32),
    );
    error.into()
}

/// One explicitly delegated descriptor of a running host-command child.
/// Operations fail with `EBADF` after the child completes.
#[wasm_bindgen(js_name = "HostCommandDescriptor")]
pub struct JsHostCommandDescriptor {
    inner: HostCommandDescriptor,
}

#[wasm_bindgen(js_class = "HostCommandDescriptor")]
impl JsHostCommandDescriptor {
    #[wasm_bindgen(getter)]
    pub fn fd(&self) -> u32 {
        self.inner.fd()
    }

    /// Resolve with 1 to `maxBytes` bytes (at most 65,536), or with an empty
    /// array at end of file. `maxBytes` must be positive. Bytes beyond the
    /// request are never consumed from the child's descriptor.
    pub fn read(&self, max_bytes: u32) -> Promise {
        let inner = self.inner.clone();
        future_to_promise(async move {
            let bytes = inner.read(max_bytes as usize).await.map_err(errno_error)?;
            Ok(Uint8Array::from(bytes.as_slice()).into())
        })
    }

    /// Copy at most 65,536 leading bytes now, write them to the child's
    /// descriptor and resolve with the number accepted, which may be fewer.
    pub fn write(&self, bytes: Uint8Array) -> Promise {
        let length = bytes.length().min(HOST_COMMAND_IO_BYTES as u32);
        let data = bytes.subarray(0, length).to_vec();
        let inner = self.inner.clone();
        future_to_promise(async move {
            let written = inner.write(&data).await.map_err(errno_error)?;
            Ok(JsValue::from(written as u32))
        })
    }

    /// Close this descriptor in the child, as the child's own `fd_close` would.
    pub fn close(&self) -> Result<(), JsValue> {
        self.inner.close().map_err(errno_error)
    }
}
