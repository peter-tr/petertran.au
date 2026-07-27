---
"web": patch
---

Simplifies pantry's sign-in/sign-up form - no more native browser email-format/required/minLength validation popups (Cognito's own SignUp/InitiateAuth error response already surfaces a real message for a bad email or short password, so the browser's native validation was just a redundant, worse-worded copy of that), and adds a short blurb explaining why you'd bother creating an account. Also shrinks Imposter's permanently-visible tagline from the site's larger marketing-page text size down to the same muted body-copy size pantry and design-studio already use, so all three standalone pages read consistently, especially on mobile.
