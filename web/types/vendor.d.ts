declare module "jsqr" {
  export type QRLocation = unknown;
  export type QRCode = { data: string; location?: QRLocation };
  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: unknown
  ): QRCode | null;
}

declare module "mssql";

