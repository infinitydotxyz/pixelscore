import { COLLECTIONS_COLL, RANKINGS_COLL } from '../utils/constants';
import { pixelScoreDb } from '../utils/firestore';
import { CollectionInfo, TokenInfo } from '../types/main';
import FirestoreBatchHandler from '../utils/firestoreBatchHandler';

// run with:
// "got": "11.8.5",
// npx ts-node src/scripts/thirdpass.ts

let rankingCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
let collectionCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
let pixelScoreDbBatchHandler: FirestoreBatchHandler;
const blueChecks = new Set<string>();

async function main() {
  rankingCol = pixelScoreDb.collection(RANKINGS_COLL);
  collectionCol = pixelScoreDb.collection(COLLECTIONS_COLL);
  pixelScoreDbBatchHandler = new FirestoreBatchHandler(pixelScoreDb);

  await findBlueChecks();
  console.log(`BlueChecks: ${blueChecks.size}`);

  await setBlueCheckOnTokens(false);
}
main();

async function findBlueChecks() {
  console.log('Finding bluechecks...');
  const limit = 10000;
  let cursor = '';
  let hasMore = true;
  let count = 0;

  while (hasMore) {
    console.log(cursor);

    let collectionsQuery = collectionCol.limit(limit);

    if (cursor) {
      const startDoc = await pixelScoreDb.doc(cursor).get();
      collectionsQuery = collectionsQuery.startAfter(startDoc);
    }

    const results = await collectionsQuery.get();
    const collectionDocs = results.docs;

    if (collectionDocs.length < limit) {
      hasMore = false;
    }

    for (const collectionDoc of collectionDocs) {
      count++;
      if (count % 50 === 0) {
        console.log(count);
      }

      const collectionInfo = collectionDoc.data() as CollectionInfo;

      if (collectionInfo && collectionInfo.hasBlueCheck) {
        blueChecks.add(collectionInfo.address);
      }

      // last path is cursor for next call
      cursor = collectionDoc.ref.path;
    }
  }
}

async function setBlueCheckOnTokens(testRun: boolean) {
  console.log('setBlueCheckOnTokens...');
  const limit = 10000;
  let cursor = '';
  let hasMore = true;
  let count = 0;

  while (hasMore) {
    console.log(cursor);

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
      if (count % 50 === 0) {
        console.log(count);
      }

      const tokenInfo = tokenDoc.data() as TokenInfo;

      // console.log(tokenInfo);

      // last path is cursor for next call
      cursor = tokenDoc.ref.path;

      try {
        const tokenMergeInfo: Partial<TokenInfo> = {
          hasBlueCheck: blueChecks.has(tokenInfo.collectionAddress)
        };

        if (testRun) {
          console.log(tokenMergeInfo);
        } else {
          pixelScoreDbBatchHandler.add(tokenDoc.ref, tokenMergeInfo, { merge: true });
        }
      } catch (err) {
        console.log(`error catch: $err`);
      }
    }

    pixelScoreDbBatchHandler.flush();
  }
}
