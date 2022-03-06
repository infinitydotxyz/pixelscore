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
const bucket = fbAdmin.storage().bucket();
const finished = promisify(stream.finished);
const DATA_DIR = 'data';
const IMAGES_DIR = 'resized';
const METADATA_DIR = 'metadata';
const METADATA_FILE_NAME = 'metadata.csv';

interface PixelScore {
  pixelScore: number;
}

// not used
async function saveScore(chainId: string, collection: string, tokenId: string, score: PixelScore) {
  const tokenDoc = db.collection('collections').doc(`${chainId}:${collection}`).collection('nfts').doc(tokenId);
  tokenDoc.set(score, { merge: true }).catch((err) => {
    console.error('Error saving pixel score for', chainId, collection, tokenId, err);
  });
}

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

async function fetchOSImages(tokens: QuerySnapshot<DocumentData>, dir: string) {
  console.log('============================== Downloading images =================================');
  mkdirSync(dir, { recursive: true });
  tokens.forEach((token) => {
    const url = token.data().image.url as string;
    const tokenId = token.data().tokenId;
    const localFile = path.join(dir, tokenId);
    // check if file already exists
    if (!fs.existsSync(localFile)) {
      if (url.indexOf('lh3') > 0) {
        const url224 = url + '=s224';
        // console.log('Downloading', url);
        downloadImage(url224, localFile).catch((err) => console.log('error downloading', url224, err));
      } else {
        console.error('Not OpenSea image');
      }
    }
  });
}

async function downloadImage(url: string, outputLocationPath: string): Promise<any> {
  return axios({
    method: 'get',
    url,
    responseType: 'stream'
  })
    .then(async (response) => {
      response.data.pipe(createWriteStream(outputLocationPath));
      return finished(createWriteStream(outputLocationPath));
    })
    .catch((err) => {
      // do nothing
    });
}

async function validate(
  numTokens: number,
  imagesDir: string,
  metadataDir: string,
  chainId: string,
  address: string,
  retries: number,
  retryAfter: number
): Promise<boolean> {
  let done = false;
  console.log('============================== Validating =================================');
  const numImages = fs.readdirSync(imagesDir).length;
  const metadataFile = path.join(metadataDir, METADATA_FILE_NAME);
  const numLines = parseInt(execSync(`cat ${metadataFile} | wc -l`).toString().trim());
  // check if num images downloaded is equal to numtokens
  if (numImages !== numTokens) {
    console.error(
      'Not all images are downloaded; numTokens',
      numTokens,
      'num images downloaded',
      numImages,
      `waiting ${retryAfter} seconds for download to finish. Ignore any errors for now.`
    );
    if (retries > 0) {
      console.log(`Retrying in ${retryAfter} seconds`);
      await sleep(retryAfter * 1000);
      run(chainId, address, --retries, retryAfter);
    }
  } else if (numLines !== numTokens) {
    // check if num lines in metadata file is equal to numtokens
    console.error('Not all metadata is written; numTokens', numTokens, 'metadata written for', numLines);
  } else {
    done = true;
    console.log('============================== Done =================================');
  }
  return done;
}

async function sleep(duration: number): Promise<void> {
  return await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
}

async function run(chainId: string, address: string, retries: number, retryAfter: number) {
  console.log(
    `============ Fetching data for ${address} with max ${retries} retries and ${retryAfter} second retry interval ============`
  );
  const collectionDoc = await db.collection('collections').doc(`${chainId}:${address}`).get();
  // check if collection indexing is complete
  const status = collectionDoc?.data()?.state.create.step;
  if (status !== 'complete') {
    console.error('Collection indexing is not complete for', address);
    return;
  }
  console.log(
    `============================== Fetching tokens from firestore for ${address} =================================`
  );
  let tokens = await db.collection('collections').doc(`${chainId}:${address}`).collection('nfts').get();
  const numTokens = tokens.size;

  // fetch metadata
  const metadataDir = path.join(__dirname, DATA_DIR, address, METADATA_DIR);
  fetchMetadata(tokens, metadataDir);

  // fetch images
  const imagesDir = path.join(__dirname, DATA_DIR, address, IMAGES_DIR);
  await fetchOSImages(tokens, imagesDir);

  // validate
  await validate(numTokens, imagesDir, metadataDir, chainId, address, retries, retryAfter);
}

async function runAFew(colls: QuerySnapshot, retries: number, retryAfter: number) {
  colls.forEach(async (coll) => {
    const chainId = coll.get('chainId');
    const address = coll.get('address');
    await run(chainId, address, retries, retryAfter);
  });
}

async function main() {
  console.log(
    'Usage for all collections: node index.js <optional: number of retries (default 3)> <optional: retry after seconds (default 60)>'
  );
  console.log(
    'Usage for individual collection: node index.js <number of retries (maybe 3?)> <retry after seconds (maybe 60?)> <chainId> <collectionAddress>'
  );
  let retries = parseInt(process.argv[2]);
  if (!retries) {
    retries = 3;
  }
  let retryAfter = parseInt(process.argv[3]);
  if (!retryAfter) {
    retryAfter = 60;
  }
  let chainId, address;
  if (process.argv.length == 6) {
    chainId = process.argv[4];
    address = process.argv[5].trim().toLowerCase();
    await run(chainId, address, retries, retryAfter);
  } else {
    // fetch completed collections from firestore
    console.log('============================== Fetching collections from firestore =================================');
    let startAfter = '';
    const limit = 10;
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
      await runAFew(colls, retries, retryAfter);
    }
  }
}

main();
