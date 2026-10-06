/**
 * Lazily loads pdf.js from a CDN the first time a PDF actually needs to be
 * rendered, instead of bundling it into the app's main JS bundle — that
 * way people who never open a PDF never download it.
 *
 * pdf.js doesn't ship convenient TypeScript types for this classic
 * "global script" build, so the returned value is typed loosely (`any`).
 * That's a deliberate, contained exception — every other file in this
 * project is fully typed.
 */

const PDFJS_SCRIPT_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.min.js";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdfjsLib?: any;
  }
}

let loadPromise: Promise<Window["pdfjsLib"]> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

export function loadPdfJs(): Promise<Window["pdfjsLib"]> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    if (!window.pdfjsLib) {
      await loadScript(PDFJS_SCRIPT_URL);
    }
    if (!window.pdfjsLib) {
      throw new Error("pdf.js script loaded but window.pdfjsLib is missing");
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    return window.pdfjsLib;
  })();

  return loadPromise;
}
