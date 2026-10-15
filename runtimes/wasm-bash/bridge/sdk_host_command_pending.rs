//! Outstanding requests grouped by their owning host command.
//!
//! Completion removes both indexes immediately. A command that streams for a
//! long time therefore retains only its concurrent requests, not its history.
//! This module has no JavaScript dependencies so ownership can be tested natively.

use std::collections::{HashMap, HashSet, VecDeque};

/// At most one MiB of copied write data (16 requests of at most 64 KiB).
/// Reads share the same admission budget. Control messages bypass it.
pub(crate) const MAX_PENDING_REQUESTS: usize = 16;

pub(crate) struct PendingRequests<T> {
    requests: HashMap<u64, (u64, T)>,
    commands: HashMap<u64, HashSet<u64>>,
}

impl<T> Default for PendingRequests<T> {
    fn default() -> Self {
        Self {
            requests: HashMap::new(),
            commands: HashMap::new(),
        }
    }
}

impl<T> PendingRequests<T> {
    pub(crate) fn count(&self, command: u64) -> usize {
        self.commands.get(&command).map_or(0, HashSet::len)
    }

    pub(crate) fn try_insert(&mut self, command: u64, key: u64, value: T) -> Result<(), T> {
        if self.count(command) >= MAX_PENDING_REQUESTS {
            return Err(value);
        }
        self.insert(command, key, value);
        Ok(())
    }

    pub(crate) fn insert(&mut self, command: u64, key: u64, value: T) {
        // Keep both indexes consistent even if a caller replaces an entry.
        self.remove(key);
        self.commands.entry(command).or_default().insert(key);
        self.requests.insert(key, (command, value));
    }

    pub(crate) fn remove(&mut self, key: u64) -> Option<T> {
        let (command, value) = self.requests.remove(&key)?;
        if let Some(keys) = self.commands.get_mut(&command) {
            keys.remove(&key);
            if keys.is_empty() {
                self.commands.remove(&command);
            }
        }
        Some(value)
    }

    pub(crate) fn finish(&mut self, command: u64) -> Vec<T> {
        self.commands
            .remove(&command)
            .into_iter()
            .flatten()
            .filter_map(|key| self.requests.remove(&key).map(|(_, value)| value))
            .collect()
    }
}

/// FIFO writes per delegated descriptor, with one in-flight write per lane.
/// The service keeps control requests outside these queues.
pub(crate) struct DescriptorQueues<T> {
    queues: [VecDeque<T>; 3],
    active: [bool; 3],
    closed: [bool; 3],
    pending: usize,
}

impl<T> Default for DescriptorQueues<T> {
    fn default() -> Self {
        Self {
            queues: std::array::from_fn(|_| VecDeque::new()),
            active: [false; 3],
            closed: [false; 3],
            pending: 0,
        }
    }
}

impl<T> DescriptorQueues<T> {
    pub(crate) fn is_closed(&self, fd: u32) -> bool {
        self.closed.get(fd as usize).copied().unwrap_or(true)
    }

    pub(crate) fn enqueue(&mut self, fd: u32, request: T) -> Result<Option<T>, T> {
        if self.is_closed(fd) || self.pending >= MAX_PENDING_REQUESTS {
            return Err(request);
        }
        let index = fd as usize;
        self.pending += 1;
        if self.active[index] {
            self.queues[index].push_back(request);
            Ok(None)
        } else {
            self.active[index] = true;
            Ok(Some(request))
        }
    }

    pub(crate) fn complete(&mut self, fd: u32) -> Option<T> {
        let index = fd as usize;
        if !self.active.get(index).copied().unwrap_or(false) {
            return None;
        }
        self.pending -= 1;
        let next = self.queues[index].pop_front();
        self.active[index] = next.is_some();
        next
    }

    pub(crate) fn close(&mut self, fd: u32) -> Vec<T> {
        let index = fd as usize;
        let Some(closed) = self.closed.get_mut(index) else {
            return Vec::new();
        };
        *closed = true;
        let queued: Vec<_> = self.queues[index].drain(..).collect();
        self.pending -= queued.len();
        queued
    }
}

#[cfg(test)]
mod tests {
    use super::{DescriptorQueues, PendingRequests, MAX_PENDING_REQUESTS};

