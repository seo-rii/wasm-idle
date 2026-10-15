//! Compile-only external SDK use of the patched runtime's owned command metadata.
//!
//! This example never starts a guest or returns a fabricated task handle. If
//! invoked as a command, it reports Unsupported after checking the prepared
//! builder. The trusted registry and common descriptor/filesystem route remain
//! unimplemented.

use std::any::Any;

use wasmer::FunctionEnvMut;
use wasmer_wasix::{
    os::{command::VirtualCommand, task::TaskJoinHandle},
    HostCommandSnapshot, SpawnError, WasiEnv,
};

#[derive(Debug)]
pub struct SnapshotCompileProbe;

// Owned Strings/Vecs provide these traits automatically. No JS value, callback,
// FunctionEnvMut, mutable WasiEnv, filesystem handle or unsafe trait impl escapes.
fn owned_snapshot<T: Send + Sync + 'static>(value: T) -> T {
    value
}

pub fn prepared_child_snapshot(
    builder: &Option<WasiEnv>,
) -> Result<HostCommandSnapshot, SpawnError> {
    let child = builder.as_ref().ok_or(SpawnError::UnknownError)?;
    child
        .host_command_snapshot()
        .map(owned_snapshot)
        .map_err(|_| SpawnError::UnknownError)
}

impl VirtualCommand for SnapshotCompileProbe {
    fn name(&self) -> &str {
        "container-snapshot-compile-probe"
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn exec(
        &self,
        _parent_ctx: &FunctionEnvMut<'_, WasiEnv>,
        _path: &str,
        builder: &mut Option<WasiEnv>,
    ) -> Result<TaskJoinHandle, SpawnError> {
        let snapshot = prepared_child_snapshot(builder)?;
        let _metadata = (snapshot.argv(), snapshot.environment(), snapshot.cwd());
        // Compile proof only. Do not register this as an executable command.
        Err(SpawnError::Unsupported)
    }
}

fn main() {}
