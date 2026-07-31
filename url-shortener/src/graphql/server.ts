import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { Express } from 'express';
import bodyParser from 'body-parser';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';
import { logger } from '../utils/logger';

export async function attachGraphQL(app: Express): Promise<void> {
  const server = new ApolloServer({ typeDefs, resolvers });
  await server.start();

  app.use('/graphql', bodyParser.json(), expressMiddleware(server));
  logger.info('GraphQL endpoint mounted at /graphql');
}
