/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { RANKINGS_COLL } from '../utils/constants';
import { pixelScoreDb } from '../utils/firestore';
import FirestoreBatchHandler from '../utils/firestoreBatchHandler';

const pixelScoreDbBatchHandler = new FirestoreBatchHandler(pixelScoreDb);

export async function main() {
  // fetch collections from firestore
  console.log('============================== Fetching rankings from firestore =================================');
  let startAfter = 0;
  const offsetFile = path.join(__dirname, 'prv-offset.txt');
  if (existsSync(offsetFile)) {
    startAfter = parseInt(readFileSync(offsetFile, 'utf8'));
  }
  const limit = 500;
  let done = false;
  while (!done) {
    console.log('================ START AFTER ===============', startAfter, 'limit', limit);
    const docSnap = await pixelScoreDb
      .collection(RANKINGS_COLL)
      .orderBy('pixelRank', 'asc')
      .startAfter(startAfter)
      .limit(limit)
      .get();

    for (const doc of docSnap.docs) {
      pixelScoreDbBatchHandler.add(doc.ref, { pixelRankVisible: false }, { merge: true });
    }

    // update cursor
    startAfter = docSnap.docs[docSnap.size - 1].get('pixelRank');

    // break condition
    if (docSnap.size < limit) {
      done = true;
    }

    writeFileSync(offsetFile, `${startAfter}`);
  }

  // final flush
  pixelScoreDbBatchHandler
    .flush()
    .then(() => {
      console.log(`===================== Finished updating default pixelrank visibility ========================`);
    })
    .catch((e) => {
      console.error('Error updating default pixelrank visibility', e);
    });
}

void main();
