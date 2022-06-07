import { TokenInfo } from 'types/main';
import { COLLECTIONS_COLL, RANKINGS_COLL } from '../utils/constants';
import { pixelScoreDb } from '../utils/firestore';
import { getCollectionInfo } from './metadataUtils';
import { CollectionInfo } from '../types/main';
import { spawn, Thread, Worker } from 'threads';

async function run() {
  const worker = await spawn(new Worker('./workers/getCollectionWorker'));
  const hashed = await worker.hashPassword('Super secret password', '1234');

  console.log('Hashed password:', hashed);

  await Thread.terminate(worker);
}

// run with:
// "got": "11.8.5",
// npx ts-node src/scripts/updateCollections.ts

let rankingCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
let collectionCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
const collectionCache = new Map<string, CollectionInfo>();

function main() {
  rankingCol = pixelScoreDb.collection(RANKINGS_COLL);
  collectionCol = pixelScoreDb.collection(COLLECTIONS_COLL);

  if (!collectionCol) {
    update(true);
  }
  run();
}
main();

// ===============================================================

async function update(testRun: boolean) {
  console.log('Updating collections...');
  const limit = 1000;
  let cursor = '';
  let hasMore = true;
  let count = 0;

  while (hasMore) {
    console.log(count);

    let nftsQuery = rankingCol.limit(limit);

    if (cursor) {
      const startDoc = await pixelScoreDb.doc(cursor).get();
      nftsQuery = nftsQuery.startAfter(startDoc);
    }

    const results = await nftsQuery.get();
    const tokenDocs = results.docs;

    if (tokenDocs.length < limit) {
      hasMore = false;
    }

    for (const tokenDoc of tokenDocs) {
      count++;

      const tokenInfo = tokenDoc.data() as TokenInfo;

      // last path is cursor for next call
      cursor = tokenDoc.ref.path;

      const collectionInfo = await _getCollectionInfo(tokenInfo.collectionAddress, testRun);

      if (collectionInfo) {
        // merge the collectionName and slug to rank col
        const tokenInfo: Partial<TokenInfo> = {
          collectionSlug: collectionInfo.slug,
          collectionName: collectionInfo.name,
          collectionImage: collectionInfo.bannerImage
        };

        if (testRun) {
          // console.log(tokenInfo);
        } else {
          tokenDoc.ref.set(tokenInfo, { merge: true });
        }
      } else {
        console.log(`missing: ${tokenInfo.collectionAddress}`);
      }
    }
  }
}

async function _getCollectionInfo(collectionAddress: string, testRun: boolean): Promise<CollectionInfo | undefined> {
  let collectionInfo = collectionCache.get(collectionAddress);

  if (!collectionInfo) {
    collectionInfo = await getCollectionInfo(collectionAddress);

    if (collectionInfo) {
      collectionCache.set(collectionAddress, collectionInfo);

      if (testRun) {
        // console.log(collectionInfo);
      } else {
        collectionCol.doc(`1:${collectionAddress}`).set(collectionInfo);
      }
    }
  } else {
    console.log('######################## from cache');
  }

  return collectionInfo;
}
