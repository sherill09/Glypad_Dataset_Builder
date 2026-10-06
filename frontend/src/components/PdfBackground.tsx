import { useEffect, useRef, useState } from "react";

import { loadPdfJs } from "../lib/pdfjs";

interface Props {
  url: string;
  onReady: (size: { w: number; h: number }) => void;
  onError: () => void;
  onInfo?: (message: string) => void;
}

/**
 * Renders page 1 of a PDF using pdf.js.
 * Uses native vector SVG rendering (SVGGraphics) so that CAD drawings and vector sheets
 * retain infinite sharpness and mathematical precision at any zoom level without pixelation.
 * Falls back to a high-DPI canvas if SVG conversion is unsupported.
 */
export function PdfBackground({ url, onReady, onError, onInfo }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [useCanvas, setUseCanvas] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const pdfjsLib = await loadPdfJs();
        const pdf = await pdfjsLib.getDocument(url).promise;
        const page = await pdf.getPage(1);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = 2000 / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const naturalWidth = Math.max(1, Math.round(viewport.width));
        const naturalHeight = Math.max(1, Math.round(viewport.height));

        // Try native vector SVG rendering first for infinite zoom sharpness
        if (pdfjsLib.SVGGraphics && containerRef.current) {
          try {
            const opList = await page.getOperatorList();
            if (cancelled) return;
            const svgGfx = new pdfjsLib.SVGGraphics(page.commonObjs, page.objs);
            const svg = await svgGfx.getSVG(opList, viewport);
            if (cancelled) return;

            svg.setAttribute("width", "100%");
            svg.setAttribute("height", "100%");
            svg.style.display = "block";
            svg.style.width = "100%";
            svg.style.height = "100%";
            svg.style.background = "#ffffff";
            svg.style.pointerEvents = "none";

            if (containerRef.current) {
              containerRef.current.innerHTML = "";
              containerRef.current.appendChild(svg);
            }

            setLoading(false);
            onReady({ w: naturalWidth, h: naturalHeight });
            if (pdf.numPages > 1 && onInfo) {
              onInfo(`This PDF has ${pdf.numPages} pages — showing page 1 only.`);
            }
            return;
          } catch (svgErr) {
            console.warn("SVGGraphics render failed, falling back to high-DPI canvas:", svgErr);
          }
        }

        // High-DPI Canvas fallback
        setUseCanvas(true);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = naturalWidth;
        canvas.height = naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context unavailable");

        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        setLoading(false);
        onReady({ w: naturalWidth, h: naturalHeight });
        if (pdf.numPages > 1 && onInfo) {
          onInfo(`This PDF has ${pdf.numPages} pages — showing page 1 only.`);
        }
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
      {loading && <div className="stage-message">Loading PDF vector preview…</div>}
      <div ref={containerRef} className="pdf-vector-container" style={{ display: useCanvas ? "none" : "block", width: "100%", height: "100%" }} />
      {useCanvas && <canvas ref={canvasRef} />}
    </>
  );
}
