import { RankInfo } from 'types/firestore';
import { COLLECTIONS_COLL, RANKINGS_COLL } from '../utils/constants';
import { pixelScoreDb } from '../utils/firestore';
import { getCollectionInfo } from './metadataUtils';

// run with:
// npx ts-node src/scripts/updateCollections.ts

// 12) Do const collectionInfo = await getCollectionInfo(collection) from collectMetadata.ts.
//  Dump this in collections collection with a doc id <1:$collectionAddress>. Also merge this to the <rankingsdoc> above

async function main() {
  console.log('Updating collections...');
  console.log(COLLECTIONS_COLL);
  let nftsQuery: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = pixelScoreDb.collection(RANKINGS_COLL);

  nftsQuery = nftsQuery.limit(10);

  const results = await nftsQuery.get();
  const nfts = results.docs.map((item) => {
    const rankInfo = item.data() as RankInfo;

    const tmp = rankInfo as any;
    tmp.firebaseId = item.id;

    return rankInfo;
  });

  // console.log(nfts);

  for (const nft of nfts) {
    const collectionInfo = await getCollectionInfo(nft.collectionAddress);

    console.log(collectionInfo);
  }
}

main();
