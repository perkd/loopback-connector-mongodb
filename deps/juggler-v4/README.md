# juggler-v4 — frozen backward-compat suite

This directory is a file-protocol workspace package that pins `loopback-datasource-juggler` to v4.28.9 and runs its upstream test files against the connector via `yarn test:juggler`.

**Do not upgrade this package.** It is a frozen reference point for juggler v4 API compatibility. New test coverage belongs in `deps/juggler-v5/` or `test/*.test.js`.

## What it runs

- `loopback-datasource-juggler/test/common.batch.js` (which in turn requires `datatype.test.js`, `basic-querying.test.js`, `manipulation.test.js`, `hooks.test.js`, and `relations.test.js`)
- `loopback-datasource-juggler/test/default-scope.test.js`
- `loopback-datasource-juggler/test/include.test.js`
- `loopback-datasource-juggler/test/persistence-hooks.suite.js`

## Known pass/fail baseline

As of v6.5.0: **1041 passing, 117 pending, 0 failing**.

## lodash/isEmpty patch

`test.js` patches `lodash.isEmpty` to return `false` for `mongodb.ObjectId` instances. This patches the shared root `node_modules/lodash` (no nested copy) and reaches `loopback-datasource-juggler/lib/scope.js:144` where the upstream juggler would otherwise skip ObjectId-keyed queries.
