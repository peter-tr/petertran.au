---
"web": patch
---

fix a real Design Studio data-loss bug: accepting a multi-element AI-generated draft (or any code path calling `useEventHistory`'s `dispatch` more than once within the same synchronous batch) silently dropped every dispatched element except the last one, because `events` and `cursor` were separate `useState` calls and each dispatch's closure captured a `cursor` value that was stale for every call after the first in the same batch. `events`/`cursor` are now one combined state atom, so each dispatch sees every prior dispatch already queued in the same batch. This is why accepting an AI draft and then saving appeared to do nothing - only one element (if any) had actually survived to be saved.
