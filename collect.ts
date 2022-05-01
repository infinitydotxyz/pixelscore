import fs from 'fs';
import path from 'path';
import fbAdmin from 'firebase-admin';
import * as stream from 'stream';
import { promisify } from 'util';
import axios from 'axios';
import { createWriteStream, mkdirSync } from 'fs';
import { QuerySnapshot, DocumentData, QueryDocumentSnapshot } from '@google-cloud/firestore';
import { execSync } from 'child_process';
import { ethers } from 'ethers';

import pixelScoreServiceAccount from './creds/pixelscore-firebase-creds.json';
import infinityServiceAccount from './creds/pixelscore-firebase-creds.json';
import MnemonicClient from './mnemonic';
import OpenSeaClient from './opensea';
import { BaseCollection } from '@infinityxyz/lib/types/core/Collection';
import { trimLowerCase, getSearchFriendlyString } from '@infinityxyz/lib/utils';
import { MnemonicContract } from './mnemonic';
import FirestoreBatchHandler from './FirestoreBatchHandler';

const fsAdminPixelScore = fbAdmin.initializeApp({
  credential: fbAdmin.credential.cert(pixelScoreServiceAccount as fbAdmin.ServiceAccount)
});

const fsAdminInfinity = fbAdmin.initializeApp({
  credential: fbAdmin.credential.cert(infinityServiceAccount as fbAdmin.ServiceAccount)
});

const pixelScoreDb = fsAdminPixelScore.firestore();
const infinityDb = fsAdminInfinity.firestore();
const pixelScoreDbBatchHandler = new FirestoreBatchHandler(pixelScoreDb);

const DATA_DIR = 'data';
const METADATA_DIR = 'metadata';
const METADATA_FILE = 'metadata.csv';
const RESIZED_IMAGES_DIR = 'resized';
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
  await getDirs(path.join(__dirname, DATA_DIR));
}

async function getDirs(dirPath: string) {
  const dirs = fs.readdirSync(dirPath).filter((file) => fs.statSync(path.join(dirPath, file)).isDirectory());
  const files = fs.readdirSync(dirPath).filter((file) => fs.statSync(path.join(dirPath, file)).isFile());

  for (const dir of dirs) {
    if (dir.startsWith('0x')) {
      const collection = dir.trim().toLowerCase();
      if (!ethers.utils.isAddress(collection)) {
        console.error('Invalid collection:', collection);
      } else {
        console.log('Collecting collection:', collection);
        // save collection info
        const collectionInfo = await getCollectionInfo(collection);
        const collectionRef = pixelScoreDb.collection(COLLECTIONS_COLL).doc(collection);
        if (collectionInfo) {
          pixelScoreDbBatchHandler.add(collectionRef, collectionInfo, { merge: true });
          // save token info
          const collectionDir = path.join(dirPath, dir);
          await saveTokenInfo(collectionRef, collectionDir, collectionInfo.slug);
        } else {
          console.error('Collection info not found:', collection);
        }
      }
    }
  }
}

async function saveTokenInfo(
  collectionRef: FirebaseFirestore.DocumentReference,
  collectionDir: string,
  collectionSlug: string
) {
  const metadataFile = path.join(collectionDir, METADATA_DIR, METADATA_FILE);
  if (fs.existsSync(metadataFile)) {
    console.log('Found metadata file:', metadataFile);
    const lines = fs.readFileSync(metadataFile, 'utf8').split('\n');
    for (const line of lines) {
      const [tokenId, rarityScore, rarityRank, imageUrl] = line.split(',');
      const tokenDocRef = collectionRef.collection(TOKENS_SUB_COLL).doc(tokenId);
      const tokenInfo: TokenInfo = {
        chainId: '1',
        collectionAddress: collectionRef.id,
        collectionSlug: collectionSlug,
        tokenId: tokenId,
        imageUrl: imageUrl,
        rarityScore: parseFloat(rarityScore),
        rarityRank: parseInt(rarityRank)
      };
      pixelScoreDbBatchHandler.add(tokenDocRef, tokenInfo, { merge: true });
    }
  } else {
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
