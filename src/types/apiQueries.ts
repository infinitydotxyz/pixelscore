import { ChainId, OrderDirection } from '@infinityxyz/lib/types/core';

export interface CollectionSearchQuery {
  query?: string;
  limit?: number;
  cursor?: string;
}

export interface CollectionQueryOptions {
  /**
   * Only show collections that have been fully indexed
   *
   * Defaults to `true`.
   */
  limitToCompleteCollections: boolean;
}

export interface NftQuery {
  address: string;
  chainId: ChainId;
  tokenId: string;
}

export enum NftsOrderBy {
  TokenId = 'tokenId'
}

export interface NftsQuery {
  orderBy: NftsOrderBy;
  orderDirection: OrderDirection;
  limit: number;
  cursor?: string;
  traitTypes?: string[];
  traitValues?: string[];
}

export interface UserNftsQuery {
  collectionAddresses?: string[];
  limit: number;
  cursor?: string;
}

export interface NftRankQuery {
  orderBy: NftsOrderBy;
  orderDirection: OrderDirection;
  limit: number;
  cursor?: string;

  minRank: number;
  maxRank: number;
}

export interface PortfolioScore {
  score: number;
  count: number;
}
