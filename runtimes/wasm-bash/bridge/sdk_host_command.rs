//! Trusted host-command registry and dispatch for real WASIX guests.
//!
//! JavaScript registers exact normalized absolute paths on a `Runtime`, and
//! optionally directories whose WebAssembly modules it executes itself. When
//! a guest execs or spawns a registered path, or a normalized path below a
//! registered directory whose file starts with the Wasm magic, WASIX hands the
//! prepared child to `HostCommandBridge` on the guest's Worker. The bridge never touches a
//! JavaScript value there. It records the child's argv, environment, cwd and
//! open descriptors, moves the child itself to a dedicated service thread, and
//! sends only that owned metadata to the scheduler thread with a
//! `SchedulerMessage`, where the handler registered on that same thread runs.
//! Handler functions never leave their thread-local table.
//!
//! The scheduler thread never touches WASIX state. Guests hold WASIX inode
//! locks while they wait for a live mount that the scheduler thread serves, so
//! that thread must not wait for those locks itself. Descriptor operations and
//! the child's completion are requests to the service thread, answered with
//! another `SchedulerMessage`.
//!
//! The handler receives owned metadata and the child's descriptors 0, 1 and
//! 2 only. It receives no filesystem capability. Its promise resolves with
//! the child's exit status; any failure completes the child with
//! `HOST_COMMAND_FAILURE_STATUS`.

use std::{
    any::Any,
    cell::{Cell, RefCell},
    collections::HashMap,
    pin::Pin,
    rc::Rc,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, RwLock,
    },
    task::{Context, Poll},
};

use futures::{
    channel::mpsc::{unbounded, UnboundedReceiver, UnboundedSender},
    executor::LocalPool,
    task::LocalSpawnExt,
    StreamExt,
};

