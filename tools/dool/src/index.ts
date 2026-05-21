import koa from 'koa'
import initHttp from './server/http'
import favicon from "koa-favicon";
import {loadLanguages} from "./judge/loader";
import {log, error} from "./log";

const PORT = 80

process.on('uncaughtException', (e) => {
    error(false, 'uncaughtException:', e)
})

async function init() {
    const app = new koa()
    app.use(favicon(__dirname + '/../res/logo.ico'))
    initHttp(app)
    await loadLanguages()
    const server = await app.listen(PORT)
    server.timeout = 5 * 60 * 1000
    log(false, `Server is running on port ${PORT}.`)
}

init().catch(e => {
    error(false, e)
    process.exit(1)
})
