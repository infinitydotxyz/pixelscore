import { Nft } from 'types/firestore';
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
