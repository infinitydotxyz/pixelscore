import { BaseToken } from '@infinityxyz/lib/types/core';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { infinityDb } from '../utils/firestore';

const DATA_DIR = '/mnt/disks/additional-disk/data';
const METADATA_DIR = 'metadata';
const METADATA_FILE = 'metadata.csv';

async function main() {
  console.log('Creating metadata files...');
  await createMetadataFiles(DATA_DIR);
}

async function createMetadataFiles(dirPath: string) {
  const dirs = readdirSync(dirPath).filter((file) => statSync(path.join(dirPath, file)).isDirectory());
  for (const dir of dirs) {
    if (dir.startsWith('0x')) {
      const metadataDir = path.join(dirPath, dir, METADATA_DIR);
      const metadataFile = path.join(metadataDir, METADATA_FILE);
      if (!existsSync(metadataFile)) {
        // recreate metadata file
        await fetchMetadata('1', dir, metadataDir);
      }
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
    tokens.forEach((token) => {
      const data = token.data() as BaseToken;
      const tokenImage = data?.image?.url || data?.alchemyCachedImage || '';
      if (!data || !tokenImage) {
        // console.error('Data is null for token');
        return;
      }
      lines += `${data.collectionAddress},${data.collectionName},${data.collectionSlug},${data.collectionProfileImage},${data.hasBlueCheck},${data.tokenId},${data.rarityScore},${data.rarityRank},${tokenImage}\n`;
    });
    // append to file
    writeFileSync(metadataFile, lines);
    console.log(
      `============================== Metadata written successfully ${collection} =================================`
    );
  } catch (e) {
    console.error('Error in writing metadata', collection, e);
  }
}

main();
