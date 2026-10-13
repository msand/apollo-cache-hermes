import { ApolloClient, ApolloLink, gql } from '@apollo/client';

import { dateScalar } from '@apollo/client/testing/internal';

import { Hermes } from '../../../../../src';
import { toNormalizedCacheObject } from '../../../../helpers/serialization';

it('serializes scalar variables used in field arguments', () => {
  const client = new ApolloClient({
    cache: new Hermes({ scalars: { Date: dateScalar } }),
    link: ApolloLink.empty(),
  });
  const query = gql`
    query Event($date: Date!) {
      event(date: $date) {
        name
      }
    }
  `;

  client.writeQuery({
    query,
    variables: { date: new Date(2026, 0, 1) },
    data: {
      event: { __typename: 'Event', name: 'GraphQL Summit' },
    },
  });

  // Hermes: extract() is Hermes' serialization; compare it in InMemoryCache's normalized shape.
  expect(toNormalizedCacheObject((client.cache as Hermes).extract())).toStrictEqualTyped({
    ROOT_QUERY: {
      __typename: 'Query',
      'event({"date":"2026-01-01"})': {
        __typename: 'Event',
        name: 'GraphQL Summit',
      },
    },
  });
});

it('serializes scalar variables used in directive arguments', () => {
  const client = new ApolloClient({
    cache: new Hermes({
      scalars: { Date: dateScalar },
      typePolicies: {
        Query: {
          fields: {
            event: {
              keyArgs: ['@on', ['date']],
            },
          },
        },
      },
    }),
    link: ApolloLink.empty(),
  });
  const query = gql`
    query Event($date: Date!) {
      event @on(date: $date) {
        name
      }
    }
  `;

  client.writeQuery({
    query,
    variables: { date: new Date(2026, 0, 1) },
    data: {
      event: { __typename: 'Event', name: 'GraphQL Summit' },
    },
  });

  // Hermes: extract() is Hermes' serialization; compare it in InMemoryCache's normalized shape.
  expect(toNormalizedCacheObject((client.cache as Hermes).extract())).toStrictEqualTyped({
    ROOT_QUERY: {
      __typename: 'Query',
      'event:{"@on":{"date":"2026-01-01"}}': {
        __typename: 'Event',
        name: 'GraphQL Summit',
      },
    },
  });
});

it('serializes scalar fields in input object variables', () => {
  const client = new ApolloClient({
    cache: new Hermes({
      scalars: { Date: dateScalar },
      inputObjects: {
        EventFilter: {
          fields: {
            date: 'Date',
          },
        },
      },
    }),
    link: ApolloLink.empty(),
  });
  const query = gql`
    query Event($filter: EventFilter!) {
      event(filter: $filter) {
        name
      }
    }
  `;

  client.writeQuery({
    query,
    variables: {
      filter: {
        date: new Date(2026, 0, 1),
      },
    },
    data: {
      event: { __typename: 'Event', name: 'GraphQL Summit' },
    },
  });

  // Hermes: extract() is Hermes' serialization; compare it in InMemoryCache's normalized shape.
  expect(toNormalizedCacheObject((client.cache as Hermes).extract())).toStrictEqualTyped({
    ROOT_QUERY: {
      __typename: 'Query',
      'event({"filter":{"date":"2026-01-01"}})': {
        __typename: 'Event',
        name: 'GraphQL Summit',
      },
    },
  });
});
