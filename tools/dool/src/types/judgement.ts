import {SourceFile, SourceLanguage} from './source'
import {SubTask} from './dataset'
import {ExecuteLimit} from "./execute";

export type JudgeResultCode = 'AC' | 'WA' | 'RE' | 'TLE' | 'MLE' | 'CE'
export type JudgeProgressCode = 'PD' | 'CP' | 'RUN'
export type JudgeStatusCode = JudgeResultCode | JudgeProgressCode
export type CompileErrorCode =
	| 'CompilationFailed'
	| 'SyntaxError'
	| 'MissingSemicolon'
	| 'BracketMismatch'
	| 'IndentationError'
	| 'UnboundVar'
	| 'TypeMismatch'
	| 'MultipleDefinition'
	| 'UsingBeforeDeclare'
	| 'InvalidPreprocessorDirective'
	| 'ConflictingDeclaration'
	| 'InvalidReturnType'
	| 'MissingReturnValue'
	| 'TemplateInstantiationError'
    | 'ModuleNotFound'
    | 'LinkerError'
    | 'InvalidLanguageVersion'
    | 'MainClassNotFound'
    | 'MainNameConflict'
export type RuntimeErrorCode =
    | 'BrokenPipe'
    | 'StackOverflow'
    | 'AssertionFailed'
    | 'SegmentationFault'
    | 'BusError'
    | 'IllegalInstruction'
    | 'FloatingPointException'
    | 'Aborted'
    | 'Killed'
    | 'OutputLimitExceeded'
    | 'DisallowedSyscall'
    | 'FileOpenNotAllowed'
    | 'PermissionDenied'
    | 'ExecFormatError'
    | 'StaticInitializationFailed'
    | 'OutOfMemory'
    | 'MemoryCorruption'
    | 'BufferOverflow'
    | 'DivisionByZero'
    | 'IntegerOverflow'
    | 'ShiftExponent'
    | 'InvalidIntLiteral'
    | 'FormatArgsMismatch'
    | 'UnsupportedOperand'
    | 'UnpackValueMismatch'
    | 'UnexpectedEof'
    | 'OutOfBounds'
    | 'NullPointer'
    | 'UnboundVar'
    | 'KeyError'
    | 'ValueError'
    | 'RangeError'
    | 'InvalidArgument'
    | 'AttributeError'
    | 'ModuleNotFound'
    | 'IOError'
    | 'FileNotFound'
    | 'NotDirectory'
    | 'Panic'
    | 'Deadlock'
    | 'ConcurrentMapWrites'
export type ErrorCode = RuntimeErrorCode | CompileErrorCode

export const enum JudgeType {
    CommonJudge = 'CommonJudge',
    OutputOnly = 'OutputOnly',
    InteractiveIOJudge = 'InteractiveIOJudge',
    COMPETITIVE = 'COMPETITIVE',
}

interface Additional {
    account?: string
    time?: number
    sca?: string
    contestId?: number
    closed?: boolean
    codepass?: boolean
    images?: JudgeImage[]
}

export interface JudgeImage {
    mime: string
    b64: string
    ts?: number
}

export interface JudgeRequest<TSubTask extends SubTask = SubTask> {
    submissionId: number
    additional?: Additional
    problemId: number
    language: SourceLanguage
    altLanguage?: SourceLanguage
    imgRender?: boolean
    judgeType: JudgeType
    source: SourceFile[]
    dataSet: TSubTask[]
    limit: ExecuteLimit
    ignoreTLE?: boolean
    specialJudge?: {
        language: SourceLanguage
        source: Promise<string>
        printScore: boolean
    }
    interactor?: false | {
        language: SourceLanguage
        source: Promise<string>
    }
    extra?: {
        name: string,
        language: SourceLanguage | 'ANY',
        res?: boolean
    }[]
    static?: {
        name: string,
        content: Uint8Array
    }[]
    fileo?: string
}

export interface JudgeResult {
    m_reason: JudgeStatusCode
    e?: ErrorCode
    score: number
    m_time: number
    m_memory: number
    reason: JudgeResultCode[]
    result: (number[] | number)[]
    time: number[]
    memory: number[]
    example?: {
        input: string
        output?: string
        solution: string
        case: number
        no: number
    }
    message?: string
    language: SourceLanguage
    altLanguage?: SourceLanguage
    source: SourceFile[]
    additional?: Additional
    size: number
}
