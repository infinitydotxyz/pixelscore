import { jsonString, trimLowerCase } from '@infinityxyz/lib/utils';
import bodyParser from 'body-parser';
import { createHmac } from 'crypto';
import dotenv from 'dotenv';
import { Express, Request, Response } from 'express';
import { CollectionInfoArray, Nft, TokenInfoArray, UserNftsArray } from 'types/firestore';
import { startServer } from './server';
import { CollectionSearchQuery, NftsOrderBy, NftsQuery, UserNftsQuery } from './types/apiQueries';
import {
  AlchemyAddressActivityWebHook,
  CollectionInfo,
  RevealOrder,
  TokenInfo,
  UpdateRankVisibility,
  UserRecord
} from './types/main';
import { getPageUserNftsFromAlchemy, getUserNftsFromAlchemy } from './utils/alchemy';
import {
  ALCHEMY_WEBHOOK_ACTIVITY_CATEGORY_EXTERNAL,
  ALCHEMY_WEBHOOK_ASSET_ETH,
  ALCHEMY_WEBHOOK_ETH_MAINNET,
  COLLECTIONS_COLL,
  DEFAULT_PAGE_LIMIT,
  getProvider,
  PIXELRANK_PRICE_PER_ITEM,
  PIXELRANK_WALLET,
  RANKINGS_COLL,
  REVEALS_COLL,
  REVEALS_ITEMS_SUB_COLL,
  REVEAL_ITEMS_LIMIT,
  USERS_COLL,
  WEBHOOK_EVENTS_COLL
} from './utils/constants';
import { pixelScoreDb } from './utils/firestore';
import FirestoreBatchHandler from './utils/firestoreBatchHandler';
import { decodeCursorToObject, encodeCursor, getDocIdHash } from './utils/main';
import { getTokenInfo, searchCollections, updateTokenInfo } from './utils/pixelstore';

dotenv.config();

const app: Express = startServer();

const pixelScoreDbBatchHandler = new FirestoreBatchHandler(pixelScoreDb);

// ========================================= GET REQUESTS =========================================

// ################################# Public endpoints #################################

app.get('/collections', async (req: Request, res: Response) => {
  const query = req.query as unknown as NftsQuery;

  const data = await getCollections(query);
  res.send(data);
});

app.get('/collections/search', async (req: Request, res: Response) => {
  const searchQuery = req.query as CollectionSearchQuery;

  let query = '';
  if (searchQuery.query) {
    // middleware will convert numbers in the query to a 'number'
    // convert everything to a string (or the code will crash epecting a string)
    query = searchQuery.query?.toString() ?? '';
  }

  const limit = searchQuery.limit ?? DEFAULT_PAGE_LIMIT;

  // with firebase we were not able to first sort on bluecheck, then do a text search
  // so we first search bluechecks, and if not enough results, search non bluechecks
  const result = await searchCollections(query ?? '', searchQuery.cursor ?? '', true, limit);

  if (result.data.length < limit && !result.hasNextPage) {
    const result2 = await searchCollections(query ?? '', searchQuery.cursor ?? '', false, limit);

    result.data = result.data.concat(result2.data);
    result.cursor = result2.cursor;
    result.hasNextPage = result2.hasNextPage;
  }

  res.send({
    data: result.data,
    cursor: result.cursor,
    hasNextPage: result.hasNextPage
  });
});

app.get('/collections/:chainId/:collectionAddress/nfts', async (req: Request, res: Response) => {
  const chainId = req.params.chainId;
  const collectionAddress = trimLowerCase(req.params.collectionAddress);
  const query = req.query as unknown as NftsQuery;

  const minRank = query.minRank ?? 1;
  const maxRank = query.maxRank ?? 10;

  const data = await getCollectionNfts(query, minRank, maxRank, chainId, collectionAddress);
  res.send(data);
});

app.get('/nfts', async (req: Request, res: Response) => {
  const query = req.query as unknown as NftsQuery;

  const minRank = query.minRank ?? 1;
  const maxRank = query.maxRank ?? 10;

  const data = await getNfts(query, minRank, maxRank);
  res.send(data);
});

// ################################# User authenticated read endpoints #################################

