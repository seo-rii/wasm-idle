import {deflate, inflate} from 'zlib';
//@ts-ignore
import {decode, encode} from 'cbor-x';

export function zip(obj: any) {
    return new Promise<Buffer>((resolve, reject) => {
        deflate(encode(obj), {level: 8}, (err, buf) => {
            if (err) reject(err);
            else {
                try {
                    resolve(buf);
                } catch (e) {
                    reject(e);
                }
            }
        });
    });
}

export function unzip(buf: any) {
    return new Promise<any>((resolve, reject) => {
        inflate(buf, (err, str) => {
            if (err) reject(err);
            else {
                try {
                    resolve(decode(<any>str));
                } catch (e) {
                    reject(e);
                }
            }
        });
    });
}