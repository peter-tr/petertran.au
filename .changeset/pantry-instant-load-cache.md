---
"pantry": minor
"web": minor
---

add a stale-while-revalidate cache for the pantry page: it now paints instantly from the last-loaded inventory/shopping list/settings on mount while a fresh copy loads in the background, instead of waiting on the network every visit. Controlled by a new "Instant load" toggle on the pantry settings page (`instantLoadCache` on `PantrySettings`, default on) - the cache is scoped per signed-in account (or the shared/default pantry when signed out) and clears immediately when the toggle is switched off.
