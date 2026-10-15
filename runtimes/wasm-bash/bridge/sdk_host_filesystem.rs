//! Trusted host filesystem mounts for WASIX guests.
//!
//! `Directory.fromHostFileSystem(delegate)` exposes a synchronous JavaScript
//! filesystem owned by the calling thread, such as the container Supervisor's
//! VFS, as a WASIX mount. Guest threads never touch JavaScript: each operation
//! is posted to the owning thread as a `SchedulerMessage`, the delegate runs
//! there synchronously, and the guest thread waits for the owned reply. Calls
//! made on the owning thread itself run directly. Delegates never leave their
//! thread-local table.
//!
//! Every operation reaches the delegate; no file content, size or directory
//! listing is cached here. WASIX's own inode cache is revalidated for such
//! mounts by the paired WASIX patch.

use std::{
    cell::RefCell,
    collections::HashMap,
    io,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc,
    },
    task::{Context, Poll},
};

use futures::future::BoxFuture;
use js_sys::{Array, Function, Reflect, Uint8Array};
use tokio::io::{AsyncRead, AsyncSeek, AsyncWrite, ReadBuf};
use virtual_fs::{
    DirEntry, FileOpener, FileSystem, FileType, FsError, Metadata, OpenOptions, OpenOptionsConfig,
    ReadDir, VirtualFile,
};
use wasm_bindgen::{prelude::wasm_bindgen, JsCast, JsValue};

use crate::{
    fs::Directory,
    tasks::{SchedulerMessage, WorkerMessage},
    utils::Error,
};

/// Largest single read or write forwarded to the delegate.
const MAX_IO_BYTES: usize = 1024 * 1024;

static NEXT_KEY: AtomicU64 = AtomicU64::new(1);

thread_local! {
    static DELEGATES: RefCell<HashMap<u64, JsValue>> = RefCell::new(HashMap::new());
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Link {
    key: u64,
    owner: u32,
}

#[derive(Debug)]
enum Op {
    Stat {
        path: String,
        follow: bool,
    },
    Readdir {
        path: String,
    },
    Mkdir {
        path: String,
    },
    Rmdir {
        path: String,
    },
    Unlink {
        path: String,
    },
    Rename {
        from: String,
        to: String,
    },
    Readlink {
        path: String,
    },
    Open {
        path: String,
        flags: OpenOptionsConfig,
    },
    Read {
        handle: u32,
        offset: u64,
        length: usize,
    },
    Write {
        handle: u32,
        offset: u64,
        bytes: Vec<u8>,
    },
    Append {
        handle: u32,
        bytes: Vec<u8>,
    },
    Fstat {
        handle: u32,
    },
    Truncate {
        handle: u32,
        size: u64,
    },
    Close {
        handle: u32,
    },
}

#[derive(Debug)]
enum Reply {
    Stat(Metadata),
    Entries(Vec<(String, Metadata)>),
    Unit,
    Text(String),
    Number(u64),
    Bytes(Vec<u8>),
}

/// One owned filesystem request moved to the delegate's thread. It contains no
/// JavaScript value.
pub(crate) struct HostFsCall {
    link: Link,
    op: Op,
    reply: Option<mpsc::SyncSender<Result<Reply, FsError>>>,
}

impl std::fmt::Debug for HostFsCall {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HostFsCall")
            .field("key", &self.link.key)
            .finish()
    }
}

/// Run on the delegate's thread for every forwarded request.
pub(crate) fn serve(call: HostFsCall) {
    let HostFsCall { link, op, reply } = call;
    let result = serve_op(link, op);
    if let Some(reply) = reply {
        let _ = reply.send(result);
    }
}

fn call(link: Link, op: Op) -> Result<Reply, FsError> {
    if wasmer::js::current_thread_id() == link.owner {
        return serve_op(link, op);
    }
    let (sender, receiver) = mpsc::sync_channel(1);
    // A guest Worker's parent is the SDK scheduler thread that owns the delegate.
    WorkerMessage::Scheduler(SchedulerMessage::HostFs(Box::new(HostFsCall {
        link,
        op,
        reply: Some(sender),
    })))
    .emit()
    .map_err(|_| FsError::IOError)?;
    receiver.recv().unwrap_or(Err(FsError::IOError))
}

fn post(link: Link, op: Op) {
    if wasmer::js::current_thread_id() == link.owner {
        let _ = serve_op(link, op);
        return;
    }
    let _ = WorkerMessage::Scheduler(SchedulerMessage::HostFs(Box::new(HostFsCall {
        link,
        op,
        reply: None,
    })))
    .emit();
}

