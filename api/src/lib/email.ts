import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { ContactInput } from "./contact";

const ses = new SESv2Client({});

// Best-effort notification, sent after the message is already durably stored
// in DynamoDB -- a failure here should never turn a successful submission
// into an error for the visitor. Both addresses come from CDK env vars
// (contact@petertran.au, verified via the domain identity; the recipient is
// Peter's own inbox, verified separately since SES is still in sandbox mode).
export async function sendContactNotification(input: ContactInput): Promise<void> {
  const from = process.env.CONTACT_FROM_EMAIL;
  const to = process.env.CONTACT_TO_EMAIL;
  if (!from || !to) return;

  const res = await ses.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      ReplyToAddresses: [input.email],
      Content: {
        Simple: {
          Subject: { Data: `New message from ${input.name} via petertran.au` },
          Body: {
            Text: { Data: `From: ${input.name} <${input.email}>\n\n${input.message}` },
          },
        },
      },
    })
  );
  console.log(`Contact notification sent, SES MessageId: ${res.MessageId}`);
}
