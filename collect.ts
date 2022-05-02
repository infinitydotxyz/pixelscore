import { BaseCollection } from '@infinityxyz/lib/types/core/Collection';
import { getSearchFriendlyString, trimLowerCase } from '@infinityxyz/lib/utils';
import { execSync } from 'child_process';
import { ethers } from 'ethers';
import fbAdmin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import {
  default as infinityServiceAccount,
  default as pixelScoreServiceAccount
} from './creds/pixelscore-firebase-creds.json';
import FirestoreBatchHandler from './FirestoreBatchHandler';
import MnemonicClient, { MnemonicContract } from './mnemonic';
import OpenSeaClient from './opensea';

const fsAdminPixelScore = fbAdmin.initializeApp(
  {
    credential: fbAdmin.credential.cert(pixelScoreServiceAccount as fbAdmin.ServiceAccount)
  },
  'pixelscore'
);

const fsAdminInfinity = fbAdmin.initializeApp(
  {
    credential: fbAdmin.credential.cert(infinityServiceAccount as fbAdmin.ServiceAccount)
  },
  'infinity'
);

const pixelScoreDb = fsAdminPixelScore.firestore();
const infinityDb = fsAdminInfinity.firestore();
const pixelScoreDbBatchHandler = new FirestoreBatchHandler(pixelScoreDb);

const DATA_DIR = 'data';
const METADATA_DIR = 'metadata';
const METADATA_FILE = 'metadata.csv';
const COLLECTION_COMPLETE_FILE = 'collection-complete.txt';
const COLLECTIONS_COLL = 'collections';
const TOKENS_SUB_COLL = 'tokens';

const mnemonic = new MnemonicClient();
const opensea = new OpenSeaClient();

export interface CollectionInfo {
  address: string;
  chainId: string;
  tokenStandard: string;
  slug: string;
  name: string;
  symbol: string;
  description: string;
  profileImage: string;
  bannerImage: string;
  cardDisplaytype?: string;
  twitter?: string;
  discord?: string;
  external?: string;
}

export interface TokenInfo {
  chainId: string;
  collectionAddress: string;
  collectionSlug: string;
  tokenId: string;
  imageUrl: string;
  rarityScore?: number;
  rarityRank?: number;
  collectionPixelScore?: number;
  collectionPixelRank?: number;
  pixelScore?: number;
  pixelRank?: number;
}

async function main() {
  console.log('Collecting data...');
  const dirPath = path.join(__dirname, DATA_DIR);
  // await processCollections(dirPath);
  await processOneCollection(dirPath, '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d');
}

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
  console.log('Collecting collection:', collection);
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
    console.log('Finished Collecting collection:', collection);
    execSync(`touch ${collectionCompleteFile}`);
  } else {
    console.error('Collection info not found:', collection);
  }
}

async function saveTokenInfo(
  collectionAddress: string,
  collectionRef: FirebaseFirestore.DocumentReference,
  collectionDir: string,
  collectionSlug: string
) {
  const metadataFile = path.join(collectionDir, METADATA_DIR, METADATA_FILE);
  if (fs.existsSync(metadataFile)) {
    console.log('Reading metadata file:', metadataFile);
    const lines = fs.readFileSync(metadataFile, 'utf8').split('\n');
    for (const line of lines) {
      const [tokenId, rarityScore, rarityRank, imageUrl] = line.split(',');
      const tokenDocRef = collectionRef.collection(TOKENS_SUB_COLL).doc(tokenId);
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

async function getCollectionInfo(collection: string): Promise<CollectionInfo | undefined> {
  // try fetching from infinity
  let info = await getCollectionInfoFromInfinity(collection);
  if (!info) {
    // try from opensea
    info = await getCollectionInfoFromOpensea(collection);
    if (!info) {
      // try from mnemonic
      info = await getCollectionInfoFromMnemonic(collection);
    }
  }
  return info;
}

async function getCollectionInfoFromInfinity(collection: string): Promise<CollectionInfo | undefined> {
  const collectionRef = infinityDb.collection(COLLECTIONS_COLL).doc(collection);
  const data = (await collectionRef.get()).data() as BaseCollection;
  if (data) {
    const info: CollectionInfo = {
      address: trimLowerCase(data.address),
      chainId: '1',
      tokenStandard: 'ERC721',
      slug: data.slug,
      name: data.metadata.name,
      symbol: data.metadata.symbol,
      description: data.metadata.description,
      profileImage: data.metadata.profileImage,
      bannerImage: data.metadata.bannerImage,
      cardDisplaytype: data.metadata.displayType,
      twitter: data.metadata.links.twitter,
      discord: data.metadata.links.discord,
      external: data.metadata.links.external
    };
    return info;
  }
  return undefined;
}

async function getCollectionInfoFromOpensea(collection: string): Promise<CollectionInfo | undefined> {
  const data = await opensea.getCollectionMetadata(collection);
  if (data) {
    const info: CollectionInfo = {
      address: trimLowerCase(collection),
      chainId: '1',
      tokenStandard: 'ERC721',
      slug: getSearchFriendlyString(data.links.slug),
      name: data.name,
      symbol: data.symbol,
      description: data.description,
      profileImage: data.profileImage,
      bannerImage: data.bannerImage,
      cardDisplaytype: data.displayType,
      twitter: data.links.twitter,
      discord: data.links.discord,
      external: data.links.external
    };
    return info;
  }
  return undefined;
}

async function getCollectionInfoFromMnemonic(collection: string): Promise<CollectionInfo | undefined> {
  const data = (await mnemonic.getCollection(collection)) as MnemonicContract;
  if (data) {
    const info: CollectionInfo = {
      address: trimLowerCase(data.address),
      chainId: '1',
      tokenStandard: 'ERC721',
      slug: getSearchFriendlyString(data.name),
      name: data.name,
      symbol: data.symbol,
      description: '',
      profileImage: '',
      bannerImage: '',
      cardDisplaytype: '',
      twitter: '',
      discord: '',
      external: ''
    };
    return info;
  }
  return undefined;
}

main();
