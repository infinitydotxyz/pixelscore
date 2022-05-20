import { ChainId, TokenStandard } from '@infinityxyz/lib/types/core';
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
  const url = getBaseUrl(chainId, '/getNFTs');
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

function getBaseUrl(chainId: string, path: string) {
  switch (chainId) {
    case '1':
      return new URL(normalize(process.env.alchemyJsonRpcEthMainnet ?? ''));
    case '137':
      return new URL(normalize(process.env.alchemyJsonRpcPolygonMainnet ?? ''));

    default:
      throw new Error(`Unsupported chainId: ${chainId}`);
  }
}
