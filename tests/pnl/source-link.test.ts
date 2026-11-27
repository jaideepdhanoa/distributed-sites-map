import assert from "node:assert/strict";
import test from "node:test";
import { parseAmount } from "../../lib/pnl/money.ts";
import { attachPnlSourceLinks } from "../../lib/pnl/attachSources.ts";
import { clearDriveFileCache, resolveFileNames, serviceDriveLister, type DriveLister } from "../../lib/pnl/driveFiles.ts";
import {
  driveFileIdFromHref,
  fileNameOf,
  matchDriveFile,
  NO_DRIVE_LINK,
  pageNumber,
  siteFolderId,
  sourceView,
} from "../../lib/pnl/sourceLink.ts";
import { buildStatement, type CapturedLine } from "../../lib/pnl/statement.ts";

const PARENT = "1_oIqMjBJqOj-WApM7xOUz1EWydW3Fydk";
const FILE = "FixtureDriveFileId0000000001";
const PDF = "FixturePdfFileId000000000001";
const SHEET = "FixtureSheetFileId0000000001";
const SITE = "FixtureSiteFolderId00000001";
const SOURCE = "FixtureSourceFolderId000001";
const FIN = "FixtureFinFolderId000000001";
const EMAIL_FOLDER = "FixtureEmailFolderId0000001";
const HEX = "0123456789abcdef";

function driveId(value: string): string {
  assert.equal(/^[A-Za-z0-9_-]{20,80}$/.test(value), true);
  return value;
}

function captured(partial: { id: string; sourceDocument: string; sourcePage: string; sourceHref?: string; code?: CapturedLine["code"] }): CapturedLine {
  const amount = parseAmount("10000");
  if (!amount) throw new Error("sample amount");
  return {
    id: partial.id,
    periodId: "PP-1",
    grain: "monthly",
    year: 2024,
    month: 1,
    throughMonth: null,
    business: "car_wash",
    code: partial.code || "labor",
    amount,
    status: "reported",
    sourceDocument: partial.sourceDocument,
    sourcePage: partial.sourcePage,
    sourceHref: partial.sourceHref || "",
    capturedAt: "2026-03-01T15:00:00Z",
  };
}

test("a stored Drive file id becomes a file link and a folder link does not", () => {
  driveId(FILE);
  const stored = sourceView({
    document: "Sample package",
    page: "Jan",
    href: `https://drive.google.com/file/d/${FILE}/view`,
    capturedLabel: "Mar 1, 2026",
  });
  assert.equal(stored.kind, "file");
  assert.equal(stored.label, "Sample package");
  assert.equal(stored.href, `https://drive.google.com/file/d/${FILE}/view`);
  assert.equal(stored.pageNote, "Jan");
  assert.equal(stored.pageAside, "");
  assert.equal(stored.href.includes("/folders/"), false);

  const bare = sourceView({
    document: FILE,
    page: "3",
    href: "",
    capturedLabel: "",
    mime: "application/pdf",
  });
  assert.equal(bare.label, "Source file");
  assert.equal(bare.label.includes(FILE), false);
  assert.equal(bare.href, `https://drive.google.com/file/d/${FILE}/preview#page=3`);

  const folder = sourceView({
    document: "Sample package",
    page: "",
    href: `https://drive.google.com/drive/folders/${PARENT}`,
    capturedLabel: "",
  });
  assert.equal(folder.href, "");
  assert.equal(folder.kind, "text");
  assert.equal(siteFolderId(`https://drive.google.com/drive/folders/${PARENT}`), "");
  assert.equal(siteFolderId(`https://drive.google.com/drive/folders/${SITE}`), SITE);
  assert.equal(driveFileIdFromHref(`https://drive.google.com/drive/folders/${SITE}`), "");
  assert.equal(fileNameOf("Sample package"), "");
  assert.equal(fileNameOf("Sample-statement.pdf"), "Sample-statement.pdf");
});

