import { useEffect, useRef, useState } from "react";

import { parseDXFToPrimitives, renderDxfOntoCanvas } from "../lib/dxf";

interface Props {
  url: string;
  onReady: (size: { w: number; h: number }) => void;
  onError: () => void;
}

/**
 * Fetches a DXF file's text, parses it, and draws it onto a canvas — see
 * app/services/classification.py on the backend and src/lib/dxf.ts here
 * for the (best-effort) rules this understands.
 */
export function DxfBackground({ url, onReady, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Could not fetch DXF file");
        const text = await response.text();
        const primitives = parseDXFToPrimitives(text);

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const size = renderDxfOntoCanvas(canvas, primitives);
        if (!size) throw new Error("Nothing drawable found in this DXF");

        setLoading(false);
        onReady(size);
      } catch {
        if (!cancelled) onError();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <>
      {loading && <div className="stage-message">Loading DXF preview…</div>}
      <canvas ref={canvasRef} />
    </>
  );
}
