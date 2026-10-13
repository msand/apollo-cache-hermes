import { build } from '@apollo/client';
import { reactCompilerVersion } from '@apollo/client/react';

const isCI = process.env.TEST_ENV === 'ci';

it('test is running against source or ESM (in CI) build', () => {
  // We want to ensure that in CI, these tests run against the
  // React Compiler-compiled ESM build
  // Hermes: the tests always run against the published package's ES modules
  // (see test/env/resolver.ts), never against Apollo Client's source.
  expect(build).toBe('esm');
});

it('test is running against uncompiled or compiled (in CI)', () => {
  if (isCI) {
    expect(reactCompilerVersion).toMatchInlineSnapshot(`"1.0.0"`);
  } else {
    expect(reactCompilerVersion).toBe('uncompiled');
  }
});
