import { ChainId, Collection, CreationFlow } from '@infinityxyz/lib/types/core';
import {
  firestoreConstants,
  getCollectionDocId,
  getEndCode,
  getSearchFriendlyString,
  jsonString,
  trimLowerCase
} from '@infinityxyz/lib/utils';
import cors from 'cors';
import { createHmac } from 'crypto';
import dotenv from 'dotenv';
import express, { Express, Request, Response } from 'express';
import { ExternalNftArray, Nft, NftArray } from 'types/firestore';
import { AlchemyAddressActivityWebHook, RevealOrder, TokenInfo, UpdateRankVisibility } from './types/main';
import {
  CollectionQueryOptions,
  CollectionSearchQuery,
  NftQuery,
  NftsOrderBy,
  NftsQuery,
  UserNftsQuery
} from './types/apiQueries';
import {
  ALCHEMY_WEBHOOK_ACTIVITY_CATEGORY_EXTERNAL,
  ALCHEMY_WEBHOOK_ASSET_ETH,
  ALCHEMY_WEBHOOK_ETH_MAINNET,
  DEFAULT_PAGE_LIMIT,
  getProvider,
  NFTS_SUB_COLL,
  PIXELSCORE_PRICE_PER_ITEM,
  PIXELSCORE_WALLET,
  REVEALS_COLL,
  REVEALS_ITEMS_SUB_COLL,
  REVEAL_ITEMS_LIMIT,
  WEBHOOK_EVENTS_COLL
} from './utils/constants';
import { infinityDb, pixelScoreDb } from './utils/firestore';
import FirestoreBatchHandler from './utils/firestoreBatchHandler';
import { authenticateUser, decodeCursor, decodeCursorToObject, encodeCursor, getDocIdHash } from './utils/main';
import { BigNumber } from 'ethers';
import { getUserNftsFromAlchemy, transformAlchemyNftToPixelScoreNft } from './utils/alchemy';
import {
  getCollectionByAddress,
  getCollectionsByAddress,
  getNftsFromInfinityFirestore,
  isCollectionSupported
} from './utils/infinity';

dotenv.config();

const app: Express = express();
app.use(express.json());

// todo: change this
export const localHost = /http:\/\/localhost:\d+/;
const whitelist = [localHost];
const corsOptions: cors.CorsOptions = {
  origin: (origin: string | undefined, callback: Function) => {
    const result = whitelist.filter((regEx, index) => {
      return origin?.match(regEx);
    });

    let originIsWhitelisted = result.length > 0;

    callback(originIsWhitelisted ? null : Error('Bad Request'), originIsWhitelisted);
  }
};
app.use(cors(corsOptions));

const port = process.env.PORT ?? 5000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

const pixelScoreDbBatchHandler = new FirestoreBatchHandler(pixelScoreDb);

app.use('/u/*', authenticateUser);

// ========================================= GET REQUESTS =========================================

// ################################# Public endpoints #################################

app.get('/collections/search', async (req: Request, res: Response) => {
  // convert query strings to ints
  const queryParams = Object.assign({}, req.query) as any; // ParamsDictionary
  queryParams.limit = parseInt(queryParams.limit);

  const search = queryParams as CollectionSearchQuery;

  const limit = search.limit ?? DEFAULT_PAGE_LIMIT;
  let firestoreQuery: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = infinityDb.collection(
    firestoreConstants.COLLECTIONS_COLL
  );

  if (search.query) {
    const startsWith = getSearchFriendlyString(search.query);
    const endCode = getEndCode(startsWith);

    if (startsWith && endCode) {
      firestoreQuery = firestoreQuery.where('slug', '>=', startsWith).where('slug', '<', endCode);
    }
  }

  firestoreQuery = firestoreQuery.orderBy('slug');

  const cursor = decodeCursor(search.cursor);
  if (cursor) {
    firestoreQuery = firestoreQuery.startAfter(cursor);
  }

  const snapshot = await firestoreQuery
    .select(
      'address',
      'chainId',
      'slug',
      'metadata.name',
      'metadata.profileImage',
      'metadata.description',
      'metadata.bannerImage',
      'hasBlueCheck'
    )
    .limit(limit + 1) // +1 to check if there are more results
    .get();

  const collections = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      address: data.address as string,
      chainId: data.chainId as string,
      slug: data.slug as string,
      name: data.metadata?.name as string,
      hasBlueCheck: data.hasBlueCheck as boolean,
      profileImage: data.metadata?.profileImage as string,
      bannerImage: data.metadata?.bannerImage as string,
      description: data.metadata?.description as string
    };
  });

  const hasNextPage = collections.length > limit;
  if (hasNextPage) {
    collections.pop(); // Remove item used to check if there are more results
  }
  const updatedCursor = encodeCursor(collections?.[collections?.length - 1]?.slug ?? ''); // Must be after we pop the item used for pagination

  res.send({
    data: collections,
    cursor: updatedCursor,
    hasNextPage
  });
});

