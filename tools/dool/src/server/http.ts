import bodyParser from 'koa-bodyparser'
import Application from 'koa'
import Router from 'koa-router'
import {setConfig} from "../config";
import {JudgeRequest} from "../types/judgement";
import validate from "../validate";
import judge from "../judge";
import {changeActiveInstancesCount, registerSubmission} from "./db";
import {publish, sendLiveMessage} from "./pub";
import {PubEvent} from "../types/socket";
import {summaryJudgeInfo} from "../judge/util";
import {error, log} from "../log";
import send from "koa-send";
import serve from "koa-static";

const {version} = require('../../package.json')
const maxRetry = 2;

export default function initHttp(app: Application) {
    app.use(bodyParser({enableTypes: ['json', 'text']}))
    app.use(serve(__dirname + '/../res'))
    const router = new Router()
    router.get('/', async (ctx) => {
        ctx.request.socket.setTimeout(10 * 60 * 1000)
        ctx.body = `DOOL v${version}`
    })
    router.get('/test', async (ctx) => {
        await send(ctx, 'index.html', {root: __dirname + '/../res'});
    })
    router.post('/judge', async (ctx) => {
        ctx.request.socket.setTimeout(10 * 60 * 1000)
        let attempt = 1;
        let data = null;
        let submissionId
        try {
            let body: any = ctx.request.body
            if (typeof body === 'string') {
                body = JSON.parse(body)
            }
            data = body.message ? JSON.parse(Buffer.from(body.message.data, 'base64').toString()) : body
            if (data?.additional?.attempt) attempt = data?.additional?.attempt + 1
            submissionId = data?.additional?.submissionId
            const judgeRequest = {
                additional: data?.additional,
                problemId: data?.problemId,
                language: data?.language,
                altLanguage: data?.altLanguage,
                imgRender: data?.imgRender,
                source: data?.source,
                limit: {
                    time: data?.limit?.time,
                    memory: data?.limit?.memory,
                }
            } as JudgeRequest
            if (!await validate(judgeRequest)) {
                ctx.body = {success: true, data: 'Invalid request'}
                return
            }
            submissionId = await registerSubmission({
                m_reason: 'PD',
                score: 0,
                m_time: 0,
                m_memory: 0,
                result: [],
                reason: [],
                time: [],
                memory: [],
                message: '',
                language: data.language,
                altLanguage: data?.altLanguage,
                ...(data.additional ? {additional: data.additional} : {}),
                source: data.source,
                size: data.source.map((s: { source: string }) => s.source.length).reduce((a: number, b: number) => a + b),
            }, data?.problemId, submissionId, false)
            log(submissionId, 'Judgement start')
            judgeRequest.submissionId = submissionId
            const result = await judge(judgeRequest)
            await Promise.all([
                sendLiveMessage(PubEvent.JUDGE_FINISH, summaryJudgeInfo(data?.problemId, submissionId, result)),
                registerSubmission(result, data?.problemId, submissionId)
            ])
            ctx.body = {success: true, data: submissionId}
        } catch (e: any) {
            error(data?.submissionId, e)
            ctx.body = {success: false, data: e}
            if (data) {
                if (attempt <= maxRetry) {
                    await publish(process.env.JUDGE_FAIL_TOPIC || 'judge-fail', {
                        ...data,
                        problemId: data?.problemId,
                        additional: {...data.additional, attempt, submissionId}
                    })
                    return
                }
                await publish(process.env.JUDGE_RETRY_TOPIC || 'judge', {
                    ...data,
                    problemId: data?.problemId,
                    additional: {...data.additional, attempt, submissionId}
                })
            }
        }
    })
    app.use(router.routes())
    app.use(router.allowedMethods())
    setConfig('useSocket', false)
}
