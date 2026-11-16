//! Console host for the unchanged Uiua compiler and interpreter.
use uiua::{RunMode, Uiua};

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        eprintln!("usage: uiua <source.ua> [program arguments]");
        std::process::exit(2);
    };
    let mut runtime = Uiua::with_native_sys()
        .with_args(args.collect())
        .with_file_path(&path);
    let result = runtime.compile_run(|compiler| {
        compiler
            .mode(RunMode::Normal)
            .print_diagnostics(true)
            .load_file(&path)
    });
    runtime.print_reports();
    if let Err(error) = result {
        eprintln!("{}", error.report());
        std::process::exit(1);
    }
    uiua::print_stack_lines(&runtime.take_stack_lines(), false);
}
