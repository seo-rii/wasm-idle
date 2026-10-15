//! Byte-bounded pipe storage for the selected WASIX shell profile.
//!
//! There is no task runner or JavaScript dependency here. Endpoint clones retain
//! their direction; the last close wakes its peer. Async waits retain weak waiter
//! references, so dropping a waiting endpoint does not retain its task in the pipe.

use std::{
    collections::VecDeque,
    io,
    sync::{Arc, Condvar, Mutex, Weak},
    task::{Context, Poll, Waker},
};

#[derive(Debug, Default)]
struct Waiter(Mutex<Option<Waker>>);

#[derive(Debug)]
struct State {
    bytes: VecDeque<u8>,
    capacity: usize,
    read_open: bool,
    write_open: bool,
    readers: Vec<Weak<Waiter>>,
    writers: Vec<Weak<Waiter>>,
}

#[derive(Debug)]
struct Shared {
    state: Mutex<State>,
    readable: Condvar,
    writable: Condvar,
}

fn register(waiters: &mut Vec<Weak<Waiter>>, waiter: &Arc<Waiter>, cx: &Context<'_>) {
    let mut slot = waiter.0.lock().unwrap();
    if !slot
        .as_ref()
        .is_some_and(|waker| waker.will_wake(cx.waker()))
    {
        *slot = Some(cx.waker().clone());
    }
    waiters.retain(|entry| entry.strong_count() != 0);
    let weak = Arc::downgrade(waiter);
    if !waiters.iter().any(|entry| entry.ptr_eq(&weak)) {
        waiters.push(weak);
    }
}

fn wake(waiters: Vec<Weak<Waiter>>) {
    // Never invoke a task waker while holding the queue's mutex.
    for waiter in waiters.into_iter().filter_map(|entry| entry.upgrade()) {
        let waker = waiter.0.lock().unwrap().take();
        if let Some(waker) = waker {
            waker.wake();
        }
    }
}

#[derive(Debug)]
struct ReadEnd(Arc<Shared>);

impl Drop for ReadEnd {
    fn drop(&mut self) {
        let writers = {
            let mut state = self.0.state.lock().unwrap();
            state.read_open = false;
            state.bytes.clear();
            std::mem::take(&mut state.writers)
        };
        self.0.writable.notify_all();
        wake(writers);
    }
}

#[derive(Debug)]
struct WriteEnd(Arc<Shared>);

impl Drop for WriteEnd {
    fn drop(&mut self) {
        let readers = {
            let mut state = self.0.state.lock().unwrap();
            state.write_open = false;
            std::mem::take(&mut state.readers)
        };
        self.0.readable.notify_all();
        wake(readers);
    }
}

#[derive(Debug)]
pub(crate) struct BoundedRx {
    end: Arc<ReadEnd>,
    waiter: Arc<Waiter>,
}

#[derive(Debug)]
pub(crate) struct BoundedTx {
    end: Arc<WriteEnd>,
    waiter: Arc<Waiter>,
}

impl Clone for BoundedRx {
    fn clone(&self) -> Self {
        Self {
            end: self.end.clone(),
            waiter: Arc::default(),
        }
    }
}

impl Clone for BoundedTx {
    fn clone(&self) -> Self {
        Self {
            end: self.end.clone(),
            waiter: Arc::default(),
        }
    }
}

pub(crate) fn pipe(capacity: usize) -> (BoundedTx, BoundedRx) {
    assert!(capacity > 0);
    let shared = Arc::new(Shared {
        state: Mutex::new(State {
            bytes: VecDeque::with_capacity(capacity),
            capacity,
            read_open: true,
            write_open: true,
            readers: Vec::new(),
            writers: Vec::new(),
        }),
        readable: Condvar::new(),
        writable: Condvar::new(),
    });
    (
        BoundedTx {
            end: Arc::new(WriteEnd(shared.clone())),
            waiter: Arc::default(),
        },
        BoundedRx {
            end: Arc::new(ReadEnd(shared)),
            waiter: Arc::default(),
        },
    )
}

