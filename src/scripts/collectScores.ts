/* eslint-disable @typescript-eslint/no-unused-vars */
import { trimLowerCase } from '@infinityxyz/lib/utils';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDocIdHash } from '../utils/main';
import { TokenInfo } from '../types/main';
import { RANKINGS_COLL } from '../utils/constants';
import { pixelScoreDb } from '../utils/firestore';
import FirestoreBatchHandler from '../utils/firestoreBatchHandler';

const pixelScoreDbBatchHandler = new FirestoreBatchHandler(pixelScoreDb);
const ALL_SCORES_DIR = '/mnt/disks/additional-disk/all_scores';
const SPLIT_PREFIX = 'split_';
const CHAIN_ID = '1';
const SPLIT_COMPLETE_PREFIX = 'complete_';

async function main() {
  console.log('Collecting scores...');
  const dirPath = path.join(__dirname, ALL_SCORES_DIR);
  // await processAllSplits(dirPath);
  await processOneSplit(dirPath, 'split_000');
}

async function processAllSplits(dirPath: string) {
  const splits = fs.readdirSync(dirPath).filter((file) => file.startsWith(SPLIT_PREFIX));
  for (const split of splits) {
    await processOneSplit(dirPath, split);
  }
}

async function processOneSplit(dirPath: string, split: string) {
  try {
    console.log('======================== Collecting split:' + split + '========================');
    const splitCompleteFile = path.join(dirPath, SPLIT_COMPLETE_PREFIX + split);
    if (fs.existsSync(splitCompleteFile)) {
      console.log('Split', split, 'already processed.');
      return;
    }

    const splitFile = path.join(dirPath, split);
    const lines = fs.readFileSync(splitFile, 'utf8').split('\n');
    for (const line of lines) {
      const [
        serialNum,
        useLessCol1,
        useLessCol2,
        useLessCol3,
        collectionAddress,
        tokenId,
        globalPixelScore,
        inCollectionPixelRank,
        useLessCol4,
        useLessCol5,
        imageUrl,
        globalPixelRankBucket
      ] = line.split(',');

      // to account for empty lines
      if (
        serialNum &&
        collectionAddress &&
        tokenId &&
        globalPixelScore &&
        inCollectionPixelRank &&
        imageUrl &&
        globalPixelRankBucket
      ) {
        const docId = getDocIdHash({ chainId: CHAIN_ID, collectionAddress, tokenId });
        const rankingDocRef = pixelScoreDb.collection(RANKINGS_COLL).doc(docId);
        const tokenInfo: TokenInfo = {
          chainId: CHAIN_ID,
          collectionAddress: trimLowerCase(collectionAddress),
          tokenId,
          imageUrl,
          pixelScore: parseFloat(globalPixelScore),
          pixelRank: parseInt(serialNum),
          pixelRankBucket: parseInt(globalPixelRankBucket),
          inCollectionPixelRank: parseInt(inCollectionPixelRank)
        };
        pixelScoreDbBatchHandler.add(rankingDocRef, tokenInfo, { merge: true });
      }
    }
    // commit any remaining data
    await pixelScoreDbBatchHandler.flush();
    console.log('======================== Finished Collecting split:' + split + '======================== \n\n\n');
    execSync(`touch ${splitCompleteFile}`);
  } catch (error) {
    console.error('Error processing split:', split, error);
  }
}

main();
