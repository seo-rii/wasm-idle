import {Firestore} from '@google-cloud/firestore';

const firestore = new Firestore();

async function test() {
    // Obtain a document reference.
    const document = firestore.doc('judge/1001');
    const doc = (await document.get()).data();
    console.log(doc);
}

test()