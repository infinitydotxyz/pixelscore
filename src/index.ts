import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import { createHmac } from 'crypto';
import { AlchemyAddressActivityWebHook } from './types/main';
import {
  ALCHEMY_WEBHOOK_ACTIVITY_CATEGORY_EXTERNAL,
  ALCHEMY_WEBHOOK_ASSET_ETH,
  ALCHEMY_WEBHOOK_ETH_MAINNET,
  PIXELSCORE_PRICE,
  PIXELSCORE_WALLET
} from './utils/constants';

dotenv.config();

const app: Express = express();
app.use(express.json());
const port = process.env.PORT ?? 3000;

app.listen(port, () => {
  console.log(`⚡️[server]: Server is running on port ${port}`);
});

app.post('/webhooks/alchemy/padw', (req: Request, res: Response) => {
  console.log('padw webhook body', JSON.stringify(req.body));
  if (isValidSignature(req)) {
    const isValidRequest = checkRequestValidity(req);
    if (isValidRequest) {
      console.log('Valid request');
    }
    res.sendStatus(200);
  } else {
    console.error('Invalid signature for padw webhook');
    res.sendStatus(401);
  }
});

function isValidSignature(req: Request) {
  const signingKey = process.env.ALCHMEY_PADW_SIGNING_KEY ?? '';
  const signature = req.headers['x-alchemy-signature']; // Lowercase for NodeJS
  const body = req.body;
  const hmac = createHmac('sha256', signingKey); // Create a HMAC SHA256 hash using the signing key
  hmac.update(JSON.stringify(body), 'utf8'); // Update the signing key hash with the request body using utf8
  const digest = hmac.digest('hex');
  return signature === digest; // If signature equals your computed hash, return true
}

function checkRequestValidity(req: Request): boolean {
  try {
    const data = req.body as AlchemyAddressActivityWebHook;

    // check basics
    if (data.webhookId !== process.env.ALCHEMY_PADW_WEBHOOK_ID) {
      console.error('Invalid webhookId');
      return false;
    }
    if (data.event.network !== ALCHEMY_WEBHOOK_ETH_MAINNET) {
      console.error('Invalid network');
      return false;
    }
    if (data.event.activity.length !== 1) {
      console.error('Invalid activty list');
      return false;
    }

    // check activity
    const activity = data.event.activity[0];
    if (activity.toAddress.trim().toLowerCase() !== PIXELSCORE_WALLET) {
      console.error('Invalid pixelscore wallet');
      return false;
    }
    if (activity.value < PIXELSCORE_PRICE) {
      // todo: multiply by quantity
      console.error('Invalid price');
      return false;
    }
    if (activity.asset !== ALCHEMY_WEBHOOK_ASSET_ETH) {
      console.error('Invalid asset for payment');
      return false;
    }
    if (activity.category.trim().toLowerCase() !== ALCHEMY_WEBHOOK_ACTIVITY_CATEGORY_EXTERNAL) {
      console.error('Invalid activity category');
      return false;
    }
  } catch (err) {
    console.error('Error while checking request validity', err);
    return false;
  }
  return true;
}
