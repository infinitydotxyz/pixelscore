import { trimLowerCase } from '@infinityxyz/lib/utils';
import { createHash } from 'crypto';
import { NextFunction, Response, Request } from 'express';
import { StatusCode } from '@infinityxyz/lib/types/core';
import { AUTH_HEADERS } from './constants';
import { ethers } from 'ethers';

export function authenticateUser(req: Request<{ user: string }>, res: Response, next: NextFunction) {
  // Return true;
  const userId = trimLowerCase(req.params.user);
  const signature = req.header(AUTH_HEADERS.signature);
  const message = req.header(AUTH_HEADERS.message);
  if (!signature || !message) {
    res.sendStatus(StatusCode.Unauthorized);
    return;
  }
  try {
    // Verify signature
    const sign = JSON.parse(signature);
    const actualAddress = ethers.utils.verifyMessage(message, sign).toLowerCase();
    if (actualAddress === userId) {
      next();
      return;
    }
  } catch (err: any) {
    console.error(`Cannot authenticate user ${userId}`);
    console.error(err);
  }
  res.sendStatus(StatusCode.Unauthorized);
}

export async function sleep(duration: number): Promise<void> {
  return await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
}

/**
 * returns a random int between min (inclusive) and max (inclusive)
 */
export function randomInt(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomItem<T>(array: T[]): T {
  const index = randomInt(0, array.length - 1);
  return array[index];
}

export function getDocIdHash({
  chainId,
  collectionAddress,
  tokenId
}: {
  collectionAddress: string;
  tokenId: string;
  chainId: string;
}) {
  const data = chainId.trim() + '::' + trimLowerCase(collectionAddress) + '::' + tokenId.trim();
  return createHash('sha256').update(data).digest('hex').trim().toLowerCase();
}
