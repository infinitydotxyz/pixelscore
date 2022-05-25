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

  app.use(cors());

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