app.get('/u/:user/nfts', async (req: Request, res: Response) => {
  const user = trimLowerCase(req.params.user);
  const query = req.query as unknown as NftsQuery;
  const chainId = '1'; // todo: other chainIds?
  // const nfts = await getUserNftsFromPixelScoreDb(user, query);
  const nfts = await getUserNfts(user, chainId, query);
  const resp = {
    ...nfts
  };
  res.send(resp);
});

app.get('/u/:user/reveals', async (req: Request, res: Response) => {
  const user = trimLowerCase(req.params.user);
  console.log('Fetching reveals for user', user);
  const cursor: string = (req.query.cursor as string) ?? '';
  const isCompleted = req.query.isCompleted ?? false;

  try {
    let query = pixelScoreDb
      .collection(REVEALS_COLL)
      .where('revealer', '==', user)
      .where('chainId', '==', '1')
      .where('txnStatus', isCompleted ? '==' : '!=', 'success')
      .limit(DEFAULT_PAGE_LIMIT);

    // firebase complains on the != above
    if (!isCompleted) {
      query = query.orderBy('txnStatus');
    }

    query = query.orderBy('timestamp', 'desc');

    if (cursor) {
      const startDoc = await pixelScoreDb.doc(cursor).get();
      query = query.startAfter(startDoc);
    }

    const revealSnap = await query.get();
    let nextCursor = '';

    const resp: RevealOrder[] = [];
    for (const revealDoc of revealSnap.docs) {
      const revealDocData = revealDoc.data() as RevealOrder;

      // make sure the array isn't undefined, or crashes below
      revealDocData.revealItems = revealDocData.revealItems || [];

      const revealItemsSnap = await revealDoc.ref.collection(REVEALS_ITEMS_SUB_COLL).get();
      for (const revealItemDoc of revealItemsSnap.docs) {
        const revealItemDocData = revealItemDoc.data() as TokenInfo;

        revealDocData.revealItems.push(revealItemDocData);
      }

      nextCursor = revealDoc.ref.path;

      resp.push(revealDocData);
    }

    const hasNextPage = revealSnap.docs.length === DEFAULT_PAGE_LIMIT;

    res.send({ data: resp, cursor: nextCursor, hasNextPage: hasNextPage });
  } catch (err) {
    console.error('Error while getting reveals for user', user, err);
    res.sendStatus(500);
  }
});

app.get('/u/:user', async (req: Request, res: Response) => {
  const user = trimLowerCase(req.params.user);
  const chainId = (req.query.chainId as string) ?? '1';

  const doc = pixelScoreDb.collection(USERS_COLL).doc(user);

  let userRec = (await doc.get()).data() as UserRecord | undefined;

  if (!userRec) {
    userRec = {
      name: '',
      address: user,
      portfolioScore: -1,
      portfolioScoreNumNfts: -1,
      portfolioScoreUpdatedAt: -1,
      totalNftsOwned: -1
    };
  }

  if (userRec.address === undefined) {
    userRec.address = user;
  }

  const scoreInfo = await getPortfolioScore(user, chainId);
  userRec.portfolioScore = scoreInfo.portfolioScore / scoreInfo.portfolioScoreNumNfts;
  userRec.portfolioScoreUpdatedAt = scoreInfo.portfolioScoreUpdatedAt;
  userRec.portfolioScoreNumNfts = scoreInfo.portfolioScoreNumNfts;

  doc.set(userRec, { merge: true }).catch((err) => {
    console.error('Error while setting user record', user, err);
  });

  res.send(userRec);
});

// ========================================= POST REQUESTS =========================================

// ########################### Endpoint that receives webhook events from Alchemy ###########################

