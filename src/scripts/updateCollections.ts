import { TokenInfo } from 'types/main';
import { COLLECTIONS_COLL, RANKINGS_COLL } from '../utils/constants';
import { pixelScoreDb } from '../utils/firestore';
import { getCollectionInfo } from './metadataUtils';
import { CollectionInfo } from '../types/main';

// run with:
// "got": "11.8.5",
// npx ts-node src/scripts/updateCollections.ts

let rankingCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
let collectionCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
const collectionCache = new Map<string, CollectionInfo>();

function main() {
  rankingCol = pixelScoreDb.collection(RANKINGS_COLL);
  collectionCol = pixelScoreDb.collection(COLLECTIONS_COLL);

  update(false);
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

      try {
        const collectionInfo = await _getCollectionInfo(tokenInfo.collectionAddress, testRun);

        if (collectionInfo) {
          // merge the collectionName and slug to rank col
          const tokenInfo: Partial<TokenInfo> = {
            collectionSlug: collectionInfo.slug,
            collectionName: collectionInfo.name,
            collectionBannerImage: collectionInfo.bannerImage,
            collectionProfileImage: collectionInfo.profileImage
          };

          if (testRun) {
            console.log(tokenInfo);
          } else {
            tokenDoc.ref.set(tokenInfo, { merge: true });
          }
        } else {
          console.log(`missing: ${tokenInfo.collectionAddress}`);
        }
      } catch (err) {
        console.log(`error catch: $err`);
      }
    }
  }
}

async function _getCollectionInfo(collectionAddress: string, testRun: boolean): Promise<CollectionInfo | undefined> {
  const address = collectionAddress.trim().toLowerCase();
  let collectionInfo = collectionCache.get(address);

  if (!collectionInfo) {
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
  } else {
    console.log('### from cache');
  }

  return collectionInfo;
}
