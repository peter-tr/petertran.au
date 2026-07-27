---
"web": patch
---

fix a broken test suite and a state-sharing bug from the cold-start auto-run change

The previous PR's automatic cold-start-check effect shared one `error` state with the initial config-load effect - since both fire independently on mount, whichever settled last could silently overwrite the other's message. Split into a separate `coldStartError`, shown alongside the existing warm-schedule error on the settings page. Also fixes `useWarmSchedule.test.ts`, which mocked `fetch` call sequences that assumed only one fetch happens on mount - the new automatic cold-start check adds a second, independent one, which was shifting every subsequent mocked response by one and crashing `saveProfile`/`applyProfile`/`deleteProfile`/`saveAll` in tests (this should have been caught by `npm run test` before the prior PR merged, not after).
