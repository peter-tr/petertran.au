import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { getShoppingList, type ShoppingListEntry } from "../../resolvers/resolvers";

const ses = new SESv2Client({});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatEntryText(e: ShoppingListEntry): string {
  const amount = e.quantity != null ? ` (${e.quantity}${e.unit ? ` ${e.unit}` : ""})` : "";
  const category = e.category ? ` [${e.category}]` : "";
  return `- ${e.name}${amount}${category}`;
}

function formatEntryHtml(e: ShoppingListEntry): string {
  const amount = e.quantity != null ? ` <span style="color:#666;">(${escapeHtml(String(e.quantity))}${e.unit ? ` ${escapeHtml(e.unit)}` : ""})</span>` : "";
  const category = e.category
    ? ` <span style="color:#999; font-size:0.85em;">[${escapeHtml(e.category)}]</span>`
    : "";
  return `<li>${escapeHtml(e.name)}${amount}${category}</li>`;
}

// Triggered daily at 4pm Australia/Sydney by an EventBridge Scheduler
// schedule (see infra/lib/pantry-stack.ts) - a best-effort reminder, not a
// data path anything else depends on, so any failure here just means no
// email today rather than anything user-visible breaking.
export async function sendShoppingListDigest(): Promise<void> {
  const from = process.env.CONTACT_FROM_EMAIL;
  const to = process.env.CONTACT_TO_EMAIL;
  if (!from || !to) {
    console.log("CONTACT_FROM_EMAIL/CONTACT_TO_EMAIL not configured - skipping digest.");
    return;
  }

  const entries = (await getShoppingList()).filter((e) => e.urgent);
  if (entries.length === 0) {
    console.log("No urgent shopping list items - skipping digest.");
    return;
  }

  const res = await ses.send(
    new SendEmailCommand({
      FromEmailAddress: `petertran.au Pantry <${from}>`,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: {
            Data: `Pantry: ${entries.length} urgent item${entries.length > 1 ? "s" : ""} to buy`,
          },
          Body: {
            Text: {
              Data: `Urgent shopping list items:\n\n${entries.map(formatEntryText).join("\n")}`,
            },
            Html: {
              Data: `<!doctype html>
<html>
  <body style="font-family: -apple-system, sans-serif; color: #1a1a1a; max-width: 32rem; margin: 0 auto;">
    <p style="color: #666;">Urgent items on your pantry shopping list:</p>
    <ul style="line-height: 1.8;">
      ${entries.map(formatEntryHtml).join("\n      ")}
    </ul>
    <hr style="border: none; border-top: 1px solid #eee; margin: 1.5rem 0 1rem;">
    <p style="color: #999; font-size: 0.85em;">Daily digest from petertran.au/pantry.</p>
  </body>
</html>`,
            },
          },
        },
      },
    })
  );
  console.log(`Shopping list digest sent, SES MessageId: ${res.MessageId}`);
}