app.post(
  '/webhooks/alchemy/padw',
  bodyParser.json({
    verify: function (req, res, buf, encoding: BufferEncoding) {
      const signature = req.headers['x-alchemy-signature']; // Lowercase for NodeJS
      const body = buf.toString(encoding || 'utf8');
      const matches = isValidSignature(body, signature as string);
      if (!matches) {
        throw 'Alchemy wwebhook signature does not match!';
      }
    }
  }),
  (req: Request, res: Response) => {
    try {
      if (isValidRequest(req)) {
        const data = req.body as AlchemyAddressActivityWebHook;
        // first store webhook data in firestore
        const webHookEventId = data.id;
        pixelScoreDb
          .collection(WEBHOOK_EVENTS_COLL)
          .doc(webHookEventId)
          .set(data, { merge: true })
          .then(() => {
            console.log('webhook data stored in firestore with id', webHookEventId);
          })
          .catch((err) => {
            console.error('Error while storing webhook data in firestore', webHookEventId, err);
          });

        // then update reveal order
        updateRevealOrder(data)
          .then(() => {
            console.log(`Successfully processed reveal with txnHash: ${trimLowerCase(data.event.activity[0].hash)}`);
            res.sendStatus(200);
          })
          .catch((err) => {
            console.error(`Error processing reveal with txnHash: ${trimLowerCase(data.event.activity[0].hash)}`, err);
            res.sendStatus(200); // to prevent retries
          });
      } else {
        console.error('Invalid request');
        res.sendStatus(200); // to prevent retries
      }
    } catch (err) {
      console.error('Error while processing padw webhook', err);
      res.sendStatus(500);
    }
  }
);

// ################################# User authenticated write endpoints #################################

app.post('/u/:user', async (req: Request, res: Response) => {
  const user = trimLowerCase(req.params.user);

  const data = req.body as UserRecord;

  await pixelScoreDb
    .collection(USERS_COLL)
    .doc(user)
    .set(data)
    .catch((err) => {
      console.error('Error while setting user record', user, err);
    });

  res.sendStatus(200);
});

app.post('/u/:user/reveals', (req: Request, res: Response) => {
  const user = trimLowerCase(req.params.user);
  console.log('Saving reveals for user', user);
  try {
    const data = req.body as RevealOrder;
    // write top level doc
    const chainId = data.chainId;
    const revealer = trimLowerCase(user);
    const numItems = data.numItems;
    const pricePerItem = PIXELRANK_PRICE_PER_ITEM;
    const totalPrice = numItems * pricePerItem;
    const txnHash = data.txnHash;
    const txnStatus = 'pending';
    const topDocData: Omit<RevealOrder, 'revealItems'> = {
      chainId,
      revealer,
      numItems,
      pricePerItem,
      totalPrice,
      txnHash,
      txnStatus,
      timestamp: Date.now()
    };
    const topDocId = `${chainId}:${txnHash}`;
    const topDocRef = pixelScoreDb.collection(REVEALS_COLL).doc(topDocId);
    pixelScoreDbBatchHandler.add(topDocRef, topDocData, { merge: true });

    // write items
    const items = data.revealItems as TokenInfo[];
    for (const item of items) {
      const itemDocId = getDocIdHash({
        chainId: item.chainId,
        collectionAddress: item.collectionAddress ?? '',
        tokenId: item.tokenId ?? ''
      });
      const itemRef = topDocRef.collection(REVEALS_ITEMS_SUB_COLL).doc(itemDocId);
      pixelScoreDbBatchHandler.add(itemRef, item, { merge: true });
    }

    pixelScoreDbBatchHandler
      .flush()
      .then(() => {
        res.sendStatus(200);
      })
      .catch((err) => {
        throw err;
      });
  } catch (err) {
    console.error('Error while saving reveals for user', user, err);
    res.sendStatus(500);
  }
});

app.post('/u/:user/refresh', async (req: Request, res: Response) => {
  const user = trimLowerCase(req.params.user);
  try {
    const txnHash = req.body.txnHash;
    const chainId = req.body.chainId;
    const revealOrderRef = pixelScoreDb
      .collection(REVEALS_COLL)
      .where('txnHash', '==', txnHash)
      .where('chainId', '==', chainId);
    const revealOrderSnapshot = await revealOrderRef.get();
    if (revealOrderSnapshot.size === 1) {
      const revealOrderDocRef = revealOrderSnapshot.docs[0].ref;
      const revealOrderData = revealOrderSnapshot.docs[0].data() as RevealOrder;

      // make sure the array isn't undefined, or crashes below
      revealOrderData.revealItems = revealOrderData.revealItems || [];

      if (revealOrderData.txnStatus === 'success') {
        const revealItemsSnap = await revealOrderDocRef.collection(REVEALS_ITEMS_SUB_COLL).get();
        for (const revealItemDoc of revealItemsSnap.docs) {
          const revealItemDocData = revealItemDoc.data() as TokenInfo;
          revealOrderData.revealItems.push(revealItemDocData);
        }
        res.send(revealOrderData);
      } else if (revealOrderData.txnStatus === 'error') {
        res.send('Txn failed');
      } else {
        console.log('Checking pending txn on refresh', txnHash);
        try {
          // check async
          updatePendingTxn(user, chainId, txnHash, revealOrderDocRef);
        } catch (err) {
          console.error('Error while checking pending txn on refresh', txnHash, err);
        }
        res.send('Txn pending');
      }
    } else {
      console.error('No reveal/more than 1 reveal found during refresh for', txnHash);
    }
  } catch (err) {
    console.error('Error while refreshing reveal', err);
  }
});

