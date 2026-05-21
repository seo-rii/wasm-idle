import {CompileErrorCode, ErrorCode, JudgeResult, JudgeResultCode} from '../types/judgement'
import {FinalDataPS} from "../types/socket";

export {v4 as uuid} from 'uuid'

export function summaryJudgeInfo(problemId: number, submissionId: number, data: JudgeResult) {
    return {
        p: problemId,
        id: submissionId,
        r: data.m_reason,
        e: data.e,
        s: data.score,
        d: data.m_time,
        m: data.m_memory,
        u: data.additional?.account || "",
        l: data.language,
        t: data.additional?.time || Date.now(),
        c: data.additional?.contestId,
        i: data.additional?.closed,
        b: data.size,
        f: data.additional?.sca,
        x: data.additional?.codepass,
        a: data?.altLanguage,
    } as FinalDataPS
}

export function sanitizeCompileMessage(messageText: string) {
    return messageText
        .replaceAll('\r', '')
        .split('\n')
        .filter((line) => {
            const trimmed = line.trim()
            if (!trimmed) return true
            if (/^-{5,}$/.test(trimmed)) return false
            if (/^welcome to \.net/i.test(trimmed)) return false
            if (/^sdk version:/i.test(trimmed)) return false
            if (/^installed an asp\.net core https development certificate\./i.test(trimmed)) return false
            if (/^to trust the certificate, run 'dotnet dev-certs https --trust'/i.test(trimmed))
                return false
            if (/^learn about https:/i.test(trimmed)) return false
            if (/^write your first app:/i.test(trimmed)) return false
            if (/^find out what's new:/i.test(trimmed)) return false
            if (/^explore documentation:/i.test(trimmed)) return false
            if (/^report issues and find source on github:/i.test(trimmed)) return false
            if (/^use 'dotnet --help' to see available commands or visit:/i.test(trimmed))
                return false
            if (/^the template "console app" was created successfully\./i.test(trimmed)) return false
            if (/^an issue was encountered verifying workloads\./i.test(trimmed)) return false
            return true
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function detectCompileErrorCode(normalized: string): CompileErrorCode | undefined {
    if (normalized.includes('indentationerror')) return 'IndentationError'
    if (normalized.includes('taberror')) return 'IndentationError'
    if (normalized.includes('expected \';\'')) return 'MissingSemicolon'
    if (normalized.includes('missing \';\'')) return 'MissingSemicolon'
    if (normalized.includes("expected ',' or ';' before")) return 'MissingSemicolon'
    if (normalized.includes('expected \';\' before')) return 'MissingSemicolon'
    if (normalized.includes('expected \')\'')) return 'BracketMismatch'
    if (normalized.includes('expected \']\'')) return 'BracketMismatch'
    if (normalized.includes('expected \'}\'')) return 'BracketMismatch'
    if (normalized.includes('missing \')\'')) return 'BracketMismatch'
    if (normalized.includes('missing \']\'')) return 'BracketMismatch'
    if (normalized.includes('missing \'}\'')) return 'BracketMismatch'
    if (normalized.includes('not declared in this scope')) return 'UnboundVar'
    if (normalized.includes('undeclared identifier')) return 'UnboundVar'
    if (normalized.includes('use of undeclared identifier')) return 'UnboundVar'
    if (normalized.includes('implicit declaration of function')) return 'UnboundVar'
    if (normalized.includes('unknown type name')) return 'UnboundVar'
    if (normalized.includes('cannot find symbol')) return 'UnboundVar'
    if (normalized.includes('package ') && normalized.includes(' does not exist'))
        return 'ModuleNotFound'
    if (normalized.includes('bad class file')) return 'ModuleNotFound'
    if (normalized.includes('class file contains wrong class')) return 'ModuleNotFound'
    if (normalized.includes('used before declaration')) return 'UsingBeforeDeclare'
    if (normalized.includes('used before its declaration')) return 'UsingBeforeDeclare'
    if (normalized.includes('used before it is declared')) return 'UsingBeforeDeclare'
    if (normalized.includes('multiple definition of')) return 'MultipleDefinition'
    if (normalized.includes('duplicate symbol')) return 'MultipleDefinition'
    if (normalized.includes('redefinition of')) return 'MultipleDefinition'
    if (normalized.includes('is already defined in')) return 'MultipleDefinition'
    if (normalized.includes('template argument') && normalized.includes('invalid'))
        return 'TemplateInstantiationError'
    if (normalized.includes('substitution failed')) return 'TemplateInstantiationError'
    if (normalized.includes('enable_if') && normalized.includes('no type named') && normalized.includes('type'))
        return 'TemplateInstantiationError'
    if (normalized.includes('candidate template')) return 'TemplateInstantiationError'
    if (normalized.includes('instantiation of')) return 'TemplateInstantiationError'
    if (normalized.includes('cannot convert')) return 'TypeMismatch'
    if (normalized.includes('invalid conversion')) return 'TypeMismatch'
    if (normalized.includes('incompatible types')) return 'TypeMismatch'
    if (normalized.includes('bad operand types')) return 'TypeMismatch'
    if (normalized.includes('no suitable method found for')) return 'TypeMismatch'
    if (normalized.includes('no matching function for call')) return 'TypeMismatch'
    if (normalized.includes('cannot initialize')) return 'TypeMismatch'
    if (normalized.includes('assignment from incompatible')) return 'TypeMismatch'
    if (normalized.includes('fatal error:')) {
        if (normalized.includes('no such file or directory')) return 'ModuleNotFound'
        return 'CompilationFailed'
    }
    if (normalized.includes('compilation terminated')) return 'CompilationFailed'
    if (normalized.includes('linker')) return 'LinkerError'
    if (normalized.includes('ld returned') || normalized.includes('linker command failed'))
        return 'LinkerError'
    if (normalized.includes('undefined reference')) return 'UnboundVar'
    if (normalized.includes('invalid preprocessing directive')) return 'InvalidPreprocessorDirective'
    if (normalized.includes('conflicting declaration')) return 'ConflictingDeclaration'
    if (normalized.includes('ambiguating new declaration')) return 'ConflictingDeclaration'
    if (normalized.includes("'main': member names cannot be the same as their enclosing type"))
        return 'MainNameConflict'
    if (normalized.includes('"main": member names cannot be the same as their enclosing type'))
        return 'MainNameConflict'
    if (normalized.includes('member names cannot be the same as their enclosing type'))
        return 'ConflictingDeclaration'
    if (normalized.includes('iso c++ forbids declaration of')) return 'InvalidReturnType'
    if (normalized.includes('return-statement with no value')) return 'MissingReturnValue'
    if (normalized.includes('main method is not static')) return 'MainClassNotFound'
    if (normalized.includes('main method must return a value of type void')) return 'InvalidReturnType'
    if (normalized.includes('tokenmissingerror')) return 'SyntaxError'
    if (normalized.includes('mismatcheddelimitererror')) return 'BracketMismatch'
    if (normalized.includes('compileerror') && normalized.includes('undefined function'))
        return 'UnboundVar'
    if (normalized.includes('compileerror') && normalized.includes('undefined module'))
        return 'ModuleNotFound'
    if (normalized.includes('compileerror')) return 'CompilationFailed'
    if (normalized.includes('class, interface, or enum expected')) return 'SyntaxError'
    if (normalized.includes('illegal start of expression')) return 'SyntaxError'
    if (normalized.includes('reached end of file while parsing')) return 'SyntaxError'
    if (normalized.includes('unclosed string literal')) return 'SyntaxError'
    if (normalized.includes('not a statement')) return 'SyntaxError'
    if (normalized.includes("expected '}' at end of input")) return 'BracketMismatch'
    if (normalized.includes('missing terminating') || normalized.includes('error: expected'))
        return 'SyntaxError'
    if (normalized.includes('main method not found') || normalized.includes('no main manifest attribute'))
        return 'MainClassNotFound'
    if (normalized.includes('could not find or load main class')) return 'MainClassNotFound'
    if (normalized.includes('invalid source release') || normalized.includes('unsupported release'))
        return 'InvalidLanguageVersion'
    if (normalized.includes('release version') && normalized.includes('not supported'))
        return 'InvalidLanguageVersion'
    return undefined
}

export function detectErrorCode(message?: string): ErrorCode | undefined {
    if (!message) return undefined
    const normalized = message
        .toLowerCase()
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
    const hasToken = (token: string) =>
        new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`).test(normalized)
    const matchExitCode = normalized.match(/exit\s+code\s*([0-9]+)/)

    if (normalized.includes('not enough heap memory to reserve minor heaps'))
        return 'OutOfMemory'

    const compileCode = detectCompileErrorCode(normalized)
    if (compileCode) return compileCode

    if (normalized.includes('broken pipe')) return 'BrokenPipe'

    if (normalized.includes('stack overflow')) return 'StackOverflow'
    if (normalized.includes('stack size exceeded')) return 'StackOverflow'
    if (normalized.includes('maximum call stack size exceeded')) return 'StackOverflow'
    if (normalized.includes('systemstackerror')) return 'StackOverflow'
    if (normalized.includes('stackoverflowerror')) return 'StackOverflow'

    if (normalized.includes('stack smashing')) return 'BufferOverflow'
    if (normalized.includes('buffer overflow')) return 'BufferOverflow'

    if (normalized.includes('invalid pointer') || normalized.includes('munmap_chunk(): invalid pointer'))
        return 'MemoryCorruption'
    if (normalized.includes('double free')) return 'MemoryCorruption'
    if (normalized.includes('invalid next size')) return 'MemoryCorruption'
    if (normalized.includes('memory corruption')) return 'MemoryCorruption'
    if (normalized.includes('corrupted double-linked list')) return 'MemoryCorruption'
    if (normalized.includes('misaligned address')) return 'MemoryCorruption'
    if (normalized.includes('insufficient space')) return 'MemoryCorruption'

    if (normalized.includes('segmentation fault') || normalized.includes('sigsegv'))
        return 'SegmentationFault'
    if (normalized.includes('command terminated by signal 11')) return 'SegmentationFault'
    if (normalized.includes('segfault')) return 'SegmentationFault'
    if (normalized.includes('bus error') || normalized.includes('sigbus')) return 'BusError'
    if (normalized.includes('illegal instruction') || normalized.includes('sigill'))
        return 'IllegalInstruction'
    if (normalized.includes('floating point exception') || normalized.includes('sigfpe'))
        return 'FloatingPointException'
    if (normalized.includes('terminate called after throwing')) {
        if (normalized.includes('std::bad_alloc') || normalized.includes('bad_alloc'))
            return 'OutOfMemory'
        if (normalized.includes('std::length_error')) return 'RangeError'
        if (normalized.includes('std::out_of_range')) return 'OutOfBounds'
        if (normalized.includes('std::invalid_argument')) return 'InvalidArgument'
        return 'Aborted'
    }
    if (normalized.includes('aborted') || normalized.includes('sigabrt'))
        return normalized.includes('assert') ? 'AssertionFailed' : 'Aborted'
    if (normalized.includes('assertion failed')) return 'AssertionFailed'
    if (normalized.includes('assertionerror')) return 'AssertionFailed'
    if (normalized.includes('assert')) return 'AssertionFailed'
    if (normalized.includes('killed') || normalized.includes('sigkill')) return 'Killed'

    if (normalized.includes('disallowed syscall')) return 'DisallowedSyscall'
    if (normalized.includes('not allowed to open') || normalized.includes('opening files is not allowed'))
        return 'FileOpenNotAllowed'
    if (normalized.includes('permission denied') || normalized.includes('eacces'))
        return 'PermissionDenied'
    if (normalized.includes('accesscontrolexception')) return 'PermissionDenied'
    if (normalized.includes('output limit exceeded') || normalized.includes('file size limit exceeded'))
        return 'OutputLimitExceeded'
    if (normalized.includes('sigxfsz')) return 'OutputLimitExceeded'
    if (normalized.includes('exec format error')) return 'ExecFormatError'
    if (normalized.includes('failed initializing')) return 'StaticInitializationFailed'

    if (normalized.includes('out of memory') || normalized.includes('std::bad_alloc'))
        return 'OutOfMemory'
    if (normalized.includes('gc heap initialization failed')) return 'OutOfMemory'
    if (normalized.includes('failed to create coreclr')) return 'OutOfMemory'
    if (normalized.includes('bad_array_new_length')) return 'OutOfMemory'
    if (normalized.includes('0x8007000e')) return 'OutOfMemory'
    if (normalized.includes('failed to create super carrier')) return 'OutOfMemory'
    if (normalized.includes('failed to create main carrier')) return 'OutOfMemory'
    if (normalized.includes('nomemoryerror')) return 'OutOfMemory'
    if (normalized.includes('memoryerror')) return 'OutOfMemory'
    if (normalized.includes('outofmemoryerror')) return 'OutOfMemory'

    if (normalized.includes('division by zero')) return 'DivisionByZero'
    if (normalized.includes('zerodivisionerror')) return 'DivisionByZero'
    if (normalized.includes('/ by zero')) return 'DivisionByZero'
    if (normalized.includes('integer divide by zero')) return 'DivisionByZero'
    if (normalized.includes('arithmeticexception')) return 'DivisionByZero'
    if (normalized.includes('integer overflow')) return 'IntegerOverflow'
    if (normalized.includes('signed integer overflow')) return 'IntegerOverflow'
    if (normalized.includes('shift exponent') || normalized.includes('shift too'))
        return 'ShiftExponent'

    if (normalized.includes('recursionerror')) return 'StackOverflow'

    if (normalized.includes('invalid literal for int')) return 'InvalidIntLiteral'
    if (normalized.includes('syntaxerror')) return 'SyntaxError'
    if (normalized.includes('expected \':\'')) return 'SyntaxError'
    if (normalized.includes('invalid syntax')) return 'SyntaxError'
    if (normalized.includes('not all arguments converted during string formatting'))
        return 'FormatArgsMismatch'
    if (normalized.includes('not enough arguments for format string'))
        return 'FormatArgsMismatch'
    if (normalized.includes('unsupported format character')) return 'FormatArgsMismatch'
    if (normalized.includes('typeerror') && normalized.includes('format:'))
        return 'FormatArgsMismatch'
    if (normalized.includes('illegalformatconversionexception')) return 'FormatArgsMismatch'
    if (normalized.includes('unknownformatconversionexception')) return 'FormatArgsMismatch'
    if (normalized.includes('illegalformatexception')) return 'FormatArgsMismatch'
    if (normalized.includes('invalid operands of types')) return 'TypeMismatch'
    if (normalized.includes('unsupported operand type')) return 'UnsupportedOperand'
    if (normalized.includes('not enough values to unpack')) return 'UnpackValueMismatch'

    if (normalized.includes('eoferror')) return 'UnexpectedEof'
    if (normalized.includes('unexpected eof')) return 'UnexpectedEof'

    if (normalized.includes('out of bounds') || normalized.includes('outofbounds'))
        return 'OutOfBounds'
    if (normalized.includes('index out of bounds')) return 'OutOfBounds'
    if (normalized.includes('index out of range')) return 'OutOfBounds'
    if (normalized.includes('indexerror')) return 'OutOfBounds'
    if (normalized.includes('indexoutofrange')) return 'OutOfBounds'
    if (normalized.includes('indexoutofbounds')) return 'OutOfBounds'
    if (normalized.includes('indexoutofboundsexception')) return 'OutOfBounds'
    if (normalized.includes('arrayindexoutofboundsexception')) return 'OutOfBounds'
    if (normalized.includes('stringindexoutofboundsexception')) return 'OutOfBounds'
    if (normalized.includes('slice bounds out of range')) return 'OutOfBounds'
    if (normalized.includes('len out of range')) return 'OutOfBounds'
    if (normalized.includes('cap out of range')) return 'OutOfBounds'
    if (normalized.includes('std::out_of_range')) return 'OutOfBounds'

    if (normalized.includes('nullpointerexception')) return 'NullPointer'
    if (normalized.includes('null pointer')) return 'NullPointer'
    if (normalized.includes('load of null')) return 'NullPointer'
    if (normalized.includes('store to null')) return 'NullPointer'
    if (normalized.includes('access null pointer')) return 'NullPointer'
    if (normalized.includes('nil map')) return 'NullPointer'
    if (normalized.includes('never be null')) return 'NullPointer'

    if (normalized.includes('nameerror')) return 'UnboundVar'
    if (normalized.includes('referenceerror')) return 'UnboundVar'
    if (normalized.includes('unboundlocalerror')) return 'UnboundVar'
    if (normalized.includes('undefinedfunctionerror')) return 'UnboundVar'
    if (normalized.includes('classnotfoundexception')) return 'ModuleNotFound'
    if (normalized.includes('noclassdeffounderror')) return 'ModuleNotFound'

    if (normalized.includes('keyerror')) return 'KeyError'
    if (normalized.includes('typeerror')) return 'TypeMismatch'
    if (normalized.includes('classcastexception')) return 'TypeMismatch'
    if (normalized.includes('arraystoreexception')) return 'TypeMismatch'
    if (normalized.includes('interface conversion')) return 'TypeMismatch'
    if (normalized.includes('valueerror')) return 'ValueError'
    if (normalized.includes('invalid number')) return 'ValueError'
    if (normalized.includes('rangeerror')) return 'RangeError'
    if (normalized.includes('std::length_error')) return 'RangeError'
    if (normalized.includes('value out of range')) return 'RangeError'
    if (normalized.includes('overflowerror')) return 'RangeError'
    if (normalized.includes('attributeerror')) return 'AttributeError'
    if (normalized.includes('nomethoderror')) return 'AttributeError'
    if (normalized.includes('importerror')) return 'ModuleNotFound'
    if (normalized.includes('loaderror')) return 'ModuleNotFound'
    if (normalized.includes('ioerror')) return 'IOError'
    if (normalized.includes('ioexception')) return 'IOError'
    if (normalized.includes('filenotfounderror')) return 'FileNotFound'
    if (normalized.includes('filenotfoundexception')) return 'FileNotFound'
    if (normalized.includes('enoent')) return 'FileNotFound'
    if (normalized.includes('modulenotfounderror')) return 'ModuleNotFound'
    if (normalized.includes('cannot find module')) return 'ModuleNotFound'
    if (normalized.includes('enotdir')) return 'NotDirectory'
    if (normalized.includes('not a directory')) return 'NotDirectory'

    if (normalized.includes('argumenterror')) return 'InvalidArgument'
    if (normalized.includes('functionclauseerror')) return 'InvalidArgument'
    if (normalized.includes('argumentexception')) return 'InvalidArgument'
    if (normalized.includes('argumentnullexception')) return 'InvalidArgument'
    if (normalized.includes('argumentoutofrangeexception')) return 'InvalidArgument'
    if (normalized.includes('illegalargumentexception')) return 'InvalidArgument'
    if (normalized.includes('illegalstateexception')) return 'InvalidArgument'
    if (normalized.includes('nosuchelementexception')) return 'InvalidArgument'
    if (normalized.includes('emptystackexception')) return 'InvalidArgument'
    if (normalized.includes('negativearraysizeexception')) return 'InvalidArgument'
    if (normalized.includes('unsupportedoperationexception')) return 'InvalidArgument'
    if (normalized.includes('invalid argument')) return 'InvalidArgument'
    if (normalized.includes('inputmismatchexception')) return 'InvalidArgument'
    if (normalized.includes('numberformatexception')) return 'InvalidArgument'

    if (normalized.includes('deadlock')) return 'Deadlock'
    if (normalized.includes('concurrent map writes')) return 'ConcurrentMapWrites'
    if (normalized.includes('concurrentmodificationexception')) return 'ConcurrentMapWrites'
    if (normalized.includes('panic')) return 'Panic'

    if (normalized.includes('main method must return')) return 'MissingReturnValue'

    return undefined
}

export function isSame(in1: string, in2: string): boolean {
    let res1 = in1.replaceAll('\r\n', '\n')
            .split('\n')
            .map((str) => str.trimEnd())
            .filter((x) => x),
        res2 = in2.replaceAll('\r\n', '\n')
            .split('\n')
            .map((str) => str.trimEnd())
            .filter((x) => x)
    return res1.length === res2.length && res1.every((x, i) => x === res2[i])
}

export function representativeResult(results: JudgeResultCode[]) {
    if (results.includes('CE')) return 'CE'
    if (results.includes('RE')) return 'RE'
    if (results.includes('TLE')) return 'TLE'
    if (results.includes('MLE')) return 'MLE'
    if (results.includes('WA')) return 'WA'
    return 'AC'
}

export function tryIt(command: any) {
    try {
        command()
    } catch (e) {
    }
}

export function timeOut(f: any, timeout: number, defaultValue: any) {
    return new Promise((resolve, reject) => {
        let timer = setTimeout(() => {
            resolve(defaultValue)
        }, timeout)
        f.then((r: any) => {
            clearTimeout(timer)
            resolve(r)
        }).catch((e: any) => {
            clearTimeout(timer)
            reject(e)
        })
    })
}
