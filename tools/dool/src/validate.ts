import {JudgeRequest} from "./types/judgement";
import {hasLanguage} from "./judge/loader";
import {Validator} from "jsonschema";

const validator = new Validator();

const object = 'object'
const string = 'string'
const number = 'number'
const array = 'array'

const schema = {
    id: "/JudgeRequest",
    type: object,
    properties: {
        problemId: {type: number},
        language: {type: string},
        source: {
            type: array, items: {
                properties: {
                    name: {type: string},
                    source: {type: string}
                },
                required: ["name", "source"]
            }
        },
        limit: {
            type: object,
            properties: {
                time: {type: number},
                memory: {type: number},
            },
            required: ["time", "memory"]
        }
    }
};

export default async function validate(judgeRequest: JudgeRequest) {
    if (!validator.validate(judgeRequest, schema).valid) return false
    return await hasLanguage(judgeRequest.altLanguage || judgeRequest.language);
}