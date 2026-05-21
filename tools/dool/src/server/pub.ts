import {FinalDataPS, LiveDataPS, ImgDataPS, PubEvent} from "../types/socket";
import {PubSub} from "@google-cloud/pubsub";

const credentials = JSON.parse(process.env.GCP_SECRET || '{}')

const ps = new PubSub({credentials, projectId: 'hancomac'});

export async function publish(topic: string, json: any) {
    return await ps.topic(topic).publishMessage({json});
}

export async function sendLiveMessage(
    messageType: PubEvent,
    data: Partial<LiveDataPS | FinalDataPS | ImgDataPS>
) {
    return await publish(process.env.LIVE_TOPIC || 'live', {
        type: messageType,
        data: data
    });
}

export async function sendReRank(problemId: number, codepass?: boolean) {
    return await publish(process.env.RANK_TOPIC || (codepass ? 'rank-cp' : 'rank'), {
        id: problemId, type: 'judge'
    });
}
