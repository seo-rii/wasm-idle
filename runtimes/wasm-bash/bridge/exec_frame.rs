//! Proposed wasm_idle_shell_v1 frame decoder. No Wasmer dependencies so its
//! malformed-input contract can be tested before rebuilding the SDK.
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
pub const MAX_STRINGS: usize = 4096;

#[derive(Debug, PartialEq, Eq)]
pub enum FrameError {
    TooLarge,
    Truncated,
    InvalidUtf8,
    EmbeddedNul,
    TrailingBytes,
}

/// Little endian count followed by repeated (u32 byte length, UTF-8 bytes).
/// Counts and lengths describe the contents, including zero-length strings.
pub fn decode(frame: &[u8]) -> Result<Vec<String>, FrameError> {
    if frame.len() > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge);
    }
    let mut position = 0;
    fn u32_at(frame: &[u8], position: &mut usize) -> Result<u32, FrameError> {
        let bytes = frame
            .get(*position..*position + 4)
            .ok_or(FrameError::Truncated)?;
        *position += 4;
        Ok(u32::from_le_bytes(bytes.try_into().unwrap()))
    }
    let count = u32_at(frame, &mut position)? as usize;
    if count > MAX_STRINGS {
        return Err(FrameError::TooLarge);
    }
    let mut strings = Vec::with_capacity(count);
    for _ in 0..count {
        let length = u32_at(frame, &mut position)? as usize;
        let end = position.checked_add(length).ok_or(FrameError::TooLarge)?;
        let bytes = frame.get(position..end).ok_or(FrameError::Truncated)?;
        if bytes.contains(&0) {
            return Err(FrameError::EmbeddedNul);
        }
        strings.push(
            std::str::from_utf8(bytes)
                .map_err(|_| FrameError::InvalidUtf8)?
                .to_owned(),
        );
        position = end;
    }
    if position != frame.len() {
        return Err(FrameError::TrailingBytes);
    }
    Ok(strings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(values: &[&str]) -> Vec<u8> {
        let mut frame = (values.len() as u32).to_le_bytes().to_vec();
        for value in values {
            frame.extend((value.len() as u32).to_le_bytes());
            frame.extend(value.as_bytes());
        }
        frame
    }

    #[test]
    fn preserves_empty_unicode_and_line_boundaries() {
        let values = ["/usr/bin/probe", "", "한글", "a\nb", "a\rb", "", "G0="];
        assert_eq!(decode(&encode(&values)).unwrap(), values);
        assert_eq!(decode(&encode(&[])).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn rejects_every_truncated_prefix() {
        let frame = encode(&["one", "", "한글", "last"]);
        for end in 0..frame.len() {
            assert!(decode(&frame[..end]).is_err(), "accepted prefix {end}");
        }
    }

    #[test]
    fn rejects_counts_lengths_trailing_bytes_and_invalid_strings() {
        assert_eq!(decode(&u32::MAX.to_le_bytes()), Err(FrameError::TooLarge));
        assert_eq!(
            decode(&[1, 0, 0, 0, 255, 255, 255, 255]),
            Err(FrameError::Truncated)
        );
        let mut frame = encode(&[""]);
        frame.push(0);
        assert_eq!(decode(&frame), Err(FrameError::TrailingBytes));
        assert_eq!(decode(&encode(&["x\0y"])), Err(FrameError::EmbeddedNul));
        assert_eq!(
            decode(&[1, 0, 0, 0, 1, 0, 0, 0, 255]),
            Err(FrameError::InvalidUtf8)
        );
        assert_eq!(
            decode(&vec![0; MAX_FRAME_BYTES + 1]),
            Err(FrameError::TooLarge)
        );
    }

    #[test]
    fn string_count_boundary_includes_empty_values() {
        assert_eq!(
            decode(&encode(&vec![""; MAX_STRINGS])).unwrap().len(),
            MAX_STRINGS
        );
        assert_eq!(
            decode(&encode(&vec![""; MAX_STRINGS + 1])),
            Err(FrameError::TooLarge)
        );
    }
}
