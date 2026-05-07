import { getLastCapture } from "../../../../lib/last-capture";

export const runtime = "nodejs";

export async function GET() {
  const c = getLastCapture();
  if (!c) {
    return Response.json(
      { image: null, deviceId: null, updatedAt: null, status: null, qrText: null },
      { status: 200 }
    );
  }
  return Response.json(
    {
      image: `data:image/jpeg;base64,${c.imageBase64}`,
      deviceId: c.deviceId,
      updatedAt: c.updatedAt,
      status: c.status,
      qrText: c.qrText ?? null,
    },
    { status: 200 }
  );
}