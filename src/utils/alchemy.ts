import { TokenStandard } from '@infinityxyz/lib/types/core';
import axios, { AxiosInstance } from 'axios';
import { BigNumber } from 'ethers';
import { normalize } from 'path';
import { AlchemyNft, AlchemyUserNftsResponse } from 'types/alchemy';
import { Nft } from 'types/firestore';
import { getNftsFromInfinityFirestore } from './infinity';

const client: AxiosInstance = axios.create();

export async function getUserNftsFromAlchemy(
  owner: string,
  chainId: string,
  cursor: string,
  contractAddresses?: string[]
) {
  const url = getAlchemyUrl(chainId, '/getNFTs');
  try {
    const response = await client.get(url.toString(), {
      params: {
        owner: owner,
        withMetadata: 'true',
        ...(cursor ? { pageKey: cursor } : {}),
        ...(contractAddresses && contractAddresses?.length > 0 ? { contractAddresses } : {})
      }
    });
    const data = response.data as AlchemyUserNftsResponse;

    if (!data) {
      throw new Error('No data returned from alchemy');
    }

    return data;
  } catch (err) {
    console.error('failed to get user nfts from alchemy', err);
    return null;
  }
}

export const getPageUserNftsFromAlchemy = async (
  pageKey: string,
  chainId: string,
  userAddress: string,
  collectionAddresses?: string[],
  startAtToken?: string
): Promise<{ pageKey: string; nfts: Nft[]; hasNextPage: boolean }> => {
  const response = await getUserNftsFromAlchemy(userAddress, chainId, pageKey, collectionAddresses);
  const nextPageKey = response?.pageKey ?? '';
  let nfts = response?.ownedNfts ?? [];

  if (startAtToken) {
    const indexToStartAt = nfts.findIndex((item: any) => BigNumber.from(item.id.tokenId).toString() === startAtToken);
    nfts = nfts.slice(indexToStartAt);
  }

  const nftsToTransform = nfts.map((item: any) => ({ alchemyNft: item, chainId }));
  const results = await transformAlchemyNftToPixelScoreNft(nftsToTransform);
  const validNfts = results.filter((item: any) => !!item) as Nft[];

  return { pageKey: nextPageKey, nfts: validNfts, hasNextPage: !!nextPageKey };
};

export async function transformAlchemyNftToPixelScoreNft(
  alchemyNfts: { alchemyNft: AlchemyNft; chainId: string }[]
): Promise<Array<Nft | null>> {
  const nftRefProps = alchemyNfts.map((item) => {
    return {
      address: item.alchemyNft.contract.address,
      chainId: item.chainId,
      tokenId: BigNumber.from(item.alchemyNft.id.tokenId).toString()
    };
  });
  const nfts = await getNftsFromInfinityFirestore(nftRefProps);

  return nfts.map((nftDto, index) => {
    const { alchemyNft, chainId } = alchemyNfts[index];
    const tokenId = BigNumber.from(alchemyNft.id.tokenId).toString();
    let metadata = nftDto?.metadata;
    if (!('metadata' in alchemyNft)) {
      return nftDto || null;
    }
    if ('metadata' in alchemyNft && !metadata) {
      metadata = alchemyNft.metadata as any;
    }
    if (!metadata) {
      return null;
    }

    return {
      ...nftDto,
      hasBlueCheck: nftDto?.hasBlueCheck ?? false,
      collectionAddress: alchemyNft.contract.address,
      chainId: chainId,
      slug: nftDto?.slug ?? '',
      tokenId: tokenId,
      minter: nftDto?.minter ?? '',
      mintedAt: nftDto?.mintedAt ?? NaN,
      mintTxHash: nftDto?.mintTxHash ?? '',
      mintPrice: nftDto?.mintPrice ?? NaN,
      metadata,
      numTraitTypes: nftDto?.numTraitTypes ?? metadata?.attributes?.length ?? 0,
      updatedAt: nftDto?.updatedAt ?? NaN,
      tokenUri: nftDto?.tokenUri ?? alchemyNft.tokenUri?.raw ?? '',
      rarityRank: nftDto?.rarityRank ?? NaN,
      rarityScore: nftDto?.rarityScore ?? NaN,
      image: {
        url: (nftDto?.image?.url || alchemyNft?.media?.[0]?.gateway || alchemyNft?.metadata?.image) ?? '',
        originalUrl: (nftDto?.image?.originalUrl || alchemyNft?.media?.[0]?.raw || alchemyNft?.metadata?.image) ?? '',
        updatedAt: nftDto?.image?.updatedAt ?? NaN
      },
      state: nftDto?.state ?? undefined,
      tokenStandard: alchemyNft.id.tokenMetadata.tokenType as TokenStandard
    };
  });
}

function getAlchemyUrl(chainId: string, path: string) {
  switch (chainId) {
    case '1':
      return new URL(normalize(`${process.env.alchemyJsonRpcEthMainnet}/${path}`));
    case '137':
      return new URL(normalize(`${process.env.alchemyJsonRpcPolygonMainnet}/${path}`));

    default:
      throw new Error(`Unsupported chainId: ${chainId}`);
  }
}
