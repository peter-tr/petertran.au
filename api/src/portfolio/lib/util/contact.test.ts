import { describe, expect, it } from "vitest";
import { CONTACT_CONFIRMATION_MESSAGE, validateContactInput, type ContactInput } from "./contact";

function validInput(overrides: Partial<ContactInput> = {}): ContactInput {
  return {
    name: "Ada Lovelace",
    email: "ada@example.com",
    message: "Hello there!",
    ...overrides,
  };
}

describe("validateContactInput", () => {
  it("does not throw for valid input", () => {
    expect(() => validateContactInput(validInput())).not.toThrow();
  });

  it.each([
    ["name", ""],
    ["name", "   "],
    ["email", ""],
    ["email", "   "],
    ["message", ""],
    ["message", "   "],
  ])("throws when %s is blank", (field, value) => {
    expect(() => validateContactInput(validInput({ [field]: value } as Partial<ContactInput>))).toThrow(
      "name, email, and message are all required."
    );
  });

  it.each(["not-an-email", "missing-at.example.com", "missing-domain@", "@no-local-part.com", "spaces in@it.com"])(
    "throws for an invalid email address %s",
    (email) => {
      expect(() => validateContactInput(validInput({ email }))).toThrow(
        "That doesn't look like a valid email address."
      );
    }
  );

  it.each(["a@b.co", "first.last+tag@sub.example.co.uk"])("accepts a valid email address %s", (email) => {
    expect(() => validateContactInput(validInput({ email }))).not.toThrow();
  });

  it("throws when name is too long", () => {
    expect(() => validateContactInput(validInput({ name: "a".repeat(201) }))).toThrow("One of the fields is too long.");
  });

  it("throws when email is too long", () => {
    // Keep it a technically-valid email shape so only the length check fires.
    const longLocalPart = "a".repeat(195);
    expect(() =>
      validateContactInput(validInput({ email: `${longLocalPart}@b.co` }))
    ).toThrow("One of the fields is too long.");
  });

  it("throws when message is too long", () => {
    expect(() => validateContactInput(validInput({ message: "a".repeat(5001) }))).toThrow(
      "One of the fields is too long."
    );
  });

  it("accepts fields exactly at the length limits", () => {
    const name = "a".repeat(200);
    const localPart = "a".repeat(193);
    const email = `${localPart}@b.co`; // exactly 200 chars
    expect(email.length).toBe(200);

    const message = "a".repeat(5000);
    expect(() => validateContactInput({ name, email, message })).not.toThrow();
  });
});

describe("CONTACT_CONFIRMATION_MESSAGE", () => {
  it("is a non-empty string", () => {
    expect(typeof CONTACT_CONFIRMATION_MESSAGE).toBe("string");
    expect(CONTACT_CONFIRMATION_MESSAGE.length).toBeGreaterThan(0);
  });
});
