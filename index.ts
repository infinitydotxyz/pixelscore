import fbAdmin from 'firebase-admin';
import * as stream from 'stream';
import { promisify } from 'util';
import axios from 'axios';
import { createWriteStream, mkdirSync } from 'fs';
import path from 'path';
import fs from 'fs';
import { QuerySnapshot, DocumentData } from '@google-cloud/firestore';

const finished = promisify(stream.finished);

import serviceAccount from './creds/nftc-dev-firebase-creds.json';
fbAdmin.initializeApp({
  credential: fbAdmin.credential.cert(serviceAccount as fbAdmin.ServiceAccount),
  storageBucket: 'infinity-static'
});

const db = fbAdmin.firestore();
const bucket = fbAdmin.storage().bucket();
interface PixelScore {
  pixelScore: number;
}

async function saveScore(chainId: string, collection: string, tokenId: string, score: PixelScore) {
  const tokenDoc = db.collection('collections').doc(`${chainId}:${collection}`).collection('nfts').doc(tokenId);
  tokenDoc.set(score, { merge: true }).catch((err) => {
    console.error('Error saving pixel score for', chainId, collection, tokenId, err);
  });
}

async function fetchOSImages(tokens: QuerySnapshot<DocumentData>, dir: string) {
  mkdirSync(dir, { recursive: true });
  tokens.forEach((token) => {
    const url = token.data().image.url as string;
    const tokenId = token.data().tokenId;
    const localFile = path.join(dir, tokenId);
    // check if file already exists
    if (!fs.existsSync(localFile)) {
      if (url.indexOf('lh3') > 0) {
        const url224 = url + '=s224';
        console.log('Downloading', url224);
        downloadImage(url224, localFile).catch((err) => console.log('error downloading', url224, err));
      } else {
        console.error('not os image');
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

async function sleep(duration: number): Promise<void> {
  return await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
}

let tokens: QuerySnapshot;
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
  if (tokens.size == 0) {
    tokens = await db.collection('collections').doc(`${chainId}:${address}`).collection('nfts').get();
  }
  const numTokens = tokens.size;
  const dir = path.join(__dirname, 'data', address, 'resized');
  await fetchOSImages(tokens, dir);
  // check if num images downloaded is equal to numtokens
  const numImages = fs.readdirSync(dir).length;
  if (numImages !== numTokens) {
    console.error('not all images are downloaded; numTokens', numTokens, 'num images downloaded', numImages);
    if (retries > 0) {
      console.log('retrying in 5 seconds');
      await sleep(5 * 1000);
      main(--retries);
    }
  } else {
    console.log('===================== Done =========================');
  }
}

main(3);
