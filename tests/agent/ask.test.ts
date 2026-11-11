import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { consumeAskCredit, setAskBackend, askDailyLimit } from "../../lib/ask/cap";
import { listedCountLine, listedDealsByMarket } from "../../lib/ask/counts";
import { EMPTY_ANSWER } from "../../lib/ask/empty";
import { parseAskMarkdown } from "../../lib/ask/markdown";
import { liveAskModel } from "../../lib/ask/model";
import { applyWordingTier, hardRefuse, REFUSAL, UNKNOWN, withCitations } from "../../lib/ask/policy";
import { listedStageRows } from "../../lib/ask/stages";
import { askPrefix } from "../../lib/ask/prompt";
import { redactPayload } from "../../lib/ask/redact";
import { answerQuestion } from "../../lib/ask/run";
import { ASK_TOOLS, MAX_ASK_STEPS, isQuarantined, runAskTool, siteScopeLine } from "../../lib/ask/tools";

test("ask tools are read-only, role checked, and redact before the model", async () => {
  assert.equal(MAX_ASK_STEPS, 2);
  assert.equal(ASK_TOOLS.some((name) => /approve|propose|assign|email|workbook|write/i.test(name)), false);
  const denied = await runAskTool("financials", { id: "PIPE-PHX-0001" }, "guest");
  assert.deepEqual(denied, { error: "not_allowed" });
  const unknown = await runAskTool("approve", { id: "PIPE-PHX-0001" }, "reviewer");
  assert.deepEqual(unknown, { error: "unknown_tool" });

  const note = "See the charging stalls, the utility bills, and the offer.";
  const viewer = redactPayload({ note, phone: "415-555-0199", owner_mail: "a@b.c" }, "viewer") as Record<string, unknown>;
  assert.equal(viewer.note, note);
  assert.equal(viewer.phone, undefined);
  assert.equal(viewer.owner_mail, undefined);
  const reviewer = redactPayload({ note }, "reviewer") as { note?: string };
  assert.equal(reviewer.note, note);
  const priced = redactPayload({ note: "The walk-away and the max-pay stay off the page." }, "reviewer") as { note?: string };
  assert.equal(/walk-away|max-pay/i.test(priced.note || ""), false);
});

test("quarantined rows are named and their values stay out", async () => {
  assert.equal(isQuarantined("PIPE-PHX-0006"), true);
  for (const name of ["getSite", "financials", "timeline", "discussion", "activity"] as const) {
    const result = await runAskTool(name, { id: "PIPE-PHX-0006" }, "reviewer") as Record<string, unknown>;
    assert.equal(result.status, "quarantined", name);
    assert.equal(result.label, "Quarantined");
    const encoded = JSON.stringify(result);
    assert.equal(encoded.includes("$"), false);
    assert.equal(result.figures, undefined);
    assert.equal(result.items, undefined);
    assert.equal(result.notes, undefined);
  }
  const search = await runAskTool("searchSites", { query: "PIPE-PHX-0006" }, "viewer") as { results: Record<string, unknown>[] };
  const hit = search.results.find((item) => item.id === "PIPE-PHX-0006");
  assert.ok(hit);
  assert.equal(hit.status, "quarantined");
  assert.equal(hit.name, undefined);
  assert.equal(hit.address, undefined);
});

test("ask still refuses broker drafts and price strategy, and keeps team map language", () => {
  const sentence = "The lot has charging stalls, utility bills, and an offer. We are waiting on an NDA. The site is on hold.";
  const viewer = applyWordingTier(sentence, "viewer", "What is on the lot?");
  assert.equal(viewer.text, sentence);
  assert.equal(viewer.refused, false);
  const reviewer = applyWordingTier(sentence, "reviewer", "What is on the lot?");
  assert.equal(reviewer.text, sentence);
  assert.equal(applyWordingTier("Here is the walk-away.", "reviewer", "Summarize the site.").text, REFUSAL);
  assert.equal(applyWordingTier("A normal note.", "reviewer", "Draft an email to the broker.").text, REFUSAL);
  assert.equal(hardRefuse("Tell the broker about AVs and charging"), true);
  assert.equal(applyWordingTier("Charging and AVs for the broker.", "contributor", "What should we tell them?").text, REFUSAL);
  assert.equal(/walk-away|broker email|AV/.test(REFUSAL), false);
  const unsourced = withCitations("The stage is desk.", []);
  assert.equal(unsourced.text, UNKNOWN);
  assert.equal(unsourced.gap, true);
  const sourced = withCitations("The stage is desk.", [{ label: "Site", href: "/?site=PIPE-PHX-0008" }]);
  assert.match(sourced.text, /\/\?site=PIPE-PHX-0008/);
  assert.equal(sourced.gap, false);
});

