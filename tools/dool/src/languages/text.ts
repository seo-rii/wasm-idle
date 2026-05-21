import {JudgeRequest, JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'
import {OutputOnly} from '../types/dataset'
import {sendLiveMessage} from '../server/pub'
import {JudgeResult} from '../types/judgement'
import {isSame, uuid} from "../judge/util";
import {PubEvent} from "../types/socket";

export function judge(
    data: JudgeRequest<OutputOnly>
) {
    return new Promise<JudgeResult>((resolve) => {
        const uid = uuid()
        let match = Array(data.dataSet.length).fill(0)
        for (const s in data.source) {
            for (const i in data.dataSet) {
                if (
                    isSame(
                        data.source[s].source,
                        data.dataSet[i].data[0].output
                    )
                ) {
                    match[i] = true
                }
            }
            sendLiveMessage(PubEvent.JUDGE_PROGRESS, {
                uid: uid,
                progress: (parseInt(s) + 1) / data.source.length,
                reason: 'RUN',
            })
        }
        resolve({
            m_reason: 'WA',
            m_time: 0,
            m_memory: 0,
            result: match,
            reason: match.map((m) => (m ? 'AC' : 'WA')),
            time: Array(data.dataSet.length).fill(0),
            memory: Array(data.dataSet.length).fill(0),
        })
    })
}

export function getLanguage() {
    return SourceLanguage.TEXT
}

export function getExtension() {
    return 'txt'
}

export function getSupportedType() {
    return [JudgeType.OutputOnly]
}

export function getTimeLimit(baseTime: number) {
    return 0
}

export function getMemoryLimit(baseMemory: number) {
    return 0
}
