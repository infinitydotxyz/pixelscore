import { getCollectionInfoFromMnemonic, getCollectionInfoFromOpensea } from './metadataUtils';
import { CollectionInfo, TokenInfo } from 'types/main';
import { COLLECTIONS_COLL, RANKINGS_COLL } from '../utils/constants';
import { pixelScoreDb } from '../utils/firestore';

// run with:
// "got": "11.8.5",
// npx ts-node src/scripts/viewCollection.ts

let rankingCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
let collectionCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;

function main() {
  rankingCol = pixelScoreDb.collection(RANKINGS_COLL);
  collectionCol = pixelScoreDb.collection(COLLECTIONS_COLL);

  // disabled avoigng having to comment things out
  if (rankingCol === null) {
    update('0x000c5b85714fe40b4af10cca4b504b47e1d5c9dc');
  }

  view('rankings/ffd0a19367597da7a04abcdac8f2c0d1b31f8b0add5156735d84b3bb2da21083');
}

main();

async function update(collectionAddress: string) {
  // let collectionInfo = await getCollectionInfo(collectionAddress);

  let collectionInfo = await getCollectionInfoFromOpensea(collectionAddress);
  if (!collectionInfo) {
    collectionInfo = await getCollectionInfoFromMnemonic(collectionAddress);
  }

  if (collectionInfo) {
    console.log(collectionInfo);
  }
}

async function view(cursor: string) {
  const limit = 10;

  console.log(cursor);

  let nftsQuery = rankingCol.limit(limit);

  if (cursor) {
    const startDoc = await pixelScoreDb.doc(cursor).get();
    nftsQuery = nftsQuery.startAfter(startDoc);
  }

  const results = await nftsQuery.get();
  const tokenDocs = results.docs;

  for (const tokenDoc of tokenDocs) {
    const tokenInfo = tokenDoc.data() as TokenInfo;

    console.log('######### tokenInfo');
    console.log(tokenInfo);

    showCollection(tokenInfo.collectionAddress ?? '');
  }
}

async function showCollection(address: string) {
  const limit = 10;

  let nftsQuery = collectionCol.limit(limit);

  nftsQuery = nftsQuery.where('address', '==', address);

  const results = await nftsQuery.get();
  const tokenDocs = results.docs;

  for (const tokenDoc of tokenDocs) {
    const collectionInfo = tokenDoc.data() as CollectionInfo;

    console.log('######### collectionInfo');
    console.log(collectionInfo);
  }
}
