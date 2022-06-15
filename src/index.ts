import { jsonString, trimLowerCase } from '@infinityxyz/lib/utils';
import { createHmac } from 'crypto';
import dotenv from 'dotenv';
import { Express, Request, Response } from 'express';
import { ExternalNftArray, Nft, TokenInfoArray, NftArray, CollectionInfoArray } from 'types/firestore';
import {
  AlchemyAddressActivityWebHook,
  CollectionInfo,
  RevealOrder,
  TokenInfo,
  UpdateRankVisibility,
  UserRecord
} from './types/main';
import {
  CollectionQueryOptions,
  CollectionSearchQuery,
  NftRankQuery,
  NftsQuery,
  PortfolioScore,
  UserNftsQuery
} from './types/apiQueries';
import {
  ALCHEMY_WEBHOOK_ACTIVITY_CATEGORY_EXTERNAL,
  ALCHEMY_WEBHOOK_ASSET_ETH,
  ALCHEMY_WEBHOOK_ETH_MAINNET,
  DEFAULT_PAGE_LIMIT,
  getProvider,
  PIXELSCORE_PRICE_PER_ITEM,
  PIXELSCORE_WALLET,
  RANKINGS_COLL,
  REVEALS_COLL,
  REVEALS_ITEMS_SUB_COLL,
  REVEAL_ITEMS_LIMIT,
  WEBHOOK_EVENTS_COLL,
  USERS_COLL,
  COLLECTIONS_COLL
} from './utils/constants';
import { pixelScoreDb } from './utils/firestore';
import FirestoreBatchHandler from './utils/firestoreBatchHandler';
import { decodeCursorToObject, encodeCursor, getDocIdHash } from './utils/main';
import { getPageUserNftsFromAlchemy } from './utils/alchemy';
import { getCollectionByAddress, isCollectionSupported } from './utils/infinity';
import { startServer } from './server';
import bodyParser from 'body-parser';
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

app.get('/collections/:chainId/:collectionAddress', async (req: Request, res: Response) => {
  const queryOptions = (req.query.options as unknown as CollectionQueryOptions) ?? defaultCollectionQueryOptions();
  const collectionAddress = trimLowerCase(req.params.collectionAddress);
  const chainId = req.params.chainId;
  const data = await getCollectionByAddress(chainId, collectionAddress, queryOptions);
  res.send(data);
});

app.get('/collections/:chainId/:collectionAddress/nfts-bottom', async (req: Request, res: Response) => {
  const chainId = req.params.chainId;
  const collectionAddress = trimLowerCase(req.params.collectionAddress);
  const query = req.query as unknown as NftsQuery;

  const data = await getCollectionNfts(query, 1, 9, chainId, collectionAddress);
  res.send(data);
});

app.get('/collections/:chainId/:collectionAddress/nfts-top', async (req: Request, res: Response) => {
  const chainId = req.params.chainId;
  const collectionAddress = trimLowerCase(req.params.collectionAddress);
  const query = req.query as unknown as NftsQuery;

  const data = await getCollectionNfts(query, 10, 10, chainId, collectionAddress);
  res.send(data);
});

app.get('/collections/nfts', async (req: Request, res: Response) => {
  const query = req.query as unknown as NftRankQuery;

  const minRank = query.minRank;
  const maxRank = query.maxRank;

  const data = await getCollectionNfts(query, minRank, maxRank);
  res.send(data);
});

// ################################# User authenticated read endpoints #################################

