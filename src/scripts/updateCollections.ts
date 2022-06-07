import { TokenInfo } from 'types/main';
import { COLLECTIONS_COLL, RANKINGS_COLL } from '../utils/constants';
import { pixelScoreDb } from '../utils/firestore';
import { getCollectionInfo } from './metadataUtils';
import { CollectionInfo } from '../types/main';
import FirestoreBatchHandler from '../utils/firestoreBatchHandler';

// run with:
// "got": "11.8.5",
// npx ts-node src/scripts/updateCollections.ts

let rankingCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
let collectionCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
const collectionCache = new Map<string, CollectionInfo>();
let pixelScoreDbBatchHandler: FirestoreBatchHandler;

function main() {
  rankingCol = pixelScoreDb.collection(RANKINGS_COLL);
  collectionCol = pixelScoreDb.collection(COLLECTIONS_COLL);
  pixelScoreDbBatchHandler = new FirestoreBatchHandler(pixelScoreDb);

  update(false);
}
main();

// ===============================================================
// first 'rankings/11881086806b91954aba7dde6c38b449fa5ded6ce24b10fe191082f3dfa33d20';
// second rankings/118ec943fecc59c50031a39bb6c8000ccec0dee875cae3ec2e5dc9a13649375d
// third rankings/119bf4de4693fcb0a847d72d7b490c91251156917e0f72c342c43c5854d1cb59
// forth rankings/171232164b41e546e77e453c304fdce082ce833bf8be41d4354268c8d0c20c89
// rankings/25396e45ea809999e8acdc889b79ee9ea93bb34437723f2ed444740762700cf1
// rankings/28a96f6da7c0c16377ff717628d7cba873bae182fd26a0641747095e2e546a75
// rankings/2905765a991a18628511be15295cdb1b7d2c2d3178a87eee800c9c3615270e38
async function update(testRun: boolean) {
  console.log('Updating collections...');
  const limit = 5000;
  let cursor = 'rankings/2905765a991a18628511be15295cdb1b7d2c2d3178a87eee800c9c3615270e38';
  let hasMore = true;
  let count = 0;

  while (hasMore) {
    console.log(count);
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

      const tokenInfo = tokenDoc.data() as TokenInfo;

      // console.log(tokenInfo);

      // last path is cursor for next call
      cursor = tokenDoc.ref.path;

      try {
        const collectionInfo = await _getCollectionInfo(tokenInfo.collectionAddress, testRun);

        if (collectionInfo) {
          // merge the collectionName and slug to rank col
          const tokenMergeInfo: Partial<TokenInfo> = {
            collectionSlug: collectionInfo.slug,
            collectionName: collectionInfo.name,
            collectionBannerImage: collectionInfo.bannerImage,
            collectionProfileImage: collectionInfo.profileImage
          };

          if (testRun) {
            console.log(tokenMergeInfo);
          } else {
            pixelScoreDbBatchHandler.add(tokenDoc.ref, tokenMergeInfo, { merge: true });

            // await tokenDoc.ref.set(tokenMergeInfo, { merge: true });
          }
        } else {
          console.log(`missing: ${tokenInfo.collectionAddress}`);
        }
      } catch (err) {
        console.log(`error catch: $err`);
      }
    }

    pixelScoreDbBatchHandler.flush();
  }
}

async function _getCollectionInfo(collectionAddress: string, testRun: boolean): Promise<CollectionInfo | undefined> {
  const address = collectionAddress.trim().toLowerCase();
  let collectionInfo = collectionCache.get(address);

  if (!collectionInfo) {
    collectionInfo = (await collectionCol.doc(`1:${address}`).get()).data() as CollectionInfo;

    if (collectionInfo) {
      collectionCache.set(address, collectionInfo);
    } else {
      collectionInfo = await getCollectionInfo(address);

      if (collectionInfo) {
        collectionCache.set(address, collectionInfo);

        if (testRun) {
          console.log(collectionInfo);
        } else {
          collectionCol.doc(`1:${address}`).set(collectionInfo);
        }
      } else {
        console.log(`### Error getCollectionInfo: ${address}`);
      }
    }
  } else {
    console.log('### from cache');
  }

  return collectionInfo;
}