impl BoundedRx {
    fn read_locked(state: &mut State, buf: &mut [u8]) -> Option<usize> {
        if buf.is_empty() {
            return Some(0);
        }
        if state.bytes.is_empty() {
            return (!state.write_open).then_some(0);
        }
        let count = buf.len().min(state.bytes.len());
        for byte in &mut buf[..count] {
            *byte = state.bytes.pop_front().unwrap();
        }
        Some(count)
    }

    pub(crate) fn try_read(&self, buf: &mut [u8]) -> Option<usize> {
        let (count, writers) = {
            let mut state = self.end.0.state.lock().unwrap();
            let count = Self::read_locked(&mut state, buf)?;
            (
                count,
                if count > 0 {
                    std::mem::take(&mut state.writers)
                } else {
                    Vec::new()
                },
            )
        };
        if count > 0 {
            self.end.0.writable.notify_all();
        }
        wake(writers);
        Some(count)
    }

    pub(crate) fn read(&self, buf: &mut [u8]) -> usize {
        let mut state = self.end.0.state.lock().unwrap();
        loop {
            if let Some(count) = Self::read_locked(&mut state, buf) {
                let writers = if count > 0 {
                    std::mem::take(&mut state.writers)
                } else {
                    Vec::new()
                };
                drop(state);
                if count > 0 {
                    self.end.0.writable.notify_all();
                }
                wake(writers);
                return count;
            }
            state = self.end.0.readable.wait(state).unwrap();
        }
    }

    pub(crate) fn poll_read(&self, cx: &mut Context<'_>, buf: &mut [u8]) -> Poll<usize> {
        let mut state = self.end.0.state.lock().unwrap();
        if let Some(count) = Self::read_locked(&mut state, buf) {
            let writers = if count > 0 {
                std::mem::take(&mut state.writers)
            } else {
                Vec::new()
            };
            drop(state);
            if count > 0 {
                self.end.0.writable.notify_all();
            }
            wake(writers);
            Poll::Ready(count)
        } else {
            register(&mut state.readers, &self.waiter, cx);
            Poll::Pending
        }
    }

    pub(crate) fn poll_ready(&self, cx: &mut Context<'_>) -> Poll<usize> {
        let mut state = self.end.0.state.lock().unwrap();
        if !state.bytes.is_empty() || !state.write_open {
            Poll::Ready(state.bytes.len())
        } else {
            register(&mut state.readers, &self.waiter, cx);
            Poll::Pending
        }
    }
}

impl BoundedTx {
    pub(crate) fn is_open(&self) -> bool {
        self.end.0.state.lock().unwrap().read_open
    }

    fn write_locked(state: &mut State, buf: &[u8]) -> Option<io::Result<usize>> {
        if buf.is_empty() {
            return Some(Ok(0));
        }
        if !state.read_open {
            return Some(Err(io::ErrorKind::BrokenPipe.into()));
        }
        let count = buf.len().min(state.capacity - state.bytes.len());
        if count == 0 {
            return None;
        }
        state.bytes.extend(&buf[..count]);
        Some(Ok(count))
    }

    pub(crate) fn try_write(&self, buf: &[u8]) -> io::Result<usize> {
        let mut state = self.end.0.state.lock().unwrap();
        let result = Self::write_locked(&mut state, buf)
            .unwrap_or_else(|| Err(io::ErrorKind::WouldBlock.into()));
        let readers = if matches!(result, Ok(n) if n > 0) {
            std::mem::take(&mut state.readers)
        } else {
            Vec::new()
        };
        drop(state);
        self.end.0.readable.notify_all();
        wake(readers);
        result
    }

    pub(crate) fn write(&self, buf: &[u8]) -> io::Result<usize> {
        let mut state = self.end.0.state.lock().unwrap();
        loop {
            if let Some(result) = Self::write_locked(&mut state, buf) {
                let readers = if matches!(result, Ok(n) if n > 0) {
                    std::mem::take(&mut state.readers)
                } else {
                    Vec::new()
                };
                drop(state);
                self.end.0.readable.notify_all();
                wake(readers);
                return result;
            }
            state = self.end.0.writable.wait(state).unwrap();
        }
    }