app.get('/u/:user/nfts', async (req: Request, res: Response) => {
  const user = trimLowerCase(req.params.user);
  const query = req.query as unknown as UserNftsQuery;
  const chainId = (req.query.chainId as string) ?? '1';

  const nfts = await getUserNfts(user, chainId, query);

  const externalNfts = await isCollectionSupported(nfts.data);

  const resp: ExternalNftArray = {
    ...nfts,
    data: externalNfts
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

// this calcs the score, look in the UserRecord for the already calced value
app.get('/u/:user/portfolio-score', async (req: Request, res: Response) => {
  const user = trimLowerCase(req.params.user);
  const chainId = (req.query.chainId as string) ?? '1';

  const scoreInfo = await getPortfolioScore(user, chainId);

  const doc = pixelScoreDb.collection(USERS_COLL).doc(user);

  const userData: Partial<UserRecord> = { portfolioScore: scoreInfo.score };
  doc.set(userData, { merge: true });

  res.send(scoreInfo);
});

app.get('/u/:user', async (req: Request, res: Response) => {
  const user = trimLowerCase(req.params.user);
  const chainId = (req.query.chainId as string) ?? '1';

  const doc = pixelScoreDb.collection(USERS_COLL).doc(user);

  let userRec = (await doc.get()).data() as UserRecord | undefined;

  let save = false;
  if (!userRec) {
    userRec = { name: '', address: user, portfolioScore: -1 };
    save = true;
  }

  if (userRec.address === undefined) {
    userRec.address = user;
    save = true;
  }

  if (userRec.portfolioScore === undefined || userRec.portfolioScore === -1) {
    const score = await getPortfolioScore(user, chainId);

    userRec.portfolioScore = score.score / score.count;
    save = true;
  }

  if (save) {
    doc.set(userRec, { merge: true });
  }

  res.send(userRec);
});

app.post('/u/:user', async (req: Request, res: Response) => {
  const user = trimLowerCase(req.params.user);

  const data = req.body as UserRecord;

  await pixelScoreDb.collection(USERS_COLL).doc(user).set(data);

  res.sendStatus(200);
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

app.post('/u/:user/reveals', (req: Request, res: Response) => {
  const user = trimLowerCase(req.params.user);
  console.log('Saving reveals for user', user);
  try {
    const data = req.body as RevealOrder;
    // write top level doc
    const chainId = data.chainId;
    const revealer = trimLowerCase(user);
    const numItems = data.numItems;
    const pricePerItem = PIXELSCORE_PRICE_PER_ITEM;
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
    const items = data.revealItems;
    for (const item of items) {
      const itemDocId = getDocIdHash({
        chainId: item.chainId,
        collectionAddress: item.collectionAddress,
        tokenId: item.tokenId
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
          pixelRankVisible: item.pixelRankVisible,
          pixelRankRevealed: item.pixelRankVisible // not sure if what's syned to the tokeninfo, not sure if correct
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

async function getUserNfts(
  userAddress: string,
  chainId: string,
  query: Pick<UserNftsQuery, 'collectionAddresses' | 'cursor' | 'limit'>
): Promise<NftArray> {
  type Cursor = { pageKey?: string; startAtToken?: string };
  const cursor = decodeCursorToObject<Cursor>(query.cursor);

  const limit = query.limit + 1; // +1 to check if there is a next page
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
    pageKey: continueFromCurrentPage ? pageKey : nextPageKey,
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
    if (provider === null) {
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
    const rankingData = await getRevealData(user, chainId, collectionAddress, tokenId);
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
    if (activity.toAddress.trim().toLowerCase() !== PIXELSCORE_WALLET) {
      console.error('Invalid pixelscore wallet');
      return false;
    }
    if (activity.value < PIXELSCORE_PRICE_PER_ITEM) {
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

function defaultCollectionQueryOptions(): CollectionQueryOptions {
  return {
    limitToCompleteCollections: true
  };
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

  nftsQuery = nftsQuery.orderBy('hasBlueCheck', 'desc');

  if (collectionAddress) {
    nftsQuery = nftsQuery.where('collectionAddress', '==', collectionAddress);
  }

  if (chainId) {
    nftsQuery = nftsQuery.where('chainId', '==', chainId);
  }

  nftsQuery = nftsQuery.where('pixelRankBucket', 'in', rankRange);
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
    }
  }
};

const getPortfolioScore = async (userAddress: string, chainId: string): Promise<PortfolioScore> => {
  const limit = 10000 + 1; // +1 to check if there is a next page
  let nfts: Nft[] = [];
  let alchemyHasNextPage = true;
  let pageKey = '';
  let nextPageKey = '';
  while (nfts.length < limit && alchemyHasNextPage) {
    pageKey = nextPageKey;
    const startAtToken = undefined;

    const response = await getPageUserNftsFromAlchemy(pageKey, chainId, userAddress, [], startAtToken);

    nfts = [...nfts, ...response.nfts];
    alchemyHasNextPage = response.hasNextPage;
    nextPageKey = response.pageKey;
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

  return { score, count };
};
