//! Explicit resource delegation for a trusted host command.
//!
//! `HostCommandProcess` takes ownership of the prepared child `WasiEnv` that
//! `VirtualCommand::exec` receives. Its owner reads immutable metadata and
//! obtains byte endpoints only for descriptors it names explicitly. No
//! filesystem capability, guest memory view or JavaScript value is exposed.
//! The child completes exactly once: through `finish`, or through the
//! synchronous failure path when the owner is dropped first.
//!
//! Descriptor operations look up the child's descriptor table on every call,
//! like the corresponding syscalls, and hold no inode between calls. Pending
//! operations are cancelled when the child finishes, so a released endpoint
//! cannot keep a WASIX pipe open after the child's descriptors are closed.

use std::{
    collections::HashMap,
    future::Future,
    io::SeekFrom,
    ops::Deref,
    sync::{atomic::Ordering, Arc, Mutex, RwLock},
};

use futures::future::select;
use virtual_fs::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, VirtualFile};
use wasmer_wasix_types::wasi::{Errno, ExitCode, Fd as WasiFd, Fdflags, Rights, Signal};

use crate::{
    fs::Kind, os::task::TaskJoinHandle, state::WasiState, utils::map_io_err, HostCommandSnapshot,
    SpawnError, WasiEnv,
};

/// Largest single delegated read or write.
pub const HOST_COMMAND_IO_BYTES: usize = 64 * 1024;

/// Exit status of a child whose trusted owner failed to start, failed during
/// execution, returned an invalid status or abandoned it.
pub const HOST_COMMAND_FAILURE_STATUS: i32 = 126;

type FileHandle = Arc<RwLock<Box<dyn VirtualFile + Send + Sync + 'static>>>;

struct Control {
    revoked: tokio::sync::watch::Sender<bool>,
    // Serializes this owner's operations on one shared file handle. Distinct
    // handles (for example separate stdin and stdout pipes) never wait on each other.
    files: Mutex<HashMap<usize, Arc<tokio::sync::Mutex<()>>>>,
    closed: Mutex<HashMap<WasiFd, tokio::sync::watch::Sender<bool>>>,
}

impl Control {
    fn new() -> Self {
        Control {
            revoked: tokio::sync::watch::Sender::new(false),
            files: Mutex::new(HashMap::new()),
            closed: Mutex::new(HashMap::new()),
        }
    }

    fn revoke(&self) {
        self.revoked.send_replace(true);
        if let Ok(mut files) = self.files.lock() {
            files.clear();
        }
    }

    fn file_lock(&self, handle: &FileHandle) -> Result<Arc<tokio::sync::Mutex<()>>, Errno> {
        let key = Arc::as_ptr(handle) as *const () as usize;
        let mut files = self.files.lock().map_err(|_| Errno::Io)?;
        Ok(files.entry(key).or_default().clone())
    }

    fn close_state(&self, fd: WasiFd) -> Result<tokio::sync::watch::Sender<bool>, Errno> {
        let mut closed = self.closed.lock().map_err(|_| Errno::Io)?;
        Ok(closed
            .entry(fd)
            .or_insert_with(|| tokio::sync::watch::Sender::new(false))
            .clone())
    }

    fn close(&self, fd: WasiFd) -> Result<(), Errno> {
        let closed = self.close_state(fd)?;
        if *closed.borrow() {
            return Err(Errno::Badf);
        }
        closed.send_replace(true);
        Ok(())
    }

    async fn run<T>(
        &self,
        fd: WasiFd,
        operation: impl Future<Output = Result<T, Errno>>,
    ) -> Result<T, Errno> {
        let local = self.close_state(fd)?;
        let mut revoked = self.revoked.subscribe();
        let mut closed = local.subscribe();
        let mut cancelled = Box::pin(async move {
            let global = Box::pin(revoked.wait_for(|value| *value));
            let descriptor = Box::pin(closed.wait_for(|value| *value));
            let _ = select(global, descriptor).await;
        });
        let mut operation = Box::pin(operation);
        futures::future::poll_fn(|cx| {
            // Check cancellation before polling a now-writable endpoint. This
            // prevents a ready write from winning a concurrent close/revoke.
            if *self.revoked.borrow() || *local.borrow() || cancelled.as_mut().poll(cx).is_ready() {
                return std::task::Poll::Ready(Err(Errno::Badf));
            }
            operation.as_mut().poll(cx)
        })
        .await
    }
}

/// Prepared child owned by a trusted host command until it finishes.
pub struct HostCommandProcess {
    env: Option<WasiEnv>,
    control: Arc<Control>,
}

impl std::fmt::Debug for HostCommandProcess {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HostCommandProcess")
            .field("pid", &self.env.as_ref().map(|env| env.pid().raw()))
            .finish()
    }
}

impl HostCommandProcess {
    /// Take the prepared child that `VirtualCommand::exec` received. Both exec
    /// branches and spawn have already applied argv, environment, cwd and fd
    /// actions to it. The caller's builder is left empty.
    pub fn take(config: &mut Option<WasiEnv>) -> Result<Self, SpawnError> {
        let env = config.take().ok_or(SpawnError::UnknownError)?;
        env.thread.set_status_running();
        Ok(HostCommandProcess {
            env: Some(env),
            control: Arc::new(Control::new()),
        })
    }

