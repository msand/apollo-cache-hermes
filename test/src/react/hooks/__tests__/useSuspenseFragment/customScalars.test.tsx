import { disableActEnvironment, renderHookToSnapshotStream } from '@testing-library/react-render-stream';
import { ApolloClient, ApolloLink, gql } from '@apollo/client';
import { useSuspenseFragment } from '@apollo/client/react';

import { createClientWrapper, dateScalar } from '@apollo/client/testing/internal';

import { Hermes } from '../../../../../../src';

it('returns parsed custom scalar fields', async () => {
  const fragment = gql`
    fragment EventFields on Event {
      id
      startDate
    }
  `;
  const client = new ApolloClient({
    cache: new Hermes({
      scalars: { Date: dateScalar },
      typePolicies: {
        Event: {
          fields: {
            startDate: { scalar: 'Date' },
          },
        },
      },
    }),
    link: ApolloLink.empty(),
  });

  client.writeFragment({
    fragment,
    data: {
      __typename: 'Event',
      id: '1',
      startDate: '2026-01-01',
    },
  });

  using _disabledAct = disableActEnvironment();
  const { takeSnapshot } = await renderHookToSnapshotStream(
    () =>
      useSuspenseFragment({
        fragment,
        from: { __typename: 'Event', id: '1' },
      }),
    { wrapper: createClientWrapper(client) },
  );

  await expect(takeSnapshot()).resolves.toStrictEqualTyped({
    data: {
      __typename: 'Event',
      id: '1',
      startDate: new Date(2026, 0, 1),
    },
  });

  client.writeFragment({
    fragment,
    data: {
      __typename: 'Event',
      id: '1',
      startDate: '2026-02-02',
    },
  });

  await expect(takeSnapshot()).resolves.toStrictEqualTyped({
    data: {
      __typename: 'Event',
      id: '1',
      startDate: new Date(2026, 1, 2),
    },
  });
  await expect(takeSnapshot).not.toRerender();
});