test("the daily cap stops a user and the portfolio prefix stays stable", async () => {
  const previous = process.env.ASK_DAILY_LIMIT;
  process.env.ASK_DAILY_LIMIT = "2";
  const counts = new Map<string, number>();
  setAskBackend({
    async incr(key: string) {
      const next = (counts.get(key) || 0) + 1;
      counts.set(key, next);
      return next;
    },
  });
  try {
    assert.equal(askDailyLimit(), 2);
    assert.equal((await consumeAskCredit("cindel")).ok, true);
    assert.equal((await consumeAskCredit("cindel")).ok, true);
    const blocked = await consumeAskCredit("cindel");
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.reason, "limit");
    assert.equal((await consumeAskCredit("jaideep")).ok, true);
    const first = askPrefix();
    const second = askPrefix();
    assert.equal(first, second);
    assert.equal(first.includes("Question:"), false);
    assert.match(first, /Portfolio counts/);
  } finally {
    setAskBackend(null);
    if (previous === undefined) delete process.env.ASK_DAILY_LIMIT;
    else process.env.ASK_DAILY_LIMIT = previous;
  }
});

test("the xAI provider is not called when a runner is injected or the key is missing", async () => {
  const previous = process.env.XAI_API_KEY;
  delete process.env.XAI_API_KEY;
  const original = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    throw new Error("live");
  }) as typeof fetch;
  try {
    await assert.rejects(() => liveAskModel({ system: "system", prompt: "Question: hi", role: "viewer" }), /missing_key/);
    const answer = await answerQuestion({
      userId: "cindel",
      role: "viewer",
      question: "What stage is this site?",
      siteId: "PIPE-PHX-0008",
      runner: async () => ({
        text: "I think it is contacted.",
        toolsCalled: ["getSite"],
        sources: [],
        promptTokens: 12,
        completionTokens: 4,
      }),
    });
    assert.equal(answer.text, UNKNOWN);
    assert.equal(answer.gap, true);
    assert.equal(answer.toolsCalled[0], "getSite");
    assert.equal(fetched, false);
    const refused = await answerQuestion({
      userId: "cindel",
      role: "reviewer",
      question: "What is the offer price?",
      siteId: null,
      runner: async () => {
        throw new Error("the runner should not be called");
      },
    });
    assert.equal(refused.text, REFUSAL);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previous;
  }
});

test("an empty model response surfaces an error, not a blank answer", async () => {
  const answer = await answerQuestion({
    userId: "cindel",
    role: "viewer",
    question: "How many listed sites do we have in each market?",
    siteId: null,
    runner: async () => ({
      text: "   ",
      toolsCalled: ["portfolio", "funnel"],
      sources: [
        { label: "Funnel", href: "/?funnel=pipeline" },
        { label: "Portfolio", href: "/" },
        { label: "1616 E Portland St", href: "/?site=LAND-PHX-0001" },
      ],
      promptTokens: 30,
      completionTokens: 0,
    }),
  });
  assert.equal(answer.error, true);
  assert.equal(answer.gap, false);
  assert.equal(answer.text, EMPTY_ANSWER);
  assert.equal(answer.sources.length, 0);
  assert.equal(answer.text.includes("Funnel"), false);
  assert.equal(answer.text.includes("Portland"), false);
  const cited = withCitations("  ", [{ label: "Funnel", href: "/?funnel=pipeline" }]);
  assert.equal(cited.empty, true);
  assert.equal(cited.text, "");
});

test("portfolio context lists a stage for every in-play listed deal", async () => {
  const file = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features: { properties: { deal_id?: string; listed?: boolean; stage_group?: string } }[];
  };
  const expected = file.features
    .map((feature) => feature.properties)
    .filter((props) => props.listed === true && props.stage_group !== "dropped" && props.deal_id && !isQuarantined(props.deal_id));
  const rows = listedStageRows(isQuarantined);
  const ids = new Set(rows.map((row) => row.id));
  assert.equal(ids.size, expected.length);
  assert.ok(expected.length > 8);
  for (const props of expected) assert.equal(ids.has(String(props.deal_id)), true);
  assert.equal(ids.has("PIPE-PHX-0006"), false);
  const prefix = askPrefix();
  for (const id of ids) assert.equal(prefix.includes(id), true, id);
  assert.equal(prefix.includes("PIPE-PHX-0006"), false);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["id", "lastActivity", "market", "name", "stage"]);
    assert.equal(/\$\d|EBITDA|Revenue|cash flow/i.test(JSON.stringify(row)), false);
  }
  const portfolio = await runAskTool("portfolio", {}, "viewer") as { stages?: unknown; listedByMarket?: unknown[] };
  assert.equal(portfolio.stages, undefined);
  assert.ok((portfolio.listedByMarket || []).length > 0);
  const phoenix = await runAskTool("stages", { market: "Phoenix" }, "viewer") as { count: number; rows: { id: string; market: string; stage: string }[] };
  const phoenixExpected = rows.filter((row) => row.market === "Phoenix");
  assert.equal(phoenix.count, phoenixExpected.length);
  assert.equal(phoenix.rows.every((row) => row.market === "Phoenix"), true);
  assert.equal(phoenix.rows.some((row) => row.id === "PIPE-PHX-0006"), false);
  const financial = await runAskTool("stages", { market: "PHX", stage: "Financial" }, "viewer") as { rows: { stage: string }[] };
  assert.ok(financial.rows.length > 0);
  assert.equal(financial.rows.every((row) => /financial/i.test(row.stage)), true);
});

