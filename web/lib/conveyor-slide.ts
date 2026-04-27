/**
 * Optional: after a QR is decoded, POST to a URL on your LAN/cloud so a
 * microcontroller or PLC can energize the "Category A" slide (solenoid, servo, etc.).
 *
 * Set CONVEYOR_SLIDE_WEBHOOK_URL (e.g. http://192.168.1.50/slide-a) on the Next.js host.
 */

const WEBHOOK_TIMEOUT_MS = 4000;

export function fireConveyorSlideWebhook(qrText: string, deviceId: string): void {
  const url = process.env.CONVEYOR_SLIDE_WEBHOOK_URL?.trim();
  if (!url) return;

  const needle = (process.env.CONVEYOR_SLIDE_TRIGGER_SUBSTRING ?? "Category A").trim();
  if (!needle) return;
  if (!qrText.toLowerCase().includes(needle.toLowerCase())) return;

  const secret = process.env.CONVEYOR_SLIDE_WEBHOOK_SECRET?.trim() ?? "";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), WEBHOOK_TIMEOUT_MS);

  void fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-slide-webhook-secret": secret } : {}),
    },
    body: JSON.stringify({
      event: "category_slide",
      deviceId,
      qrText,
      matchedSubstring: needle,
    }),
    signal: ac.signal,
  })
    .then((res) => {
      if (!res.ok) console.error("[conveyor-slide] webhook HTTP", res.status, url);
    })
    .catch((e) => console.error("[conveyor-slide] webhook failed:", e))
    .finally(() => clearTimeout(timer));
}
