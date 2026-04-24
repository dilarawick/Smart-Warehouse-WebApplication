export type LastCapture = {
  imageBase64: string;
  deviceId: string;
  updatedAt: string;
  status: "decoded" | "no_qr";
  qrText?: string;
};

const MAX_JPEG_BYTES = 900_000;

let lastCapture: LastCapture | undefined;

export function setLastCaptureFromJpeg(
  opts: { jpegBuffer: Buffer; deviceId: string; status: "decoded" | "no_qr"; qrText?: string }
) {
  const buf = opts.jpegBuffer.length > MAX_JPEG_BYTES ? opts.jpegBuffer.subarray(0, MAX_JPEG_BYTES) : opts.jpegBuffer;
  lastCapture = {
    imageBase64: buf.toString("base64"),
    deviceId: opts.deviceId,
    updatedAt: new Date().toISOString(),
    status: opts.status,
    qrText: opts.qrText,
  };
}

export function getLastCapture(): LastCapture | undefined {
  return lastCapture;
}