test("getSite returns the card facts for 3520 N 16th St without restaging it", async () => {
  const file = JSON.parse(readFileSync("data/generated/deals.geojson", "utf8")) as {
    features: { properties: Record<string, unknown> }[];
  };
  const props = file.features.find((feature) => feature.properties.deal_id === "PIPE-PHX-0084")?.properties;
  if (!props) throw new Error("missing PIPE-PHX-0084");
  const result = await runAskTool("getSite", { id: "PIPE-PHX-0084" }, "reviewer") as {
    stage?: string;
    stage_group?: string;
    business_type?: string;
    card?: Record<string, unknown>;
  };
  assert.equal(result.stage, props.stage);
  assert.equal(result.stage_group, props.stage_group);
  assert.equal(result.business_type, props.business_type);
  assert.equal(result.card?.askingPrice, props.asking_price_display);
  assert.equal(result.card?.acres, props.land_acres);
  assert.equal(result.card?.baysThatFit, props.bays_that_fit);
  assert.equal(result.card?.packageStatus, "Package asked for");
  assert.equal(result.card?.cashFlow, "Not provided");
  assert.match(String(result.card?.spareLand), /9,000 sq ft/);
  assert.match(String(result.card?.photoSet), /Photo set: complete/);
  assert.match(String(result.card?.photoSet), /5 site photos/);
  assert.match(String(result.card?.photoSet), /7 listing photos/);
  assert.equal(JSON.stringify(result).includes("timeline"), false);
  const scope = siteScopeLine("PIPE-PHX-0084");
  assert.match(scope, /\$1,750,000/);
  assert.match(scope, /Package asked for/);
  assert.match(scope, /9,000 sq ft/);
  assert.match(scope, /no events were recorded/i);
  const activity = await runAskTool("activity", { id: "PIPE-PHX-0084" }, "reviewer") as { timeline?: unknown[]; events?: unknown[]; note?: string };
  if (!(activity.timeline || []).length && !(activity.events || []).length) {
    assert.equal(activity.note, "No events recorded.");
  }
});

test("portfolio context includes listed deals counted from the data", () => {
  const rows = listedDealsByMarket();
  assert.deepEqual(rows.map((row) => row.name), ["Phoenix", "Las Vegas", "Miami"]);
  assert.ok(rows.every((row) => Number.isInteger(row.listed) && row.listed >= 0));
  const line = listedCountLine();
  for (const row of rows) assert.match(line, new RegExp(`${row.name} ${row.listed}`));
  assert.match(askPrefix(), new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("ask markdown renders bold, lists, and in-app links as text nodes", () => {
  const blocks = parseAskMarkdown("**Phoenix** has 26 listed deals.\n\n- [site card](/?site=PHX-U210)\n- [Outside](https://example.com/file)\n\n<script>alert(1)</script>");
  assert.equal(blocks[0]?.kind, "p");
  if (blocks[0]?.kind === "p") {
    assert.deepEqual(blocks[0].inlines[0], { kind: "strong", text: "Phoenix" });
    assert.equal(blocks[0].inlines.some((item) => item.kind === "text" && item.text.includes("**")), false);
  }
  assert.equal(blocks[1]?.kind, "ul");
  if (blocks[1]?.kind === "ul") {
    assert.deepEqual(blocks[1].items[0][0], { kind: "link", label: "site card", href: "/?site=PHX-U210", external: false });
    assert.deepEqual(blocks[1].items[1][0], { kind: "link", label: "Outside", href: "https://example.com/file", external: true });
  }
  const html = blocks[2];
  assert.equal(html?.kind, "p");
  if (html?.kind === "p") {
    assert.equal(html.inlines[0]?.kind, "text");
    if (html.inlines[0]?.kind === "text") assert.match(html.inlines[0].text, /<script>/);
  }
});