    pub(crate) fn poll_write(&self, cx: &mut Context<'_>, buf: &[u8]) -> Poll<io::Result<usize>> {
        let mut state = self.end.0.state.lock().unwrap();
        if let Some(result) = Self::write_locked(&mut state, buf) {
            let readers = if matches!(result, Ok(n) if n > 0) {
                std::mem::take(&mut state.readers)
            } else {
                Vec::new()
            };
            drop(state);
            self.end.0.readable.notify_all();
            wake(readers);
            Poll::Ready(result)
        } else {
            register(&mut state.writers, &self.waiter, cx);
            Poll::Pending
        }
    }

    pub(crate) fn poll_ready(&self, cx: Option<&mut Context<'_>>) -> Poll<io::Result<usize>> {
        let mut state = self.end.0.state.lock().unwrap();
        if !state.read_open {
            return Poll::Ready(Err(io::ErrorKind::BrokenPipe.into()));
        }
        let available = state.capacity - state.bytes.len();
        if available > 0 {
            return Poll::Ready(Ok(available));
        }
        if let Some(cx) = cx {
            register(&mut state.writers, &self.waiter, cx);
        }
        Poll::Pending
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            mpsc,
        },
        task::Wake,
        time::Duration,
    };

    #[derive(Default)]
    struct CountWake(AtomicUsize);
    impl Wake for CountWake {
        fn wake(self: Arc<Self>) {
            self.0.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[test]
    fn bytes_and_zero_length_io_preserve_capacity() {
        let (tx, rx) = pipe(4);
        assert_eq!(rx.try_read(&mut []), Some(0));
        assert_eq!(tx.write(&[]).unwrap(), 0);
        assert_eq!(rx.try_read(&mut [0]), None);
        assert_eq!(tx.write(&[0, 255, 1, 2, 3]).unwrap(), 4);
        assert!(tx.poll_ready(None).is_pending());
        let mut first = [0; 2];
        assert_eq!(rx.try_read(&mut first), Some(2));
        assert_eq!(first, [0, 255]);
        assert_eq!(tx.write(&[3, 4, 5]).unwrap(), 2);
        let mut rest = [0; 4];
        assert_eq!(rx.read(&mut rest), 4);
        assert_eq!(rest, [1, 2, 3, 4]);
    }

    #[test]
    fn synchronous_try_write_reports_backpressure_without_blocking() {
        let (tx, rx) = pipe(1);
        assert_eq!(tx.try_write(b"a").unwrap(), 1);
        assert_eq!(
            tx.try_write(b"b").unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );
        assert_eq!(tx.try_write(b"").unwrap(), 0);
        assert_eq!(rx.read(&mut [0]), 1);
        assert_eq!(tx.try_write(b"b").unwrap(), 1);
    }

    #[test]
    fn stream_larger_than_capacity_roundtrips_and_drains_at_eof() {
        let (tx, rx) = pipe(1024);
        let expected: Vec<_> = (0..131_072).map(|index| (index % 251) as u8).collect();
        let input = expected.clone();
        let writer = std::thread::spawn(move || {
            let mut offset = 0;
            while offset < input.len() {
                offset += tx.write(&input[offset..]).unwrap();
            }
        });
        let mut result = Vec::new();
        let mut buffer = [0; 317];
        loop {
            let count = rx.read(&mut buffer);
            if count == 0 {
                break;
            }
            result.extend_from_slice(&buffer[..count]);
            assert!(rx.end.0.state.lock().unwrap().bytes.len() <= 1024);
        }
        writer.join().unwrap();
        assert_eq!(result, expected);
    }

    #[test]
    fn last_writer_close_drains_then_returns_eof() {
        let (tx, rx) = pipe(4);
        let duplicate = tx.clone();
        tx.write(b"ab").unwrap();
        drop(tx);
        assert_eq!(rx.read(&mut [0; 4]), 2);
        assert_eq!(rx.try_read(&mut [0]), None);
        drop(duplicate);
        assert_eq!(rx.read(&mut [0]), 0);
    }

    #[test]
    fn writer_wakes_when_bytes_are_consumed() {
        let (tx, rx) = pipe(1);
        tx.write(b"a").unwrap();
        let wakes = Arc::new(CountWake::default());
        let waker = Waker::from(wakes.clone());
        let mut cx = Context::from_waker(&waker);
        assert!(tx.poll_write(&mut cx, b"b").is_pending());
        assert_eq!(rx.read(&mut [0]), 1);
        assert_eq!(wakes.0.load(Ordering::Relaxed), 1);
        assert!(matches!(tx.poll_write(&mut cx, b"b"), Poll::Ready(Ok(1))));
    }

    #[test]
    fn last_reader_close_wakes_all_waiting_writers_with_broken_pipe() {
        let (tx, rx) = pipe(1);
        tx.write(b"a").unwrap();
        let other_tx = tx.clone();
        let other_rx = rx.clone();
        let wakes = Arc::new(CountWake::default());
        let waker = Waker::from(wakes.clone());
        let mut cx = Context::from_waker(&waker);
        assert!(tx.poll_write(&mut cx, b"b").is_pending());
        assert!(other_tx.poll_write(&mut cx, b"c").is_pending());
        drop(rx);
        assert_eq!(wakes.0.load(Ordering::Relaxed), 0);
        drop(other_rx);
        assert_eq!(wakes.0.load(Ordering::Relaxed), 2);
        assert!(!tx.is_open());
        assert_eq!(
            tx.write(b"b").unwrap_err().kind(),
            io::ErrorKind::BrokenPipe
        );
    }

    #[test]
    fn reader_wakes_on_data_and_last_writer_close() {
        let (tx, rx) = pipe(1);
        let wakes = Arc::new(CountWake::default());
        let waker = Waker::from(wakes.clone());
        let mut cx = Context::from_waker(&waker);
        assert!(rx.poll_ready(&mut cx).is_pending());
        tx.write(b"a").unwrap();
        assert_eq!(wakes.0.load(Ordering::Relaxed), 1);
        assert_eq!(rx.poll_read(&mut cx, &mut [0]), Poll::Ready(1));
        assert!(rx.poll_read(&mut cx, &mut [0]).is_pending());
        drop(tx);
        assert_eq!(wakes.0.load(Ordering::Relaxed), 2);
        assert_eq!(rx.poll_read(&mut cx, &mut [0]), Poll::Ready(0));
    }

    #[test]
    fn synchronous_writer_resumes_after_reader_frees_capacity() {
        let (tx, rx) = pipe(1);
        tx.write(b"a").unwrap();
        let (done, received) = mpsc::channel();
        let worker = std::thread::spawn(move || done.send(tx.write(b"b")).unwrap());
        assert!(received.try_recv().is_err());
        let mut byte = [0];
        assert_eq!(rx.read(&mut byte), 1);
        assert_eq!(&byte, b"a");
        assert_eq!(
            received
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap(),
            1
        );
        assert_eq!(rx.read(&mut byte), 1);
        assert_eq!(&byte, b"b");
        worker.join().unwrap();
    }

    #[test]
    fn dropped_waiters_do_not_retain_tasks() {
        let (tx, rx) = pipe(1);
        tx.write(b"a").unwrap();
        let wakes = Arc::new(CountWake::default());
        let waker = Waker::from(wakes.clone());
        let mut cx = Context::from_waker(&waker);
        let waiting = tx.clone();
        assert!(waiting.poll_write(&mut cx, b"b").is_pending());
        drop(waiting);
        assert_eq!(Arc::strong_count(&wakes), 2);
        rx.read(&mut [0]);
        assert_eq!(wakes.0.load(Ordering::Relaxed), 0);
    }
}
