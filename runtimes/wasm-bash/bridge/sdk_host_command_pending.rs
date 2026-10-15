//! Outstanding requests grouped by their owning host command.
//!
//! Completion removes both indexes immediately. A command that streams for a
//! long time therefore retains only its concurrent requests, not its history.
//! This module has no JavaScript dependencies so ownership can be tested natively.

use std::collections::{HashMap, HashSet};

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

#[cfg(test)]
mod tests {
    use super::PendingRequests;

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
