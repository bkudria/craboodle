# Changelog

## [0.3.0](https://github.com/bkudria/craboodle/compare/v0.2.0...v0.3.0) (2026-07-03)


### ⚠ BREAKING CHANGES

* **run:** add error_rate reliability gate for crashed reps ([#48](https://github.com/bkudria/craboodle/issues/48))
* **lint:** drop plugin coverage diagnostic ([#42](https://github.com/bkudria/craboodle/issues/42))

### Features

* **auth:** forward a credential preference to scuttlerun and pincenez ([#77](https://github.com/bkudria/craboodle/issues/77)) ([9a3b472](https://github.com/bkudria/craboodle/commit/9a3b4720a044cfd90407f2a99fd054315179d616))
* **cli:** add --timeout passthrough to scuttlerun ([#45](https://github.com/bkudria/craboodle/issues/45)) ([12c840f](https://github.com/bkudria/craboodle/commit/12c840f7d6715efbaa3877d7b84623771ebdef07))
* craboodle lint emits plugin-component coverage in plugin mode ([#32](https://github.com/bkudria/craboodle/issues/32)) ([07e6d82](https://github.com/bkudria/craboodle/commit/07e6d82eb835bcae71d693a9b6e922bb0ab0ee65))
* **examples:** ship note-taker plugin-level eval fixture ([#33](https://github.com/bkudria/craboodle/issues/33)) ([c4a21f5](https://github.com/bkudria/craboodle/commit/c4a21f50b4ee26fbc5d701250bc27e920ea3e4a2))
* **init:** emit project.plugins self-reference in plugin mode ([#35](https://github.com/bkudria/craboodle/issues/35)) ([b24023a](https://github.com/bkudria/craboodle/commit/b24023ab7b7cae844938d34eb8f34ad237ac3da5))
* **init:** emit project.plugins self-reference in plugin mode ([#41](https://github.com/bkudria/craboodle/issues/41)) ([98e0166](https://github.com/bkudria/craboodle/commit/98e0166e911fe6161a946db6e031a6078c23094d))
* **init:** prefix named-component placeholders with `<type>-` ([#36](https://github.com/bkudria/craboodle/issues/36)) ([a03274b](https://github.com/bkudria/craboodle/commit/a03274ba0c8af27a105754ea9b28dd2f3eb51c89))
* **init:** scaffold a composition-placeholder scenario in plugin mode ([#49](https://github.com/bkudria/craboodle/issues/49)) ([885b644](https://github.com/bkudria/craboodle/commit/885b644a31d53c39dc4beb41224b922c51d8ded6))
* **init:** scaffold incrementally, skipping components with existing suites ([#59](https://github.com/bkudria/craboodle/issues/59)) ([41eaa67](https://github.com/bkudria/craboodle/commit/41eaa67470418f0f844eb31ef29db3e872c80f2e))
* **init:** scaffold per-component placeholders in plugin mode ([#34](https://github.com/bkudria/craboodle/issues/34)) ([9b8a612](https://github.com/bkudria/craboodle/commit/9b8a61234b81e990bf0197885f9c1b0d3064ddf1))
* **lint:** disclose verdict nondeterminism on the lint surface ([#66](https://github.com/bkudria/craboodle/issues/66)) ([170a38a](https://github.com/bkudria/craboodle/commit/170a38add5991fa9ea8fa695478f348677cbe187))
* **lint:** drop plugin coverage diagnostic ([#42](https://github.com/bkudria/craboodle/issues/42)) ([b3480a5](https://github.com/bkudria/craboodle/commit/b3480a5a0878a115effeefbcac7a327c57f34d4c))
* **lint:** ground pincenez lint in the scenario's resolved config ([#58](https://github.com/bkudria/craboodle/issues/58)) ([e379f4c](https://github.com/bkudria/craboodle/commit/e379f4c904adc2bcb9e4ed12261871aed12f56c5))
* **lint:** surface pincenez lint cost in the lint footer ([#69](https://github.com/bkudria/craboodle/issues/69)) ([1792b02](https://github.com/bkudria/craboodle/commit/1792b028d81371e05f1ccf5caf6ae6b4e7ebea50))
* parse .claude-plugin/plugin.json and enumerate plugin components ([#30](https://github.com/bkudria/craboodle/issues/30)) ([c21f855](https://github.com/bkudria/craboodle/commit/c21f85570d0a2ab6db895ce00b32b8a5a145cf2b))
* **prepare-run:** rewrite project.plugins paths into the staged view ([#71](https://github.com/bkudria/craboodle/issues/71)) ([6c9aa52](https://github.com/bkudria/craboodle/commit/6c9aa523292651716511767d5d4ca3b858396302))
* **run:** add error_rate reliability gate for crashed reps ([#48](https://github.com/bkudria/craboodle/issues/48)) ([b70cede](https://github.com/bkudria/craboodle/commit/b70ceded1851a7b819158dceb78836f94995dad1))
* **run:** end the stdout YAML stream with a result/exit_code verdict trailer ([#60](https://github.com/bkudria/craboodle/issues/60)) ([80065be](https://github.com/bkudria/craboodle/commit/80065be697eadf014a65e6d59664552a8e190fb8))
* **run:** ground pincenez grading in the scenario's resolved prompt ([#63](https://github.com/bkudria/craboodle/issues/63)) ([129cc05](https://github.com/bkudria/craboodle/commit/129cc0510bbd547166378f7d030f62af9d676fdb))
* **runner:** persist partial output.yaml on scuttlerun failure ([#47](https://github.com/bkudria/craboodle/issues/47)) ([2692336](https://github.com/bkudria/craboodle/commit/26923366238dfe11316f2f5ceab4cdef42dd3033))
* **runner:** surface subprocess exit code on failure ([#46](https://github.com/bkudria/craboodle/issues/46)) ([be70259](https://github.com/bkudria/craboodle/commit/be702596469d9ce8edb8eb335c60639376d8849b))


### Bug Fixes

* **cli:** emit path-specific recovery hint for missing evals.yaml ([#43](https://github.com/bkudria/craboodle/issues/43)) ([55a07c3](https://github.com/bkudria/craboodle/commit/55a07c34049734434e5b4ca5320d88c2a14ff13b))
* **init:** indent project block hints to nest under scenarios.base.project ([#44](https://github.com/bkudria/craboodle/issues/44)) ([c0733dc](https://github.com/bkudria/craboodle/commit/c0733dc9a9756843e98a06faf0f226775c77dcc9))
* **init:** lint-clean composition example, current additional_tools hint, plugin-mode help ([#51](https://github.com/bkudria/craboodle/issues/51)) ([110e37d](https://github.com/bkudria/craboodle/commit/110e37df708e22514ad1e800c99dfa2024ca3475))
* **init:** scaffold Skill/Agent checks against the real input.&lt;field&gt; shape ([#50](https://github.com/bkudria/craboodle/issues/50)) ([f010034](https://github.com/bkudria/craboodle/commit/f010034189aee8666768fae0e9a67972422a7f94))
* **init:** surface the strict max_error_rate default (0) in the scaffold and --help schema ([#62](https://github.com/bkudria/craboodle/issues/62)) ([f89a69c](https://github.com/bkudria/craboodle/commit/f89a69c4f77ef7c0f1d4be5faed3f216bbbc1f8c))
* **init:** surface the top-level timeout key in the scaffold and --help schema ([#67](https://github.com/bkudria/craboodle/issues/67)) ([7987225](https://github.com/bkudria/craboodle/commit/7987225ec461262ca40184f35b70315d57b863ed))
* **run:** count failed reps' transcript costs in totals and the budget guard ([#65](https://github.com/bkudria/craboodle/issues/65)) ([42912d2](https://github.com/bkudria/craboodle/commit/42912d247136d8d505f1f74fa2dc0b767bccfdf9))
* **run:** lead the verbose fail-fast message with the min_pass_rate breach ([#61](https://github.com/bkudria/craboodle/issues/61)) ([f165d1d](https://github.com/bkudria/craboodle/commit/f165d1d53025aa135c68eb231a0e89d75be4d7b8))
* **runner:** forward subprocess stderr to the operator on failure ([#57](https://github.com/bkudria/craboodle/issues/57)) ([2dab517](https://github.com/bkudria/craboodle/commit/2dab5176f1b1334c4e214bad289a42fb3dcfab10))
* **runner:** point crashed-rep errors at the transcript when stderr is empty ([#70](https://github.com/bkudria/craboodle/issues/70)) ([ff386a5](https://github.com/bkudria/craboodle/commit/ff386a5ed575ed1dcbc01e549d705eeb29bef96f))

## [0.2.0](https://github.com/bkudria/craboodle/compare/v0.1.0...v0.2.0) (2026-05-21)


### Features

* single evals.yaml at skill/plugin root with staged view ([#12](https://github.com/bkudria/craboodle/issues/12)) ([6a86fd3](https://github.com/bkudria/craboodle/commit/6a86fd30c8acf79743154433c18c6ddf543361ed))

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
