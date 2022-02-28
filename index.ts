import fbAdmin from 'firebase-admin';
import * as stream from 'stream';
import { promisify } from 'util';
import axios from 'axios';
import { createWriteStream, mkdirSync } from 'fs';
import path from 'path';

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

async function fetchOSImages(chainId: string, collection: string) {
  const dir = path.join(__dirname, 'data', collection, 'resized');
  mkdirSync(dir, { recursive: true });
  const tokens = await db.collection('collections').doc(`${chainId}:${collection}`).collection('nfts').get();
  tokens.forEach((token) => {
    const url = token.data().image.url as string;
    const tokenId = token.data().tokenId;
    const localFile = path.join(dir, tokenId);
    if (url.indexOf('lh3') > 0) {
      const url224 = url + '=s224';
      console.log('Downloading', url224);
      downloadImage(url224, localFile).catch((err) => console.log('error downloading', url224, err));
    } else {
      console.log('not os image');
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

async function main() {
  const chainId = process.argv[2];
  const address = process.argv[3];
  await fetchOSImages(chainId, address);
}

main();
