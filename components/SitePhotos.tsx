"use client";

import { useEffect, useRef, useState } from "react";
import { esriCredit, galleryModel, imageCandidates, roleLabel, streetViewEmbedSrc, type PhotoCard } from "@/lib/photos";
import type { SitePhoto } from "@/lib/types";

function altFor(photo: SitePhoto) {
  return photo.caption || roleLabel(photo.role);
}

function Frame({ photo, size }: { photo: SitePhoto; size: "thumb" | "full" }) {
  const sources = imageCandidates(photo, size);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const alt = altFor(photo);
  const src = sources[index] || "";
  if (!src) {
    return (
      <span className={`photo-fallback ${size}`}>
        <span>{alt}</span>
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      style={{ opacity: ready ? 1 : 0 }}
      onLoad={() => setReady(true)}
      onError={() => {
        setReady(false);
        setIndex((current) => current + 1);
      }}
    />
  );
}

function Thumb({ photo, onOpen }: { photo: SitePhoto; onOpen: () => void }) {
  const credit = esriCredit(photo);
  return (
    <figure className={photo.role === "listing" ? "listing" : "diligence"}>
      <button type="button" className="photo-shot" data-testid="photo-thumb" onClick={onOpen}>
        <Frame photo={photo} size="thumb" />
        <span className="photo-tag">{roleLabel(photo.role)}</span>
      </button>
      {credit ? <figcaption className="photo-credit" data-testid="photo-attribution">{credit}</figcaption> : null}
    </figure>
  );
}

export default function SitePhotos({ card }: { card: PhotoCard }) {
  const model = galleryModel(card);
  const [open, setOpen] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const embed = model.frontageUrl ? streetViewEmbedSrc(model.frontageUrl) : "";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open == null) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }, [open]);

  if (!model.visible) return null;
  const slide = open != null ? model.slides[open] : null;
  const slideCredit = slide ? (slide.attribution || esriCredit(slide)) : "";
  const both = model.diligence.length > 0 && (model.listingThumbs.length > 0 || model.hiddenListing > 0);

  function step(delta: number) {
    setOpen((current) => {
      if (current == null) return current;
      const next = current + delta;
      if (next < 0 || next >= model.slides.length) return current;
      return next;
    });
  }

  function openAt(photo: SitePhoto) {
    const index = model.slides.indexOf(photo);
    if (index >= 0) setOpen(index);
  }

  return (
    <section className="site-photos" data-testid="site-photos">
      {model.statusLine ? <p className="photo-status" data-testid="photo-status">{model.statusLine}</p> : null}
      {embed ? (
        <div className="street-frame">
          <span>Street View</span>
          <iframe
            title="Street View"
            data-testid="street-view-frame"
            src={embed}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        </div>
      ) : null}
      {model.showGallery ? (
        <>
          {model.diligence.length ? (
            <div className="photo-group">
              {both ? <h3>Diligence</h3> : null}
              <div className="photo-grid">
                {model.diligence.map((photo, index) => (
                  <Thumb key={`${photo.role}-${photo.file_id || photo.view_url}-${index}`} photo={photo} onOpen={() => openAt(photo)} />
                ))}
              </div>
            </div>
          ) : null}
          {model.listingThumbs.length || model.hiddenListing ? (
            <div className="photo-group listing">
              <h3>Listing</h3>
              <div className="photo-grid">
                {model.listingThumbs.map((photo, index) => (
                  <Thumb key={`${photo.role}-${photo.file_id || photo.view_url}-${index}`} photo={photo} onOpen={() => openAt(photo)} />
                ))}
                {model.hiddenListing > 0 ? (
                  <button
                    type="button"
                    className="photo-more"
                    data-testid="photo-more"
                    onClick={() => setOpen(model.diligence.length + model.listingThumbs.length)}
                  >
                    +{model.hiddenListing} more
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <dialog
            ref={dialogRef}
            className="photo-dialog"
            aria-label="Site photos"
            onClose={() => setOpen(null)}
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                step(1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                step(-1);
              }
            }}
          >
            {slide ? (
              <div className="photo-stage">
                <Frame key={`${slide.role}-${slide.file_id || slide.view_url}-full`} photo={slide} size="full" />
                <figcaption>
                  <span className={`photo-tag ${slide.role === "listing" ? "listing" : "diligence"}`}>{roleLabel(slide.role)}</span>
                  <p data-testid="photo-caption">{slide.caption || roleLabel(slide.role)}</p>
                  {slideCredit && slideCredit !== slide.caption ? <p className="photo-credit" data-testid="photo-attribution">{slideCredit}</p> : null}
                  <div className="photo-nav">
                    <button type="button" onClick={() => step(-1)} disabled={open === 0}>Previous</button>
                    <span>{(open ?? 0) + 1} of {model.slides.length}</span>
                    <button type="button" onClick={() => step(1)} disabled={open === model.slides.length - 1}>Next</button>
                    <button type="button" onClick={() => setOpen(null)}>Close</button>
                  </div>
                </figcaption>
              </div>
            ) : null}
          </dialog>
        </>
      ) : null}
    </section>
  );
}