app.get('/collections/:chainId/:collectionAddress', async (req: Request, res: Response) => {
  const queryOptions = (req.query.options as unknown as CollectionQueryOptions) ?? defaultCollectionQueryOptions();
  const collectionAddress = trimLowerCase(req.params.collectionAddress);
  const chainId = req.params.chainId;
  const data = await getCollectionByAddress(chainId, collectionAddress, queryOptions);
  res.send(data);
});

app.get('/collections/:chainId/:collectionAddress/nfts', async (req: Request, res: Response) => {
  const chainId = req.params.chainId;
  const collectionAddress = trimLowerCase(req.params.collectionAddress);
  const query = req.query as unknown as NftsQuery;
  const data = await getCollectionNfts(chainId, collectionAddress, query);
  res.send(data);
});

app.get('/collections/:chainId/:collectionAddress/nfts/:tokenId', async (req: Request, res: Response) => {
  const nftQuery = req.query as unknown as NftQuery;
  const chainId = nftQuery.chainId as string;
  const collectionAddress = trimLowerCase(nftQuery.address);
  const tokenId = nftQuery.tokenId;
  const collection = await getCollectionByAddress(chainId, collectionAddress, defaultCollectionQueryOptions());

  if (collection) {
    const collectionDocId = getCollectionDocId({
      collectionAddress: collection.address,
      chainId: collection.chainId
    });

    if (collection?.state?.create?.step !== CreationFlow.Complete || !collectionDocId) {
      return undefined;
    }

    const nfts = await getNftsFromInfinityFirestore([
      { address: collection.address, chainId: collection.chainId, tokenId: nftQuery.tokenId }
    ]);

    const nft = nfts?.[0];
    res.send(nft);
  }
  res.sendStatus(404);
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
  const startAfterTimestamp = parseInt(String(req.query.startAfterTimestamp)) ?? Date.now();
  try {
    const revealSnap = await pixelScoreDb
      .collection(REVEALS_COLL)
      .where('revealer', '==', user)
      .where('chainId', '==', '1')
      .limit(DEFAULT_PAGE_LIMIT)
      .orderBy('timestamp', 'desc')
      .startAfter(startAfterTimestamp)
      .get();

    const resp: RevealOrder[] = [];
    for (const revealDoc of revealSnap.docs) {
      const revealDocData = revealDoc.data() as RevealOrder;
      const revealItemsSnap = await revealDoc.ref.collection(REVEALS_ITEMS_SUB_COLL).get();
      for (const revealItemDoc of revealItemsSnap.docs) {
        const revealItemDocData = revealItemDoc.data() as TokenInfo;
        revealDocData.revealItems.push(revealItemDocData);
      }
      resp.push(revealDocData);
    }
    res.send(resp);
  } catch (err) {
    console.error('Error while getting reveals for user', user, err);
    res.sendStatus(500);
  }
});

// ========================================= POST REQUESTS =========================================

// ########################### Endpoint that receives webhook events from Alchemy ###########################

app.post('/webhooks/alchemy/padw', (req: Request, res: Response) => {
  console.log('padw webhook body', JSON.stringify(req.body));
  try {
    if (isValidSignature(req) && isValidRequest(req)) {
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
          console.error(`Error processing reveal with txnHash: ${trimLowerCase(data.event.activity[0].hash)}`);
          throw err;
        });
    } else {
      throw new Error('Invalid signature or request');
    }
  } catch (err) {
    console.error('Error while processing padw webhook', err);
    res.sendStatus(500);
  }
});

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
      const revealOrderData = revealOrderSnapshot.docs[0].data as unknown as RevealOrder;
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
          updatePendingTxn(user, txnHash, chainId, revealOrderDocRef);
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
  const getPage = async (
    pageKey: string,
    startAtToken?: string
  ): Promise<{ pageKey: string; nfts: Nft[]; hasNextPage: boolean }> => {
    const response = await getUserNftsFromAlchemy(userAddress, chainId, pageKey, query.collectionAddresses);
    const nextPageKey = response?.pageKey ?? '';
    let nfts = response?.ownedNfts ?? [];

    if (startAtToken) {
      const indexToStartAt = nfts.findIndex(
        (item: any) => BigNumber.from(item.id.tokenId).toString() === cursor.startAtToken
      );
      nfts = nfts.slice(indexToStartAt);
    }

    const nftsToTransform = nfts.map((item: any) => ({ alchemyNft: item, chainId }));
    const results = await transformAlchemyNftToPixelScoreNft(nftsToTransform);
    const validNfts = results.filter((item: any) => !!item) as Nft[];

    return { pageKey: nextPageKey, nfts: validNfts, hasNextPage: !!nextPageKey };
  };

  const limit = query.limit + 1; // +1 to check if there is a next page
  let nfts: Nft[] = [];
  let alchemyHasNextPage = true;
  let pageKey = '';
  let nextPageKey = cursor?.pageKey ?? '';
  let pageNumber = 0;
  while (nfts.length < limit && alchemyHasNextPage) {
    pageKey = nextPageKey;
    const startAtToken = pageNumber === 0 && cursor.startAtToken ? cursor.startAtToken : undefined;
    const response = await getPage(pageKey, startAtToken);
    nfts = [...nfts, ...response.nfts];
    alchemyHasNextPage = response.hasNextPage;
    nextPageKey = response.pageKey;
    pageNumber += 1;
  }

  const continueFromCurrentPage = nfts.length > query.limit;
  const hasNextPage = continueFromCurrentPage || alchemyHasNextPage;
  const nftsToReturn = nfts.slice(0, query.limit);
  const nftToStartAt = nfts?.[query.limit]?.tokenId;

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