fn fs_error(error: &JsValue) -> FsError {
    let code = Reflect::get(error, &JsValue::from_str("code"))
        .ok()
        .and_then(|code| code.as_string());
    match code.as_deref() {
        Some("ENOENT") => FsError::EntryNotFound,
        Some("EEXIST") => FsError::AlreadyExists,
        Some("ENOTDIR") => FsError::BaseNotDirectory,
        Some("EISDIR") => FsError::NotAFile,
        Some("ENOTEMPTY") => FsError::DirectoryNotEmpty,
        Some("EACCES") | Some("EROFS") | Some("EPERM") => FsError::PermissionDenied,
        Some("EBADF") => FsError::InvalidFd,
        Some("EINVAL") | Some("EXDEV") | Some("ELOOP") => FsError::InvalidInput,
        Some("ENOSPC") => FsError::StorageFull,
        Some("EBUSY") => FsError::Lock,
        Some("ENOTSUP") => FsError::Unsupported,
        _ => FsError::IOError,
    }
}

fn invoke(delegate: &JsValue, name: &str, args: &[JsValue]) -> Result<JsValue, FsError> {
    let function: Function = Reflect::get(delegate, &JsValue::from_str(name))
        .ok()
        .and_then(|value| value.dyn_into().ok())
        .ok_or(FsError::Unsupported)?;
    let arguments: Array = args.iter().collect();
    function
        .apply(delegate, &arguments)
        .map_err(|error| fs_error(&error))
}

fn field(value: &JsValue, name: &str) -> Result<JsValue, FsError> {
    Reflect::get(value, &JsValue::from_str(name)).map_err(|_| FsError::InvalidData)
}

fn number(value: &JsValue) -> Result<u64, FsError> {
    match value.as_f64() {
        Some(n) if n >= 0.0 && n.fract() == 0.0 && n <= 9_007_199_254_740_991.0 => Ok(n as u64),
        _ => Err(FsError::InvalidData),
    }
}

fn nanos(value: &JsValue) -> u64 {
    value
        .as_f64()
        .filter(|ms| ms.is_finite() && *ms >= 0.0)
        .map(|ms| (ms * 1_000_000.0) as u64)
        .unwrap_or(0)
}

fn file_type(name: &str) -> Result<FileType, FsError> {
    let kind = |dir, file, symlink| FileType {
        dir,
        file,
        symlink,
        char_device: false,
        block_device: false,
        socket: false,
        fifo: false,
    };
    match name {
        "directory" => Ok(kind(true, false, false)),
        "file" => Ok(kind(false, true, false)),
        "symlink" => Ok(kind(false, false, true)),
        _ => Err(FsError::InvalidData),
    }
}

fn metadata(value: &JsValue) -> Result<Metadata, FsError> {
    let ft = file_type(
        &field(value, "type")?
            .as_string()
            .ok_or(FsError::InvalidData)?,
    )?;
    let modified = nanos(&field(value, "mtimeMs")?);
    Ok(Metadata {
        ft,
        accessed: modified,
        created: nanos(&field(value, "ctimeMs")?),
        modified,
        len: number(&field(value, "size")?)?,
    })
}

