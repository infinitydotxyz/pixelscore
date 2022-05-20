import { trimLowerCase } from '@infinityxyz/lib/utils';
import { createHash } from 'crypto';
import { NextFunction, Response, Request } from 'express';
import { StatusCode } from '@infinityxyz/lib/types/core';
import { AUTH_HEADERS } from './constants';
import { ethers } from 'ethers';

export function isUserAuthenticated(userId: string, signature: string, message: string): boolean {
  // Return true;
  if (!signature || !message) {
    return false;
  }
  try {
    // Verify signature
    const sign = JSON.parse(signature);
    const actualAddress = ethers.utils.verifyMessage(message, sign).toLowerCase();
    if (actualAddress === userId) {
      return true;
    }
  } catch (err: any) {
    console.error(`Cannot authenticate user ${userId}`);
    console.error(err);
  }
  return false;
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

/**
 * Encodes a plaintext cursor.
 * @param cursor plaintext cursor
 * @returns base64 encoded cursor
 */
export function encodeCursor(cursor: string | number | Object) {
  if (typeof cursor == 'object') {
    cursor = JSON.stringify(cursor);
  }

  return base64Encode(cursor.toString());
}

/**
 * Decodes a base64 encoded cursor.
 * @param encoded base64 encoded cursor
 * @returns plaintext
 */
export function decodeCursor(encoded = ''): string {
  return base64Decode(encoded);
}

/**
 * Decodes a base64 encoded JSON cursor to an object.
 * @param encoded
 * @returns
 */
export function decodeCursorToObject<T>(encoded = ''): T {
  try {
    const decoded = decodeCursor(encoded);
    return JSON.parse(decoded);
  } catch (err: any) {
    return {} as T;
  }
}

/**
 * Decodes a base64 encoded cursor containing a number to a number.
 * @param encoded
 * @returns
 */
export function decodeCursorToNumber(encoded = '') {
  const decoded = decodeCursor(encoded);
  return parseInt(decoded, 10);
}

export const base64Encode = (data: string) => Buffer.from(data).toString('base64');

export const base64Decode = (data?: string) => Buffer.from(data ?? '', 'base64').toString();
