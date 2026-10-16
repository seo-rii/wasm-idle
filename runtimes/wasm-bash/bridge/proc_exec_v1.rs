//! Optional wasm32 host-port entry. This is not a new WASIX standard syscall.
use super::*;
use crate::syscalls::*;
use wasmer::FromToNativeWasmType;

pub fn proc_exec_v1(
    mut ctx: FunctionEnvMut<'_, WasiEnv>,
    name: WasmPtr<u8, Memory32>,
    name_len: u32,
    args: WasmPtr<u8, Memory32>,
    args_len: u32,
    envs: WasmPtr<u8, Memory32>,
    envs_len: u32,
    flags: u32,
) -> Result<Errno, WasiError> {
    WasiEnv::do_pending_operations(&mut ctx)?;
    if let Some(exit_code) = unsafe { handle_rewind::<Memory32, i32>(&mut ctx) } {
        let exit_code = ExitCode::from_native(exit_code);
        ctx.data().process.terminate(exit_code);
        return Err(WasiError::Exit(exit_code));
    }
    if flags > 1
        || name_len == 0
        || name_len > 4096
        || u64::from(name_len) + u64::from(args_len) + u64::from(envs_len)
            > exec_frame::MAX_FRAME_BYTES as u64
        || (flags == 1 && (!envs.is_null() || envs_len != 0))
    {
        return Ok(Errno::Inval);
    }
    let memory = unsafe { ctx.data().memory_view(&ctx) };
    let name = wasi_try_mem_ok!(name.read_utf8_string(&memory, name_len));
    if name.as_bytes().contains(&0) {
        return Ok(Errno::Inval);
    }
    let args = wasi_try_mem_ok!(args.slice(&memory, args_len));
    let args = wasi_try_mem_ok!(args.read_to_vec());
    let args = match exec_frame::decode(&args) {
        Ok(args) => args,
        Err(_) => return Ok(Errno::Inval),
    };
    let envs = if flags == 1 {
        None
    } else {
        let envs = wasi_try_mem_ok!(envs.slice(&memory, envs_len));
        let envs = wasi_try_mem_ok!(envs.read_to_vec());
        let envs = match exec_frame::decode(&envs) {
            Ok(envs) => envs,
            Err(_) => return Ok(Errno::Inval),
        };
        let mut keys = std::collections::HashSet::new();
        let mut parsed = Vec::with_capacity(envs.len());
        for entry in envs {
            let Some((key, value)) = entry.split_once('=') else {
                return Ok(Errno::Inval);
            };
            if key.is_empty() || !keys.insert(key.to_owned()) {
                return Ok(Errno::Inval);
            }
            parsed.push((key.to_owned(), value.to_owned()));
        }
        Some(parsed)
    };
    drop(memory);
    proc_exec_decoded::<Memory32>(ctx, name, args, envs, Bool::False, WasmPtr::null(), 0)
}