async function getCollectionNfts(chainId: string, collectionAddress: string, query: NftsQuery): Promise<NftArray> {
  type Cursor = Record<NftsOrderBy, string | number>;
  const collectionDocId = getCollectionDocId({ chainId, collectionAddress });
  const nftsCollection = infinityDb
    .collection(firestoreConstants.COLLECTIONS_COLL)
    .doc(collectionDocId)
    .collection(firestoreConstants.COLLECTION_NFTS_COLL);
  const decodedCursor = decodeCursorToObject<Cursor>(query.cursor);

  let nftsQuery: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = nftsCollection;

  if (query.traitTypes) {
    const traitTypes = query.traitTypes ?? [];
    const traitTypesValues = query?.traitValues?.map((item) => item.split('|')) ?? [];

    const traits: object[] = [];
    for (let index = 0; index < traitTypes.length; index++) {
      const traitType = traitTypes[index];
      const traitValues = traitTypesValues[index];
      for (const traitValue of traitValues) {
        if (traitValue) {
          const traitTypeObj = traitType ? { trait_type: traitType } : {};
          traits.push({
            value: traitValue,
            ...traitTypeObj
          });
        }
      }
    }
    if (traits.length > 0) {
      nftsQuery = nftsQuery.where('metadata.attributes', 'array-contains-any', traits);
    }
  }

  let orderBy: string = query.orderBy;
  nftsQuery = nftsQuery.orderBy(orderBy, query.orderDirection);

  if (decodedCursor?.[query.orderBy]) {
    nftsQuery = nftsQuery.startAfter(decodedCursor[query.orderBy]);
  }

  nftsQuery = nftsQuery.limit(query.limit + 1); // +1 to check if there are more events

  const results = await nftsQuery.get();
  const data = results.docs.map((item) => item.data() as Nft);

  const hasNextPage = data.length > query.limit;
  if (hasNextPage) {
    data.pop();
  }

  const cursor: Cursor = {} as any;
  const lastItem = data[data.length - 1];
  for (const key of Object.values(NftsOrderBy) as NftsOrderBy[]) {
    switch (key) {
      case NftsOrderBy.TokenId:
        if (lastItem?.[key]) {
          cursor[key] = lastItem[key];
        }
        break;
    }
  }
  const encodedCursor = encodeCursor(cursor);

  return {
    data,
    cursor: encodedCursor,
    hasNextPage
  };
}

async function updatePendingTxn(
  user: string,
  chainId: string,
  txnHash: string,
  revealOrderDocRef: FirebaseFirestore.DocumentReference
) {
  try {
    const provider = getProvider(chainId);
    if (provider == null) {
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
  const rankingInfo = await pixelScoreDb
    .collectionGroup(NFTS_SUB_COLL)
    .where('chainId', '==', chainId)
    .where('collectionAddress', '==', collectionAddress)
    .where('tokenId', '==', tokenId)
    .get();

  if (rankingInfo.size === 1) {
    const rankingInfoData = rankingInfo.docs[0].data() as unknown as TokenInfo;
    const rankData = {
      inCollectionPixelScore: rankingInfoData?.inCollectionPixelScore,
      inCollectionPixelRank: rankingInfoData?.inCollectionPixelRank,
      pixelScore: rankingInfoData?.pixelScore,
      pixelRank: rankingInfoData?.pixelRank,
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

function isValidSignature(req: Request): boolean {
  try {
    const signingKey = process.env.ALCHMEY_PADW_SIGNING_KEY ?? '';
    const signature = req.headers['x-alchemy-signature']; // Lowercase for NodeJS
    const body = req.body;
    const hmac = createHmac('sha256', signingKey); // Create a HMAC SHA256 hash using the signing key
    hmac.update(JSON.stringify(body), 'utf8'); // Update the signing key hash with the request body using utf8
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
