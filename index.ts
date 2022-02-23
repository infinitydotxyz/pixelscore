import { initializeApp, credential as _credential, firestore, storage } from 'firebase-admin';

import serviceAccount from './creds/nftc-infinity-firebase-creds.json';
initializeApp({
  // @ts-ignore
  credential: _credential.cert(serviceAccount),
  storageBucket: 'infinity-static'
});

const db = firestore();
const bucket = storage().bucket();

interface PixelScore {
  pixelScore: number;
}

async function saveScore(chainId: string, collection: string, tokenId: string, score: PixelScore) {
  const tokenDoc = db.collection('collections').doc(`${chainId}:${collection}`).collection('nfts').doc(tokenId);
  tokenDoc.set(score, { merge: true }).catch((err) => {
    console.error('Error saving pixel score for', chainId, collection, tokenId, err);
  });
}
