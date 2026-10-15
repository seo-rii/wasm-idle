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
    ] {
        let bytes = std::fs::read(root.join(name)).unwrap();
        assert_eq!(exec_frame::decode(&bytes).unwrap(), expected, "{name}");
    }
}