test("a pdf page is in the preview link and any other file shows p. N beside it", () => {
  assert.equal(pageNumber("4"), 4);
  assert.equal(pageNumber("p. 12"), 12);
  assert.equal(pageNumber("page 3"), 3);
  assert.equal(pageNumber("Jan"), null);
  assert.equal(pageNumber("Sheet 4"), null);
  const pdf = sourceView({
    document: "Sample-statement.pdf",
    page: "4",
    href: "",
    capturedLabel: "",
    fileId: PDF,
    mime: "application/pdf",
  });
  assert.equal(pdf.href, `https://drive.google.com/file/d/${PDF}/preview#page=4`);
  assert.equal(pdf.pageAside, "p. 4");
  const sheet = sourceView({
    document: "Sample-book.xlsx",
    page: "p. 2",
    href: "",
    capturedLabel: "",
    fileId: SHEET,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  assert.equal(sheet.href, `https://drive.google.com/file/d/${SHEET}/view`);
  assert.equal(sheet.href.includes("#page="), false);
  assert.equal(sheet.pageAside, "p. 2");
  const again = sourceView({
    document: pdf.label,
    page: "4",
    href: pdf.href,
    capturedLabel: "",
    mime: "application/pdf",
  });
  assert.equal(again.href, pdf.href);
  assert.equal(again.label, pdf.label);
});

test("an email citation shows Email and a date, and Open in Gmail only when allowed", () => {
  const hidden = sourceView({
    document: `Gmail message ${HEX}`,
    page: HEX,
    href: `https://mail.google.com/mail/u/0/#inbox/${HEX}`,
    capturedLabel: "Mar 1, 2026",
    gmailHref: "",
  });
  assert.equal(hidden.kind, "email");
  assert.equal(hidden.label, "Email, Mar 1, 2026");
  assert.equal(hidden.href, "");
  assert.equal(hidden.gmailHref, "");
  assert.equal(hidden.pageNote, "");
  assert.equal(JSON.stringify({ label: hidden.label, href: hidden.href }).includes(HEX), false);
  assert.equal(JSON.stringify({ label: hidden.label, href: hidden.href }).includes("mail.google.com"), false);

  const shown = sourceView({
    document: `Email ${HEX}`,
    page: "",
    href: "",
    capturedLabel: "Mar 1, 2026",
    gmailHref: `https://mail.google.com/mail/u/0/#inbox/${HEX}`,
  });
  assert.equal(shown.label, "Email, Mar 1, 2026");
  assert.equal(shown.href, "");
  assert.equal(shown.gmailHref.startsWith("https://mail.google.com/"), true);
  assert.equal(shown.label.includes(HEX), false);
  const repeat = sourceView({
    document: shown.label,
    page: "",
    href: shown.href,
    capturedLabel: "Mar 1, 2026",
    gmailHref: shown.gmailHref,
  });
  assert.equal(repeat.label, shown.label);
  assert.equal(repeat.gmailHref, shown.gmailHref);
});

function lister(tree: Record<string, { id: string; name: string; mimeType: string }[]>): DriveLister & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async listChildren(folderId: string) {
      asked.push(folderId);
      return tree[folderId] || [];
    },
  };
}

