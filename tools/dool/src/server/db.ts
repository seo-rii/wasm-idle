import {Datastore, type Transaction} from '@google-cloud/datastore';
import {Storage} from '@google-cloud/storage';
import {JudgeRequest, JudgeResult, JudgeType} from "../types/judgement";
import {summaryJudgeInfo} from "../judge/util";
import {error} from "../log";
import redis from "./redis";
import {sendReRank} from "./pub";
import MultiprocessManager from './manager';

const credentials = JSON.parse(process.env.GCP_SECRET || '{}')

const ds = new Datastore({credentials, projectId: 'hancomac', ...(process.env.GCP_DATABASE_ID_JUNGOL ? {databaseId: process.env.GCP_DATABASE_ID_JUNGOL} : {})});
const cp = new Datastore({credentials, projectId: 'hancomac', databaseId: process.env.GCP_DATABASE_ID_CODEPASS || 'codepass'});
const storage = new Storage({credentials, projectId: 'hancomac'});
const dataBucket = storage.bucket(process.env.GCS_JUDGE_BUCKET || 'jungol-judge-data');
const submissionBucket = storage.bucket(process.env.GCS_SUBMISSION_BUCKET || 'jungol-submission-data');

const TRANSACTION_RETRY_LIMIT = 5;
const TRANSACTION_RETRY_DELAY_MS = 25;

function isRetryableTransactionError(error: any) {
    const code = error?.code;
    if (code === 10 || code === 409 || code === 503 || code === 504) return true;
    const message = typeof error?.message === 'string' ? error.message : '';
    return message.includes('ABORTED') || message.includes('aborted') || message.includes('Conflict');
}

async function safeRollback(transaction: Transaction) {
    try {
        await transaction.rollback();
    } catch (e) {
    }
}

async function backoff(attempt: number) {
    if (attempt <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, TRANSACTION_RETRY_DELAY_MS * attempt));
}

export async function getProblemConfig(data: JudgeRequest) {
    try {
        data = Object.assign({}, data)
        const rawResult = (await ds.get(ds.key(['judge_data_config', data.problemId.toString()])))[0] as JudgeRequest;
        let processedResult = {
            ...data,
            ...rawResult
        };
        const manager = new MultiprocessManager(12);
        if (processedResult.specialJudge) processedResult.specialJudge.source = manager.run(async () => (await (await dataBucket.file(`spj/${data.problemId}/Main`).get())[0].download({validation: false})).toString())
        if (processedResult.interactor) processedResult.interactor.source = manager.run(async () => (await (await dataBucket.file(`interactor/${data.problemId}/Main`).get())[0].download({validation: false})).toString())
        if (processedResult.extra) {
            for (let extraOne of processedResult.extra) {
                if (
                    extraOne.language === processedResult.language ||
                    extraOne.language === processedResult.altLanguage ||
                    extraOne.language === processedResult.interactor?.language ||
                    extraOne.language === 'ANY'
                ) {
                    const content = (await (await dataBucket.file(`extra/${data.problemId}/${extraOne.name}`).get())[0].download({validation: false}));
                    const forSubmission =
                        extraOne.language === processedResult.language ||
                        extraOne.language === processedResult.altLanguage ||
                        extraOne.language === 'ANY';
                    if (!extraOne.res && forSubmission) processedResult.source.push({
                        name: extraOne.name,
                        source: content.toString(),
                    })
                    else {
                        if (!processedResult.static) processedResult.static = []
                        processedResult.static.push({
                            name: extraOne.name,
                            content: content[0]
                        })
                    }
                }
            }
        }
        for (let tc in processedResult.dataSet) {
            const uidList = processedResult.dataSet[tc].data
            processedResult.dataSet[tc].data = []
            for (let uid of uidList) {
                processedResult.dataSet[tc].data.push({
                    input: manager.run(async () => (await dataBucket.file(`data/${data.problemId}/${tc}/${uid}.in`).get())[0].download()),
                    output: processedResult.judgeType === JudgeType.InteractiveIOJudge
                        ? manager.run(async () => {
                            try {
                                return (await dataBucket.file(`data/${data.problemId}/${tc}/${uid}.out`).get())[0].download()
                            } catch (e) {
                                return Buffer.alloc(0)
                            }
                        })
                        : manager.run(async () => (await dataBucket.file(`data/${data.problemId}/${tc}/${uid}.out`).get())[0].download()),
                })
            }
        }
        await manager.join()
        return processedResult as JudgeRequest;
    } catch (e) {
        error(data.submissionId, e)
        return false
    }
}

async function updateVerdictRecord(
    datastoreClient: Datastore,
    vKey: any,
    result: JudgeResult,
    submissionId: number,
    problemId: number,
    rank: boolean
) {
    if (!rank) return;
    const solved = result.m_reason === 'AC';
    for (let attempt = 0; attempt < TRANSACTION_RETRY_LIMIT; attempt++) {
        const transaction = datastoreClient.transaction();
        try {
            await transaction.run();
            const [existing] = await transaction.get(vKey);
            const alreadySolved = Boolean((existing as any)?.r);
            const shouldWrite = !alreadySolved && (solved || !existing);
            if (shouldWrite) {
                transaction.save({
                    key: vKey,
                    data: {
                        r: solved,
                        t: result.additional?.time,
                        i: submissionId,
                        u: result.additional?.account,
                        p: problemId,
                        c: result.additional?.contestId || null
                    }
                })
            }
            await transaction.commit();
            return;
        } catch (e) {
            await safeRollback(transaction);
            if (isRetryableTransactionError(e) && attempt < TRANSACTION_RETRY_LIMIT - 1) {
                await backoff(attempt + 1);
                continue;
            }
            throw e;
        }
    }
}

export async function registerSubmission(result: JudgeResult, problemId: number, mSubmissionId?: number, rank = true) {
    const cl = result.additional?.codepass ? cp : ds;
    const cid = (result.additional?.contestId || 0) > 0 ? result.additional?.contestId : 0;
    const vN = problemId + ':' + result.additional?.account + (cid ? ':' + cid : ''), vKey = ds.key(['v', vN]);

    let prs = [];
    const transaction = ds.transaction();
    await transaction.run()
    const submissionId = mSubmissionId || ((await ds.get(ds.key(['judge_site_config', 'submissionCount'])))[0]?.data || 0) + 1;
    if (!mSubmissionId) transaction.save({
        key: ds.key(['judge_site_config', 'submissionCount']),
        data: {data: submissionId}
    });
    await transaction.commit();

    prs.push(cl.save({
        key: cl.key(['s', submissionId]),
        data: summaryJudgeInfo(problemId, submissionId, result)
    }))

    prs.push(updateVerdictRecord(cl, vKey, result, submissionId, problemId, rank))


    prs.push(redis.del('s:' + submissionId));
    prs.push(redis.del('$s:' + submissionId));
    if (rank) {
        prs.push(redis.del('V' + vN));
        prs.push(redis.del('$V' + vN));
    }

    prs.push((async() => {
        const submissionFile = submissionBucket.file(`${submissionId}.json`);
        try {
            await submissionFile.delete();
        } catch (e) {
        }
        await submissionFile.save(JSON.stringify({...result, submissionId, problemId, sv: 5}));
    })())
    prs.push(sendReRank(submissionId, result.additional?.codepass));

    await Promise.all(prs);
    return submissionId;
}

export async function changeActiveInstancesCount(diff: number) {
    return;
}
