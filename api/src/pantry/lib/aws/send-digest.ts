import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { captureAwsClient } from "api-shared/xray";
import { getSettings } from "../../services/settings";
import { getShoppingList, type ShoppingListEntry } from "../../services/shopping-list";

const ses = captureAwsClient(new SESv2Client({}));

// The schedule itself fires once an hour (see infra/lib/pantry-stack.ts) -
// the actual "what time" the user configured in Settings lives in app data,
// not infrastructure, so it can be changed without a redeploy. This just
// checks whether the current Sydney-local hour matches their choice.
function currentSydneyHour(): number {
  const hourPart = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "numeric",
    hour12: false,
  })
    .formatToParts(new Date())
    .find((p) => p.type === "hour")?.value;

  // ICU can format midnight as "24" with hour12: false - normalize back to 0.
  return Number(hourPart ?? "0") % 24;
}

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
  const amount =
    e.quantity != null
      ? ` <span style="color:#666;">(${escapeHtml(String(e.quantity))}${e.unit ? ` ${escapeHtml(e.unit)}` : ""})</span>`
      : "";
  const category = e.category
    ? ` <span style="color:#999; font-size:0.85em;">[${escapeHtml(e.category)}]</span>`
    : "";

  return `<li>${escapeHtml(e.name)}${amount}${category}</li>`;
}

// Triggered hourly by an EventBridge Scheduler schedule (see
// infra/lib/pantry-stack.ts) - a best-effort reminder, not a data path
// anything else depends on, so any failure here just means no email this
// hour rather than anything user-visible breaking. Whether it actually
// sends is gated by settings.digestEnabled/digestHour, checked below, so
// the user can turn it off or change the time from Pantry settings without
// a redeploy.
export async function sendShoppingListDigest(pk: string): Promise<void> {
  const from = process.env.CONTACT_FROM_EMAIL;
  const to = process.env.CONTACT_TO_EMAIL;
  if (!from || !to) {
    console.log("CONTACT_FROM_EMAIL/CONTACT_TO_EMAIL not configured - skipping digest.");

    return;
  }

  const settings = await getSettings(pk);
  if (!settings.digestEnabled) {
    console.log(`Digest email disabled in settings for pk="${pk}" - skipping.`);

    return;
  }

  const hour = currentSydneyHour();
  if (hour !== settings.digestHour) {
    console.log(
      `Not the configured digest hour (now ${hour}, configured ${settings.digestHour}) - skipping.`
    );

    return;
  }

  const entries = (await getShoppingList(pk)).filter((e) => e.urgent);
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