test("a filename resolves inside the site folder, and a parent or a tie does not", { concurrency: false }, async () => {
  clearDriveFileCache();
  driveId(SITE);
  driveId(PDF);
  const files = lister({
    [SITE]: [
      { id: SOURCE, name: "Source files", mimeType: "application/vnd.google-apps.folder" },
    ],
    [SOURCE]: [
      { id: FIN, name: "1 Financials", mimeType: "application/vnd.google-apps.folder" },
      { id: EMAIL_FOLDER, name: "4 Emails and calls", mimeType: "application/vnd.google-apps.folder" },
    ],
    [FIN]: [
      { id: PDF, name: "Sample-statement.pdf", mimeType: "application/pdf" },
      { id: SHEET, name: "Sample-book.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    ],
    [EMAIL_FOLDER]: [
      { id: "FixtureHiddenFileId00000001", name: "Sample-statement.pdf", mimeType: "application/pdf" },
    ],
  });
  const found = await resolveFileNames(SITE, ["Sample-statement.pdf", "Sample-book.xlsx", "Missing-note.pdf"], files);
  assert.deepEqual(found.get("sample-statement.pdf"), { id: PDF, mime: "application/pdf" });
  assert.equal(found.get("sample-book.xlsx")?.id, SHEET);
  assert.equal(found.get("missing-note.pdf"), null);
  assert.equal(files.asked.includes(EMAIL_FOLDER), false);
  assert.equal(files.asked.includes(PARENT), false);
  const again = await resolveFileNames(SITE, ["Sample-statement.pdf"], files);
  assert.equal(again.get("sample-statement.pdf")?.id, PDF);
  assert.equal(files.asked.filter((id) => id === SITE).length, 1);

  clearDriveFileCache();
  const tied = lister({
    [SITE]: [
      { id: PDF, name: "Sample-statement.pdf", mimeType: "application/pdf" },
      { id: SHEET, name: "Sample-statement.pdf", mimeType: "application/pdf" },
    ],
  });
  const tie = await resolveFileNames(SITE, ["Sample-statement.pdf"], tied);
  assert.equal(tie.get("sample-statement.pdf"), null);
  assert.equal(matchDriveFile([
    { id: PDF, name: "Sample-statement.pdf", mime: "application/pdf" },
    { id: SHEET, name: "Sample-statement.pdf", mime: "application/pdf" },
  ], "Sample-statement.pdf"), null);

  const blocked = lister({});
  const parent = await resolveFileNames(PARENT, ["Sample-statement.pdf"], blocked);
  assert.equal(parent.get("sample-statement.pdf"), null);
  assert.deepEqual(blocked.asked, []);
});

test("lines keep a stored file id, and a filename link never uses the parent folder", { concurrency: false }, async () => {
  clearDriveFileCache();
  const files = lister({
    [SITE]: [
      { id: PDF, name: "Sample-statement.pdf", mimeType: "application/pdf" },
    ],
  });
  const statement = buildStatement([
    captured({
      id: "PL-1",
      sourceDocument: "Sample package",
      sourcePage: "2",
      sourceHref: `https://drive.google.com/file/d/${FILE}/view`,
    }),
    captured({
      id: "PL-2",
      sourceDocument: "Sample-statement.pdf",
      sourcePage: "4",
      sourceHref: `https://drive.google.com/drive/folders/${PARENT}`,
      code: "chemicals",
    }),
    captured({
      id: "PL-3",
      sourceDocument: `Broker note ${HEX}`,
      sourcePage: "1",
      code: "utilities",
    }),
  ], [{
    year: 2024,
    month: 2,
    business: "car_wash",
    periodId: "PP-2",
    sourceDocument: "Sample-statement.pdf",
    sourcePage: "4",
    capturedAt: "2026-03-01T15:00:00Z",
  }]);
  const linked = await attachPnlSourceLinks(statement, { folderId: SITE, gmailAllowed: false, lister: files });
  const period = linked.years[0]?.months[0];
  const labor = period?.costs.find((line) => line.code === "labor");
  const chemicals = period?.costs.find((line) => line.code === "chemicals");
  const utilities = period?.costs.find((line) => line.code === "utilities");
  assert.equal(labor?.sourceHref, `https://drive.google.com/file/d/${FILE}/view`);
  assert.equal(labor?.sourceDocument, "Sample package");
  assert.equal(chemicals?.sourceHref, `https://drive.google.com/file/d/${PDF}/preview#page=4`);
  assert.equal(chemicals?.sourceDocument, "Sample-statement.pdf");
  assert.equal(chemicals?.sourceHref.includes("/folders/"), false);
  assert.equal(chemicals?.sourceHref.includes(PARENT), false);
  assert.equal(utilities?.sourceDocument, "Email, Mar 1, 2026");
  assert.equal(utilities?.sourceHref, "");
  assert.equal(utilities?.gmailHref, "");
  const printed = JSON.stringify(utilities);
  assert.equal(printed.includes(HEX), false);
  assert.equal(printed.includes("mail.google.com"), false);
  const missing = linked.years[0]?.missingDetails[0];
  assert.equal(missing?.sourceHref, `https://drive.google.com/file/d/${PDF}/preview#page=4`);
  assert.equal(files.asked.includes(PARENT), false);

  const allowed = await attachPnlSourceLinks(statement, { folderId: "", gmailAllowed: true, lister: null });
  const mail = allowed.years[0]?.months[0]?.costs.find((line) => line.code === "utilities");
  assert.equal(mail?.sourceDocument, "Email, Mar 1, 2026");
  assert.equal(mail?.gmailHref?.startsWith("https://mail.google.com/"), true);
  assert.equal(mail?.sourceHref, "");
});

test("a package zip links when that file has an id, otherwise the citation says there is no Drive link", () => {
  const zip = "FixtureZipFileId00000000001";
  const linked = sourceView({
    document: "Sample-package.zip / Sample-member.pdf",
    page: "1",
    href: "",
    capturedLabel: "",
    fileId: zip,
    mime: "application/zip",
    linkPart: "zip",
  });
  assert.equal(linked.label, "Sample-package.zip");
  assert.equal(linked.beside, "Sample-member.pdf");
  assert.equal(linked.pageAside, "p. 1");
  assert.equal(linked.href, `https://drive.google.com/file/d/${zip}/view`);
  assert.equal(linked.href.includes("#page="), false);
  assert.equal(linked.hint, "");
  const missing = sourceView({
    document: "Sample-package.zip / Sample-member.pdf",
    page: "1",
    href: "",
    capturedLabel: "",
  });
  assert.equal(missing.href, "");
  assert.equal(missing.hint, NO_DRIVE_LINK);
  assert.equal(missing.label.includes("/"), true);
});

test("the Drive lister stays unset without a service account", async () => {
  const previous = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  try {
    assert.equal(await serviceDriveLister(), null);
  } finally {
    if (previous == null) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = previous;
  }
});
