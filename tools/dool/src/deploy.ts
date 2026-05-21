import * as util from 'util';
import * as fs from 'fs';
import {ChildProcessWithoutNullStreams, exec, spawn} from 'child_process';

const args = require('args-parser')(process.argv);
const exec_p = util.promisify(exec);

function getElapsedTime() {
    return (Date.now() - buildBeginTime) / 1000
}

const buildBeginTime = Date.now()

function spawnSync(...args: any): Promise<string> {
    return new Promise((resolve, reject) => {
        let out = '';
        // @ts-ignore
        const _ = spawn(...args, {
            cwd: process.cwd(),
            env: process.env,
            stdio: 'pipe',
            encoding: 'utf-8'
        }) as ChildProcessWithoutNullStreams;
        _.stdout.on('data', (data) => {
            data = data.toString();
            out += data;
            process.stdout.write(data);
        });
        _.stderr.on('data', (data) => {
            data = data.toString();
            out += data;
            process.stderr.write(data);
        });
        _.on('error', reject);
        _.on('close', (code) => {
            if (code && code !== 0) {
                reject(new Error(`Command failed with exit code ${code}`));
                return;
            }
            resolve(out);
        })
    })
}

async function main() {
    let _;
    console.log(`Building... (${getElapsedTime()}s)`)
    _ = await spawnSync('pnpm', ['run', args.s ? 'build:docker:s' : 'build:docker']);

    const variant = args.s ? '-s' : '';
    const tag = args.beta ? 'dev' : 'latest';
    const metadataPath = args.s ? '/tmp/dool-s-main-metadata.json' : '/tmp/dool-main-metadata.json';
    let result_main = '';
    console.log(`Resolving image digest... (${getElapsedTime()}s)`)
    if (fs.existsSync(metadataPath)) {
        try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
            result_main = metadata['containerimage.digest'] || '';
            if (result_main) {
                console.log(`Resolved image digest from ${metadataPath}. (${getElapsedTime()}s)`)
            }
        } catch (err) {
            console.warn(`Failed to read ${metadataPath}. (${getElapsedTime()}s)`, err)
        }
    }
    if (!result_main) {
        console.log(`Falling back to registry tag lookup... (${getElapsedTime()}s)`)
        result_main = (await exec_p(
            `gcloud container images list-tags asia.gcr.io/hancomac/dool${variant} --filter="tags:${tag}" --limit=1 --format='get(digest)'`
        )).stdout.toString().trim();
    }
    if (!result_main) throw new Error('Failed to resolve pushed image digest');

    const rv = args.beta ? ['dool-beta'] : (args.s ? ['dool-s05', 'dool-s1', 'dool-s2'] : ['dool', 'dool-r05', 'dool-r1', 'dool-r2', 'dool-r4', 'dool-r8', 'dool-beta']);
    const prs = [];
    console.log(`Deploying... (${getElapsedTime()}s)`)
    for (let i = 0; i < rv.length; i++) {
        prs.push((async () => {
            const rev = (await exec_p(`gcloud run revisions list --region=asia-northeast3 --service=${rv[i]}`)).stdout.toString().split('\n').slice(1).map(el => el.replace('  ', ' ').split(' ')[1]).filter(x => x)
            _ = await exec_p(`gcloud run deploy ${rv[i]} ` +
                `--image=asia.gcr.io/hancomac/dool${variant}@${result_main} ` +
                '--platform=managed ' +
                '--region=asia-northeast3 ' +
                '--project=hancomac ')
            console.log(`Migrating ${rv[i]}... (${getElapsedTime()}s)`)
            _ = await exec_p(`gcloud run services update-traffic ${rv[i]} --to-latest --region=asia-northeast3`)
            console.log(`Deployed ${rv[i]}. (${getElapsedTime()}s)`)
            await Promise.all(rev.slice(1).map(async (el: string) => {
                console.log(`Deleting ${el}... (${getElapsedTime()}s)`)
                _ = await exec_p(`gcloud run revisions delete ${el} --region=asia-northeast3 -q`)
                console.log(`Deleted ${el}. (${getElapsedTime()}s)`)
            }))
        })())
    }
    await Promise.all(prs);

    if (!args.beta) {
        console.log(`Cleaning up base... (${getElapsedTime()}s)`)
        const base_old = JSON.parse((await exec_p(`gcloud container images list-tags asia.gcr.io/hancomac/dool-base${variant} --format=json`)).stdout.toString()).slice(2)
        for (const el of base_old) {
            try {
                _ = await exec_p(`gcloud container images delete asia.gcr.io/hancomac/dool-base${variant}@${el.digest} --force-delete-tags -q`)
                console.log(`Deleted asia.gcr.io/hancomac/dool-base${variant}@${el.digest}. (${getElapsedTime()}s)`)
            } catch (err: any) {
                const errText = `${err?.stderr || ''}${err?.message || ''}`;
                if (errText.includes('Manifest is still referenced by one or more parent images')) {
                    console.log(`Skipped asia.gcr.io/hancomac/dool-base${variant}@${el.digest} because a parent manifest still references it. (${getElapsedTime()}s)`)
                    continue
                }
                throw err
            }
        }

        console.log(`Cleaning up main... (${getElapsedTime()}s)`)
        const main_old = JSON.parse((await exec_p(`gcloud container images list-tags asia.gcr.io/hancomac/dool${variant} --format=json`)).stdout.toString()).slice(2)
        for (const el of main_old) {
            try {
                _ = await exec_p(`gcloud container images delete asia.gcr.io/hancomac/dool${variant}@${el.digest} --force-delete-tags -q`)
                console.log(`Deleted asia.gcr.io/hancomac/dool${variant}@${el.digest}. (${getElapsedTime()}s)`)
            } catch (err: any) {
                const errText = `${err?.stderr || ''}${err?.message || ''}`;
                if (errText.includes('Manifest is still referenced by one or more parent images')) {
                    console.log(`Skipped asia.gcr.io/hancomac/dool${variant}@${el.digest} because a parent manifest still references it. (${getElapsedTime()}s)`)
                    continue
                }
                throw err
            }
        }
    }
}

main().then(() => {
    console.log(`⚡ Done in ${getElapsedTime()}s`)
}).catch(err => {
    console.error(err)
    process.exit(1)
})
