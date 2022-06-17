import { Erc721Metadata, TokenStandard } from '@infinityxyz/lib/types/core';
import { CollectionInfo, TokenInfo } from './main';
export interface UserNftsArray {
  data: Nft[];
  cursor: string;
  hasNextPage: boolean;
}

export interface Nft {
  collectionAddress?: string;
  collectionSlug?: string;
  collectionName?: string;
  collectionBannerImage?: string;
  collectionProfileImage?: string;
  hasBlueCheck?: boolean;
  chainId: string;
  slug: string;
  tokenId: string;
  minter: string;
  mintedAt: number;
  mintTxHash: string;
  mintPrice: number;
  destroyedAt?: number;
  metadata: Erc721Metadata;
  numTraitTypes: number;
  updatedAt: number;
  tokenUri: string;
  image: NftImage;
  tokenStandard: TokenStandard;
  owner?: string;

  rarityScore?: number;
  rarityRank?: number;
  inCollectionPixelScore?: number;
  inCollectionPixelRank?: number;
  pixelScore?: number;
  pixelRank?: number;
  pixelRankBucket?: number;
  pixelRankRevealed?: boolean;
  pixelRankVisible?: boolean;
  pixelRankRevealer?: string;
  pixelRankRevealedAt?: number;
}

export interface NftImage {
  url: string;
  originalUrl: string;
  updatedAt: number;
}

export interface TokenInfoArray {
  data: TokenInfo[];
  cursor: string;
  hasNextPage: boolean;
}

export interface CollectionInfoArray {
  data: CollectionInfo[];
  cursor: string;
  hasNextPage: boolean;
}