    #[test]
    fn admission_is_bounded_and_completion_releases_capacity() {
        let mut pending = PendingRequests::default();
        for key in 0..MAX_PENDING_REQUESTS as u64 {
            pending.try_insert(1, key, key).unwrap();
        }
        assert_eq!(pending.try_insert(1, 99, 99), Err(99));
        pending.try_insert(2, 100, 100).unwrap();
        pending.remove(0);
        pending.try_insert(1, 99, 99).unwrap();
        assert_eq!(pending.count(1), MAX_PENDING_REQUESTS);
        assert_eq!(pending.count(2), 1);
    }

    #[test]
    fn descriptor_writes_keep_order_without_blocking_other_descriptors() {
        let mut lanes = DescriptorQueues::default();
        assert_eq!(lanes.enqueue(1, "one"), Ok(Some("one")));
        assert_eq!(lanes.enqueue(1, "two"), Ok(None));
        assert_eq!(lanes.enqueue(1, "three"), Ok(None));
        assert_eq!(lanes.enqueue(2, "stderr"), Ok(Some("stderr")));
        assert_eq!(lanes.complete(2), None);
        assert_eq!(lanes.complete(1), Some("two"));
        assert_eq!(lanes.complete(1), Some("three"));
        assert_eq!(lanes.complete(1), None);
        assert_eq!(lanes.pending, 0);
    }

    #[test]
    fn close_discards_queued_writes_and_prevents_reopening() {
        let mut lanes = DescriptorQueues::default();
        assert_eq!(lanes.enqueue(1, "active"), Ok(Some("active")));
        assert_eq!(lanes.enqueue(1, "queued"), Ok(None));
        assert_eq!(lanes.close(1), vec!["queued"]);
        assert_eq!(lanes.enqueue(1, "late"), Err("late"));
        assert_eq!(lanes.complete(1), None);
        assert_eq!(lanes.pending, 0);
        assert!(lanes.close(1).is_empty());
    }

    #[test]
    fn service_write_lanes_have_a_second_admission_limit() {
        let mut lanes = DescriptorQueues::default();
        for key in 0..MAX_PENDING_REQUESTS {
            lanes.enqueue(1, key).unwrap();
        }
        assert_eq!(lanes.enqueue(2, 99), Err(99));
        assert_eq!(lanes.close(1).len(), MAX_PENDING_REQUESTS - 1);
        lanes.complete(1);
        assert_eq!(lanes.enqueue(2, 100), Ok(Some(100)));
    }

    #[test]
    fn sequential_streaming_does_not_retain_completed_requests() {
        let mut pending = PendingRequests::default();
        for key in 1..=10_000 {
            pending.insert(7, key, key);
            assert_eq!(pending.remove(key), Some(key));
            assert!(pending.requests.is_empty());
            assert!(pending.commands.is_empty());
        }
        assert!(pending.finish(7).is_empty());
    }

    #[test]
    fn finishing_one_command_preserves_another_commands_requests() {
        let mut pending = PendingRequests::default();
        pending.insert(1, 10, "finished earlier");
        pending.insert(1, 11, "cancel this");
        pending.insert(2, 12, "keep this");
        assert_eq!(pending.remove(10), Some("finished earlier"));
        assert_eq!(pending.finish(1), vec!["cancel this"]);
        assert_eq!(pending.remove(12), Some("keep this"));
        assert!(pending.requests.is_empty());
        assert!(pending.commands.is_empty());
    }

    #[test]
    fn late_completion_and_repeated_finish_are_noops() {
        let mut pending = PendingRequests::default();
        pending.insert(1, 10, "pending");
        assert_eq!(pending.finish(1), vec!["pending"]);
        assert_eq!(pending.remove(10), None);
        assert!(pending.finish(1).is_empty());
        assert!(pending.commands.is_empty());
    }

    #[test]
    fn replacing_a_key_removes_its_previous_owner() {
        let mut pending = PendingRequests::default();
        pending.insert(1, 10, "old");
        pending.insert(2, 10, "new");
        assert!(pending.finish(1).is_empty());
        assert_eq!(pending.remove(10), Some("new"));
        assert!(pending.commands.is_empty());
    }
}
