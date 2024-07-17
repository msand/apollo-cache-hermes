/** @jest-environment node */
import * as React from 'react';
import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';
import { ApolloClient, ApolloProvider } from '@apollo/client';

import { mockSingleLink } from '../../../testing';
import { useLazyQuery } from '../../hooks';
import { renderToStringWithData } from '..';
import { Hermes } from '../../../../../src';

describe('useLazyQuery Hook SSR', () => {
  const CAR_QUERY: DocumentNode = gql`
    query {
      cars {
        make
        model
        vin
      }
    }
  `;

  const CAR_RESULT_DATA = {
    cars: [
      {
        make: 'Audi',
        model: 'RS8',
        vin: 'DOLLADOLLABILL',
        __typename: 'Car',
      },
    ],
  };

  it('should run query only after calling the lazy mode execute function', () => {
    const link = mockSingleLink({
      request: { query: CAR_QUERY },
      result: { data: CAR_RESULT_DATA },
    });

    const client = new ApolloClient({
      cache: new Hermes(),
      link,
      ssrMode: true,
    });

    const Component = () => {
      let html: React.ReactElement | null = null;
      const [execute, { loading, called, data }] = useLazyQuery(CAR_QUERY);

      if (!loading && !called) {
        execute();
      }

      if (!loading && called) {
        expect(loading).toEqual(false);
        expect(data).toEqual(CAR_RESULT_DATA);
        html = <p>{data.cars[0].make}</p>;
      }

      return html;
    };

    const app = (
      <ApolloProvider client={client}>
        <Component />
      </ApolloProvider>
    );

    return renderToStringWithData(app).then((markup) => {
      expect(markup).toMatch(/Audi/);
    });
  });
});
