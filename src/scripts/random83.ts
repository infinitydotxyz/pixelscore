/* eslint-disable @typescript-eslint/no-unused-vars */
import { trimLowerCase } from '@infinityxyz/lib/utils';
import { execSync } from 'child_process';
import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { getDocIdHash } from '../utils/main';
import { TokenInfo } from '../types/main';
import { RANKINGS_COLL } from '../utils/constants';
import { pixelScoreDb } from '../utils/firestore';
import FirestoreBatchHandler from '../utils/firestoreBatchHandler';

const pixelScoreDbBatchHandler = new FirestoreBatchHandler(pixelScoreDb);
const CHAIN_ID = '1';
const ALL_COLLECTIONS_FILE = '/mnt/disks/additional-disk/all_scores/all_collections.txt';
const ERROR_COLLECTIONS_FILE = '/mnt/disks/additional-disk/all_scores/error_collections.txt';
const COMPLETED_COLLECTIONS_DIR = '/mnt/disks/additional-disk/all_scores/completed_collections';

const collectionSet = new Set<string>();

async function main() {
  await processAllCollections(ALL_COLLECTIONS_FILE);
  // await processOneCollection('0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d');
}

async function processAllCollections(collsFilePath: string) {
  try {
    const collsFile = path.join(collsFilePath);
    const lines = fs.readFileSync(collsFile, 'utf8').split('\n');
    for (const collectionAddress of lines) {
      collectionSet.add(collectionAddress);
      await processOneCollection(collectionAddress);
    }
    // commit any remaining data
    await pixelScoreDbBatchHandler.flush();
    console.log('======================== Finished all collections ======================== \n\n\n');
  } catch (error) {
    console.error('Error processing all collections', error);
  }
}

async function processOneCollection(collectionAddress: string) {
  try {
    const isCollectionCompleted = fs.existsSync(path.join(COMPLETED_COLLECTIONS_DIR, collectionAddress));
    if (isCollectionCompleted) {
      console.log(`Collection ${collectionAddress} already completed`);
      return;
    }
    console.log('Processing collection:', collectionAddress);
    const rankingsCollRef = pixelScoreDb.collection(RANKINGS_COLL);
    const fetchLimit = 1000;
    const fetchLimitPlusOne = fetchLimit + 1;
    let hasNextPage = true;
    let startAfterTokenId = '';
    while (hasNextPage) {
      console.log('Starting after tokenId:', startAfterTokenId);
      const tokenSnap = await rankingsCollRef
        .where('collectionAddress', '==', collectionAddress)
        .orderBy('tokenId', 'asc')
        .startAfter(startAfterTokenId)
        .limit(fetchLimitPlusOne)
        .get();

      hasNextPage = tokenSnap.size > fetchLimit;
      const tokensToProcess = tokenSnap.docs.slice(0, fetchLimit);
      startAfterTokenId = tokensToProcess[tokensToProcess.length - 1].data().tokenId;

      // remove pixelRankBucket > 7 from the list
      const remaining: TokenInfo[] = [];
      for (const tokenDoc of tokensToProcess) {
        const tokenInfo = tokenDoc.data() as TokenInfo;
        if (tokenInfo.pixelRankBucket && tokenInfo.pixelRankBucket <= 7) {
          remaining.push(tokenInfo);
        }
      }
      console.log('Num tokens with prb <=7:', remaining.length);
      const size = remaining.length;
      const size83 = Math.ceil(size * 0.83);
      const random83 = getRandom(remaining, size83);
      for (const tokenInfo of random83) {
        const tokenId = tokenInfo.tokenId ?? '';
        if (tokenId) {
          const docId = getDocIdHash({ chainId: CHAIN_ID, collectionAddress, tokenId });
          const docRef = pixelScoreDb.collection(RANKINGS_COLL).doc(docId);
          pixelScoreDbBatchHandler.add(docRef, { pixelRankVisible: true }, { merge: true });
        }
      }
    }

    // flush remaining data
    await pixelScoreDbBatchHandler.flush();
    console.log(`==== Finished collection ${collectionAddress} ==== \n`);
    execSync(`cd ${COMPLETED_COLLECTIONS_DIR} && touch ${collectionAddress}`);
  } catch (e) {
    console.error('Error processing collection:', collectionAddress, e);
    fs.appendFileSync(ERROR_COLLECTIONS_FILE, collectionAddress + '\n');
  }
}

function getRandom(arr: TokenInfo[], n: number) {
  const result = new Array<TokenInfo>(n);
  let len = arr.length;
  const taken = new Array(len);
  while (n--) {
    const x = Math.floor(Math.random() * len);
    result[n] = arr[x in taken ? taken[x] : x];
    taken[x] = --len in taken ? taken[len] : len;
  }
  return result;
}

main();