app.post('/u/:user/rankVisibility', async (req: Request, res: Response) => {
  const user = trimLowerCase(req.params.user);
  console.log('updating rank visibility for user', user);
  try {
    const data = req.body as UpdateRankVisibility[];
    for (const item of data) {
      const snap = await pixelScoreDb
        .collectionGroup(REVEALS_ITEMS_SUB_COLL)
        .where('pixelRankRevealer', '==', user)
        .where('chainId', '==', item.chainId)
        .where('collectionAddress', '==', item.collectionAddress)
        .where('tokenId', '==', item.tokenId)
        .get();
      if (snap.size === 1) {
        const docRef = snap.docs[0].ref;
        pixelScoreDbBatchHandler.add(docRef, { pixelRankVisible: item.pixelRankVisible }, { merge: true });

        // update the token
        const tokenInfo: Partial<TokenInfo> = {
          pixelRankVisible: item.pixelRankVisible
        };

        updateTokenInfo(item.chainId, item.collectionAddress, item.tokenId, tokenInfo);
      } else {
        console.error(
          'No reveal/more than one reveal found for',
          user,
          item.chainId,
          item.collectionAddress,
          item.tokenId
        );
      }
    }
    pixelScoreDbBatchHandler
      .flush()
      .then(() => {
        res.sendStatus(200);
      })
      .catch((err) => {
        throw err;
      });
  } catch (err) {
    console.error('Error while updating rank visibility for user', user, err);
    res.sendStatus(500);
  }
});

// ============================================ HELPER FUNCTIONS ============================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getUserNftsFromPixelScoreDb(userAddress: string, query: NftsQuery): Promise<TokenInfoArray> {
  const limit = query.limit + 1;
  const minRank = query.minRank;
  const maxRank = query.maxRank;
  let nftsQuery: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = pixelScoreDb.collection(RANKINGS_COLL);
  nftsQuery = nftsQuery
    .where('pixelRank', '>=', minRank)
    .where('pixelRank', '<', maxRank)
    .where('owner', '==', userAddress);
  nftsQuery = nftsQuery.orderBy(NftsOrderBy.PixelRank, query.orderDirection);

  let cursor = query.cursor;
  if (cursor) {
    const startDoc = await pixelScoreDb.doc(cursor).get();
    nftsQuery = nftsQuery.startAfter(startDoc);
  }

  const results = await nftsQuery.limit(limit).get();
  const hasNextPage = results.size > query.limit;
  const nftsToReturnSnap = results.docs.slice(0, query.limit);
  const nftsToReturn = nftsToReturnSnap.map((doc) => doc.data() as TokenInfo);

  removeRankInfo(nftsToReturn);

  cursor = results.docs[query.limit - 1]?.ref?.path;
  return {
    data: nftsToReturn,
    cursor,
    hasNextPage
  };
}

