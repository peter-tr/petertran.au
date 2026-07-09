export interface ContactInput {
  name: string;
  email: string;
  message: string;
}

export const CONTACT_CONFIRMATION_MESSAGE = "Thanks - you'll hear back from me soon.";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