use js_sys::{Array, Function, Object, Promise, Reflect, Uint8Array};
use wasm_bindgen::{prelude::wasm_bindgen, JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use tokio::io::{AsyncRead, ReadBuf};
use virtual_fs::FileSystem;
use wasmer::FunctionEnvMut;
use wasmer_wasix::{
    os::{command::VirtualCommand, task::TaskJoinHandle},
    runtime::task_manager::VirtualTaskManager,
    wasmer_wasix_types::wasi::{Errno, ExitCode},
    HostCommandProcess, HostCommandSnapshot, SpawnError, WasiEnv, HOST_COMMAND_FAILURE_STATUS,
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

/// Exact path and directory registrations shared by every clone of one SDK
/// `Runtime`.
#[derive(Debug, Default)]
pub(crate) struct HostCommands {
    entries: RwLock<HashMap<String, Registration>>,
    directories: RwLock<HashMap<String, Registration>>,
}

impl HostCommands {
    /// Lookup on the guest's thread. Nothing is fetched or run. An exact
    /// registration wins; otherwise the longest registered directory that
    /// contains `path` is selected, and only normalized paths can match it.
    pub(crate) fn lookup(
        &self,
        pool: &Arc<ThreadPool>,
        path: &str,
    ) -> Option<Arc<dyn VirtualCommand + Send + Sync>> {
        let (registration, wasm_only) = match self.entries.read().ok()?.get(path) {
            Some(registration) => (*registration, false),
            None => {
                validate_path(path).ok()?;
                let directories = self.directories.read().ok()?;
                let registration = directories
                    .iter()
                    .filter(|(directory, _)| {
                        path.len() > directory.len()
                            && path.starts_with(directory.as_str())
                            && path.as_bytes()[directory.len()] == b'/'
                    })
                    .max_by_key(|(directory, _)| directory.len())?
                    .1;
                (*registration, true)
            }
        };
        Some(Arc::new(HostCommandBridge {
            path: path.to_string(),
            registration,
            wasm_only,
            pool: pool.clone(),
        }))
    }
}

impl Drop for HostCommands {
    fn drop(&mut self) {
        // Handlers registered on another thread are unreachable from here and
        // are released when that thread's table is dropped.
        let thread = wasmer::js::current_thread_id();
        for table in [&mut self.entries, &mut self.directories] {
            if let Ok(entries) = table.get_mut() {
                let _ = HANDLERS.try_with(|handlers| {
                    let mut handlers = handlers.borrow_mut();
                    for registration in entries.values().filter(|r| r.thread == thread) {
                        handlers.remove(&registration.key);
                    }
                });
            }
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

fn register(
    table: &RwLock<HashMap<String, Registration>>,
    path: String,
    handler: HostCommandHandler,
) -> Result<(), Error> {
    let handler: Function = handler
        .dyn_into()
        .map_err(|_| registry_error("host command handler must be a function"))?;
    validate_path(&path)?;
    let mut entries = table
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

fn unregister(table: &RwLock<HashMap<String, Registration>>, path: &str) -> Result<bool, Error> {
    let mut entries = table
        .write()
        .map_err(|_| registry_error("host command registry is poisoned"))?;
    let Some(registration) = entries.get(path).copied() else {
        return Ok(false);
    };
    if registration.thread != wasmer::js::current_thread_id() {
        return Err(registry_error(
            "host command must be unregistered on its registering thread",
        ));
    }
    entries.remove(path);
    HANDLERS.with(|handlers| handlers.borrow_mut().remove(&registration.key));
    Ok(true)
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
        register(&self.host_commands().entries, path, handler)
    }

    /// Remove a registration made on this thread. Commands already dispatched
    /// keep running; later lookups fall back to the ordinary resolver.
    #[wasm_bindgen(js_name = "unregisterHostCommand")]
    pub fn unregister_host_command(&self, path: String) -> Result<bool, Error> {
        unregister(&self.host_commands().entries, &path)
    }

    /// Route a guest's exec or spawn of a WebAssembly module below
    /// `directory` to `handler`, with the same thread rule as
    /// `registerHostCommand`. Only a normalized absolute path strictly below
    /// the directory whose first four bytes, read through the guest's own
    /// filesystem, are the Wasm magic is routed. Other files, such as
    /// scripts, and unnormalized paths use the ordinary resolver. An exact
    /// registration and a longer registered directory take precedence.
    #[wasm_bindgen(js_name = "registerHostCommandDirectory")]
    pub fn register_host_command_directory(
        &self,
        directory: String,
        handler: HostCommandHandler,
    ) -> Result<(), Error> {
        register(&self.host_commands().directories, directory, handler)
    }

    /// Remove a directory registration made on this thread.
    #[wasm_bindgen(js_name = "unregisterHostCommandDirectory")]
    pub fn unregister_host_command_directory(&self, directory: String) -> Result<bool, Error> {
        unregister(&self.host_commands().directories, &directory)
    }
}

/// Whether `path` in the guest's filesystem starts with the Wasm magic. Only
/// four bytes are read; a file that cannot be read synchronously does not match.
fn has_wasm_magic(env: &WasiEnv, path: &str) -> bool {
    let Ok(mut file) = env.fs_root().new_open_options().read(true).open(path) else {
        return false;
    };
    let mut magic = [0u8; 4];
    let mut filled = 0;
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);
    while filled < magic.len() {
        let mut buffer = ReadBuf::new(&mut magic[filled..]);
        match Pin::new(&mut file).poll_read(&mut context, &mut buffer) {
            Poll::Ready(Ok(())) if !buffer.filled().is_empty() => filled += buffer.filled().len(),
            _ => return false,
        }
    }
    magic == *b"\0asm"
}

/// Owned metadata of one child, moved from the guest's Worker to the scheduler
/// thread. It contains no JavaScript value and no WASIX state: descriptor
/// operations and completion run on the command's service thread.
#[derive(Debug)]
pub(crate) struct HostCommandDispatch {
    path: String,
    registration: Registration,
    snapshot: HostCommandSnapshot,
    /// Whether descriptors 0, 1 and 2 are open in the child.
    descriptors: [bool; 3],
    requests: UnboundedSender<ServiceRequest>,
}

/// One owner request to a command's service thread.
#[derive(Debug)]
enum ServiceRequest {
    Read { fd: u32, max: usize, key: u64 },
    Write { fd: u32, data: Vec<u8>, key: u64 },
    Close { fd: u32, key: u64 },
    Finish { status: i32 },
}

#[derive(Debug)]
enum ReplyValue {
    Bytes(Vec<u8>),
    Count(usize),
    Unit,
}

/// The result of one descriptor operation, returned to the scheduler thread.
#[derive(Debug)]
pub(crate) struct HostCommandReply {
    key: u64,
    result: Result<ReplyValue, Errno>,
}

#[derive(Debug)]
struct HostCommandBridge {
    path: String,
    registration: Registration,
    /// Set for a directory registration, which only claims Wasm modules.
    wasm_only: bool,
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
        parent_ctx: &FunctionEnvMut<'_, WasiEnv>,
        path: &str,
        config: &mut Option<WasiEnv>,
    ) -> Result<TaskJoinHandle, SpawnError> {
        // Before the child is taken, so a non-module falls back to the
        // ordinary resolver and the guest sees its usual exec result.
        if self.wasm_only && !has_wasm_magic(parent_ctx.data(), path) {
            return Err(SpawnError::BinaryNotFound {
                binary: path.to_string(),
            });
        }
        let handle = config
            .as_ref()
            .ok_or(SpawnError::UnknownError)?
            .thread
            .join_handle();
        let process = HostCommandProcess::take(config)?;
        // From here the child is owned and always completes; if anything below
        // fails, the dropped child completes with the failure status, so the
        // caller never falls back to executing the file's bytes natively.
        //
        // WASIX state is read here, on the guest's own thread, and later on a
        // dedicated service thread, never on the scheduler thread. Guests hold
        // inode locks while they wait for a live mount served by the scheduler
        // thread, so that thread must never wait for those locks itself.
        let snapshot = match process.snapshot() {
            Ok(snapshot) => snapshot,
            Err(errno) => {
                tracing::warn!(%errno, path, "host command snapshot failed");
                return Ok(handle);
            }
        };
        let descriptors = [0, 1, 2].map(|fd| process.descriptor(fd).is_ok());
        let (requests, receiver) = unbounded();
        let pool = self.pool.clone();
        let service = Box::new(move || serve(process, receiver, pool));
        if let Err(error) = self.pool.task_dedicated(service) {
            tracing::warn!(?error, path, "host command service could not start");
            return Ok(handle);
        }
        let dispatch = HostCommandDispatch {
            path: path.to_string(),
            registration: self.registration,
            snapshot,
            descriptors,
            requests,
        };
        if let Err(error) = self.pool.dispatch_host_command(dispatch) {
            // The dropped request channel completes the child with the failure status.
            tracing::warn!(error = &*error, path, "host command dispatch failed");
        }
        Ok(handle)
    }
}

/// The command's service thread: performs descriptor operations and the final
/// completion of the child, all of which may wait for WASIX locks. Reads can
/// wait for data, so each runs as its own task; writes and closes keep their
/// order. A dropped request channel completes the child with the failure status.
fn serve(process: HostCommandProcess, mut requests: UnboundedReceiver<ServiceRequest>, pool: Arc<ThreadPool>) {
    let mut executor = LocalPool::new();
    let spawner = executor.spawner();
    executor.run_until(async move {
        let reply = |pool: &Arc<ThreadPool>, key: u64, result: Result<ReplyValue, Errno>| {
            if let Err(error) = pool.host_command_reply(HostCommandReply { key, result }) {
                tracing::warn!(error = &*error, key, "host command reply could not be delivered");
            }
        };
        while let Some(request) = requests.next().await {
            match request {
                ServiceRequest::Finish { status } => {
                    process.finish(ExitCode::from(status)).await;
                    return;
                }
                ServiceRequest::Read { fd, max, key } => {
                    let descriptor = process.descriptor(fd);
                    let pool = pool.clone();
                    let task = async move {
                        let result = match descriptor {
                            Ok(descriptor) => descriptor.read(max).await.map(ReplyValue::Bytes),
                            Err(errno) => Err(errno),
                        };
                        reply(&pool, key, result);
                    };
                    if spawner.spawn_local(task).is_err() {
                        reply(&pool, key, Err(Errno::Io));
                    }
                }
                ServiceRequest::Write { fd, data, key } => {
                    let result = match process.descriptor(fd) {
                        Ok(descriptor) => descriptor.write(&data).await.map(ReplyValue::Count),
                        Err(errno) => Err(errno),
                    };
                    reply(&pool, key, result);
                }
                ServiceRequest::Close { fd, key } => {
                    let result = process.descriptor(fd).and_then(|descriptor| descriptor.close());
                    if key != 0 {
                        reply(&pool, key, result.map(|()| ReplyValue::Unit));
                    }
                }
            }
        }
        drop(process);
    });
}

type Settlers = (Function, Function);

thread_local! {
    /// Pending descriptor promises on the scheduler thread, by request key.
    static PENDING: RefCell<HashMap<u64, Settlers>> = RefCell::new(HashMap::new());
}

/// The scheduler thread's handle to one running command.
struct CommandLink {
    requests: UnboundedSender<ServiceRequest>,
    keys: RefCell<Vec<u64>>,
    finished: Cell<bool>,
}

impl CommandLink {
    fn request(&self, make: impl FnOnce(u64) -> ServiceRequest) -> Promise {
        let key = NEXT_KEY.fetch_add(1, Ordering::Relaxed);
        let mut settlers = None;
        let promise = Promise::new(&mut |resolve, reject| settlers = Some((resolve, reject)));
        let (resolve, reject) = settlers.expect("Promise executor runs synchronously");
        if self.finished.get() || self.requests.unbounded_send(make(key)).is_err() {
            let _ = reject.call1(&JsValue::UNDEFINED, &errno_error(Errno::Badf));
            return promise;
        }
        PENDING.with(|pending| pending.borrow_mut().insert(key, (resolve, reject)));
        self.keys.borrow_mut().push(key);
        promise
    }

    /// Revoke the handler's endpoints and complete the child on its service thread.
    fn finish(&self, status: i32) {
        self.finished.set(true);
        PENDING.with(|pending| {
            let mut pending = pending.borrow_mut();
            for key in self.keys.borrow_mut().drain(..) {
                if let Some((_, reject)) = pending.remove(&key) {
                    let _ = reject.call1(&JsValue::UNDEFINED, &errno_error(Errno::Badf));
                }
            }
        });
        if self.requests.unbounded_send(ServiceRequest::Finish { status }).is_err() {
            tracing::warn!(status, "host command service already stopped");
        }
    }
}

/// Run on the scheduler thread for every dispatched child.
pub(crate) fn start(dispatch: HostCommandDispatch) {
    let HostCommandDispatch {
        path,
        registration,
        snapshot,
        descriptors,
        requests,
    } = dispatch;
    let handler = if registration.thread == wasmer::js::current_thread_id() {
        HANDLERS.with(|handlers| handlers.borrow().get(&registration.key).cloned())
    } else {
        None
    };
    let link = Rc::new(CommandLink {
        requests,
        keys: RefCell::new(Vec::new()),
        finished: Cell::new(false),
    });
    wasm_bindgen_futures::spawn_local(async move {
        let status = match handler {
            Some(handler) => run_handler(&handler, &path, &snapshot, descriptors, &link).await,
            None => {
                tracing::warn!(path, "no host command handler on the scheduler thread");
                HOST_COMMAND_FAILURE_STATUS
            }
        };
        link.finish(status);
    });
}

/// Settle one pending descriptor promise on the scheduler thread.
pub(crate) fn complete(reply: HostCommandReply) {
    let HostCommandReply { key, result } = reply;
    let Some((resolve, reject)) = PENDING.with(|pending| pending.borrow_mut().remove(&key)) else {
        return;
    };
    let _ = match result {
        Ok(ReplyValue::Bytes(bytes)) => resolve.call1(&JsValue::UNDEFINED, &Uint8Array::from(bytes.as_slice()).into()),
        Ok(ReplyValue::Count(count)) => resolve.call1(&JsValue::UNDEFINED, &JsValue::from(count as u32)),
        Ok(ReplyValue::Unit) => resolve.call1(&JsValue::UNDEFINED, &JsValue::UNDEFINED),
        Err(errno) => reject.call1(&JsValue::UNDEFINED, &errno_error(errno)),
    };
}

async fn run_handler(
    handler: &Function,
    path: &str,
    snapshot: &HostCommandSnapshot,
    descriptors: [bool; 3],
    link: &Rc<CommandLink>,
) -> i32 {
    let invocation = match invocation(path, snapshot, descriptors, link) {
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

fn invocation(
    path: &str,
    snapshot: &HostCommandSnapshot,
    descriptors: [bool; 3],
    link: &Rc<CommandLink>,
) -> Result<Object, JsValue> {
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
    for (name, fd) in [("stdin", 0u32), ("stdout", 1), ("stderr", 2)] {
        let descriptor = if descriptors[fd as usize] {
            JsValue::from(JsHostCommandDescriptor {
                fd,
                link: link.clone(),
            })
        } else {
            JsValue::NULL
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
    fd: u32,
    link: Rc<CommandLink>,
}

#[wasm_bindgen(js_class = "HostCommandDescriptor")]
impl JsHostCommandDescriptor {
    #[wasm_bindgen(getter)]
    pub fn fd(&self) -> u32 {
        self.fd
    }

    /// Resolve with 1 to `maxBytes` bytes (at most 65,536), or with an empty
    /// array at end of file. `maxBytes` must be positive. Bytes beyond the
    /// request are never consumed from the child's descriptor.
    pub fn read(&self, max_bytes: u32) -> Promise {
        let fd = self.fd;
        self.link.request(|key| ServiceRequest::Read {
            fd,
            max: max_bytes as usize,
            key,
        })
    }

    /// Copy at most 65,536 leading bytes now, write them to the child's
    /// descriptor and resolve with the number accepted, which may be fewer.
    pub fn write(&self, bytes: Uint8Array) -> Promise {
        let length = bytes.length().min(HOST_COMMAND_IO_BYTES as u32);
        let data = bytes.subarray(0, length).to_vec();
        let fd = self.fd;
        self.link.request(|key| ServiceRequest::Write { fd, data, key })
    }

    /// Close this descriptor in the child, as its own `fd_close` would. The
    /// close runs after this command's earlier writes on its service thread;
    /// like a close after process exit, its outcome is not reported.
    pub fn close(&self) {
        if !self.link.finished.get() {
            let _ = self.link.requests.unbounded_send(ServiceRequest::Close { fd: self.fd, key: 0 });
        }
    }
}
