import {createClient, commandOptions, type RedisClientType} from 'redis';
import {zip as enzip, unzip} from "./zip";

let client: RedisClientType | null, cp: RedisClientType | null, errorTime = 0, logTime = 0;

export type RedisSetOption = {
    EX?: number;
} | undefined;

export type RedisGetOption = undefined;

export function connect() {
    const host = process.env.REDIS_HOST;
    return new Promise<RedisClientType | null>(async (resolve) => {
        if (client || Date.now() - errorTime < 60000) {
            resolve(client);
            return;
        }
        try {
            client = createClient({url: host});
            cp = createClient({url: host});
            client.on('error', (err) => {
                if (Date.now() - logTime > 60000) {
                    console.error('Redis Client Error', err);
                    logTime = Date.now();
                }
                client = null;
                errorTime = Date.now();
                resolve(client);
            });
            await client?.connect?.();
            //await cp?.connect?.();
            resolve(client);
        } catch (err) {
            if (Date.now() - logTime > 60000) {
                console.error('Redis Client Error', err);
                logTime = Date.now();
            }
            client = null;
            errorTime = Date.now();
            resolve(null);
        }
    })
}

export async function del(key: string) {
    const redisClient = await connect();
    if (!redisClient) throw new Error('Redis connection failed');
    //if (!cp) throw new Error('Redis connection failed');
    //await cp.del(key);
    return await redisClient.del(key);
}

const redis = {
    del,
}

export default redis;