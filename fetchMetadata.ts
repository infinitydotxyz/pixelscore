import fbAdmin from 'firebase-admin';
import * as stream from 'stream';
import { promisify } from 'util';
import axios from 'axios';
import { createWriteStream, mkdirSync } from 'fs';
import path from 'path';
import fs from 'fs';
import { QuerySnapshot, DocumentData, QueryDocumentSnapshot } from '@google-cloud/firestore';
import { execSync } from 'child_process';

import serviceAccount from './creds/nftc-infinity-firebase-creds.json';
fbAdmin.initializeApp({
  credential: fbAdmin.credential.cert(serviceAccount as fbAdmin.ServiceAccount),
  storageBucket: 'infinity-static'
});

const db = fbAdmin.firestore();
const DATA_DIR = 'data';
const METADATA_DIR = 'metadata';
const METADATA_FILE_NAME = 'metadata.csv';

function fetchMetadata(tokens: QuerySnapshot<DocumentData>, dir: string) {
  console.log('============================== Writing metadata =================================');
  mkdirSync(dir, { recursive: true });
  const metadataFile = path.join(dir, METADATA_FILE_NAME);
  let lines = '';
  tokens.forEach((token) => {
    const data = token.data();
    if (!data) {
      console.error('Data is null for token', token);
      return;
    }
    lines += `${data.tokenId},${data.rarityScore},${data.rarityRank},${data.image?.url}\n`;
  });
  // write file
  fs.writeFileSync(metadataFile, lines);
  console.log('============================== Metadata written successfully =================================');
}

async function run(chainId: string, address: string) {
  const collectionDoc = await db.collection('collections').doc(`${chainId}:${address}`).get();
  // check if collection indexing is complete
  const status = collectionDoc?.data()?.state.create.step;
  if (status !== 'complete') {
    console.error('Collection indexing is not complete for', address);
    return;
  }

  const metadataDir = path.join(__dirname, DATA_DIR, address, METADATA_DIR);
  const metadataFile = path.join(metadataDir, METADATA_FILE_NAME);
  if (fs.existsSync(metadataFile)) {
    console.log('Metadata file already exists for', chainId, address);
    return;
  }
  // fetch metadata
  console.log(
    `============================== Fetching tokens from firestore for ${chainId}:${address} =================================`
  );
  let tokens = await db.collection('collections').doc(`${chainId}:${address}`).collection('nfts').get();
  fetchMetadata(tokens, metadataDir);
}

async function runAFew(colls: QuerySnapshot<DocumentData>) {
  for(const coll of colls.docs) {
    const data = coll.data();
    if (!data) {
      console.error('Data is null for collection', coll);
      continue;
    }
    await run(data.chainId, data.address);
  }
}

async function main() {
  console.log('Usage for all collections: node fetchMetadata.js');
  console.log('Usage for individual collection: node fetchMetadata.js <chainId> <collectionAddress>');
  let chainId, address;
  if (process.argv.length == 4) {
    chainId = process.argv[2];
    address = process.argv[3].trim().toLowerCase();
    await run(chainId, address);
  } else {
    // fetch collections from firestore
    console.log('============================== Fetching collections from firestore =================================');
    let startAfter = '';
    const limit = 100;
    let done = false;
    while (!done) {
      const colls = await db
        .collection('collections')
        .orderBy('address', 'asc')
        .startAfter(startAfter)
        .limit(limit)
        .get();
      console.log('================ START AFTER ===============', startAfter, colls.size);

      // update cursor
      startAfter = colls.docs[colls.size - 1].get('address');

      // break condition
      if (colls.size < limit) {
        done = true;
      }
      await runAFew(colls);
    }
  }
}

main();
