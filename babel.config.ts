// eslint-disable-next-line import/no-extraneous-dependencies
import { ConfigAPI, ConfigFunction } from '@babel/core';

const config: ConfigFunction = (api: ConfigAPI) => {
  api.cache.forever();
  return {
    presets: [
      [
        '@babel/preset-env',
        {
          targets: {
            node: 'current',
          },
        },
      ],
    ],
  };
};

export default config;
