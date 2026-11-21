// The pinned PHP runtime loads /internal/shared/preload/*.php before the entry
// script, preserving the original source bytes, namespace and line numbers.
export const PHP_PRELOAD_PATH = '/internal/shared/preload/wasm-idle.php';
export const PHP_STDIN_MESSAGE = 'wasm-idle:php:stdin';
export const PHP_PRELOAD = String.raw`<?php
namespace WasmIdle\Runtime;

$argv = json_decode($_SERVER['WASM_IDLE_ARGV'], true, flags: JSON_THROW_ON_ERROR);
$argc = count($argv);
$_SERVER['argv'] = $argv;
$_SERVER['argc'] = $argc;
unset($_SERVER['WASM_IDLE_ARGV']);

if ($_SERVER['WASM_IDLE_TERMINAL_STDIN'] === '1') {
    TerminalInput::install();
}
unset($_SERVER['WASM_IDLE_TERMINAL_STDIN']);
if (!defined('STDIN')) {
    define('STDIN', fopen('php://input', 'rb'));
}

/** php-wasm's request body is fixed before execution. Read terminal data only
 * when PHP actually consumes the input stream, including from required files. */
final class TerminalInput {
    public $context;
    private $native;
    private $position = 0;
    private static $bytes = '';
    private static $ended = false;

    public static function install() {
        stream_wrapper_register('wasm-idle-input', self::class);
        stream_wrapper_unregister('php');
        stream_wrapper_register('php', self::class);
    }

    public function stream_open($path, $mode, $options, &$openedPath) {
        $uri = strtolower($path);
        if (in_array($uri, ['php://input', 'php://stdin', 'wasm-idle-input://stdin'], true)) {
            return $mode[0] === 'r';
        }

        // PHP selects wrappers by scheme. Delegate its other streams to the
        // original backend, including native filters and memory/temp streams.
        // A filter's nested input still needs the demand-driven reader.
        if (str_starts_with($uri, 'php://filter/')) {
            $path = preg_replace('~/resource=php://(?:input|stdin)$~i', '/resource=wasm-idle-input://stdin', $path);
        }
        stream_wrapper_restore('php');
        try {
            $this->native = fopen($path, $mode, (bool) ($options & STREAM_USE_PATH), $this->context);
        } finally {
            stream_wrapper_unregister('php');
            stream_wrapper_register('php', self::class);
        }
        return $this->native !== false;
    }

    private static function readChunk() {
        $chunk = json_decode(post_message_to_js('${PHP_STDIN_MESSAGE}'), true, flags: JSON_THROW_ON_ERROR);
        if ($chunk === null) {
            self::$ended = true;
        } else {
            self::$bytes .= $chunk;
        }
    }

    public function stream_read($count) {
        if ($this->native) return fread($this->native, $count);
        while ($this->position >= strlen(self::$bytes) && !self::$ended) {
            self::readChunk();
        }
        $chunk = substr(self::$bytes, $this->position, $count);
        $this->position += strlen($chunk);
        return $chunk;
    }

    public function stream_eof() {
        return $this->native ? feof($this->native) : self::$ended && $this->position >= strlen(self::$bytes);
    }

    public function stream_tell() {
        return $this->native ? ftell($this->native) : $this->position;
    }

    public function stream_seek($offset, $whence) {
        if ($this->native) return fseek($this->native, $offset, $whence) === 0;
        if ($whence === SEEK_END) {
            while (!self::$ended) self::readChunk();
            $offset += strlen(self::$bytes);
        } elseif ($whence === SEEK_CUR) {
            $offset += $this->position;
        }
        while ($offset > strlen(self::$bytes) && !self::$ended) self::readChunk();
        if ($offset < 0 || $offset > strlen(self::$bytes)) return false;
        $this->position = $offset;
        return true;
    }

    public function stream_write($data) { return $this->native ? fwrite($this->native, $data) : 0; }
    public function stream_flush() { return !$this->native || fflush($this->native); }
    public function stream_close() { if ($this->native) fclose($this->native); }
    public function stream_stat() { return $this->native ? fstat($this->native) : false; }
    public function stream_truncate($size) { return $this->native && ftruncate($this->native, $size); }
    public function stream_lock($operation) { return $this->native && flock($this->native, $operation); }
    public function stream_cast($kind) { return $this->native ?: false; }
    public function url_stat($path, $flags) { return false; }
    public function stream_set_option($option, $arg1, $arg2) {
        if (!$this->native) return false;
        return match ($option) {
            STREAM_OPTION_BLOCKING => stream_set_blocking($this->native, $arg1),
            STREAM_OPTION_READ_TIMEOUT => stream_set_timeout($this->native, $arg1, $arg2),
            STREAM_OPTION_READ_BUFFER => stream_set_read_buffer($this->native, $arg2) === 0,
            STREAM_OPTION_WRITE_BUFFER => stream_set_write_buffer($this->native, $arg2) === 0,
            default => false
        };
    }
}
`;
