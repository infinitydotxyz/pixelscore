import { firestoreConstants, getEndCode, getSearchFriendlyString } from '@infinityxyz/lib/utils';
import { Nft } from 'types/firestore';
import { TokenInfo } from 'types/main';
import { RANKINGS_COLL } from './constants';
import { pixelScoreDb } from './firestore';
import { getDocIdHash } from './main';

export async function getNftsFromPixelStoreFirestore(nfts: { address: string; chainId: string; tokenId: string }[]) {
  const refs = nfts.map((item) => {
    const docId = getDocIdHash({
      chainId: item.chainId,
      collectionAddress: item.address ?? '',
      tokenId: item.tokenId
    });

    return pixelScoreDb.collection(RANKINGS_COLL).doc(docId);
  });

  if (refs.length === 0) {
    return [];
  }

  const snapshots = await pixelScoreDb.getAll(...refs);

  const retrievedNfts = snapshots.map((snapshot) => {
    const nft = snapshot.data() as Nft | undefined;

    return nft;
  });

  return retrievedNfts;
}

// with firebase we were not able to first sort on bluecheck, then do a text search
// so we first search bluechecks, and if not enough results, search non bluechecks
export async function searchCollections(
  query: string,
  codedCursor: string,
  hasBlueCheck: boolean,
  limit: number
): Promise<{
  data: object[];
  cursor: string;
  hasNextPage: boolean;
}> {
  let cursor = '';

  // cursor has a flag to mark if it's for bluechecks or not
  if (codedCursor) {
    const [flag, c] = codedCursor.split('::');
    if ((flag === 'blue') !== hasBlueCheck) {
      // bail out, this cursor isn't for this search
      return {
        data: [],
        cursor: '',
        hasNextPage: false
      };
    }

    cursor = c;
  }

  let firestoreQuery: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = pixelScoreDb.collection(
    firestoreConstants.COLLECTIONS_COLL
  );

  firestoreQuery = firestoreQuery.where('hasBlueCheck', '==', hasBlueCheck);

  if (query) {
    const startsWith = getSearchFriendlyString(query);
    const endCode = getEndCode(startsWith);

    if (startsWith && endCode) {
      firestoreQuery = firestoreQuery.where('slug', '>=', startsWith).where('slug', '<', endCode);
    }
  }
  firestoreQuery = firestoreQuery.orderBy('slug');

  if (cursor) {
    const startDoc = await pixelScoreDb.doc(cursor).get();
    firestoreQuery = firestoreQuery.startAfter(startDoc);
  }

  const snapshot = await firestoreQuery.limit(limit).get();

  let newCursor = '';
  const collections = snapshot.docs.map((doc) => {
    const data = doc.data();

    newCursor = doc.ref.path;

    return data;
  });

  const hasNextPage = collections.length === limit;

  return {
    data: collections,
    cursor: `${hasBlueCheck ? 'blue' : 'none'}::${newCursor}`,
    hasNextPage
  };
}

export const getTokenInfo = async (imageUrl: string): Promise<TokenInfo[] | undefined> => {
  const tokenInfoSnapshot = await pixelScoreDb.collection(RANKINGS_COLL).where('imageUrl', '==', imageUrl).get();
  const results: TokenInfo[] = [];
  tokenInfoSnapshot.docs.map((doc) => {
    results.push(doc.data() as TokenInfo);
  });
  return results;
};

export const updateTokenInfo = async (
  chainId: string,
  collectionAddress: string,
  tokenId: string,
  tokenInfo: Partial<TokenInfo>
) => {
  const docId = getDocIdHash({
    chainId: chainId,
    collectionAddress: collectionAddress ?? '',
    tokenId: tokenId
  });

  pixelScoreDb.doc(`${RANKINGS_COLL}/${docId}`).set(tokenInfo, { merge: true });
};
