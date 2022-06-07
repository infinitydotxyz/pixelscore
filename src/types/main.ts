export interface CollectionInfo {
  address: string;
  chainId: string;
  tokenStandard: string;
  slug: string;
  name: string;
  symbol: string;
  description: string;
  profileImage: string;
  bannerImage: string;
  cardDisplaytype?: string;
  twitter?: string;
  discord?: string;
  external?: string;
}

export interface TokenInfo {
  chainId: string;
  collectionAddress: string;
  collectionName?: string;
  collectionBannerImage?: string;
  collectionProfileImage?: string;
  collectionSlug?: string;
  tokenId: string;
  imageUrl: string;
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

export interface UpdateRankVisibility {
  chainId: string;
  collectionAddress: string;
  tokenId: string;
  pixelRankVisible: boolean;
}

export interface RevealOrder {
  chainId: string;
  revealer: string;
  numItems: number;
  pricePerItem: number;
  totalPrice: number;
  txnHash: string;
  txnStatus: 'pending' | 'success' | 'error';
  timestamp: number;
  revealItems: TokenInfo[];
}

export interface AlchemyAddressActivityWebHook {
  webhookId: string;
  id: string;
  createdAt: string;
  type: 'ADDRESS_ACTIVITY';
  event: {
    network: string;
    activity: AlchemyAddressActivity[];
  };
}

export interface AlchemyAddressActivity {
  fromAddress: string;
  toAddress: string;
  blockNum: string;
  hash: string;
  value: number;
  asset: string;
  category: 'external' | 'internal' | 'token';
}

export interface UserRecord {
  address: string;
  name: string;
  portfolioScore: number;
}