fn serve_op(link: Link, op: Op) -> Result<Reply, FsError> {
    let delegate = DELEGATES
        .with(|delegates| delegates.borrow().get(&link.key).cloned())
        .ok_or(FsError::IOError)?;
    let text = |value: &str| JsValue::from_str(value);
    let int = |value: u64| JsValue::from_f64(value as f64);
    match op {
        Op::Stat { path, follow } => {
            let name = if follow { "stat" } else { "lstat" };
            Ok(Reply::Stat(metadata(&invoke(
                &delegate,
                name,
                &[text(&path)],
            )?)?))
        }
        Op::Readdir { path } => {
            let listing = invoke(&delegate, "readdir", &[text(&path)])?;
            let listing: Array = listing.dyn_into().map_err(|_| FsError::InvalidData)?;
            let mut entries = Vec::with_capacity(listing.length() as usize);
            for entry in listing.iter() {
                let name = field(&entry, "name")?
                    .as_string()
                    .ok_or(FsError::InvalidData)?;
                if name.is_empty() || name.contains('/') || name.contains('\0') {
                    return Err(FsError::InvalidData);
                }
                let entry_path = if path.ends_with('/') {
                    format!("{path}{name}")
                } else {
                    format!("{path}/{name}")
                };
                let stat = invoke(&delegate, "lstat", &[text(&entry_path)])?;
                entries.push((name, metadata(&stat)?));
            }
            Ok(Reply::Entries(entries))
        }
        Op::Mkdir { path } => invoke(&delegate, "mkdir", &[text(&path)]).map(|_| Reply::Unit),
        Op::Rmdir { path } => invoke(&delegate, "rmdir", &[text(&path)]).map(|_| Reply::Unit),
        Op::Unlink { path } => invoke(&delegate, "unlink", &[text(&path)]).map(|_| Reply::Unit),
        Op::Rename { from, to } => {
            invoke(&delegate, "rename", &[text(&from), text(&to)]).map(|_| Reply::Unit)
        }
        Op::Readlink { path } => invoke(&delegate, "readlink", &[text(&path)])?
            .as_string()
            .map(Reply::Text)
            .ok_or(FsError::InvalidData),
        Op::Open { path, flags } => {
            let options = js_sys::Object::new();
            for (name, value) in [
                ("read", flags.read),
                ("write", flags.write),
                ("create", flags.create || flags.create_new),
                ("exclusive", flags.create_new),
                ("truncate", flags.truncate),
                ("append", flags.append),
            ] {
                Reflect::set(&options, &text(name), &JsValue::from_bool(value))
                    .map_err(|_| FsError::InvalidData)?;
            }
            let handle = number(&invoke(&delegate, "open", &[text(&path), options.into()])?)?;
            Ok(Reply::Number(handle))
        }
        Op::Read {
            handle,
            offset,
            length,
        } => {
            let bytes = invoke(
                &delegate,
                "read",
                &[int(handle as u64), int(offset), int(length as u64)],
            )?;
            let bytes: Uint8Array = bytes.dyn_into().map_err(|_| FsError::InvalidData)?;
            if bytes.length() as usize > length {
                return Err(FsError::InvalidData);
            }
            Ok(Reply::Bytes(bytes.to_vec()))
        }
        Op::Write {
            handle,
            offset,
            bytes,
        } => {
            let data = Uint8Array::from(bytes.as_slice());
            let written = number(&invoke(
                &delegate,
                "write",
                &[int(handle as u64), int(offset), data.into()],
            )?)?;
            if written > bytes.len() as u64 {
                return Err(FsError::InvalidData);
            }
            Ok(Reply::Number(written))
        }
        Op::Append { handle, bytes } => {
            let data = Uint8Array::from(bytes.as_slice());
            let written = number(&invoke(
                &delegate,
                "append",
                &[int(handle as u64), data.into()],
            )?)?;
            if written > bytes.len() as u64 {
                return Err(FsError::InvalidData);
            }
            Ok(Reply::Number(written))
        }
        Op::Fstat { handle } => Ok(Reply::Stat(metadata(&invoke(
            &delegate,
            "fstat",
            &[int(handle as u64)],
        )?)?)),
        Op::Truncate { handle, size } => {
            invoke(&delegate, "truncate", &[int(handle as u64), int(size)]).map(|_| Reply::Unit)
        }
        Op::Close { handle } => {
            invoke(&delegate, "close", &[int(handle as u64)]).map(|_| Reply::Unit)
        }
    }
}

fn path_text(path: &Path) -> Result<String, FsError> {
    let text = path.to_str().ok_or(FsError::InvalidInput)?;
    if text.contains('\0') {
        return Err(FsError::InvalidInput);
    }
    Ok(if text.starts_with('/') {
        text.to_string()
    } else {
        format!("/{text}")
    })
}

fn expect_stat(reply: Reply) -> Result<Metadata, FsError> {
    match reply {
        Reply::Stat(metadata) => Ok(metadata),
        _ => Err(FsError::InvalidData),
    }
}

fn expect_number(reply: Reply) -> Result<u64, FsError> {
    match reply {
        Reply::Number(value) => Ok(value),
        _ => Err(FsError::InvalidData),
    }
}

/// A WASIX filesystem whose every operation runs on the delegate's thread.
#[derive(Debug)]
pub(crate) struct HostFileSystem {
    link: Link,
}

impl FileSystem for HostFileSystem {
    fn readlink(&self, path: &Path) -> virtual_fs::Result<PathBuf> {
        match call(
            self.link,
            Op::Readlink {
                path: path_text(path)?,
            },
        )? {
            Reply::Text(target) => Ok(PathBuf::from(target)),
            _ => Err(FsError::InvalidData),
        }
    }

