import type { SitePhoto } from "./types";

export const LISTING_THUMB_CAP = 6;

const ROLE_ORDER = [
  "spare_land_annotated",
  "lot_aerial",
  "access_spare",
  "electrical",
  "listing",
] as const;

export const ROLE_LABEL: Record<string, string> = {
  spare_land_annotated: "Spare land",
  lot_aerial: "Aerial",
  access_spare: "Access",
  electrical: "Electrical",
  listing: "Listing",
  street_frontage: "Street View",
};

const FILE_ID = /^[A-Za-z0-9_-]{10,}$/;
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

export function driveFileId(photo: Pick<SitePhoto, "file_id" | "view_url">) {
  const explicit = text(photo.file_id);
  if (FILE_ID.test(explicit)) return explicit;
  const view = text(photo.view_url);
  const match = view.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || view.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  return match?.[1] || "";
}

export function withDriveSize(url: string, width: "w400" | "w1600") {
  if (/[?&]sz=w\d+/i.test(url)) return url.replace(/sz=w\d+/i, `sz=${width}`);
  if (url.includes("googleusercontent.com") && /=(?:w|s)\d+$/i.test(url)) {
    return url.replace(/=(?:w|s)\d+$/i, `=${width}`);
  }
  return url;
}

/** img src candidates. The stored view URL is first. Folder pages and stills are omitted. */
export function imageCandidates(photo: SitePhoto, size: "thumb" | "full"): string[] {
  if (photo.role === "street_frontage" || photo.visibility === "drive_only") return [];
  const width = size === "thumb" ? "w400" : "w1600";
  const urls: string[] = [];
  const add = (url: string) => {
    const value = text(url);
    if (!value || urls.includes(value) || !isDirectImageUrl(value)) return;
    urls.push(value);
  };
  const view = text(photo.view_url);
  if (view) add(withDriveSize(view, width));
  const id = driveFileId(photo);
  if (id) {
    add(`https://lh3.googleusercontent.com/d/${id}`);
    add(`https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=${width}`);
  }
  if (view) add(view);
  return urls;
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

export function photoStatusLine(status: string, diligenceCount: number | null, listingCount: number | null) {
  const label = text(status);
  if (label === "Deferred") return "Deferred";
  const known = label === "Complete" || label === "Partial";
  const bits: string[] = [];
  if (diligenceCount != null && (diligenceCount > 0 || known)) bits.push(`${diligenceCount} diligence`);
  if (listingCount != null && (listingCount > 0 || known)) bits.push(`${listingCount} listing`);
  const counts = bits.join(" · ");
  if (known) return counts ? `${label} / ${counts}` : label;
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
