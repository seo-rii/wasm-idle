const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const Externalize = {
    name: 'make-all-packages-external',
    setup(build) {
        let filter = /^[^.\/]|^\.[^.\/]|^\.\.[^\/]/
        build.onResolve({filter}, (args) => {
            if (args.kind !== 'entry-point') return {
                path: args.path,
                external: true,
            }
            return {path: args.path}
        })
    },
}

function getElapsedTime() {
    return (Date.now() - buildBeginTime) / 1000
}

const buildBeginTime = Date.now()

async function init() {
    try {
        console.log(`Building entry file... (${getElapsedTime()}s)`)
        await esbuild.build({
            entryPoints: ['src/index.ts'],
            outfile: 'build/index.js',
            bundle: true,
            loader: {'.ts': 'ts'},
            plugins: [Externalize],
            minify: true,
        })

        console.log(`Building test file... (${getElapsedTime()}s)`)
        await esbuild.build({
            entryPoints: ['src/test.ts'],
            outfile: 'build/test.js',
            bundle: true,
            loader: {'.ts': 'ts'},
            plugins: [Externalize],
            minify: true,
        })

        console.log(`Building language modules... (${getElapsedTime()}s)`)
        const files = fs.readdirSync(path.join(__dirname, 'src', 'languages'))
        for (let file of files) {
            await esbuild.build({
                entryPoints: [path.join(__dirname, 'src', 'languages', file)],
                outfile: path.join(__dirname, 'build', 'languages', file.replace('.ts', '.js')),
                bundle: true,
                loader: {'.ts': 'ts'},
                plugins: [Externalize],
                format: 'cjs',
            })
        }

        console.log(`Building deployment file... (${getElapsedTime()}s)`)
        await esbuild.build({
            entryPoints: ['src/deploy.ts'],
            outfile: 'build/deploy.js',
            bundle: true,
            loader: {'.ts': 'ts'},
            plugins: [Externalize],
            minify: true,
        })

        console.log(`⚡ Done in ${getElapsedTime()}s`)
    } catch (e) {
        console.error(e)
    }
}

init()
