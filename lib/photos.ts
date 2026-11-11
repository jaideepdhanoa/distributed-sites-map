import type { SitePhoto } from "./types";

export const LISTING_THUMB_CAP = 6;

const ROLE_ORDER = [
  "spare_land_annotated",
  "lot_aerial",
  "access_spare",
  "building",
  "street_level",
  "electrical",
  "listing",
] as const;

export const ROLE_LABEL: Record<string, string> = {
  spare_land_annotated: "Spare land",
  lot_aerial: "Aerial",
  access_spare: "Access",
  building: "Building",
  street_level: "Street level",
  electrical: "Electrical",
  listing: "Listing",
  street_frontage: "Street View",
};

const STILL = /streetviewpixels|maps\/api\/streetview|streetview|ggpht\.com|geo\d\.ggpht/i;
const PANO_AT = /@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,[^/\s]*3a/i;

export type PhotoCarrier = {
  photos?: SitePhoto[] | null;
  photo_status?: string | null;
  photo_diligence_count?: number | null;
  photo_listing_count?: number | null;
  street_view_url?: string | null;
};

export type PhotoCard = {
  photos: SitePhoto[];
  status: string;
  diligenceCount: number | null;
  listingCount: number | null;
  frontageUrl: string;
};

export type GalleryModel = {
  visible: boolean;
  statusLine: string;
  showGallery: boolean;
  diligence: SitePhoto[];
  listingThumbs: SitePhoto[];
  hiddenListing: number;
  slides: SitePhoto[];
  frontageUrl: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isPanoUrl(url: string) {
  const value = text(url);
  if (!value.toLowerCase().startsWith("https://")) return false;
  let host = "";
  try {
    host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  if (host !== "google.com" && host !== "maps.google.com") return false;
  const lowered = value.toLowerCase();
  if (lowered.includes("map_action=pano") || lowered.includes("viewpoint=")) return true;
  if (lowered.includes("layer=c") && lowered.includes("cbll=")) return true;
  return PANO_AT.test(value);
}

export function isStreetViewStill(url: string) {
  return STILL.test(text(url));
}

export function isDirectImageUrl(url: string) {
  const value = text(url);
  if (!value.toLowerCase().startsWith("https://")) return false;
  if (isPanoUrl(value) || isStreetViewStill(value)) return false;
  const lowered = value.toLowerCase();
  if (lowered.includes("/drive/folders/") || lowered.includes("/file/d/")) return false;
  if (lowered.includes("drive.google.com/uc?") || lowered.includes("export=download") || lowered.includes("export=view")) {
    return false;
  }
  return true;
}

const LOCAL_PHOTO = /^\/api\/data\/photos\/[a-f0-9]{20}\.(?:jpe?g|png|webp|gif)$/;

export function isDriveHost(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host === "drive.google.com" || host === "docs.google.com" || host.endsWith("googleusercontent.com");
  } catch {
    return false;
  }
}

/** Same-origin cached image, or a non-Drive https image. Drive hosts sign the visitor out of the picture. */
export function imageCandidates(photo: SitePhoto, _size: "thumb" | "full"): string[] {
  if (photo.role === "street_frontage" || photo.visibility === "drive_only") return [];
  const view = text(photo.view_url);
  if (LOCAL_PHOTO.test(view)) return [view];
  if (view && isDirectImageUrl(view) && !isDriveHost(view)) return [view];
  return [];
}

export function viewpoint(url: string) {
  const value = text(url);
  const named = value.match(/viewpoint=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (named) return `${named[1]},${named[2]}`;
  const at = value.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return `${at[1]},${at[2]}`;
  const cbll = value.match(/cbll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (cbll) return `${cbll[1]},${cbll[2]}`;
  return "";
}

export function streetViewEmbedSrc(url: string) {
  const point = viewpoint(url);
  if (!point || !isPanoUrl(url)) return "";
  return `https://www.google.com/maps?layer=c&cbll=${point}&cbp=12,0,0,0,0&output=svembed`;
}

export function frontageUrl(photos: SitePhoto[] | null | undefined) {
  for (const photo of photos || []) {
    if (photo.visibility === "drive_only") continue;
    const url = text(photo.view_url);
    if (photo.role === "street_frontage" && isPanoUrl(url)) return url;
  }
  return "";
}

function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function orderedImages(photos: SitePhoto[]) {
  const rank = new Map<string, number>(ROLE_ORDER.map((role, index) => [role, index]));
  return photos
    .filter((photo) => photo.visibility !== "drive_only" && photo.role !== "street_frontage" && rank.has(photo.role))
    .filter((photo) => imageCandidates(photo, "full").length > 0)
    .map((photo, index) => ({ photo, index }))
    .sort((a, b) => (rank.get(a.photo.role) ?? 99) - (rank.get(b.photo.role) ?? 99) || a.index - b.index)
    .map((item) => item.photo);
}

function photoCount(count: number, kind: "site" | "listing") {
  return `${count} ${kind} photo${count === 1 ? "" : "s"}`;
}

/** Photo-set status: whether the expected photos are on file, then site photos and listing photos. */
export function photoStatusLine(status: string, diligenceCount: number | null, listingCount: number | null) {
  const label = text(status);
  if (label === "Deferred") return "Photo set: deferred";
  const known = label === "Complete" || label === "Partial";
  const bits: string[] = [];
  if (diligenceCount != null && (diligenceCount > 0 || known)) bits.push(photoCount(diligenceCount, "site"));
  if (listingCount != null && (listingCount > 0 || known)) bits.push(photoCount(listingCount, "listing"));
  const counts = bits.join(" · ");
  if (label === "Complete" || label === "Partial") {
    const word = label.toLowerCase();
    return counts ? `Photo set: ${word} · ${counts}` : `Photo set: ${word}`;
  }
  return counts;
}

export function cardPhotos(primary?: PhotoCarrier | null, secondary?: PhotoCarrier | null): PhotoCard {
  const primaryPhotos = primary?.photos || [];
  const photos = primaryPhotos.length ? primaryPhotos : secondary?.photos || [];
  const status = text(primary?.photo_status) || text(secondary?.photo_status);
  const diligenceCount = countOf(primary?.photo_diligence_count) ?? countOf(secondary?.photo_diligence_count);
  const listingCount = countOf(primary?.photo_listing_count) ?? countOf(secondary?.photo_listing_count);
  const deferred = status === "Deferred";
  return {
    photos: deferred ? [] : photos,
    status,
    diligenceCount,
    listingCount,
    frontageUrl: deferred ? "" : frontageUrl(photos),
  };
}

export function galleryModel(card: PhotoCard): GalleryModel {
  const statusLine = photoStatusLine(card.status, card.diligenceCount, card.listingCount);
  const deferred = card.status === "Deferred";
  const slides = deferred ? [] : orderedImages(card.photos);
  const diligence = slides.filter((photo) => photo.role !== "listing");
  const listing = slides.filter((photo) => photo.role === "listing");
  const listingThumbs = listing.slice(0, LISTING_THUMB_CAP);
  const frontage = deferred ? "" : card.frontageUrl;
  const showGallery = slides.length > 0;
  return {
    visible: Boolean(statusLine || showGallery || frontage),
    statusLine,
    showGallery,
    diligence,
    listingThumbs,
    hiddenListing: listing.length - listingThumbs.length,
    slides,
    frontageUrl: frontage,
  };
}

export function roleLabel(role: string) {
  return ROLE_LABEL[role] || "Photo";
}

export function esriCredit(photo: SitePhoto) {
  if (photo.source !== "esri_world_imagery") return "";
  return text(photo.attribution) || "Esri";
}
