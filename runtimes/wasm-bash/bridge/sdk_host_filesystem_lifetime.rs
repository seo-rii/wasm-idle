//! Shared lifetime of an owner-thread filesystem registration.
//!
//! The registration contains no JavaScript values. Filesystems, open files and
//! queued operations retain it; the last reference schedules owner cleanup.

use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Link {
    pub(crate) key: u64,
    pub(crate) owner: u32,
}

#[derive(Debug)]
pub(crate) struct Registration {
    pub(crate) link: Link,
    release: fn(Link),
}

impl Registration {
    pub(crate) fn new(link: Link, release: fn(Link)) -> Arc<Self> {
        Arc::new(Self { link, release })
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        // This may run on a guest thread. The callback must post cleanup to the
        // owner without waiting for that owner or invoking JavaScript here.
        (self.release)(self.link);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static RELEASED: Mutex<Vec<Link>> = Mutex::new(Vec::new());

    fn release(link: Link) {
        RELEASED.lock().unwrap().push(link);
    }

    fn releases(key: u64) -> usize {
        RELEASED
            .lock()
            .unwrap()
            .iter()
            .filter(|link| link.key == key)
            .count()
    }

    #[test]
    fn open_file_keeps_registration_after_directory_free() {
        let directory = Registration::new(Link { key: 1, owner: 17 }, release);
        let file = directory.clone();
        drop(directory);
        assert_eq!(releases(1), 0);
        assert_eq!(file.link.owner, 17);
        drop(file);
        assert_eq!(releases(1), 1);
    }

    #[test]
    fn queued_close_keeps_registration_until_owner_serves_it() {
        let directory = Registration::new(Link { key: 2, owner: 18 }, release);
        let file = directory.clone();
        let queued_close = file.clone();
        drop(directory);
        drop(file);
        assert_eq!(releases(2), 0);
        drop(queued_close);
        assert_eq!(releases(2), 1);
    }

    #[test]
    fn cross_thread_clones_release_once() {
        let directory = Registration::new(Link { key: 3, owner: 19 }, release);
        let clones: Vec<_> = (0..8).map(|_| directory.clone()).collect();
        drop(directory);
        assert_eq!(releases(3), 0);
        let workers: Vec<_> = clones
            .into_iter()
            .map(|file| std::thread::spawn(move || drop(file)))
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(releases(3), 1);
    }

    #[test]
    fn repeated_registration_lifetimes_do_not_retain_history() {
        for key in 10..110 {
            let directory = Registration::new(Link { key, owner: 20 }, release);
            drop(directory);
            assert_eq!(releases(key), 1);
        }
    }
}
