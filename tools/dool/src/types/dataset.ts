export interface DataSet {
    data: any
}

export const enum ScoringType {
    PROPORTIONAL = 'PROPORTIONAL',
    QUANTIZED = 'QUANTIZED',
    MINIMUM = 'MINIMUM',
    MAXIMUM = 'MAXIMUM',
}

export interface SubTask extends DataSet {
    scoringType: ScoringType
    score: number
    prev?: number | string
}

export interface OutputOnly extends SubTask {
    data: {
        output: Promise<string>
    }[]
}

export interface CommonDataSet extends SubTask {
    data: {
        input: Promise<string>
        output: Promise<string>
    }[]
}
