import fbAdmin from 'firebase-admin';
import * as stream from 'stream';
import { promisify } from 'util';
import axios from 'axios';
import { createWriteStream, mkdirSync } from 'fs';
import path from 'path';
import fs from 'fs';
import { QuerySnapshot, DocumentData } from '@google-cloud/firestore';
import { execSync, exec } from 'child_process';
import serviceAccount from './creds/nftc-infinity-firebase-creds.json';
import MnemonicClient from './mnemonic';
import OpenSeaClient from './opensea';

fbAdmin.initializeApp({
  credential: fbAdmin.credential.cert(serviceAccount as fbAdmin.ServiceAccount),
  storageBucket: 'infinity-static'
});

const db = fbAdmin.firestore();
const bucket = fbAdmin.storage().bucket();
const finished = promisify(stream.finished);
const DATA_DIR = 'data';
const MNEMONIC_DATA_DIR = 'mnemonic_data';
const IMAGES_DIR = 'resized';
const METADATA_DIR = 'metadata';
const METADATA_FILE_NAME = 'metadata.csv';

let origRetries = 0;

const mnemonic = new MnemonicClient();
const opensea = new OpenSeaClient();

async function fetchOSImage(url: string, collection: string, tokenId: string, resizedImagesDir: string) {
  // console.log(`================== Downloading image to ${resizedImagesDir} ====================`);
  mkdirSync(resizedImagesDir, { recursive: true });
  if (!url || !tokenId) {
    console.error('url or tokenId is null; url:', url, 'tokenId:', tokenId, 'collection:', collection);
    return;
  }
  // write url to file
  const urlFile = path.join(resizedImagesDir, tokenId + '.url');
  fs.writeFileSync(urlFile, `${tokenId},${url}`);

  // check if image file already exists
  const resizedImageLocalFile = path.join(resizedImagesDir, tokenId);
  if (!fs.existsSync(resizedImageLocalFile)) {
    if (url.indexOf('lh3') > 0) {
      const url224 = url + '=s224';
      // console.log('Downloading', url);
      downloadImage(url224, resizedImageLocalFile).catch((err) =>
        console.error('error downloading', url224, collection, tokenId, err)
      );
    } else {
      // console.log('Not OpenSea image for token', tokenId, url, collection);
      downloadImage(url, resizedImageLocalFile)
        .then(() => {
          // mogrify
          // console.log('Mogrifying image', url, collection, tokenId);
          const cmd = `mogrify -resize 224x224^ -gravity center -extent 224x224 ${resizedImageLocalFile}`;
          exec(cmd, (err, stdout, stderr) => {
            if (err) {
              console.error('Error mogrifying', resizedImageLocalFile, err);
            }
          });
        })
        .catch((err) => console.error('error downloading', url, collection, tokenId, err));
    }
  }
}

async function downloadImage(url: string, outputLocationPath: string): Promise<any> {
  const writer = createWriteStream(outputLocationPath);
  return axios({
    method: 'get',
    url,
    responseType: 'stream'
  })
    .then((response) => {
      response.data.pipe(writer);
      return finished(writer);
    })
    .catch((err) => {
      throw err;
    });
}

async function buildCollection(address: string, tokensOffset = 0) {
  console.log(`============================== Building collection ${address} =================================`);
  // check if collection is already downloaded to local file system
  const collectionDir = path.join(__dirname, DATA_DIR, address);
  if (fs.existsSync(collectionDir)) {
    console.log('Collection', address, 'already downloaded. Skipping for now');
    return;
  }
  const tokensOfContractLimit = 50;
  const openseaLimit = 50;
  const openseaTokenIdsLimit = 20;
  const tokenResponse = await mnemonic.getNFTsOfContract(address, tokensOfContractLimit, tokensOffset);
  const tokens = tokenResponse.tokens;
  if (tokens.length == 0) {
    console.log('No tokens found for', address);
    return;
  }
  console.log(`Found ${tokens.length} tokens for ${address}`);
  const resizedImagesDir = path.join(__dirname, DATA_DIR, address, IMAGES_DIR);

  // fetch tokens that don't have images
  const imageLessTokens = [];
  for (const token of tokens) {
    const resizedImageLocalFile = path.join(resizedImagesDir, token.tokenId);
    if (!fs.existsSync(resizedImageLocalFile)) {
      imageLessTokens.push(token);
    }
  }

  const numImagelessTokens = imageLessTokens.length;
  const numTokens = tokens.length;
  const percentFailed = Math.floor((numImagelessTokens / numTokens) * 100);
  // console.log(`percent tokens failed to download images (${percentFailed}%)`);
  if (percentFailed < 40) {
    const numIters = Math.ceil(numImagelessTokens / openseaTokenIdsLimit);
    for (let i = 0; i < numIters; i++) {
      const tokenSlice = tokens.slice(i * openseaTokenIdsLimit, (i + 1) * openseaTokenIdsLimit);
      let tokenIdsConcat = '';
      for (const token of tokenSlice) {
        tokenIdsConcat += `token_ids=${token.tokenId}&`;
      }
      const data = await opensea.getTokenIdsOfContract(address, tokenIdsConcat);
      // console.log(`opensea getTokenIdsOfContract for ${address}`, data);
      for (const datum of data.assets) {
        const imageUrl = datum.image_url;
        await fetchOSImage(imageUrl, address, datum.token_id, resizedImagesDir);
      }
    }
  } else {
    const numIters = Math.ceil(numTokens / openseaLimit);
    let cursor = '';
    for (let i = 0; i < numIters; i++) {
      const data = await opensea.getNFTsOfContract(address, openseaLimit, cursor);
      // console.log(`opensea getNFTsOfContract for ${address}`, data);
      // update cursor
      cursor = data.next;
      for (const datum of data.assets) {
        const imageUrl = datum.image_url;
        await fetchOSImage(imageUrl, address, datum.token_id, resizedImagesDir);
      }
    }
  }

  // recurse
  if (tokens.length === tokensOfContractLimit) {
    console.log('Building collection', address, 'recursing with offset', tokensOffset);
    await buildCollection(address, tokensOffset + tokensOfContractLimit);
  }
}

async function main() {
  console.log('Usage for all collections: node 100m.js');
  console.log(
    'Usage for individual collection: node 100m.js <number of retries (maybe 3?)> <retry after seconds (maybe 60?)> <chainId> <collectionAddress>'
  );
  let retries = parseInt(process.argv[2]);
  if (!retries) {
    retries = 3;
  }
  let retryAfter = parseInt(process.argv[3]);
  if (!retryAfter) {
    retryAfter = 30;
  }

  origRetries = retries;

  let chainId, address;
  if (process.argv.length == 4) {
    process.exit(1);
  } else if (process.argv.length == 6) {
    chainId = process.argv[4];
    address = process.argv[5].trim().toLowerCase();
    await buildCollection(address, 0);
  } else {
    console.log('============================== Fetching collections from mnemonic =================================');
    const limit = 50;
    let done = false;
    let offset = 0;
    while (!done) {
      const colls = await mnemonic.getERC721Collections(offset, limit);
      // break condition
      if (colls.length < limit) {
        done = true;
      }
      for (const coll of colls) {
        await buildCollection(coll.address, 0);
      }
    }
  }
}

main();
