import { useRef, useState } from "react";

interface Props {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

const SUPPORTED_FORMATS = [
  { label: "PDF", desc: "Vector & Raster", badgeClass: "fmt-badge--pdf" },
  { label: "DXF", desc: "AutoCAD 2D", badgeClass: "fmt-badge--dxf" },
  { label: "SVG", desc: "Vector CAD", badgeClass: "fmt-badge--svg" },
  { label: "PNG / JPG", desc: "Scanned Sheet", badgeClass: "fmt-badge--img" },
  { label: "TIFF", desc: "High-Res CAD", badgeClass: "fmt-badge--tiff" },
  { label: "STEP / IGES", desc: "3D CAD", badgeClass: "fmt-badge--3d" },
];

export function UploadDropzone({ onFilesSelected, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function openFileBrowser() {
    if (!disabled) inputRef.current?.click();
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    onFilesSelected(Array.from(fileList));
  }

  return (
    <div
      className={`cad-dropzone${isDragging ? " cad-dropzone--active" : ""}${disabled ? " cad-dropzone--disabled" : ""}`}
      onClick={openFileBrowser}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openFileBrowser();
        }
      }}
      aria-disabled={disabled}
    >
      <div className="cad-dropzone__icon-wrapper">
        <svg className="cad-dropzone__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M12 18v-6" />
          <path d="M9 15l3-3 3 3" />
        </svg>
      </div>

      <div className="cad-dropzone__content">
        <div className="cad-dropzone__title">
          <span className="cad-dropzone__action-text">Upload CAD Drawing Sheets</span>
          <span className="cad-dropzone__hint-text">Drag & drop files here or click to browse</span>
        </div>

        <div className="cad-dropzone__formats-list">
          {SUPPORTED_FORMATS.map((fmt) => (
            <span key={fmt.label} className={`fmt-badge ${fmt.badgeClass}`} title={fmt.desc}>
              {fmt.label}
            </span>
          ))}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        disabled={disabled}
        accept=".pdf,.dxf,.svg,.png,.jpg,.jpeg,.tiff,.tif,.step,.stp,.stl,.obj,.iges,.igs"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
