#[path = "exec_frame.rs"]
mod exec_frame;

#[test]
fn c_encoder_and_rust_decoder_agree() {
    let root = std::path::PathBuf::from(std::env::var("WASM_IDLE_EXEC_FRAME_FIXTURES").unwrap());
    for (name, expected) in [
        (
            "argv-0.bin",
            vec!["probe", "", "한글", "line\nbreak", "cr\rx", ""],
        ),
        ("env-0.bin", vec!["EMPTY=", "G0=space 한글\n\ry"]),
        ("argv-1.bin", vec![]),
        ("env-1.bin", vec![]),
        ("argv-2.bin", vec![""; exec_frame::MAX_STRINGS]),
        ("env-2.bin", vec![]),
    ] {
        let bytes = std::fs::read(root.join(name)).unwrap();
        assert_eq!(exec_frame::decode(&bytes).unwrap(), expected, "{name}");
    }
    // The C encoder's largest accepted single argument, with a 14-byte path and empty env.
    let bytes = std::fs::read(root.join("argv-3.bin")).unwrap();
    assert_eq!(
        exec_frame::decode(&bytes).unwrap(),
        vec!["x".repeat(exec_frame::MAX_FRAME_BYTES - 26)]
    );
}
