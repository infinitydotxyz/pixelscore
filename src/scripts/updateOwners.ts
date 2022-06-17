/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { getCollectionDocId, trimLowerCase } from '@infinityxyz/lib/utils';
import { QuerySnapshot } from 'firebase-admin/firestore';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import FirestoreBatchHandler from '../utils/firestoreBatchHandler';
import { infinityDb, pixelScoreDb } from '../utils/firestore';
import { getProvider, RANKINGS_COLL } from '../utils/constants';
import { ethers } from 'ethers';
import { ERC721ABI } from '../abi/erc721';
import { getDocIdHash } from '../utils/main';

const pixelScoreDbBatchHandler = new FirestoreBatchHandler(pixelScoreDb);

export async function main() {
  // fetch collections from firestore
  console.log('============================== Fetching rankings from firestore =================================');
  let startAfter = 0;
  const offsetFile = path.join(__dirname, 'offset.txt');
  if (existsSync(offsetFile)) {
    startAfter = parseInt(readFileSync(offsetFile, 'utf8'));
  }
  const limit = 500;
  let done = false;
  while (!done) {
    const docSnap = await pixelScoreDb
      .collection(RANKINGS_COLL)
      .orderBy('pixelRank', 'asc')
      .startAfter(startAfter)
      .limit(limit)
      .get();
    console.log('================ START AFTER ===============', startAfter, 'limit', docSnap.size);

    // update cursor
    startAfter = docSnap.docs[docSnap.size - 1].get('pixelRank');

    // break condition
    if (docSnap.size < limit) {
      done = true;
    }
    await runAFew(docSnap);
    writeFileSync(offsetFile, `${startAfter}`);
  }

  // final flush
  pixelScoreDbBatchHandler
    .flush()
    .then(() => {
      console.log(`===================== Finished updating owners ========================`);
    })
    .catch((e) => {
      console.error('Error updating owners', e);
    });
}

async function runAFew(docSnap: QuerySnapshot) {
  try {
    const tokenDocRefs = [];
    for (const doc of docSnap.docs) {
      // fetch owner data from infinity db
      const data = doc.data();
      const chainId = data.chainId;
      const collectionAddress = data.collectionAddress;
      const tokenId = data.tokenId;
      const owner = data.owner;
      const ownerFetched = data.ownerFetched;
      if (!chainId || !collectionAddress || !tokenId) {
        console.error('Missing chainId, collectionAddress or tokenId in doc with id', doc.id);
        continue;
      }
      // skip if owner already set
      if (owner && ownerFetched) {
        continue;
      }
      if (owner && !ownerFetched) {
        pixelScoreDbBatchHandler.add(doc.ref, { ownerFetched: true }, { merge: true });
        continue;
      }

      const collectionDocId = getCollectionDocId({ chainId, collectionAddress });
      const tokenDocRef = infinityDb.collection('collections').doc(collectionDocId).collection('nfts').doc(tokenId);
      tokenDocRefs.push(tokenDocRef);
    }
    // update
    await updateOwners(tokenDocRefs);
  } catch (e) {
    console.error('Error running a few', e);
  }
}

async function updateOwners(tokenDocRefs: FirebaseFirestore.DocumentReference[]) {
  if (tokenDocRefs.length === 0) {
    return;
  }
  const results = await infinityDb.getAll(...tokenDocRefs);
  for (const result of results) {
    try {
      const data = result.data();
      // path is of the form collections/{chainId:collectionAddress/nfts/{tokenId}
      const pathSplit = result.ref.path.split('/');
      const chainId = pathSplit[1].split(':')[0];
      const collectionAddress = pathSplit[1].split(':')[1];
      const tokenId = pathSplit[3];
      let owner = data?.owner;
      if (!owner && chainId && collectionAddress && tokenId) {
        try {
          owner = await getErc721Owner({ address: collectionAddress, tokenId, chainId });
        } catch (e) {
          console.error('Error getting owner from blockchain');
        }
      }
      if (!owner) {
        console.error(
          'Missing owner info in both infinityDb and blockchain!!',
          chainId,
          collectionAddress,
          tokenId,
          result.ref.path
        );
        continue;
      }
      const docId = getDocIdHash({ chainId, collectionAddress, tokenId });
      const docRef = pixelScoreDb.collection(RANKINGS_COLL).doc(docId);
      pixelScoreDbBatchHandler.add(docRef, { owner, ownerFetched: true }, { merge: true });
    } catch (e) {
      console.error('Error updating owner for', result.ref.path, e);
    }
  }
}

async function getErc721Owner(token: { address: string; tokenId: string; chainId: string }): Promise<string> {
  const contract = new ethers.Contract(token.address, ERC721ABI, getProvider(token.chainId));
  const owner = trimLowerCase(await contract.ownerOf(token.tokenId));
  return owner;
}

void main();
