import { Erc721Metadata, RefreshTokenErrorJson, RefreshTokenFlow, TokenStandard } from '@infinityxyz/lib/types/core';
import { CollectionInfo, TokenInfo } from './main';
export interface NftArray {
  data: Nft[];
  cursor: string;
  hasNextPage: boolean;
}

export interface ExternalNftArray {
  data: ExternalNft[];
  cursor: string;
  hasNextPage: boolean;
}

export interface ExternalNft extends Nft {
  isSupported: boolean;
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
  state?: NftStateDto;
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

interface NftStateMetadataDto {
  step: RefreshTokenFlow;
  error?: RefreshTokenErrorJson;
}

export interface NftStateDto {
  metadata: NftStateMetadataDto;
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
