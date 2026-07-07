import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { ContactInput } from "./contact";
import { getLocationForIp } from "./geoip";

const ses = new SESv2Client({});

const AEST_FORMATTER = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  dateStyle: "medium",
  timeStyle: "long",
});

export interface SubmissionMeta {
  receivedAt: string;
  sourceIp?: string;
  userAgent?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Best-effort notification, sent after the message is already durably stored
// in DynamoDB - a failure here should never turn a successful submission
// into an error for the visitor. Both addresses come from CDK env vars
// (contact@petertran.au, verified via the domain identity; the recipient is
// Peter's own inbox, verified separately since SES is still in sandbox mode).
export async function sendContactNotification(input: ContactInput, meta: SubmissionMeta): Promise<void> {
  const from = process.env.CONTACT_FROM_EMAIL;
  const to = process.env.CONTACT_TO_EMAIL;
  if (!from || !to) return;

  const { name, email, message } = input;
  const htmlMessage = escapeHtml(message).replace(/\n/g, "<br>");
  const receivedAtAest = `${AEST_FORMATTER.format(new Date(meta.receivedAt))} AEST/AEDT`;
  const sourceIp = meta.sourceIp ?? "unknown";
  const userAgent = meta.userAgent ?? "unknown";
  const location = (await getLocationForIp(meta.sourceIp)) ?? "unknown";

  const res = await ses.send(
    new SendEmailCommand({
      // A display name (rather than a bare address) and a proper HTML
      // alternative both read as more legitimate to spam filters than a
      // plain address with text-only content - on top of the DKIM/SPF/
      // MAIL FROM alignment already set up for the domain.
      FromEmailAddress: `petertran.au <${from}>`,
      Destination: { ToAddresses: [to] },
      // Kept as a bare address, not "Name <email>" - name is untrusted
      // visitor input and could contain characters (commas, angle brackets)
      // that break RFC 5322 address parsing if embedded there.
      ReplyToAddresses: [email],
      Content: {
        Simple: {
          Subject: { Data: `New message from ${name} via petertran.au` },
          Body: {
            Text: {
              Data: `From: ${name} <${email}>\nReceived: ${receivedAtAest}\nIP: ${sourceIp}\nLocation: ${location}\nDevice: ${userAgent}\n\n${message}`,
            },
            Html: {
              Data: `<!doctype html>
<html>
  <body style="font-family: -apple-system, sans-serif; color: #1a1a1a; max-width: 32rem; margin: 0 auto;">
    <p style="color: #666;">New message from the contact form on petertran.au</p>
    <p><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;</p>
    <p style="white-space: pre-wrap; border-left: 3px solid #ddd; padding-left: 1rem;">${htmlMessage}</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 1.5rem 0 1rem;">
    <p style="color: #999; font-size: 0.85em;">
      Received ${escapeHtml(receivedAtAest)}<br>
      IP: ${escapeHtml(sourceIp)}<br>
      Location: ${escapeHtml(location)}<br>
      Device: ${escapeHtml(userAgent)}
    </p>
  </body>
</html>`,
            },
          },
        },
      },
    })
  );
  console.log(`Contact notification sent, SES MessageId: ${res.MessageId}`);
}