// todo: remove when ready
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getUserNfts(
  userAddress: string,
  chainId: string,
  query: Pick<UserNftsQuery, 'collectionAddresses' | 'cursor' | 'limit'>
): Promise<UserNftsArray> {
  type Cursor = { pageKey?: string; startAtToken?: string };
  const cursor = decodeCursorToObject<Cursor>(query.cursor);
  const limit = query.limit + 1;
  let nfts: Nft[] = [];
  let alchemyHasNextPage = true;
  let pageKey = '';
  let nextPageKey = cursor?.pageKey ?? '';
  let pageNumber = 0;
  while (nfts.length < limit && alchemyHasNextPage) {
    pageKey = nextPageKey;
    const startAtToken = pageNumber === 0 && cursor.startAtToken ? cursor.startAtToken : undefined;

    const response = await getPageUserNftsFromAlchemy(
      pageKey,
      chainId,
      userAddress,
      query.collectionAddresses,
      startAtToken
    );
    nfts = [...nfts, ...response.nfts];
    alchemyHasNextPage = response.hasNextPage;
    nextPageKey = response.pageKey;
    pageNumber += 1;
  }

  const continueFromCurrentPage = nfts.length > query.limit;
  const hasNextPage = continueFromCurrentPage || alchemyHasNextPage;
  let nftsToReturn = nfts.slice(0, query.limit);
  const nftToStartAt = nfts?.[query.limit]?.tokenId;

  // add ranking info for each nft
  nftsToReturn = await addRankInfoToNFTs(nftsToReturn);

  const updatedCursor = encodeCursor({
    pageKey: nextPageKey,
    startAtToken: nftToStartAt
  });

  return {
    data: nftsToReturn,
    cursor: updatedCursor,
    hasNextPage
  };
}

async function addRankInfoToNFTs(nfts: Nft[]): Promise<Nft[]> {
  const docs: FirebaseFirestore.DocumentReference[] = [];

  for (const nft of nfts) {
    const docId = getDocIdHash({
      chainId: nft.chainId,
      collectionAddress: nft.collectionAddress ?? '',
      tokenId: nft.tokenId
    });

    docs.push(pixelScoreDb.doc(`${RANKINGS_COLL}/${docId}`));
  }

  if (docs.length > 0) {
    const results = await pixelScoreDb.getAll(...docs);

    if (results.length === nfts.length) {
      const filtered: Nft[] = [];

      for (let i = 0; i < nfts.length; i++) {
        const n = nfts[i];
        const ps = results[i].data();

        if (ps) {
          // my notes said collectionName was missing. added here
          n.collectionName = ps.collectionName;

          n.inCollectionPixelRank = ps.inCollectionPixelRank;
          n.pixelRank = ps.pixelRank;
          n.pixelRankBucket = ps.pixelRankBucket;
          n.pixelScore = ps.pixelScore;
          n.pixelRankVisible = ps.pixelRankVisible;
          n.pixelRankRevealer = ps.pixelRankRevealer;
          n.pixelRankRevealed = ps.pixelRankRevealed;
          n.inCollectionPixelScore = ps.inCollectionPixelScore;

          filtered.push(n);
        }
      }

      return filtered;
    }
  }

  return [];
}

async function updatePendingTxn(
  user: string,
  chainId: string,
  txnHash: string,
  revealOrderDocRef: FirebaseFirestore.DocumentReference
) {
  try {
    const provider = getProvider(chainId);
    if (provider === undefined) {
      console.error('Not waiting for txn since provider is null');
    } else {
      const receipt = await provider.waitForTransaction(txnHash, 1);
      const txnData = JSON.parse(jsonString(receipt));
      const txnSuceeded = txnData.status === 1;
      const updatedStatus = txnSuceeded ? 'success' : 'error';
      if (txnSuceeded) {
        console.log('Txn succeeded on refresh', txnHash);
        await updateRevealItemsWithRanks(user, revealOrderDocRef);
      } else {
        console.log('Txn failed on refresh', txnHash);
        pixelScoreDbBatchHandler.add(revealOrderDocRef, { txnStatus: updatedStatus }, { merge: true });
      }
      pixelScoreDbBatchHandler.flush().catch((err) => {
        throw err;
      });
    }
  } catch (err) {
    console.error('Error while updating pending txn on refresh', txnHash, err);
    throw err;
  }
}

