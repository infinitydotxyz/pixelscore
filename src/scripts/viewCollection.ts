import { getCollectionInfoFromMnemonic, getCollectionInfoFromOpensea } from './metadataUtils';

// run with:
// "got": "11.8.5",
// npx ts-node src/scripts/viewCollection.ts

function main() {
  update('0x000c5b85714fe40b4af10cca4b504b47e1d5c9dc');
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
