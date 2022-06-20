import dotenv from 'dotenv';
dotenv.config();
import { ethers } from 'ethers';

export const AUTH_HEADERS = {
  signature: 'x-auth-signature',
  message: 'x-auth-message'
};

export const PIXELRANK_BUCKET_PERCENT_MAP = {
  10: 'Top 1%',
  9: 'Top 3%',
  8: 'Top 5%',
  7: 'Top 7%',
  6: 'Top 10%',
  5: 'Top 15%',
  4: 'Top 25%',
  3: 'Top 40%',
  2: 'Top 65%',
  1: 'Top 100%'
};

export const PIXELRANK_WALLET = '0xb01ab20314e743b62836ca7060fc56ab69157bc1';
export const MAX_PIXELRANKBUCKET_PUBLICLY_VISIBLE = 7;
export const PIXELRANK_PRICE_PER_ITEM = 0.1;
export const ALCHEMY_WEBHOOK_ASSET_ETH = 'ETH';
export const ALCHEMY_WEBHOOK_ACTIVITY_CATEGORY_EXTERNAL = 'external';
export const ALCHEMY_WEBHOOK_ETH_MAINNET = 'ETH_MAINNET';
export const REVEAL_ITEMS_LIMIT = 500;
export const DEFAULT_PAGE_LIMIT = 50;

// infinity firestore constants
export const COLLECTIONS_COLL = 'collections';

// pixelscore firestore constants
export const WEBHOOK_EVENTS_COLL = 'webhookEvents';
export const RANKINGS_COLL = 'rankings';
export const REVEALS_COLL = 'reveals';
export const USERS_COLL = 'users';
export const NFTS_SUB_COLL = 'nfts';
export const REVEALS_ITEMS_SUB_COLL = 'revealItems';

const ethProvider = new ethers.providers.JsonRpcProvider(process.env.alchemyJsonRpcEthMainnet);
const polygonProvider = new ethers.providers.JsonRpcProvider(process.env.alchemyJsonRpcPolygonMainnet);

export function getProvider(chainId: string) {
  if (chainId === '1') {
    return ethProvider;
  } else if (chainId === '137') {
    return polygonProvider;
  }
  return undefined;
}

const getInfuraIPFSAuthKeys = (): string[] => {
  const apiKeys = [];

  let i = 0;
  for (;;) {
    try {
      const projectId = getEnvironmentVariable(`INFURA_IPFS_PROJECT_ID${i}`);
      const projectSecret = getEnvironmentVariable(`INFURA_IPFS_PROJECT_SECRET${i}`);
      const apiKey = Buffer.from(`${projectId}:${projectSecret}`).toString('base64');
      const header = `Basic ${apiKey}`;
      apiKeys.push(header);
      i += 1;
    } catch (err) {
      break;
    }
  }
  return apiKeys;
};

export const METADATA_CONCURRENCY = 50;

export const INFURA_API_KEYS = getInfuraIPFSAuthKeys();

export const OPENSEA_API_KEYS = (() => {
  const apiKeys = getMultipleEnvVariables('OPENSEA_API_KEY');
  return apiKeys;
})();

export const MNEMONIC_API_KEYS = (() => {
  const apiKeys = getMultipleEnvVariables('MNEMONIC_API_KEY');
  return apiKeys;
})();

function getMultipleEnvVariables(prefix: string, minLength = 1): string[] {
  const variables = [];
  let i = 0;

  for (;;) {
    try {
      const apiKey = getEnvironmentVariable(`${prefix}${i}`);
      variables.push(apiKey);
      i += 1;
    } catch (err) {
      break;
    }
  }

  if (variables.length < minLength) {
    throw new Error(
      `Env Variable: ${prefix} failed to get min number of keys. Found: ${variables.length} Expected: at least ${minLength}`
    );
  }

  return variables;
}

function getEnvironmentVariable(name: string, required = true): string {
  const variable = process.env[name] ?? '';
  if (required && !variable) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return variable;
}