async function updateRevealItemsWithRanks(user: string, revealOrderDocRef: FirebaseFirestore.DocumentReference) {
  pixelScoreDbBatchHandler.add(revealOrderDocRef, { txnStatus: 'success' }, { merge: true });
  const revealOrderItems = await revealOrderDocRef.collection(REVEALS_ITEMS_SUB_COLL).limit(REVEAL_ITEMS_LIMIT).get();
  for (const revealOrderItem of revealOrderItems.docs) {
    const revealOrderItemDocRef = revealOrderItem.ref;
    const revealOrderItemData = revealOrderItem.data() as unknown as TokenInfo;
    const chainId = revealOrderItemData.chainId;
    const collectionAddress = revealOrderItemData.collectionAddress;
    const tokenId = revealOrderItemData.tokenId;
    // fetch ranking info
    const rankingData = await getRevealData(user, chainId, collectionAddress ?? '', tokenId ?? '');
    if (rankingData) {
      pixelScoreDbBatchHandler.add(revealOrderItemDocRef, rankingData, { merge: true });
    } else {
      console.error('No ranking data found for', chainId, collectionAddress, tokenId);
    }
  }
  pixelScoreDbBatchHandler.flush().catch((err) => {
    throw err;
  });
}

async function updateRevealOrder(webhookData: AlchemyAddressActivityWebHook) {
  const txnHash = trimLowerCase(webhookData.event.activity[0].hash);
  const network = webhookData.event.network;
  const chainId = alchemyNetworkToChainId(network);
  const revealer = webhookData.event.activity[0].fromAddress;

  console.log('updating reveal order for', revealer, chainId, txnHash);
  const revealOrderRef = pixelScoreDb
    .collection(REVEALS_COLL)
    .where('txnHash', '==', txnHash)
    .where('chainId', '==', chainId);
  const revealOrderSnapshot = await revealOrderRef.get();

  if (revealOrderSnapshot.size === 1) {
    const revealOrderDocRef = revealOrderSnapshot.docs[0].ref;
    const revealOrderData = revealOrderSnapshot.docs[0].data as unknown as RevealOrder;
    if (revealOrderData.txnStatus === 'pending') {
      await updateRevealItemsWithRanks(revealer, revealOrderDocRef);
    } else {
      console.log('Reveal already processed or txn failed', txnHash);
    }
  } else {
    console.error('No reveal/more than 1 reveal found for', txnHash);
  }
}

async function getRevealData(
  revealer: string,
  chainId: string,
  collectionAddress: string,
  tokenId: string
): Promise<Partial<TokenInfo> | undefined> {
  const tokenInfo = await getTokenInfo(chainId, collectionAddress, tokenId);

  if (tokenInfo) {
    const rankData: Partial<TokenInfo> = {
      inCollectionPixelScore: tokenInfo?.inCollectionPixelScore,
      inCollectionPixelRank: tokenInfo?.inCollectionPixelRank,
      pixelScore: tokenInfo?.pixelScore,
      pixelRank: tokenInfo?.pixelRank,
      pixelRankBucket: tokenInfo?.pixelRankBucket,
      pixelRankRevealed: true,
      pixelRankVisible: false,
      pixelRankRevealer: revealer,
      pixelRankRevealedAt: Date.now()
    };
    return rankData;
  } else {
    console.error('No ranking/more than 1 info found for', chainId, collectionAddress, tokenId);
  }
}

function isValidSignature(rawBody: string, signature: string): boolean {
  try {
    const signingKey = process.env.ALCHMEY_PADW_SIGNING_KEY ?? '';
    const hmac = createHmac('sha256', signingKey); // Create a HMAC SHA256 hash using the signing key
    hmac.update(rawBody, 'utf8'); // Update the signing key hash with the request body using utf8
    const digest = hmac.digest('hex');
    const isValid = signature === digest;
    if (!isValid) {
      console.error('Invalid signature', signature);
    }
    return isValid;
  } catch (err) {
    console.error('Error while validating signature', err);
    return false;
  }
}

function isValidRequest(req: Request): boolean {
  try {
    const data = req.body as AlchemyAddressActivityWebHook;

    // check basics
    if (data.webhookId !== process.env.ALCHEMY_PADW_WEBHOOK_ID) {
      console.error('Invalid webhookId');
      return false;
    }
    if (data.event.network !== ALCHEMY_WEBHOOK_ETH_MAINNET) {
      console.error('Invalid network');
      return false;
    }
    if (data.event.activity.length !== 1) {
      console.error('Invalid activty list');
      return false;
    }

    // check activity
    const activity = data.event.activity[0];
    if (activity.toAddress.trim().toLowerCase() !== PIXELRANK_WALLET) {
      console.error('Invalid pixelscore wallet');
      return false;
    }
    if (activity.value < PIXELRANK_PRICE_PER_ITEM) {
      // todo: multiply by quantity
      console.error('Invalid price');
      return false;
    }
    if (activity.asset !== ALCHEMY_WEBHOOK_ASSET_ETH) {
      console.error('Invalid asset for payment');
      return false;
    }
    if (activity.category.trim().toLowerCase() !== ALCHEMY_WEBHOOK_ACTIVITY_CATEGORY_EXTERNAL) {
      console.error('Invalid activity category');
      return false;
    }
  } catch (err) {
    console.error('Error while checking request validity', err);
    return false;
  }
  return true;
}

