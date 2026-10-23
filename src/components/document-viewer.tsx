/* eslint-disable @next/next/no-img-element -- Private, session-bound originals must be fetched directly without an image optimizer. */
"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowSquareOutIcon, CaretLeftIcon, CaretRightIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon, FileTextIcon } from "@phosphor-icons/react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { DocumentRef } from "@/lib/contracts";
import { Busy, EmptyState } from "./care-ui";

export default function DocumentViewer({ document: original, initialPage = 1 }: { document: DocumentRef | null; initialPage?: number }) {
  const [page, setPage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const originalUrl = original?.url;
  const isPdf = original?.mimeType === "application/pdf";
  const isImage = original?.mimeType.startsWith("image/");

  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(entries => setStageWidth(entries[0].contentRect.width));
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [originalUrl]);

  useEffect(() => {
    if (!originalUrl) return;
    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    async function load() {
      try {
        if (isPdf) {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
          loadingTask = pdfjs.getDocument({ url: originalUrl!, withCredentials: true });
          const loadedPdf = await loadingTask.promise;
          if (!disposed) { setPdf(loadedPdf); setLoading(false); }
        } else if (!isImage) {
          const response = await fetch(originalUrl!, { cache: "no-store" });
          if (!response.ok) throw new Error("Não foi possível abrir o documento.");
          const value = await response.text();
          if (!disposed) { setText(value); setLoading(false); }
        } else if (!disposed) setLoading(false);
      } catch {
        if (!disposed) { setError("Não foi possível abrir o documento. Tente abrir o arquivo abaixo."); setLoading(false); }
      }
    }
    void load();
    return () => { disposed = true; void loadingTask?.destroy(); };
  }, [originalUrl, isPdf, isImage]);

  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let stopped = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    async function render() {
      try {
        const pdfPage = await pdf!.getPage(Math.min(page, pdf!.numPages));
        if (stopped || !canvas.current) return;
        const originalSize = pdfPage.getViewport({ scale: 1 });
        const fitScale = stageWidth > 0 ? Math.max(100, stageWidth - 24) / originalSize.width : 1;
        const viewport = pdfPage.getViewport({ scale: fitScale * zoom });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const target = canvas.current;
        target.height = viewport.height * ratio;
        target.width = viewport.width * ratio;
        target.style.width = `${viewport.width}px`;
        target.style.height = `${viewport.height}px`;
        renderTask = pdfPage.render({ canvas: target, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        await renderTask.promise;
      } catch {
        if (!stopped) setError("Não foi possível mostrar esta página. Tente abrir o arquivo abaixo.");
      }
    }
    void render();
    return () => { stopped = true; renderTask?.cancel(); };
  }, [pdf, page, zoom, stageWidth]);

  if (!original) return <EmptyState icon={<FileTextIcon size={30} />} title="Orientação adicionada à mão">Confira o texto que você informou.</EmptyState>;
  return <section className="document-viewer" data-parity-anchor="source-original" aria-label="Documento original">
    <div className="document-toolbar"><span><FileTextIcon size={20} /> <strong>{original.name}</strong></span><a className="icon-button" href={original.url} target="_blank" rel="noreferrer" aria-label="Abrir original em nova aba"><ArrowSquareOutIcon size={21} /></a></div>
    <div className="document-controls" data-parity-anchor="source-controls">
      {isPdf && <div className="inline-controls"><button type="button" className="icon-button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(page - 1)}><CaretLeftIcon size={20} /></button><span>Página {page} de {pdf?.numPages ?? original.pageCount ?? "…"}</span><button type="button" className="icon-button" aria-label="Próxima página" disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(page + 1)}><CaretRightIcon size={20} /></button></div>}
      <div className="inline-controls"><button type="button" className="icon-button" aria-label="Diminuir zoom" disabled={zoom <= .6} onClick={() => setZoom(Math.max(.6, zoom - .2))}><MagnifyingGlassMinusIcon size={20} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" className="icon-button" aria-label="Ampliar documento" disabled={zoom >= 2.4} onClick={() => setZoom(Math.min(2.4, zoom + .2))}><MagnifyingGlassPlusIcon size={20} /></button></div>
    </div>
    {error && <p className="error-message" role="alert">{error} <a href={original.url} target="_blank" rel="noreferrer">Abrir arquivo</a></p>}
    <div className="document-stage" ref={stage}>{loading && <p className="loading-line"><Busy>Abrindo documento…</Busy></p>}{isPdf ? <canvas ref={canvas} aria-label={`Página ${page} do documento original`} /> : isImage ? <img src={original.url} alt="Documento original enviado para revisão" style={{ width: `${zoom * 100}%`, maxWidth: "none" }} onError={() => setError("Não foi possível abrir a imagem.")} /> : <pre style={{ fontSize: `${zoom}rem` }}>{text}</pre>}</div>
  </section>;
}
