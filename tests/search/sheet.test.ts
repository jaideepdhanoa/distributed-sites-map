import assert from "node:assert/strict";
import test from "node:test";
import { commandSheetBox } from "../../lib/search/sheet.ts";

test("the phone palette sits above the keyboard and stays tall enough to show results", () => {
  const open = commandSheetBox(844, { height: 520, offsetTop: 0 });
  assert.equal(open?.bottom, 324);
  assert.ok((open?.maxHeight || 0) >= 500);
  assert.equal(commandSheetBox(844, { height: 844, offsetTop: 0 }), null);
});
