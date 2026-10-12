import * as fs from 'fs';
import * as path from 'path';

// Tests run from tsc output (`foo.js`), but snapshots are named after the source file
// (`__snapshots__/foo.ts.snap` or `foo.tsx.snap`), as they were when the suites ran from TypeScript.
function sourceExtension(testPath: string) {
  return fs.existsSync(testPath.replace(/\.js$/, '.tsx')) ? '.tsx' : '.ts';
}

const snapshotResolver = {
  testPathForConsistencyCheck: 'some/__tests__/example.test.js',

  resolveSnapshotPath(testPath: string, snapshotExtension: string) {
    const name = path.basename(testPath).replace(/\.js$/, sourceExtension(testPath));
    return path.join(path.dirname(testPath), '__snapshots__', name + snapshotExtension);
  },

  resolveTestPath(snapshotPath: string, snapshotExtension: string) {
    const name = path.basename(snapshotPath, snapshotExtension).replace(/\.tsx?$/, '.js');
    return path.join(path.dirname(path.dirname(snapshotPath)), name);
  },
};

export = snapshotResolver;
