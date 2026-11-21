import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChipFace } from "../../components/ChipFace";
import { NdaChip } from "../../components/NdaChip";
import { ChipRow, TagChip } from "../../components/TagChip";
import { serviceAreaChip } from "../../lib/cardStatus";
import { CHIP_LABEL_MAX, chipFace, chipLabelProblem, stageChipLabel } from "../../lib/chips";
import { LAND_PAUSED_NOTE, LIST_CHIP_LABELS, countyCheck } from "../../lib/listLook";
import { cashFlowListLabel } from "../../lib/keyNumbers";
import type { DealProps } from "../../lib/types";
import { TAG_FAMILIES } from "../../lib/tags/vocab";
import type { TagView } from "../../lib/tags/map";

function faceText(html: string, testId: string): string {
  const match = new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`).exec(html);
  return match?.[1] || "";
}

const drop: TagView = {
  family: "drop_reason",
  code: "outside_service_area",
  label: "Outside service area",
  tone: "sand",
  help: "The site is outside the service area.",
  since: "Nov 12",
  note: "The lot cannot fit.",
  owner: "Ada",
  due: "Nov 20",
  source: "stage_decision",
};

test("a stage chip is the stage name only, on one line, with the decision outside the chip", () => {
  assert.equal(stageChipLabel("Dropped", "dropped"), "Dropped");
  assert.equal(stageChipLabel("2 Financial screen", "financial"), "Financial screen");
  assert.equal(chipLabelProblem(stageChipLabel("Dropped", "dropped")), "");
  const detail = "Outside service area · Proposed by Ada · Approved by Ada · Nov 12, 11:31 AM PT";
  const html = renderToStaticMarkup(createElement(ChipFace, {
    className: "stage-pill tone-sand",
    testId: "stage-chip",
    label: "Dropped",
    detail,
  }));
  const text = faceText(html, "stage-chip");
  assert.equal(text, "Dropped");
  assert.equal(text.includes("·"), false);
  assert.equal(chipLabelProblem(text), "");
  assert.match(html, /data-testid="stage-decision-tip"/);
  assert.match(html, /Proposed by Ada/);
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.list-table \.stage-pill \{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.stage-cell \.stage-pill \{[^}]*white-space:\s*nowrap/);
  assert.doesNotMatch(css, /\.list-table \.stage-pill \{[^}]*text-overflow:\s*ellipsis/);
  assert.match(readFileSync("DESIGN.md", "utf8"), /at most 28 characters/);
});

test("data-driven chips stay a short label and do not join clauses", () => {
  for (const family of TAG_FAMILIES) {
    for (const code of family.codes) {
      assert.equal(chipLabelProblem(code.label), "", `${family.family} ${code.code} (${code.label.length})`);
      assert.ok(code.label.length <= CHIP_LABEL_MAX);
    }
  }
  for (const label of ["Outside service area", "Near, 4.2 mi", "Near, under 5 mi", "Financial screen", "Offer and close", "Dropped", ...LIST_CHIP_LABELS]) {
    assert.equal(chipLabelProblem(label), "", label);
  }
  const county = countyCheck({ verdict: "PASS" });
  assert.equal(county.label, "Land OK");
  assert.match(county.note, /County records confirm/);
  assert.equal(countyCheck({ verdict: "MAYBE" }).label, "Land borderline");
  assert.equal(countyCheck({ verdict: "UNRESOLVED" }).label, "Records unclear");
  assert.equal(countyCheck({ verdict: null }).label, "Not reviewed");
  assert.equal(countyCheck({ verdict: "FAIL" }).label, "Ruled out");
  assert.equal(chipLabelProblem("Land paused"), "");
  assert.match(LAND_PAUSED_NOTE, /Nov 20, 2026/);
  assert.equal(chipLabelProblem(serviceAreaChip({ service_area_class: "outside" }) || ""), "");
  assert.equal(chipLabelProblem(serviceAreaChip({ service_area_class: "near_5_10", service_area_distance_mi: 4.2 }) || ""), "");

  const tag = renderToStaticMarkup(createElement(TagChip, { chip: drop }));
  const tagText = faceText(tag, "chip-drop_reason");
  assert.equal(tagText, "Outside service area");
  assert.equal(tagText.includes("·"), false);
  assert.match(tag, /since Nov 12/);
  assert.doesNotMatch(tag, /class="tag-since"/);

  const row = renderToStaticMarkup(createElement(ChipRow, {
    titled: true,
    testId: "diligence",
    chips: [{
      family: "diligence_environmental",
      code: "verified",
      label: "Verified",
      tone: "pine",
      help: "Environmental check.",
      since: "",
      note: "",
      owner: "",
      due: "",
      source: "",
    }],
  }));
  assert.equal(faceText(row, "chip-diligence_environmental"), "Verified");
  assert.equal(faceText(row, "chip-diligence_environmental").includes("·"), false);

  const nda = renderToStaticMarkup(createElement(NdaChip, {
    text: "NDA: With counterparty legal · 10d open · 2d in court",
  }));
  const ndaText = faceText(nda, "nda-chip");
  assert.equal(ndaText, "With counterparty legal");
  assert.equal(ndaText.includes("·"), false);
  assert.equal(chipLabelProblem(ndaText), "");
  assert.match(nda, /10d open/);

  const shortened = chipFace("Dropped · Outside service area · Proposed by Ada");
  assert.equal(shortened.label, "Dropped");
  assert.equal(chipLabelProblem(shortened.label), "");

  const cash = cashFlowListLabel({
    kind: "pipeline",
    figures_status: "shown",
    stated_cash_flow: 102517,
    stated_cash_flow_display: "$102,517",
    cash_flow_label: "EBITDA",
    package_status: "Received",
    package_line: "Package on file",
    earnings_basis: "Package",
    figures_basis: "Documented",
  } as DealProps);
  assert.equal(cash.text, "$102,517 EBITDA");
  assert.equal(cash.text.includes("·"), false);
  assert.match(cash.title, /Package on file/);
  assert.match(cash.title, /Package/);
  assert.doesNotMatch(cash.text, /Package/);
});
