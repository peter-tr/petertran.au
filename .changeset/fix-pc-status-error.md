---
"api": patch
---

fix warm-schedule handler catching the wrong AWS exception for "no PC config found", which 502'd the settings page's provisioned concurrency status endpoint whenever any target was outside its warm window
