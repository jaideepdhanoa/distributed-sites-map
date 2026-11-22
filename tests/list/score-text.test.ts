import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PhoneCards } from "../../components/PhoneCards";
import { ScoreCell } from "../../components/ListLook";
import { listCellText, universeCardFacts, type ListRow } from "../../components/ListView";
import { listScoreText, scoreForFeed } from "../../lib/keyNumbers";

const row: ListRow = {
  id: "WB-PHX-0001",
  site: "Sample Wash",
  type: "Car wash",
  city: "PHX",
  stage: "Cleared",
  score: "47.12",
  county: "Land OK",
  countyNote: "County records confirm an operating wash with enough spare land on its own parcel.",
  scoreInput: { score: 47.12, economics: 4.62, land: 25, power: 7.5, location: 5, deal: 5 },
  tier: "",
  spare: "0.4 ac",
  grade: "",
  zoning: "",
  traffic: "",
  listed: "Yes · $2,900,000",
  lead: "",
  address: "900 Placeholder Lane",
};

test("the universe list row and the phone card show one decimal", () => {
  assert.equal(listScoreText(47.12), "47.1");
  assert.equal(listScoreText("47.12"), "47.1");
  assert.equal(scoreForFeed(47.12), 47.1);
  assert.equal(scoreForFeed(72), 72);
  const list = renderToStaticMarkup(createElement(
    "tr",
    { className: "list-row", "data-testid": "universe-list-row" },
    createElement("td", { "data-col": "score" }, listCellText(row, "score", true)),
    createElement("td", { "data-col": "listed" }, listCellText(row, "listed", true)),
  ));
  const score = renderToStaticMarkup(createElement(ScoreCell, { input: row.scoreInput || { score: 47.12 } }));
  const card = renderToStaticMarkup(createElement(PhoneCards, {
    rows: [{
      id: row.id,
      name: row.site,
      address: row.address,
      stage: row.stage,
      chips: createElement(ScoreCell, { input: row.scoreInput || { score: 47.12 } }),
      facts: universeCardFacts(row, true),
      onOpen: () => {},
    }],
  }));
  assert.equal(list.includes("47.12"), false);
  assert.match(list, />47\.1</);
  assert.equal(score.includes("47.12"), false);
  assert.match(score, /47\.1/);
  assert.match(score, /Economics 4\.6\/40/);
  assert.match(score, /data-testid="score-breakdown-tip"/);
  assert.equal(card.includes("47.12"), false);
  assert.match(card, /47\.1/);
  assert.match(card, /Yes/);
  assert.match(card, /\$2,900,000/);
  assert.match(card, /phone-card-meta/);
});
