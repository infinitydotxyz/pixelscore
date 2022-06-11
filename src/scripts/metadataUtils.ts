import { BaseCollection } from '@infinityxyz/lib/types/core/Collection';
import { getSearchFriendlyString, trimLowerCase } from '@infinityxyz/lib/utils';
import { CollectionInfo } from '../types/main';
import { COLLECTIONS_COLL } from '../utils/constants';
import { infinityDb } from '../utils/firestore';
import MnemonicClient, { MnemonicContract } from '../utils/mnemonic';
import OpenSeaClient from '../utils/opensea';

const mnemonic = new MnemonicClient();
const opensea = new OpenSeaClient();

export async function getCollectionInfo(collection: string): Promise<CollectionInfo | undefined> {
  try {
    // try fetching from infinity
    let info = await getCollectionInfoFromInfinity(collection);
    if (!info) {
      // try from opensea
      info = await getCollectionInfoFromOpensea(collection);
      if (!info) {
        // try from mnemonic
        info = await getCollectionInfoFromMnemonic(collection);
      }
    }
    return info;
  } catch (error) {
    console.error('Error getting collection info:', error);
  }
}

export async function getCollectionInfoFromInfinity(collection: string): Promise<CollectionInfo | undefined> {
  try {
    const collectionRef = infinityDb.collection(COLLECTIONS_COLL).doc(collection);
    const data = (await collectionRef.get()).data() as BaseCollection;
    if (data) {
      const info: CollectionInfo = {
        address: trimLowerCase(data.address),
        chainId: '1',
        tokenStandard: 'ERC721',
        slug: data.slug,
        name: data.metadata?.name,
        symbol: data.metadata?.symbol,
        description: data.metadata?.description,
        profileImage: data.metadata?.profileImage,
        bannerImage: data.metadata?.bannerImage,
        cardDisplaytype: data.metadata?.displayType,
        twitter: data.metadata?.links.twitter,
        discord: data.metadata?.links.discord,
        external: data.metadata?.links.external,
        hasBlueCheck: data.hasBlueCheck ?? false,
        numNfts: data.numNfts ?? 0,
        numOwners: data.numOwners ?? 0
      };
      return info;
    }
  } catch (error) {
    console.error('Error getting collection info from infinity:', error);
  }
  return undefined;
}

export async function getCollectionInfoFromOpensea(collection: string): Promise<CollectionInfo | undefined> {
  try {
    const data = await opensea.getCollectionMetadata(collection);
    if (data) {
      const info: CollectionInfo = {
        address: trimLowerCase(collection),
        chainId: '1',
        tokenStandard: 'ERC721',
        slug: getSearchFriendlyString(data.links.slug),
        name: data.name,
        symbol: data.symbol,
        description: data.description,
        profileImage: data.profileImage,
        bannerImage: data.bannerImage,
        cardDisplaytype: data.displayType,
        twitter: data.links.twitter,
        discord: data.links.discord,
        external: data.links.external
      };
      return info;
    }
  } catch (error) {
    console.error('Error getting collection info from opensea:', error);
  }

  return undefined;
}

export async function getCollectionInfoFromMnemonic(collection: string): Promise<CollectionInfo | undefined> {
  try {
    const data = (await mnemonic.getCollection(collection)) as MnemonicContract;
    if (data) {
      const info: CollectionInfo = {
        address: trimLowerCase(data.address),
        chainId: '1',
        tokenStandard: 'ERC721',
        slug: getSearchFriendlyString(data.name),
        name: data.name,
        symbol: data.symbol,
        description: '',
        profileImage: '',
        bannerImage: '',
        cardDisplaytype: '',
        twitter: '',
        discord: '',
        external: ''
      };
      return info;
    }
  } catch (error) {
    console.error('Error getting collection info from mnemonic:', error);
  }
  return undefined;
}
