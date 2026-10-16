//! Exit classification shared by the SDK's legacy and streaming completion APIs.
//!
//! The WASIX integration supplies an explicit guest exit code only when its
//! runtime error chain contains one. Setup failures and traps retain their
//! diagnostic instead of becoming an indistinguishable guest exit 1.

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ExitCondition {
    Exited(i32),
    Failed(String),
}

impl ExitCondition {
    pub(crate) fn from_classified(result: Result<(), (Option<i32>, String)>) -> Self {
        match result {
            Ok(()) => Self::Exited(0),
            Err((Some(code), _)) => Self::Exited(code),
            Err((None, message)) => Self::Failed(message),
        }
    }

    pub(crate) fn legacy_code(&self) -> i32 {
        match self {
            Self::Exited(code) => *code,
            Self::Failed(_) => 1,
        }
    }

    pub(crate) fn into_streaming_code(self) -> Result<i32, String> {
        match self {
            Self::Exited(code) => Ok(code),
            Self::Failed(message) => Err(message),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ExitCondition;

    #[test]
    fn successful_completion_is_exit_zero_for_both_apis() {
        let status = ExitCondition::from_classified(Ok(()));
        assert_eq!(status.legacy_code(), 0);
        assert_eq!(status.into_streaming_code(), Ok(0));
    }

    #[test]
    fn explicit_guest_exit_is_never_a_host_failure() {
        for code in [0, 1, 23, 126, 255] {
            let status = ExitCondition::from_classified(Err((Some(code), "guest exit".into())));
            assert_eq!(status.legacy_code(), code);
            assert_eq!(status.into_streaming_code(), Ok(code));
        }
    }

    #[test]
    fn startup_and_trap_errors_reject_only_the_streaming_api() {
        for message in ["current directory is missing", "guest memory trap"] {
            let status = ExitCondition::from_classified(Err((None, message.into())));
            assert_eq!(status.legacy_code(), 1);
            assert_eq!(status.into_streaming_code(), Err(message.into()));
        }
    }
}
