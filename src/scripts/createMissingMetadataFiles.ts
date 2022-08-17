import { BaseToken } from '@infinityxyz/lib/types/core';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { infinityDb } from '../utils/firestore';

const DISK_DIR = '/mnt/disks/additional-disk';
const MISSING_FILE = 'missing.csv';
const DATA_DIR = '/mnt/disks/additional-disk/data';
const METADATA_DIR = 'metadata';
const METADATA_FILE = 'metadata.csv';

async function main() {
  console.log('Creating missing metadata files...');
  const missingFile = path.join(DISK_DIR, MISSING_FILE);
  const lines = readFileSync(missingFile, 'utf8').split('\n');
  for (const line of lines) {
    const [, collection] = line.split(',');
    if (collection) {
      const metadataDir = path.join(DATA_DIR, collection, METADATA_DIR);
      // recreate metadata file
      await fetchMetadata('1', collection, metadataDir);
    }
  }
}

async function fetchMetadata(chainId: string, collection: string, metadataDir: string) {
  try {
    // exception for ENS and unstoppable domains
    if (
      collection === '0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85' ||
      collection === '0x049aba7510f45ba5b64ea9e658e342f904db358d'
    ) {
      return;
    }

    console.log(`============================== Fetching metadata for ${collection} =================================`);
    mkdirSync(metadataDir, { recursive: true });
    const metadataFile = path.join(metadataDir, METADATA_FILE);

    const tokens = await infinityDb.collection('collections').doc(`${chainId}:${collection}`).collection('nfts').get();

    let lines = '';
    for (const token of tokens.docs) {
      const data = token.data() as BaseToken;
      const tokenImage = data?.image?.url || data?.alchemyCachedImage || '';
      if (!data || !tokenImage) {
        // console.error('Data is null for token');
        return;
      }
      lines += `${data.collectionAddress},${data.collectionName},${data.collectionSlug},${data.collectionProfileImage},${data.hasBlueCheck},${data.tokenId},${data.rarityScore},${data.rarityRank},${tokenImage}\n`;
    }
    // write file
    writeFileSync(metadataFile, lines);
    console.log(
      `============================== Metadata written successfully ${collection} =================================`
    );
  } catch (e) {
    console.error('Error in writing metadata', collection, e);
  }
}

main();
