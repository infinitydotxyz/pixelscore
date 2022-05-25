import { trimLowerCase } from '@infinityxyz/lib/utils';
import cors from 'cors';
import express, { Express, NextFunction, Request, Response } from 'express';
import { AUTH_HEADERS } from './utils/constants';
import { isUserAuthenticated } from './utils/main';
import { queryParser } from './utils/query-parser';

export const startServer = (): Express => {
  const app: Express = express();
  app.use(express.json());

  app.use(
    queryParser({
      parseNull: true,
      parseUndefined: true,
      parseBoolean: true,
      parseNumber: true
    })
  );

  // todo: change this
  const localHost = /http:\/\/localhost:\d+/;
  const whitelist = [localHost];
  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      if (origin) {
        const result = whitelist.filter((regEx) => {
          return origin.match(regEx);
        });
        let isWhitelisted = result.length > 0;

        if (!isWhitelisted) {
          if (origin.includes('/webhooks/alchemy/padw')) {
            isWhitelisted = true;
          } else if (origin.includes('54.236.136.17')) {
            isWhitelisted = true;
          } else if (origin.includes('34.237.24.169')) {
            isWhitelisted = true;
          }
        }

        if (!isWhitelisted) {
          console.log(`cors rejecting origin: ${origin}`);
        }

        callback(isWhitelisted ? null : Error('Bad Request'), isWhitelisted);
      }

      callback(null, true);
    }
  };
  app.use(cors(corsOptions));

  const port = process.env.PORT ?? 9090;
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });

  app.all('/u/:user/*', async (req: Request, res: Response, next: NextFunction) => {
    const userAddress = trimLowerCase(req.params.user);
    const authorized = isUserAuthenticated(
      userAddress,
      req.header(AUTH_HEADERS.signature) ?? '',
      req.header(AUTH_HEADERS.message) ?? ''
    );
    if (authorized) {
      next();
    } else {
      res.status(401).send('Unauthorized');
    }
  });

  return app;
};
