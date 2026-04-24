// Compatibility shim for TypeScript/lib type differences
// Some @types/node / lib combinations reference `NonSharedArrayBufferView` which
// may not exist in the active TypeScript lib set used by VS Code. This file
// provides a minimal alias to keep the project compiling in editors.

type NonSharedArrayBufferView = ArrayBufferView;

declare module 'jsqr' {
  export interface QRCode {
    data: string;
    version: number;
    location: {
      corners: { x: number; y: number }[];
      topLeftCorner: { x: number; y: number };
      topRightCorner: { x: number; y: number };
      bottomLeftCorner: { x: number; y: number };
      bottomRightCorner: { x: number; y: number };
      topLeftFinderPattern: { x: number; y: number };
      topRightFinderPattern: { x: number; y: number };
      bottomLeftFinderPattern: { x: number; y: number };
    };
  }

  export interface JsQROptions {
    inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth';
  }

  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: JsQROptions
  ): QRCode | null;
}

export {};
