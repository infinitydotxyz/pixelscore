import fbAdmin from 'firebase-admin';
import * as stream from 'stream';
import { promisify } from 'util';
import axios from 'axios';
import { createWriteStream, mkdirSync } from 'fs';
import path from 'path';
import fs from 'fs';
import { QuerySnapshot, DocumentData } from '@google-cloud/firestore';
import { execSync } from 'child_process';

import serviceAccount from './creds/nftc-dev-firebase-creds.json';
fbAdmin.initializeApp({
  credential: fbAdmin.credential.cert(serviceAccount as fbAdmin.ServiceAccount),
  storageBucket: 'infinity-static'
});

const db = fbAdmin.firestore();
const bucket = fbAdmin.storage().bucket();
const finished = promisify(stream.finished);
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
      console.error('data is null for token', token);
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
        console.log('Downloading', url);
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
  }).then(async (response) => {
    response.data.pipe(createWriteStream(outputLocationPath));
    return finished(createWriteStream(outputLocationPath));
  });
}

async function validate(numTokens: number, imagesDir: string, metadataDir: string, retries: number): Promise<void> {
  console.log('============================== Validating =================================');
  const numImages = fs.readdirSync(imagesDir).length;
  const metadataFile = path.join(metadataDir, METADATA_FILE_NAME);
  const numLines = parseInt(execSync(`cat ${metadataFile} | wc -l`).toString().trim());
  // check if num images downloaded is equal to numtokens
  if (numImages !== numTokens) {
    console.error('Not all images are downloaded; numTokens', numTokens, 'num images downloaded', numImages);
    if (retries > 0) {
      console.log('Retrying in 120 seconds');
      await sleep(120 * 1000);
      main(--retries);
    }
  } else if (numLines !== numTokens) {
    // check if num lines in metadata file is equal to numtokens
    console.error('Not all metadata is written; numTokens', numTokens, 'metadata written for', numLines);
  } else {
    console.log('===================== Done =========================');
  }
}

async function sleep(duration: number): Promise<void> {
  return await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
}

let tokens: fbAdmin.firestore.QuerySnapshot<fbAdmin.firestore.DocumentData>;
async function main(retries: number) {
  const chainId = process.argv[2];
  const address = process.argv[3].trim().toLowerCase();
  const collectionDoc = await db.collection('collections').doc(`${chainId}:${address}`).get();
  // check if collection indexing is complete
  const status = collectionDoc?.data()?.state.create.step;
  if (status !== 'complete') {
    console.error('Collection indexing is not complete for', address);
    return;
  }
  if (!tokens) {
    console.log('============================== Fetching tokens from firestore =================================');
    tokens = await db.collection('collections').doc(`${chainId}:${address}`).collection('nfts').get();
  }
  const numTokens = tokens.size;

  // fetch metadata
  const metadataDir = path.join(__dirname, 'data', address, 'metadata');
  fetchMetadata(tokens, metadataDir);

  // fetch images
  const imagesDir = path.join(__dirname, 'data', address, 'resized');
  await fetchOSImages(tokens, imagesDir);

  // validate
  await validate(numTokens, imagesDir, metadataDir, retries);
}

main(1);
