# Changelog

## [0.1.0](https://github.com/bkudria/craboodle/compare/v0.0.1...v0.1.0) (2026-05-19)


### Features

* add exit code 5 for budget exhaustion ([2fb075d](https://github.com/bkudria/craboodle/commit/2fb075ded10ed4e42efc42d420f32cfdb0423cdd))
* add totals and fix pool abort reason ([57d0e82](https://github.com/bkudria/craboodle/commit/57d0e829e4b03103ce903b4e32d6f853574d9799))
* **cli:** add structured error hints to stderr ([de2fafc](https://github.com/bkudria/craboodle/commit/de2fafcfd54a63dacd0238228b4925d7742b3376))
* **cli:** pre-flight check for scuttlerun/pincenez on PATH ([3963827](https://github.com/bkudria/craboodle/commit/39638272eb59357d37afb3514310f78e8c383482))
* **cli:** validate `--concurrency` is a positive integer ([ab971f6](https://github.com/bkudria/craboodle/commit/ab971f6ba4a58fc1fbbf232d803299f374fd24d6))
* **config:** add `artifact_retention_days` option ([e776914](https://github.com/bkudria/craboodle/commit/e7769147ef9b97c55027bea47e0a9fc458593020))
* **output:** join rep gradings by check id ([29c9b54](https://github.com/bkudria/craboodle/commit/29c9b54822b3c1d4ecef95b5c8e324e1dcc7a694))
* **pool:** add `isInterrupted` abort reason ([8b41e75](https://github.com/bkudria/craboodle/commit/8b41e755820ec6adb10a48b7f2bb6f6f98ca84d0))
* **project:** add cli profile ([5c51650](https://github.com/bkudria/craboodle/commit/5c51650b8cd8fabc9395de9f43aa2e5bf768c9b5))
* **project:** add public profile ([397d640](https://github.com/bkudria/craboodle/commit/397d6402d7755e4291674d6c93b4fd6ef9aaf03b))
* **runner:** use spawn for process-group cleanup ([2ee5b85](https://github.com/bkudria/craboodle/commit/2ee5b8584697723c9eb9567abe0f1fbbedac3335))
* **signals:** add SIGINT handling ([1ded301](https://github.com/bkudria/craboodle/commit/1ded30147e8e1bc4752b0d610dff7a505fa9f937))


### Bug Fixes

* **ci:** explicit boolean check: release_created ([5d01389](https://github.com/bkudria/craboodle/commit/5d01389bd878d853f09addd0cf23572fa809ba53))
* **cli:** correct exit codes and lint totals ([a050358](https://github.com/bkudria/craboodle/commit/a0503581606181b3ad134064737989f0de578760))
* **cli:** read version from package.json ([99210e2](https://github.com/bkudria/craboodle/commit/99210e2f026b6cac1808bfb2325de554e2454ea7))
* **discovery:** escape regex metachars in patterns ([3284e0b](https://github.com/bkudria/craboodle/commit/3284e0bec989f909a4407c11a7835877371addf7))
* **tests:** make suite hermetic for CI without companion CLIs ([#10](https://github.com/bkudria/craboodle/issues/10)) ([93940cd](https://github.com/bkudria/craboodle/commit/93940cd9ffaf131f4bae26b41d94b3885b803cc7))
* **tests:** poll pidFile instead of fixed delay ([d0e9bd5](https://github.com/bkudria/craboodle/commit/d0e9bd58fcc837dff9334e2389b69c0dec862aa3))

## Changelog
