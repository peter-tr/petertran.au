import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactInput } from "../util/contact";

vi.mock("../util/geoip", () => ({
  getLocationForIp: vi.fn(),
}));

import { getLocationForIp } from "../util/geoip";
import { sendContactNotification } from "./email";

const sesMock = mockClient(SESv2Client);

const input: ContactInput = {
  name: "Ada <Lovelace>",
  email: "ada@example.com",
  message: 'Hi & welcome\n"quoted" line',
};

describe("sendContactNotification", () => {
  const originalFrom = process.env.CONTACT_FROM_EMAIL;
  const originalTo = process.env.CONTACT_TO_EMAIL;

  beforeEach(() => {
    sesMock.reset();
    vi.mocked(getLocationForIp).mockReset();
    process.env.CONTACT_FROM_EMAIL = "contact@petertran.au";
    process.env.CONTACT_TO_EMAIL = "peter@example.com";
  });

  afterEach(() => {
    if (originalFrom === undefined) delete process.env.CONTACT_FROM_EMAIL;
    else process.env.CONTACT_FROM_EMAIL = originalFrom;
    if (originalTo === undefined) delete process.env.CONTACT_TO_EMAIL;
    else process.env.CONTACT_TO_EMAIL = originalTo;
  });

  it("does nothing when CONTACT_FROM_EMAIL is missing", async () => {
    delete process.env.CONTACT_FROM_EMAIL;

    await sendContactNotification(input, { receivedAt: new Date().toISOString() });

    expect(sesMock.calls()).toHaveLength(0);
  });

  it("does nothing when CONTACT_TO_EMAIL is missing", async () => {
    delete process.env.CONTACT_TO_EMAIL;

    await sendContactNotification(input, { receivedAt: new Date().toISOString() });

    expect(sesMock.calls()).toHaveLength(0);
  });

  it("sends an email with escaped HTML and a plain-text alternative", async () => {
    vi.mocked(getLocationForIp).mockResolvedValue("Sydney, NSW, Australia");
    sesMock.on(SendEmailCommand).resolves({ MessageId: "msg-1" });

    await sendContactNotification(input, {
      receivedAt: "2026-01-15T10:00:00.000Z",
      sourceIp: "1.2.3.4",
      userAgent: "TestAgent/1.0",
    });

    expect(sesMock.calls()).toHaveLength(1);

    const sent = sesMock.call(0).args[0].input as SendEmailCommand["input"];

    expect(sent.FromEmailAddress).toBe("petertran.au <contact@petertran.au>");
    expect(sent.Destination?.ToAddresses).toEqual(["peter@example.com"]);
    // Reply-to is the bare visitor address, not "Name <email>".
    expect(sent.ReplyToAddresses).toEqual(["ada@example.com"]);
    expect(sent.Content?.Simple?.Subject?.Data).toBe("New message from Ada <Lovelace> via petertran.au");

    const text = sent.Content?.Simple?.Body?.Text?.Data ?? "";
    expect(text).toContain("From: Ada <Lovelace> <ada@example.com>");
    expect(text).toContain("IP: 1.2.3.4");
    expect(text).toContain("Location: Sydney, NSW, Australia");
    expect(text).toContain("Device: TestAgent/1.0");
    // Plain text body is not escaped.
    expect(text).toContain('Hi & welcome\n"quoted" line');

    const html = sent.Content?.Simple?.Body?.Html?.Data ?? "";
    // Name and message are escaped in the HTML alternative.
    expect(html).toContain("&lt;Lovelace&gt;");
    expect(html).toContain("Hi &amp; welcome<br>&quot;quoted&quot; line");
    expect(html).toContain("IP: 1.2.3.4");
    expect(html).toContain("Location: Sydney, NSW, Australia");
  });

  it("falls back to 'unknown' for IP, user agent, and location when absent", async () => {
    vi.mocked(getLocationForIp).mockResolvedValue(null);
    sesMock.on(SendEmailCommand).resolves({ MessageId: "msg-2" });

    await sendContactNotification(input, { receivedAt: "2026-01-15T10:00:00.000Z" });

    const sent = sesMock.call(0).args[0].input as SendEmailCommand["input"];
    const text = sent.Content?.Simple?.Body?.Text?.Data ?? "";
    expect(text).toContain("IP: unknown");
    expect(text).toContain("Location: unknown");
    expect(text).toContain("Device: unknown");
    expect(getLocationForIp).toHaveBeenCalledWith(undefined);
  });

  it("formats the received time in AEST/AEDT", async () => {
    vi.mocked(getLocationForIp).mockResolvedValue(null);
    sesMock.on(SendEmailCommand).resolves({ MessageId: "msg-3" });

    await sendContactNotification(input, { receivedAt: "2026-01-15T10:00:00.000Z" });

    const sent = sesMock.call(0).args[0].input as SendEmailCommand["input"];
    const text = sent.Content?.Simple?.Body?.Text?.Data ?? "";
    expect(text).toMatch(/Received: .*AEST\/AEDT/);
  });
});
