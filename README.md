# CI report for 2a7640205b8982cf966d53c47845e5270cf4119d

- Server and protocol: success
- Lockfiles: success
- Encryption core: success
- App checks: success

## Server and protocol (success)

```
  CACHE_ON_FAILURE: false
  CACHE_ON_FAILURE: false
  CACHE_ON_FAILURE: false
  CACHE_ON_FAILURE: false
  CACHE_ON_FAILURE: false
  CACHE_ON_FAILURE: false
  CACHE_ON_FAILURE: false
packages/protocol test:  [32m✓[39m test/protocol.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 35[2mms[22m[39m
packages/protocol test: [2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
apps/server test:  [32m✓[39m test/messaging.test.ts [2m([22m[2m12 tests[22m[2m)[22m[33m 1290[2mms[22m[39m
apps/server test:    [33m[2m✓[22m[39m device sign-in, keys and message delivery[2m > [22mqueues messages for an offline device and delivers them in order on sign-in [33m 377[2mms[22m[39m
apps/server test:    [33m[2m✓[22m[39m device sign-in, keys and message delivery[2m > [22mdelivers immediately to an online device, once per message id [33m 329[2mms[22m[39m
apps/server test:  [32m✓[39m test/accounts.test.ts [2m([22m[2m14 tests[22m[2m)[22m[33m 1813[2mms[22m[39m
apps/server test:    [33m[2m✓[22m[39m registration, sign-in and recovery[2m > [22mrecovery with the backup code[2m > [22mpauses recovery after repeated wrong codes [33m 431[2mms[22m[39m
apps/server test:  [32m✓[39m test/e2e.test.ts [2m([22m[2m2 tests[22m[2m)[22m[33m 391[2mms[22m[39m
apps/server test:  [32m✓[39m test/devices.test.ts [2m([22m[2m6 tests[22m[2m)[22m[33m 488[2mms[22m[39m
apps/server test:  [32m✓[39m test/push.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 13[2mms[22m[39m
apps/server test:  [32m✓[39m test/server.test.ts [2m([22m[2m11 tests[22m[2m)[22m[32m 142[2mms[22m[39m
apps/server test:  [32m✓[39m test/blobs.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 247[2mms[22m[39m
apps/server test:  [32m✓[39m test/safety.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 260[2mms[22m[39m
apps/server test:  [32m✓[39m test/calls.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 149[2mms[22m[39m
apps/server test: [2m Test Files [22m [1m[32m9 passed[39m[22m[90m (9)[39m
```

## Lockfiles (success)

```
```

## Encryption core (success)

```
  CACHE_ON_FAILURE: false
  CACHE_ON_FAILURE: false
  CACHE_ON_FAILURE: false
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 14.80s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.24s
```

## App checks (success)

```
```