    fn env(&self) -> Result<&WasiEnv, Errno> {
        self.env.as_ref().ok_or(Errno::Badf)
    }

    /// Owned argv, raw environment bytes and actual cwd of this child.
    pub fn snapshot(&self) -> Result<HostCommandSnapshot, Errno> {
        self.env()?.host_command_snapshot()
    }

    /// The join handle observed by the exec/spawn caller.
    pub fn join_handle(&self) -> Result<TaskJoinHandle, Errno> {
        Ok(self.env()?.thread.join_handle())
    }

    /// Delegate one descriptor that is currently open in the child.
    pub fn descriptor(&self, fd: WasiFd) -> Result<HostCommandDescriptor, Errno> {
        let env = self.env()?;
        env.state.fs.get_fd(fd)?;
        Ok(HostCommandDescriptor {
            state: env.state.clone(),
            fd,
            control: self.control.clone(),
        })
    }

    /// Complete the child once: revoke endpoints, close its descriptors the
    /// same way process exit does, then publish the exit status.
    pub async fn finish(mut self, code: ExitCode) {
        let Some(env) = self.env.take() else {
            return;
        };
        self.control.revoke();
        if !env.disable_fs_cleanup {
            env.state.fs.close_all().await;
        }
        // Publish the status before signalling. A forked child's guest thread can
        // still be waiting in exec; if it handled SIGQUIT first, the signal's
        // default status 0 would become the process status, which is set once.
        env.process.terminate(code);
        env.thread.set_status_finished(Ok(code));
        if !env.disable_fs_cleanup {
            env.process.signal_process(Signal::Sigquit);
        }
    }
}

impl Drop for HostCommandProcess {
    fn drop(&mut self) {
        let Some(env) = self.env.take() else {
            return;
        };
        self.control.revoke();
        let fds: Vec<WasiFd> = match env.state.fs.fd_map.read() {
            Ok(map) => map.keys().collect(),
            Err(_) => Vec::new(),
        };
        for fd in fds {
            env.state.fs.close_fd(fd).ok();
        }
        let code = ExitCode::from(HOST_COMMAND_FAILURE_STATUS);
        env.process.terminate(code);
        env.thread.set_status_finished(Ok(code));
    }
}

/// One explicitly delegated descriptor of a host-command child. Reads and
/// writes follow the child's descriptor rights, shared offset and append flag.
#[derive(Clone)]
pub struct HostCommandDescriptor {
    state: Arc<WasiState>,
    fd: WasiFd,
    control: Arc<Control>,
}

impl std::fmt::Debug for HostCommandDescriptor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HostCommandDescriptor")
            .field("fd", &self.fd)
            .finish()
    }
}

enum Endpoint {
    File(FileHandle),
    PipeRx(virtual_fs::PipeRx),
    Duplex(virtual_fs::Pipe),
}

enum WriteTarget {
    /// A file handle, and whether it belongs to a live mount.
    File(FileHandle, bool),
    PipeTx(virtual_fs::PipeTx),
    Duplex(virtual_fs::Pipe),
}

impl HostCommandDescriptor {
    pub fn fd(&self) -> WasiFd {
        self.fd
    }

    /// Read at most `HOST_COMMAND_IO_BYTES`. An empty result is end of file,
    /// so a zero-length request is rejected instead of consuming nothing.
    /// The descriptor's nonblocking flag is not emulated; the read waits.
    pub async fn read(&self, max: usize) -> Result<Vec<u8>, Errno> {
        if max == 0 {
            return Err(Errno::Inval);
        }
        let max = max.min(HOST_COMMAND_IO_BYTES);
        self.control.run(self.fd, self.read_inner(max)).await
    }

    async fn read_inner(&self, max: usize) -> Result<Vec<u8>, Errno> {
        let fd_entry = self.state.fs.get_fd(self.fd)?;
        let is_stdio = fd_entry.is_stdio;
        if !is_stdio && !fd_entry.inner.rights.contains(Rights::FD_READ) {
            return Err(Errno::Access);
        }
        let endpoint = {
            let guard = fd_entry.inode.read();
            match guard.deref() {
                Kind::File {
                    handle: Some(handle),
                    ..
                } => Endpoint::File(handle.clone()),
                Kind::File { handle: None, .. } => return Err(Errno::Inval),
                Kind::PipeRx { rx } => Endpoint::PipeRx(rx.clone()),
                Kind::DuplexPipe { pipe } => Endpoint::Duplex(pipe.clone()),
                Kind::PipeTx { .. } => return Err(Errno::Badf),
                Kind::Dir { .. } | Kind::Root { .. } => return Err(Errno::Isdir),
                _ => return Err(Errno::Notsup),
            }
        };
        let mut buffer = vec![0u8; max];
        let read = match endpoint {
            Endpoint::File(handle) => {
                let serial = self.control.file_lock(&handle)?;
                let _serial = serial.lock().await;
                let mut handle = handle.write().map_err(|_| Errno::Fault)?;
                if !is_stdio {
                    let offset = fd_entry.inner.offset.load(Ordering::Acquire);
                    handle
                        .seek(SeekFrom::Start(offset))
                        .await
                        .map_err(map_io_err)?;
                }
                let read = handle
                    .read(&mut buffer)
                    .await
                    .map_err(|err| match map_io_err(err) {
                        Errno::Again if is_stdio => Errno::Badf,
                        errno => errno,
                    })?;
                if !is_stdio {
                    fd_entry
                        .inner
                        .offset
                        .fetch_add(read as u64, Ordering::AcqRel);
                }
                read
            }
            Endpoint::PipeRx(mut rx) => rx.read(&mut buffer).await.map_err(map_io_err)?,
            Endpoint::Duplex(mut pipe) => pipe.read(&mut buffer).await.map_err(map_io_err)?,
        };
        buffer.truncate(read);
        Ok(buffer)
    }

