export const typeDefs = `#graphql
  type Url {
    shortCode: String!
    shortUrl: String!
    longUrl: String!
    createdAt: String!
    expiresAt: String
    clickCount: String!
  }

  type DimensionCount {
    value: String!
    count: String!
  }

  type TimeBucket {
    bucket: String!
    count: String!
  }

  type Analytics {
    shortCode: String!
    days: Int!
    byCountry: [DimensionCount!]!
    byBrowser: [DimensionCount!]!
    byDevice: [DimensionCount!]!
    overTime: [TimeBucket!]!
  }

  type Query {
    url(shortCode: String!): Url
    analytics(shortCode: String!, days: Int = 30): Analytics
    userUrls(userId: String!, limit: Int = 50, offset: Int = 0): [Url!]!
  }

  type Mutation {
    createUrl(longUrl: String!, userId: String, expiresAt: String): Url!
    deleteUrl(shortCode: String!): Boolean!
  }
`;