    fn read_dir(&self, path: &Path) -> virtual_fs::Result<ReadDir> {
        match call(
            self.link,
            Op::Readdir {
                path: path_text(path)?,
            },
        )? {
            Reply::Entries(entries) => Ok(ReadDir::new(
                entries
                    .into_iter()
                    .map(|(name, metadata)| DirEntry {
                        path: path.join(name),
                        metadata: Ok(metadata),
                    })
                    .collect(),
            )),
            _ => Err(FsError::InvalidData),
        }
    }

    fn create_dir(&self, path: &Path) -> virtual_fs::Result<()> {
        call(
            self.link,
            Op::Mkdir {
                path: path_text(path)?,
            },
        )
        .map(|_| ())
    }

    fn remove_dir(&self, path: &Path) -> virtual_fs::Result<()> {
        call(
            self.link,
            Op::Rmdir {
                path: path_text(path)?,
            },
        )
        .map(|_| ())
    }

    fn rename<'a>(&'a self, from: &'a Path, to: &'a Path) -> BoxFuture<'a, virtual_fs::Result<()>> {
        let result = path_text(from)
            .and_then(|from| Ok((from, path_text(to)?)))
            .and_then(|(from, to)| call(self.link, Op::Rename { from, to }).map(|_| ()));
        Box::pin(async move { result })
    }

    fn metadata(&self, path: &Path) -> virtual_fs::Result<Metadata> {
        expect_stat(call(
            self.link,
            Op::Stat {
                path: path_text(path)?,
                follow: true,
            },
        )?)
    }

    fn symlink_metadata(&self, path: &Path) -> virtual_fs::Result<Metadata> {
        expect_stat(call(
            self.link,
            Op::Stat {
                path: path_text(path)?,
                follow: false,
            },
        )?)
    }

    fn remove_file(&self, path: &Path) -> virtual_fs::Result<()> {
        call(
            self.link,
            Op::Unlink {
                path: path_text(path)?,
            },
        )
        .map(|_| ())
    }

    fn new_open_options(&self) -> OpenOptions<'_> {
        OpenOptions::new(self)
    }

    fn mount(
        &self,
        _name: String,
        _path: &Path,
        _fs: Box<dyn FileSystem + Send + Sync>,
    ) -> virtual_fs::Result<()> {
        Err(FsError::Unsupported)
    }
}

impl FileOpener for HostFileSystem {
    fn open(
        &self,
        path: &Path,
        conf: &OpenOptionsConfig,
    ) -> virtual_fs::Result<Box<dyn VirtualFile + Send + Sync + 'static>> {
        let path = path_text(path)?;
        let handle = expect_number(call(
            self.link,
            Op::Open {
                path: path.clone(),
                flags: conf.clone(),
            },
        )?)?;
        let handle = u32::try_from(handle).map_err(|_| FsError::InvalidData)?;
        Ok(Box::new(HostFile {
            link: self.link,
            handle,
            cursor: 0,
            append: conf.append,
            path,
        }))
    }
}

/// An open file in a host filesystem. Reads and writes use explicit offsets;
/// append-mode writes let the delegate place them at the current end.
#[derive(Debug)]
struct HostFile {
    link: Link,
    handle: u32,
    cursor: u64,
    append: bool,
    path: String,
}

impl HostFile {
    fn stat(&self) -> virtual_fs::Result<Metadata> {
        expect_stat(call(
            self.link,
            Op::Fstat {
                handle: self.handle,
            },
        )?)
    }
}

impl Drop for HostFile {
    fn drop(&mut self) {
        post(
            self.link,
            Op::Close {
                handle: self.handle,
            },
        );
    }
}

impl AsyncRead for HostFile {
    fn poll_read(
        mut self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let length = buf.remaining().min(MAX_IO_BYTES);
        if length == 0 {
            return Poll::Ready(Ok(()));
        }
        let reply = call(
            self.link,
            Op::Read {
                handle: self.handle,
                offset: self.cursor,
                length,
            },
        );
        Poll::Ready(match reply {
            Ok(Reply::Bytes(bytes)) => {
                buf.put_slice(&bytes);
                self.cursor += bytes.len() as u64;
                Ok(())
            }
            Ok(_) => Err(FsError::InvalidData.into()),
            Err(error) => Err(error.into()),
        })
    }
}

impl AsyncWrite for HostFile {
    fn poll_write(
        mut self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        let bytes = data[..data.len().min(MAX_IO_BYTES)].to_vec();
        if bytes.is_empty() {
            return Poll::Ready(Ok(0));
        }
        let op = if self.append {
            Op::Append {
                handle: self.handle,
                bytes,
            }
        } else {
            Op::Write {
                handle: self.handle,
                offset: self.cursor,
                bytes,
            }
        };
        Poll::Ready(match call(self.link, op).and_then(expect_number) {
            Ok(written) => {
                self.cursor += written;
                Ok(written as usize)
            }
            Err(error) => Err(error.into()),
        })
    }

    fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}

impl AsyncSeek for HostFile {
    fn start_seek(mut self: Pin<&mut Self>, position: io::SeekFrom) -> io::Result<()> {
        let base = match position {
            io::SeekFrom::Start(offset) => {
                self.cursor = offset;
                return Ok(());
            }
            io::SeekFrom::Current(delta) => (self.cursor, delta),
            io::SeekFrom::End(delta) => (self.stat().map_err(io::Error::from)?.len, delta),
        };
        self.cursor = base
            .0
            .checked_add_signed(base.1)
            .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
        Ok(())
    }

    fn poll_complete(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<u64>> {
        Poll::Ready(Ok(self.cursor))
    }
}

impl VirtualFile for HostFile {
    fn last_accessed(&self) -> u64 {
        self.stat().map(|stat| stat.accessed).unwrap_or(0)
    }

    fn last_modified(&self) -> u64 {
        self.stat().map(|stat| stat.modified).unwrap_or(0)
    }

    fn created_time(&self) -> u64 {
        self.stat().map(|stat| stat.created).unwrap_or(0)
    }

    fn size(&self) -> u64 {
        self.stat().map(|stat| stat.len).unwrap_or(0)
    }

    fn set_len(&mut self, new_size: u64) -> virtual_fs::Result<()> {
        call(
            self.link,
            Op::Truncate {
                handle: self.handle,
                size: new_size,
            },
        )
        .map(|_| ())
    }

    fn unlink(&mut self) -> virtual_fs::Result<()> {
        call(
            self.link,
            Op::Unlink {
                path: self.path.clone(),
            },
        )
        .map(|_| ())
    }

    fn poll_read_ready(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<usize>> {
        Poll::Ready(Ok(MAX_IO_BYTES))
    }

    fn poll_write_ready(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<usize>> {
        Poll::Ready(Ok(MAX_IO_BYTES))
    }
}

#[wasm_bindgen(typescript_custom_section)]
const HOST_FILESYSTEM_TYPES: &str = r#"
/** File metadata returned by a host filesystem delegate. Times are milliseconds. */
export interface HostFileStat {
    readonly type: "file" | "directory" | "symlink";
    readonly size: number;
    readonly mtimeMs: number;
    readonly ctimeMs: number;
}

/**
 * Synchronous filesystem operations on paths that are absolute inside the
 * mount. Throw an Error whose `code` is a POSIX name (for example `ENOENT`) to
 * report a failure. Handles are positive integers owned by the delegate.
 */
export interface HostFileSystemDelegate {
    stat(path: string): HostFileStat;
    lstat(path: string): HostFileStat;
    readdir(path: string): readonly { readonly name: string }[];
    mkdir(path: string): void;
    rmdir(path: string): void;
    unlink(path: string): void;
    rename(from: string, to: string): void;
    readlink(path: string): string;
    open(path: string, flags: { read: boolean; write: boolean; create: boolean; exclusive: boolean; truncate: boolean; append: boolean }): number;
    read(handle: number, offset: number, length: number): Uint8Array;
    write(handle: number, offset: number, bytes: Uint8Array): number;
    append(handle: number, bytes: Uint8Array): number;
    fstat(handle: number): HostFileStat;
    truncate(handle: number, size: number): void;
    close(handle: number): void;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "HostFileSystemDelegate")]
    pub type HostFileSystemDelegate;
}

#[wasm_bindgen(js_class = "Directory")]
impl Directory {
    /// Mount a trusted synchronous filesystem owned by this thread. Commands
    /// using it must be started from this same thread. WASIX revalidates its
    /// cached entries under such a mount on every lookup.
    #[wasm_bindgen(js_name = "fromHostFileSystem")]
    pub fn from_host_file_system(delegate: HostFileSystemDelegate) -> Result<Directory, Error> {
        let delegate: JsValue = delegate.into();
        if !delegate.is_object() {
            return Err(Error::Rust(anyhow::anyhow!(
                "host filesystem delegate must be an object"
            )));
        }
        let link = Link {
            key: NEXT_KEY.fetch_add(1, Ordering::Relaxed),
            owner: wasmer::js::current_thread_id(),
        };
        DELEGATES.with(|delegates| delegates.borrow_mut().insert(link.key, delegate));
        Ok(Directory::from_filesystem(Arc::new(HostFileSystem {
            link,
        })))
    }
}