function alchemyNetworkToChainId(network: string) {
  switch (network) {
    case ALCHEMY_WEBHOOK_ETH_MAINNET:
      return '1';
    default:
      return '0';
  }
}

async function getCollections(query: NftsQuery): Promise<CollectionInfoArray> {
  let nftsQuery: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = pixelScoreDb.collection(COLLECTIONS_COLL);

  nftsQuery = nftsQuery.orderBy('hasBlueCheck', 'desc');

  if (query.cursor) {
    const startDoc = await pixelScoreDb.doc(query.cursor).get();
    nftsQuery = nftsQuery.startAfter(startDoc);
  }

  nftsQuery = nftsQuery.limit(query.limit);

  let cursor = '';
  const results = await nftsQuery.get();
  const data = results.docs.map((item) => {
    const collection = item.data() as CollectionInfo;

    cursor = item.ref.path;

    return collection;
  });

  const hasNextPage = data.length === query.limit;

  return {
    data,
    cursor: cursor,
    hasNextPage
  };
}

async function getCollectionNfts(
  query: NftsQuery,
  minRank: number,
  maxRank: number,
  chainId?: string,
  collectionAddress?: string
): Promise<TokenInfoArray> {
  const rankRange = [...Array(maxRank - minRank + 1).keys()].map((x) => x + minRank);
  let nftsQuery: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = pixelScoreDb.collection(RANKINGS_COLL);
  if (collectionAddress) {
    nftsQuery = nftsQuery.where('collectionAddress', '==', collectionAddress);
  }
  if (chainId) {
    nftsQuery = nftsQuery.where('chainId', '==', chainId);
  }
  nftsQuery = nftsQuery.where('pixelRankBucket', 'in', rankRange);
  if (query.showOnlyVisible && !query.showOnlyUnvisible) {
    nftsQuery = nftsQuery.where('pixelRankVisible', '==', true);
  } else if (!query.showOnlyVisible && query.showOnlyUnvisible) {
    nftsQuery = nftsQuery.where('pixelRankVisible', '!=', true);
    nftsQuery = nftsQuery.orderBy('pixelRankVisible', 'desc');
  }

  nftsQuery = nftsQuery.orderBy('hasBlueCheck', 'desc');
  nftsQuery = nftsQuery.orderBy(query.orderBy, query.orderDirection);

  if (query.cursor) {
    const startDoc = await pixelScoreDb.doc(query.cursor).get();
    nftsQuery = nftsQuery.startAfter(startDoc);
  }

  nftsQuery = nftsQuery.limit(query.limit);
  let cursor = '';

  const results = await nftsQuery.get();
  const data = results.docs.map((item) => {
    const rankInfo = item.data() as TokenInfo;
    cursor = item.ref.path;
    return rankInfo;
  });

  const hasNextPage = data.length === query.limit;

  // remove rank information unless visible, or user is revealer
  removeRankInfo(data);

  return {
    data,
    cursor: cursor,
    hasNextPage
  };
}

