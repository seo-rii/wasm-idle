import {ScoringType, SubTask} from "../types/dataset";
import {JudgeRequest, JudgeResult, JudgeType} from "../types/judgement";
import commonJudge from "./commonJudge";
import {loadLanguage} from "./loader";
import {getProblemConfig} from "../server/db";
import {detectErrorCode, timeOut} from "./util";
import {log} from "../log";

export default async function judge(data: JudgeRequest): Promise<JudgeResult> {
    let beginTimer = Date.now();
    let sourceSize = data.source.map((s: { source: string }) => s.source.length).reduce((a: number, b: number) => a + b)
    const languageModule = await loadLanguage(data.altLanguage || data.language)
    const problemData = await getProblemConfig(data)
    log(data.submissionId, 'Got problem config')
    if (!problemData) return {
        m_reason: 'CE',
        score: 0,
        m_time: 0,
        m_memory: 0,
        result: data.dataSet.map((subtask: SubTask) => {
            switch (subtask.scoringType) {
                case ScoringType.MAXIMUM:
                case ScoringType.MINIMUM:
                case ScoringType.QUANTIZED:
                    return 0
                case ScoringType.PROPORTIONAL:
                    return Array(subtask.data.length).fill(0)
            }
        }),
        reason: Array(data.dataSet.length).fill('CE'),
        message: 'Cannot get problem data',
        e: detectErrorCode('Cannot get problem data'),
        time: Array(data.dataSet.length).fill(0),
        memory: Array(data.dataSet.length).fill(0),
        language: data.language,
        altLanguage: data.altLanguage,
        ...(data.additional ? {additional: data.additional} : {})
    } as JudgeResult
    let judge = null as any
    if (
        languageModule &&
        (
            languageModule.getSupportedType().includes(problemData.judgeType) ||
            (
                problemData.judgeType === JudgeType.InteractiveIOJudge &&
                languageModule.getSupportedType().includes(JudgeType.CommonJudge)
            )
        )
    ) {
        if (languageModule.judge) judge = languageModule.judge
        else
            judge = (problemData: JudgeRequest) =>
                commonJudge(
                    problemData,
                    languageModule.build as (
                        path: string,
                        uid: string
                    ) => string,
                    languageModule.getExecuteCommand as (
                        path: string,
                        uid: string
                    ) => string,
                    languageModule.getExtension(),
                    sourceSize,
                    languageModule.mergeBuildErrorStreams ? 'merge' : 'default'
                )
        return await timeOut(judge({
            ...problemData,
            limit: {
                memory: languageModule.getMemoryLimit(problemData.limit?.memory || 0),
                time: languageModule.getTimeLimit(problemData.limit?.time || 0)
            }
        }), 295 * 1000 - (Date.now() - beginTimer), {
            m_reason: 'TLE',
            score: 0,
            m_time: 0,
            m_memory: 0,
            result: problemData.dataSet.map((subtask: SubTask) => {
                switch (subtask.scoringType) {
                    case ScoringType.MAXIMUM:
                    case ScoringType.MINIMUM:
                    case ScoringType.QUANTIZED:
                        return 0
                    case ScoringType.PROPORTIONAL:
                        return Array(subtask.data.length).fill(0)
                }
            }),
            reason: Array(problemData.dataSet.length).fill('TLE'),
            message: 'Total Judgement Time must be less than 300s (5 minutes).',
            e: detectErrorCode('Total Judgement Time must be less than 300s (5 minutes).'),
            time: Array(problemData.dataSet.length).fill(0),
            memory: Array(problemData.dataSet.length).fill(0),
            language: problemData.language,
            altLanguage: data.altLanguage,
            ...(problemData.additional ? {additional: problemData.additional} : {}),
            source: problemData.source
        }) as JudgeResult
    }
    log(data.submissionId, 'Judgement not supported')

    return {
        m_reason: 'CE',
        score: 0,
        m_time: 0,
        m_memory: 0,
        result: problemData.dataSet.map((subtask: SubTask) => {
            switch (subtask.scoringType) {
                case ScoringType.MAXIMUM:
                case ScoringType.MINIMUM:
                case ScoringType.QUANTIZED:
                    return 0
                case ScoringType.PROPORTIONAL:
                    return Array(subtask.data.length).fill(0)
            }
        }),
        reason: Array(problemData.dataSet.length).fill('CE'),
        message: 'Unknown judge type',
        e: detectErrorCode('Unknown judge type'),
        time: Array(problemData.dataSet.length).fill(0),
        memory: Array(problemData.dataSet.length).fill(0),
        language: problemData.language,
        altLanguage: data.altLanguage,
        ...(problemData.additional ? {additional: problemData.additional} : {}),
        source: problemData.source,
        size: sourceSize,
    }
}
