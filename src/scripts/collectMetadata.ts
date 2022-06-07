import { trimLowerCase } from '@infinityxyz/lib/utils';
import { execSync } from 'child_process';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { TokenInfo } from '../types/main';
import { COLLECTIONS_COLL, NFTS_SUB_COLL } from '../utils/constants';
import { pixelScoreDb } from '../utils/firestore';
import FirestoreBatchHandler from '../utils/firestoreBatchHandler';
import { getCollectionInfo } from './metadataUtils';

const pixelScoreDbBatchHandler = new FirestoreBatchHandler(pixelScoreDb);
const DATA_DIR = '/mnt/disks/additional-disk/data';
const METADATA_DIR = 'metadata';
const METADATA_FILE = 'metadata.csv';
const COLLECTION_COMPLETE_FILE = 'collection-complete.txt';

async function main() {
  console.log('Collecting data...');
  const dirPath = DATA_DIR;
  // await processCollections(dirPath);
  await processOneCollection(dirPath, '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function processCollections(dirPath: string) {
  const dirs = fs.readdirSync(dirPath).filter((file) => fs.statSync(path.join(dirPath, file)).isDirectory());
  for (const dir of dirs) {
    if (dir.startsWith('0x')) {
      const collection = trimLowerCase(dir);
      const collectionCompleteFile = path.join(dirPath, dir, COLLECTION_COMPLETE_FILE);
      if (!ethers.utils.isAddress(collection)) {
        console.error('Invalid collection:', collection);
      } else if (fs.existsSync(collectionCompleteFile)) {
        console.log('Collection already processed:', collection);
      } else {
        await processOneCollection(dirPath, collection);
      }
    }
  }
}

async function processOneCollection(dirPath: string, collection: string) {
  try {
    console.log('======================== Collecting collection:' + collection + '========================');
    const collectionCompleteFile = path.join(dirPath, collection, COLLECTION_COMPLETE_FILE);
    // save collection info
    const collectionInfo = await getCollectionInfo(collection);
    if (collectionInfo) {
      const chainId = collectionInfo.chainId;
      const collectionRef = pixelScoreDb.collection(COLLECTIONS_COLL).doc(chainId + ':' + collection);
      pixelScoreDbBatchHandler.add(collectionRef, collectionInfo, { merge: true });
      // save token info
      const collectionDir = path.join(dirPath, collection);
      await saveTokenInfo(collectionInfo.address, collectionRef, collectionDir, collectionInfo.slug);
      // commit any remaining data
      await pixelScoreDbBatchHandler.flush();
      console.log(
        '======================== Finished Collecting collection:' + collection + '======================== \n\n\n'
      );
      execSync(`touch ${collectionCompleteFile}`);
    } else {
      console.error('Collection info not found:', collection);
    }
  } catch (error) {
    console.error('Error processing collection:', collection, error);
  }
}

async function saveTokenInfo(
  collectionAddress: string,
  collectionRef: FirebaseFirestore.DocumentReference,
  collectionDir: string,
  collectionSlug: string
) {
  try {
    const metadataFile = path.join(collectionDir, METADATA_DIR, METADATA_FILE);
    if (fs.existsSync(metadataFile)) {
      console.log('Reading metadata file:', metadataFile);
      const lines = fs.readFileSync(metadataFile, 'utf8').split('\n');
      for (const line of lines) {
        const [tokenId, rarityScore, rarityRank, imageUrl] = line.split(',');
        // to account for empty lines
        if (tokenId) {
          const tokenDocRef = collectionRef.collection(NFTS_SUB_COLL).doc(tokenId);
          const tokenInfo: TokenInfo = {
            chainId: '1',
            collectionAddress: trimLowerCase(collectionAddress),
            collectionSlug: collectionSlug,
            tokenId: tokenId,
            imageUrl: imageUrl,
            rarityScore: parseFloat(rarityScore),
            rarityRank: parseInt(rarityRank)
          };
          pixelScoreDbBatchHandler.add(tokenDocRef, tokenInfo, { merge: true });
        }
      }
    }
  } catch (error) {
    console.error('Error saving token info:', error);
  }
}

main();
