import 'dotenv/config';

export const PIXELSCORE_WALLET = '0xb01ab20314e743b62836ca7060fc56ab69157bc1';
export const PIXELSCORE_PRICE = 0.1;
export const ALCHEMY_WEBHOOK_ASSET_ETH = 'ETH';
export const ALCHEMY_WEBHOOK_ACTIVITY_CATEGORY_EXTERNAL = 'external';
export const ALCHEMY_WEBHOOK_ETH_MAINNET = 'ETH_MAINNET';

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
