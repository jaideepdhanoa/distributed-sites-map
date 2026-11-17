import { gmailHref } from "@/lib/comms";
import { withoutGmail } from "@/lib/displayText";

/** Parent program folders. A source link never points at either of them. */
const BLOCKED_IDS = new Set([
  "1_oIqMjBJqOj-WApM7xOUz1EWydW3Fydk",
  "11ONFb99evERFObom8lf_Qq81onW50WBw",
]);
const FILE_ID = /^[A-Za-z0-9_-]{20,80}$/;
const FILE_EXT = /\.(pdf|xlsx|xls|csv|docx|doc|png|jpe?g|tiff?|txt)$/i;
const HEX_ID = /\b[0-9a-f]{16}\b/i;
const GMAIL_URL = /mail\.google\.com|gmail\.com/i;
const EMAIL_LABEL = /^(?:e-?mail|gmail)\b/i;

export type DriveFile = { id: string; name: string; mime: string };

export type SourceView = {
  kind: "file" | "email" | "text";
  label: string;
  /** A Drive file URL, or empty. Never a folder, a parent folder, or a Gmail URL. */
  href: string;
  /** `p. N` when the page is a number. */
  pageAside: string;
  /** A non-numeric page note, such as a month name. */
  pageNote: string;
  /** Open in Gmail, only when the caller already decided the viewer may see it. */
  gmailHref: string;
};

export function isSafeFileId(id: string): boolean {
  return FILE_ID.test(id) && !BLOCKED_IDS.has(id);
}

/** Site folder id from a Drive folder URL. A parent program folder yields nothing. */
export function siteFolderId(url: string | null | undefined): string {
  const match = /\/folders\/([A-Za-z0-9_-]+)/.exec(String(url || ""));
  const id = match?.[1] || "";
  return isSafeFileId(id) ? id : "";
}

/** File id from a Drive or Docs file URL. Folder URLs yield nothing. */
export function driveFileIdFromHref(href: string): string {
  const text = href.trim();
  if (!text.startsWith("https://")) return "";
  if (/\/folders\//.test(text)) return "";
  const path = text.match(/https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/)
    || text.match(/https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]+)/);
  let id = path?.[1] || "";
  if (!id) {
    try {
      const url = new URL(text);
      const host = url.hostname;
      if (host === "drive.google.com" || host === "docs.google.com") id = url.searchParams.get("id") || "";
    } catch {
      return "";
    }
  }
  return isSafeFileId(id) ? id : "";
}

export function bareFileId(document: string): string {
  const text = document.trim();
  if (!isSafeFileId(text) || !/\d/.test(text) || FILE_EXT.test(text)) return "";
  return text;
}

export function fileNameOf(document: string): string {
  const text = document.trim();
  if (!text || text.length > 180) return "";
  if (text.includes("/") || text.includes("\\") || text.includes("\n")) return "";
  if (!FILE_EXT.test(text)) return "";
  if (HEX_ID.test(text) || GMAIL_URL.test(text)) return "";
  return text;
}

export function normalizeFileName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** One exact name match. Two files with the same name is not a link. */
export function matchDriveFile(files: DriveFile[], filename: string): DriveFile | null {
  const wanted = normalizeFileName(filename);
  if (!wanted) return null;
  const hits = files.filter((file) => isSafeFileId(file.id) && normalizeFileName(file.name) === wanted);
  return hits.length === 1 ? hits[0] : null;
}

export function pageNumber(page: string): number | null {
  const text = page.trim();
  const match = /^(?:p\.?|page)\s*(\d{1,4})$/i.exec(text) || /^(\d{1,4})$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < 1 || value > 9999) return null;
  return value;
}

export function isEmailCitation(document: string, href: string, page: string): boolean {
  if (GMAIL_URL.test(href)) return true;
  const blob = `${document} ${page}`;
  if (HEX_ID.test(blob)) return true;
  return EMAIL_LABEL.test(document.trim());
}

function messageId(value: string): string {
  const labeled = value.match(/#(?:inbox|all|sent|search)\/([0-9a-f]{16})\b/i);
  if (labeled) return labeled[1].toLowerCase();
  const bare = value.match(/\b([0-9a-f]{16})\b/i);
  return bare ? bare[1].toLowerCase() : "";
}

/** A Gmail URL for a viewer who may see one. Everyone else gets an empty string. */
export function gmailLinkFor(document: string, href: string, page: string, allowed: boolean): string {
  if (!allowed || !isEmailCitation(document, href, page)) return "";
  const link = gmailHref(href, messageId(href) || messageId(document) || messageId(page), "");
  if (!link.startsWith("https://mail.google.com/")) return "";
  if (link.includes("@") || /authuser=/i.test(link)) return "";
  return link;
}

function emailLabel(document: string, capturedLabel: string): string {
  const existing = document.trim();
  if (/^Email,/i.test(existing) && !HEX_ID.test(existing) && !GMAIL_URL.test(existing)) return existing;
  return capturedLabel ? `Email, ${capturedLabel}` : "Email";
}

function safePageNote(page: string): string {
  const text = page.trim();
  if (!text || HEX_ID.test(text) || GMAIL_URL.test(text)) return "";
  return text;
}

function isPdf(label: string, mime: string, href: string): boolean {
  if (mime === "application/pdf") return true;
  if (/\.pdf$/i.test(label)) return true;
  return /\/preview(?:#|$)/.test(href);
}

/** Opens the file in Drive. PDFs use the preview URL so `#page=N` is honored. */
export function driveFileHref(fileId: string, options: { pdf: boolean; page: number | null; original?: string }): string {
  if (!isSafeFileId(fileId)) return "";
  if (options.pdf) {
    const base = `https://drive.google.com/file/d/${fileId}/preview`;
    return options.page ? `${base}#page=${options.page}` : base;
  }
  const original = options.original || "";
  const docs = original.match(/^https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[A-Za-z0-9_-]+/);
  if (docs && driveFileIdFromHref(original) === fileId) return docs[0];
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export function sourceView(input: {
  document: string;
  page: string;
  href: string;
  capturedLabel: string;
  fileId?: string;
  mime?: string;
  gmailHref?: string;
}): SourceView {
  const document = input.document || "";
  const page = input.page || "";
  const href = input.href || "";
  const fromHref = driveFileIdFromHref(href);
  const passed = input.fileId && isSafeFileId(input.fileId) ? input.fileId : "";
  const fromDoc = bareFileId(document);
  const id = fromHref || passed || fromDoc;
  const numeric = pageNumber(page);
  const pageAside = numeric ? `p. ${numeric}` : "";
  const pageNote = numeric ? "" : safePageNote(page);
  if (!id && isEmailCitation(document, href, page)) {
    const gmail = input.gmailHref && input.gmailHref.startsWith("https://mail.google.com/") && !input.gmailHref.includes("@") && !/authuser=/i.test(input.gmailHref)
      ? input.gmailHref
      : "";
    return { kind: "email", label: emailLabel(document, input.capturedLabel), href: "", pageAside: "", pageNote: "", gmailHref: gmail };
  }
  if (!id) {
    const label = withoutGmail(document) || document.trim();
    return { kind: "text", label, href: "", pageAside, pageNote, gmailHref: "" };
  }
  let label = document.trim();
  if (!label || label === id || bareFileId(label) === id) label = "Source file";
  else label = withoutGmail(label) || "Source file";
  const pdf = isPdf(label, input.mime || "", href);
  return {
    kind: "file",
    label,
    href: driveFileHref(id, { pdf, page: pdf ? numeric : null, original: href }),
    pageAside,
    pageNote,
    gmailHref: "",
  };
}
