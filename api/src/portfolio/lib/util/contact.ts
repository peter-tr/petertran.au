export interface ContactInput {
  name: string;
  email: string;
  message: string;
}

export const CONTACT_CONFIRMATION_MESSAGE = "Thanks - you'll hear back from me soon.";

// The domain-side classes exclude "." (each label is delimited by a literal
// "." instead) - `[^\s@]+\.[^\s@]+$` let the two quantified groups both
// match dots, which gave SonarQube's static analyzer a super-linear-
// backtracking flag (S8786). Same result for every real email shape (see
// contact.test.ts, including multi-label domains like "sub.example.co.uk"),
// and linear since there's no longer any ambiguity for the engine to
// backtrack over.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function validateContactInput(input: ContactInput): void {
  const { name, email, message } = input;

  if (!name.trim() || !email.trim() || !message.trim()) {
    throw new Error("name, email, and message are all required.");
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("That doesn't look like a valid email address.");
  }
  if (name.length > 200 || email.length > 200 || message.length > 5000) {
    throw new Error("One of the fields is too long.");
  }
}