async function getNfts(query: NftsQuery, minRank: number, maxRank: number): Promise<TokenInfoArray> {
  const rankRange = [...Array(maxRank - minRank + 1).keys()].map((x) => x + minRank);
  let nftsQuery: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = pixelScoreDb.collection(RANKINGS_COLL);
  nftsQuery = nftsQuery.where('pixelRankBucket', 'in', rankRange);
  if (query.showOnlyVisible && !query.showOnlyUnvisible) {
    nftsQuery = nftsQuery.where('pixelRankVisible', '==', true);
  } else if (!query.showOnlyVisible && query.showOnlyUnvisible) {
    nftsQuery = nftsQuery.where('pixelRankVisible', '!=', true);
    nftsQuery = nftsQuery.orderBy('pixelRankVisible', 'desc');
  }
  nftsQuery = nftsQuery.orderBy('hasBlueCheck', 'desc');
  nftsQuery = nftsQuery.orderBy(query.orderBy, query.orderDirection);

  if (query.cursor) {
    const startDoc = await pixelScoreDb.doc(query.cursor).get();
    nftsQuery = nftsQuery.startAfter(startDoc);
  }

  nftsQuery = nftsQuery.limit(query.limit);
  let cursor = '';

  const results = await nftsQuery.get();
  const data = results.docs.map((item) => {
    const rankInfo = item.data() as TokenInfo;
    cursor = item.ref.path;
    return rankInfo;
  });

  const hasNextPage = data.length === query.limit;

  // remove rank information unless visible, or user is revealer
  removeRankInfo(data);

  return {
    data,
    cursor: cursor,
    hasNextPage
  };
}

const removeRankInfo = (tokens: TokenInfo[]) => {
  for (const token of tokens) {
    if (!token.pixelRankVisible) {
      // TODO: look up in reveal items, the token doesn't have the latest
      delete token.pixelRank;
      delete token.pixelScore;
      delete token.pixelRankBucket;
      delete token.inCollectionPixelRank;
      delete token.inCollectionPixelScore;
      delete token.rarityScore;
      delete token.rarityRank;
      delete token.collectionAddress;
      delete token.collectionName;
      delete token.collectionBannerImage;
      delete token.collectionProfileImage;
      delete token.collectionSlug;
      delete token.tokenId;
      delete token.owner;
      delete token.ownerFetched;
    }
  }
};

// calculate portfolio score if not already done or something changed from last calculcation
const getPortfolioScore = async (userAddress: string, chainId: string): Promise<UserRecord> => {
  console.log('Fetching portfolio score for', userAddress, chainId);
  const userDoc = pixelScoreDb.collection(USERS_COLL).doc(userAddress);
  const userRec = (await userDoc.get()).data() as UserRecord | undefined;
  // fetch user nfts from alchemy to check if user has acquired / lost any nfts
  const userNftsResponse = await getUserNftsFromAlchemy(userAddress, chainId, '');
  const newOwnedCount = userNftsResponse?.totalCount;
  const didOwnedNftsChange = newOwnedCount && newOwnedCount !== userRec?.totalNftsOwned;
  const doesPortfolioScoreInfoExist =
    userRec && userRec.portfolioScore && userRec.portfolioScoreNumNfts && userRec.portfolioScoreUpdatedAt;
  if (doesPortfolioScoreInfoExist && !didOwnedNftsChange && userRec.portfolioScoreUpdatedAt !== -1) {
    return userRec;
  }

  console.log('Re-calculating portfolio score since something changed since last calculation');

  let nfts: Nft[] = [];
  let alchemyHasNextPage = true;
  let pageKey = '';
  let nextPageKey = '';
  let totalNftsOwned = 0;
  while (alchemyHasNextPage) {
    pageKey = nextPageKey;
    const response = await getPageUserNftsFromAlchemy(pageKey, chainId, userAddress, []);
    nfts = [...nfts, ...response.nfts];
    alchemyHasNextPage = response.hasNextPage;
    nextPageKey = response.pageKey;
    // no need to sum here since Alchemy response returns the total number of nfts owned by a user in each pagination result
    totalNftsOwned = response.totalNftsOwned;
  }

  // add ranking info for each nft
  nfts = await addRankInfoToNFTs(nfts);

  let count = 0;
  let score = 0;
  for (const nft of nfts) {
    if (nft.pixelScore || nft.pixelScore === 0) {
      count++;
      score += nft.pixelScore;
    }
  }

  const userRecData = {
    address: userAddress,
    name: userRec?.name ?? '',
    portfolioScore: score,
    portfolioScoreNumNfts: count,
    portfolioScoreUpdatedAt: Date.now(),
    totalNftsOwned
  };

  userDoc.set(userRecData, { merge: true }).catch((err) => {
    console.error('Error saving user rec', err);
  });

  return userRecData;
};
