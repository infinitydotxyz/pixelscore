import { Collection, CreationFlow } from '@infinityxyz/lib/types/core';
import { firestoreConstants, getCollectionDocId } from '@infinityxyz/lib/utils';
import { CollectionQueryOptions } from 'types/apiQueries';
import { ExternalNft, Nft } from 'types/firestore';
import { infinityDb } from './firestore';

export async function getNftsFromInfinityFirestore(nfts: { address: string; chainId: string; tokenId: string }[]) {
  const refs = nfts.map((item) => {
    const collectionDocId = getCollectionDocId({
      collectionAddress: item.address,
      chainId: item.chainId
    });
    return infinityDb
      .collection(firestoreConstants.COLLECTIONS_COLL)
      .doc(collectionDocId)
      .collection(firestoreConstants.COLLECTION_NFTS_COLL)
      .doc(item.tokenId);
  });

  if (refs.length === 0) {
    return [];
  }
  const snapshots = await infinityDb.getAll(...refs);

  const retrievedNfts = snapshots.map((snapshot, index) => {
    const nft = snapshot.data() as Nft | undefined;

    if (nft) {
      nft.collectionAddress = nfts[index].address;
    }

    return nft;
  });

  return retrievedNfts;
}

export async function getCollectionByAddress(
  chainId: string,
  collectionAddress: string,
  queryOptions: CollectionQueryOptions
) {
  const docId = getCollectionDocId({ collectionAddress, chainId });

  const collectionSnapshot = await infinityDb.collection(firestoreConstants.COLLECTIONS_COLL).doc(docId).get();

  const result = collectionSnapshot.data() as Collection | undefined;
  if (queryOptions.limitToCompleteCollections && result?.state?.create?.step !== CreationFlow.Complete) {
    return undefined;
  }
  return result;
}

export async function getCollectionsByAddress(collections: { address: string; chainId: string }[]) {
  const docIds = [
    ...new Set(
      collections.map((collection) => {
        try {
          return getCollectionDocId({ collectionAddress: collection.address, chainId: collection.chainId });
        } catch (err) {
          return null;
        }
      })
    )
  ].filter((item) => item !== null) as string[];

  const collectionRefs = docIds.map((docId) => infinityDb.collection(firestoreConstants.COLLECTIONS_COLL).doc(docId));
  const collectionMap: { [id: string]: Partial<Collection> } = {};

  const getCollection = (coll: { address: string; chainId: string }) => {
    try {
      const collection =
        collectionMap[getCollectionDocId({ collectionAddress: coll.address, chainId: coll.chainId })] ?? {};
      return collection;
    } catch (err) {
      return {};
    }
  };

  if (collectionRefs.length > 0) {
    const collectionsSnap = await infinityDb.getAll(...collectionRefs);

    collectionsSnap.forEach((item, index) => {
      const docId = docIds[index];
      collectionMap[docId] = (item.data() ?? {}) as Partial<Collection>;
    });
  }

  return { getCollection };
}

export async function isCollectionSupported(nfts: Nft[]) {
  const { getCollection } = await getCollectionsByAddress(
    nfts.map((nft) => ({ address: nft.collectionAddress ?? '', chainId: nft.chainId }))
  );

  const externalNfts: ExternalNft[] = nfts.map((nft) => {
    const collection = getCollection({ address: nft.collectionAddress ?? '', chainId: nft.chainId });
    const isSupported = collection?.state?.create?.step === CreationFlow.Complete;
    const externalNft: ExternalNft = {
      ...nft,
      isSupported
    };
    return externalNft;
  });

  return externalNfts;
}
