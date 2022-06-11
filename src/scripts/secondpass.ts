import { COLLECTIONS_COLL } from '../utils/constants';
import { pixelScoreDb } from '../utils/firestore';
import { getCollectionInfoFromInfinity } from './metadataUtils';
import { CollectionInfo } from '../types/main';
import FirestoreBatchHandler from '../utils/firestoreBatchHandler';
import { getCollectionDocId } from '@infinityxyz/lib/utils';

// run with:
// "got": "11.8.5",
// npx ts-node src/scripts/secondpass.ts

// let rankingCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
let collectionCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
let pixelScoreDbBatchHandler: FirestoreBatchHandler;

function main() {
  // rankingCol = pixelScoreDb.collection(RANKINGS_COLL);
  collectionCol = pixelScoreDb.collection(COLLECTIONS_COLL);
  pixelScoreDbBatchHandler = new FirestoreBatchHandler(pixelScoreDb);

  updateCollections(false);
}
main();

async function updateCollections(testRun: boolean) {
  console.log('Updating collections...');
  const limit = 1000;
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

      // console.log(collectionInfo);

      // last path is cursor for next call
      cursor = collectionDoc.ref.path;

      try {
        const docId = getCollectionDocId({
          collectionAddress: collectionInfo.address.trim(),
          chainId: collectionInfo.chainId
        });

        const freshColInfo = await _fetchCollectionInfo(docId);

        if (freshColInfo) {
          if (freshColInfo.hasBlueCheck) {
            console.log('BLUE CHECKKKK');
          }

          const collectionMergeInfo: Partial<CollectionInfo> = {
            hasBlueCheck: freshColInfo.hasBlueCheck ?? false,
            numNfts: freshColInfo.numNfts ?? 0,
            numOwners: freshColInfo.numOwners ?? 0
          };

          if (testRun) {
            console.log(collectionMergeInfo);
          } else {
            pixelScoreDbBatchHandler.add(collectionDoc.ref, collectionMergeInfo, { merge: true });
          }
        } else {
          const collectionMergeInfo: Partial<CollectionInfo> = {
            hasBlueCheck: false,
            numNfts: 0,
            numOwners: 0
          };

          if (testRun) {
            console.log(collectionMergeInfo);
          } else {
            pixelScoreDbBatchHandler.add(collectionDoc.ref, collectionMergeInfo, { merge: true });
          }
        }
      } catch (err) {
        console.log(`error catch: $err`);
      }
    }

    pixelScoreDbBatchHandler.flush();
  }
}

async function _fetchCollectionInfo(collectionAddress: string): Promise<CollectionInfo | undefined> {
  const address = collectionAddress.trim().toLowerCase();

  const collectionInfo = await getCollectionInfoFromInfinity(address);

  return collectionInfo;
}
