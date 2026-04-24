"use client";
import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import jsQR from 'jsqr';
import { useSearchParams } from 'next/navigation';

export default function DecoderPage() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = await loadImageFromFile(file);
    drawToCanvas(img);
    const data = readCanvasImageData();
    if (!data) return setResult('Failed to read image data');
    const qr = jsQR(data.data, data.width, data.height);
    setResult(qr ? qr.data : 'No QR found');
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    if (src) {
      (async () => {
        try {
          const res = await fetch(src);
          const js = await res.json();
          if (js && js.data) {
            const img = await loadImageFromURL(js.data);
            drawToCanvas(img);
            const data = readCanvasImageData();
            if (!data) return setResult('Failed to read image data');
            const qr = jsQR(data.data, data.width, data.height);
            setResult(qr ? qr.data : 'No QR found');
          }
        } catch (e) {
          setResult('Failed to load image');
        }
      })();
    }
  }, []);

  function loadImageFromURL(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = dataUrl;
    });
  }

  function loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = rej;
      img.src = url;
    });
  }

  function drawToCanvas(img: HTMLImageElement) {
    const c = canvasRef.current;
    if (!c) return;
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0,0,c.width,c.height);
    ctx.drawImage(img, 0, 0);
  }

  function readCanvasImageData(): ImageData | null {
    const c = canvasRef.current;
    if (!c) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  const handlePaste = async (ev: React.ClipboardEvent) => {
    const items = ev.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) {
          const img = await loadImageFromFile(file);
          drawToCanvas(img);
          const data = readCanvasImageData();
          if (!data) return setResult('Failed to read pasted image data');
          const qr = jsQR(data.data, data.width, data.height);
          setResult(qr ? qr.data : 'No QR found');
          return;
        }
      }
    }
  };

  return (
    <div style={{padding:20}} onPaste={handlePaste}>
      <h2>Client-side QR Decoder</h2>
      <p>Upload an image or paste an image into this page to decode a QR.</p>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} />
      <div style={{marginTop:12}}>
        <canvas ref={canvasRef} style={{maxWidth:'100%',border:'1px solid #ddd'}} />
      </div>
      <div style={{marginTop:12}}>
        <strong>Result:</strong>
        <div style={{marginTop:6, whiteSpace:'pre-wrap'}}>{result ?? 'No data yet'}</div>
      </div>
      <div style={{marginTop:12,color:'#666'}}>
        Tip: If the QR is small, try cropping it so it fills the image before uploading.
      </div>
    </div>
  );
}
