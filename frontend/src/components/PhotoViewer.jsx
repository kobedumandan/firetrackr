import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "../styles/PhotoViewer.css";

/* Full-screen scene-photo lightbox: counter + caption up top, prev/next,
   a thumbnail strip to jump around, Esc / ← / → from the keyboard. */
export default function PhotoViewer({ photos, index, onIndexChange, onClose, caption }) {
  const viewerRef = useRef(null);
  const count = photos.length;
  const go = (delta) => onIndexChange((index + delta + count) % count);

  useEffect(() => {
    const previous = document.activeElement;
    viewerRef.current?.querySelector('[aria-label="Close viewer"]')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Tab") {
        const controls = [...viewerRef.current.querySelectorAll('button, a[href]')];
        const first = controls[0], last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && count > 1) onIndexChange((index - 1 + count) % count);
      else if (e.key === "ArrowRight" && count > 1) onIndexChange((index + 1) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, onClose, onIndexChange]);

  return createPortal(
    <div
      className="idp-viewer"
      ref={viewerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Scene photo ${index + 1} of ${count}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="idp-viewer-bar">
        <div className="idp-viewer-meta">
          <span className="idp-viewer-count">
            Photo {index + 1} <span>of {count}</span>
          </span>
          {caption && <span className="idp-viewer-caption">{caption}</span>}
        </div>
        <div className="idp-viewer-tools">
          <a
            className="idp-viewer-btn"
            href={photos[index]}
            target="_blank"
            rel="noreferrer"
            title="Open full size in a new tab"
            aria-label="Open full size in a new tab"
          >
            <span className="material-symbols-outlined">open_in_new</span>
          </a>
          <button type="button" className="idp-viewer-btn" onClick={onClose} aria-label="Close viewer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>

      <div className="idp-viewer-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {count > 1 && (
          <button type="button" className="idp-viewer-btn idp-viewer-nav prev" onClick={() => go(-1)} aria-label="Previous photo">
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
        )}
        <img key={photos[index]} className="idp-viewer-img" src={photos[index]} alt={`Scene photo ${index + 1}`} />
        {count > 1 && (
          <button type="button" className="idp-viewer-btn idp-viewer-nav next" onClick={() => go(1)} aria-label="Next photo">
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        )}
      </div>

      {count > 1 && (
        <div className="idp-viewer-strip" role="tablist" aria-label="All photos">
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Photo ${i + 1}`}
              className={`idp-viewer-thumb${i === index ? " active" : ""}`}
              onClick={() => onIndexChange(i)}
            >
              <img src={url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}
