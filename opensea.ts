import { randomItem, sleep } from './utils';
import { OPENSEA_API_KEYS } from './constants';
import got, { Got, Response } from 'got/dist/source';
import { gotErrorHandler } from './got';

/**
 * we try not to use OpenSea more than we have to
 * prefer other methods of getting data if possible
 */
export default class OpenSeaClient {
  private readonly client: Got;
  private readonly clientNoApiKey: Got;
  constructor() {
    this.client = got.extend({
      prefixUrl: 'https://api.opensea.io/api/v1/',
      hooks: {
        beforeRequest: [
          (options) => {
            if(!options?.headers?.['x-api-key']) {

              if(!options.headers) {
                options.headers = {}
              }

              const randomApiKey = randomItem(OPENSEA_API_KEYS);
              options.headers['x-api-key'] = randomApiKey;
            }
          }
        ]
      },
      /**
       * requires us to check status code
       */
      throwHttpErrors: false,
      cache: false,
      timeout: 20_000
    });

    this.clientNoApiKey = got.extend({
      prefixUrl: 'https://api.opensea.io/api/v1/',
      /**
       * requires us to check status code
       */
      throwHttpErrors: false,
      cache: false,
      timeout: 20_000
    });
  }

  async getNFTMetadata(address: string, tokenId: string): Promise<OpenSeaNFTMetadataResponse> {
    const res: Response<OpenSeaNFTMetadataResponse> = await this.errorHandler(() => {
      return this.clientNoApiKey.get(`metadata/${address}/${tokenId}`, {
        responseType: 'json'
      });
    });

    return res.body;
  }

  async getNFTsOfContract(address: string, limit: number, cursor: string): Promise<OpenSeaAssetsResponse> {
    const res: Response<OpenSeaAssetsResponse> = await this.errorHandler(() => {
      const url = `assets?asset_contract_address=${address}&include_orders=false&limit=${limit}&cursor=$${cursor}`;
      return this.client.get(url, {
        responseType: 'json'
      });
    });

    return res.body;
  }

  async getTokenIdsOfContract(address: string, tokenIds: string): Promise<OpenSeaAssetsResponse> {
    const res: Response<OpenSeaAssetsResponse> = await this.errorHandler(() => {
      const url = `assets?asset_contract_address=${address}&include_orders=false&${tokenIds}`;
      return this.client.get(url, {
        responseType: 'json'
      });
    });

    return res.body;
  }

  private async errorHandler<T>(request: () => Promise<Response<T>>, maxAttempts = 3): Promise<Response<T>> {
    let attempt = 0;

    for(;;) { 
      attempt += 1;

      try {
        const res: Response<T> = await request();

        switch (res.statusCode) {
          case 200:
            return res;

          case 400:
            throw new Error(res.statusMessage);

          case 404:
            throw new Error('Not found');

          case 429:
            await sleep(2000);
            throw new Error('Rate limited');

          case 500:
            throw new Error('Internal server error');

          case 504:
            await sleep(5000);
            throw new Error('OpenSea down');

          default:
            await sleep(2000);
            throw new Error(`Unknown status code: ${res.statusCode}`);
        }
      } catch (err) {
        const handlerRes = gotErrorHandler(err);
        if ('retry' in handlerRes) {
          await sleep(handlerRes.delay);
        } else if (!handlerRes.fatal) {
          // unknown error
          if (attempt >= maxAttempts) {
            throw err;
          }
        } else {
          throw err;
        }
      }
    }
  }
}

interface OpenSeaAssetsResponse {
  next: string;
  previous: string;
  assets: Array<{
    /**
     * opensea id
     */
    id: number;
    num_sales: number;
    name: string;
    token_id: string;
    external_link?: string;
    image_url: string;
    image_original_url: string;
    traits: Array<{ trait_type: string; value: string | number }>;
    background_color?: string;
    animation_url?: string;
    animation_original_url?: string;
    description?: string;
    permalink: string;
    decimals?: number;
    /**
     * link to the token metadata
     */
    token_metadata?: string;
  }>;
}

interface OpenSeaNFTMetadataResponse {
  name: string;
  description: string;
  external_link: string;
  image: string;
  animation_url: string;
}