    /// Write at most `HOST_COMMAND_IO_BYTES` and return the accepted count.
    /// A closed reader yields `Errno::Pipe`; no signal is raised in the child.
    /// A zero-length write only validates the descriptor: an empty WASIX pipe
    /// message would otherwise be observed as end of file by the reader.
    pub async fn write(&self, data: &[u8]) -> Result<usize, Errno> {
        let data = &data[..data.len().min(HOST_COMMAND_IO_BYTES)];
        self.control
            .run(self.fd, async {
                if data.is_empty() {
                    self.state.fs.get_fd(self.fd)?;
                    return Ok(0);
                }
                self.write_inner(data).await
            })
            .await
    }

    async fn write_inner(&self, data: &[u8]) -> Result<usize, Errno> {
        let fd_entry = self.state.fs.get_fd(self.fd)?;
        let is_stdio = fd_entry.is_stdio;
        if !is_stdio && !fd_entry.inner.rights.contains(Rights::FD_WRITE) {
            return Err(Errno::Access);
        }
        let pipe_error = |err: std::io::Error| match err.kind() {
            std::io::ErrorKind::BrokenPipe => Errno::Pipe,
            _ => map_io_err(err),
        };
        // Snapshot the endpoint under its inode lock, then release the lock
        // before awaiting capacity. Cancellation can then revoke a full pipe.
        let target = {
            let mut guard = fd_entry.inode.write();
            match &mut *guard {
                Kind::File {
                    handle: Some(handle),
                    path,
                    ..
                } => WriteTarget::File(handle.clone(), crate::fs::is_live_path(path)),
                Kind::File { handle: None, .. } => return Err(Errno::Inval),
                Kind::PipeTx { tx } => WriteTarget::PipeTx(tx.clone()),
                Kind::DuplexPipe { pipe } => WriteTarget::Duplex(pipe.clone()),
                Kind::PipeRx { .. } => return Err(Errno::Badf),
                Kind::Dir { .. } | Kind::Root { .. } => return Err(Errno::Isdir),
                _ => return Err(Errno::Notsup),
            }
        };
        let (handle, live) = match target {
            WriteTarget::File(handle, live) => (handle, live),
            WriteTarget::PipeTx(mut tx) => return tx.write(data).await.map_err(pipe_error),
            WriteTarget::Duplex(mut pipe) => return pipe.write(data).await.map_err(pipe_error),
        };
        let serial = self.control.file_lock(&handle)?;
        let _serial = serial.lock().await;
        let mut handle = handle.write().map_err(|_| Errno::Fault)?;
        if !is_stdio {
            if fd_entry.inner.flags.contains(Fdflags::APPEND) {
                // A live file may have grown outside this process.
                let size = if live {
                    handle.seek(SeekFrom::End(0)).await.map_err(map_io_err)?
                } else {
                    fd_entry.inode.stat.read().unwrap().st_size
                };
                fd_entry.inner.offset.store(size, Ordering::Release);
            }
            let offset = fd_entry.inner.offset.load(Ordering::Acquire);
            handle
                .seek(SeekFrom::Start(offset))
                .await
                .map_err(map_io_err)?;
        }
        let written = handle.write(data).await.map_err(map_io_err)?;
        if is_stdio {
            handle.flush().await.map_err(map_io_err)?;
        } else {
            let end = fd_entry
                .inner
                .offset
                .fetch_add(written as u64, Ordering::AcqRel)
                + written as u64;
            let mut stat = fd_entry.inode.stat.write().unwrap();
            stat.st_size = stat.st_size.max(end);
        }
        Ok(written)
    }

    /// Close this descriptor in the child, as the child's `fd_close` would.
    /// Other duplicates of the same open description stay open.
    pub fn close(&self) -> Result<(), Errno> {
        if *self.control.revoked.borrow() {
            return Err(Errno::Badf);
        }
        self.control.close(self.fd)?;
        self.state.fs.close_fd(self.fd)
    }
}
