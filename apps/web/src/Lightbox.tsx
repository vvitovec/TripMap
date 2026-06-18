import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect } from "react";
import { mediaFullUrl } from "./format";
import type { MediaItem } from "./types";

type Props = {
  items: MediaItem[];
  index: number;
  caption?: string;
  onClose: () => void;
  onIndex: (index: number) => void;
};

export function Lightbox({ items, index, caption, onClose, onIndex }: Props) {
  const current = items[index];
  const count = items.length;

  const go = useCallback(
    (delta: number) => {
      if (!count) return;
      onIndex((index + delta + count) % count);
    },
    [count, index, onIndex]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [go, onClose]);

  if (!current) return null;
  const url = mediaFullUrl(current);

  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lb-btn lb-close" onClick={onClose} aria-label="Close">
        <X size={20} />
      </button>

      {count > 1 && (
        <>
          <button
            className="lb-btn lb-nav prev"
            onClick={(event) => {
              event.stopPropagation();
              go(-1);
            }}
            aria-label="Previous"
          >
            <ChevronLeft size={24} />
          </button>
          <button
            className="lb-btn lb-nav next"
            onClick={(event) => {
              event.stopPropagation();
              go(1);
            }}
            aria-label="Next"
          >
            <ChevronRight size={24} />
          </button>
        </>
      )}

      <div className="lightbox-stage" onClick={(event) => event.stopPropagation()}>
        {current.kind === "video" ? (
          <video src={url} controls autoPlay playsInline key={current.id} />
        ) : (
          <img src={url} alt={caption ?? current.file_name} key={current.id} />
        )}
      </div>

      <div className="lightbox-bar" onClick={(event) => event.stopPropagation()}>
        <div className="lightbox-cap">
          {caption && <b>{caption}</b>}
          <span>{captureLabel(current)}</span>
        </div>
        {count > 1 && (
          <span className="lightbox-cap">
            {index + 1} / {count}
          </span>
        )}
      </div>
    </div>
  );
}

function captureLabel(item: MediaItem) {
  if (item.captured_at) {
    const date = new Date(item.captured_at);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    }
  }
  return item.file_name;
}
