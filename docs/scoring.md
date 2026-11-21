# Scoring

The workbook score is stored as written. This app does not recompute Economics, Land, Location, or Deal points. Power points stay a formula on Pipeline and Land Sites. The grade inside that formula is derived. Nobody types it.

Weights, from `config/scorecard.json` and `Assumptions!B77:B81`:

| Part | Points |
| --- | --- |
| Economics | 40 |
| Land | 25 |
| Power | 15 |
| Location | 10 |
| Deal | 10 |

Location points stay Inside 10, Near 0-5 5, Near 5-10 2.5, Outside 0.

## Power rating

`lib/score/power-rating.ts` reads the typed power layers and returns a rating, a reason, and the inputs it used. Each input keeps its source label, as-of date, and confidence. Confidence is Estimated, Claimed, or Verified.

The database stores `sites.power_rating`, `sites.power_rating_reason`, and `sites.power_rating_inputs` (`db/migrations/024_power_rating.sql`). Production applies that file from the Production migrations workflow. The mirror copies the rating to a read-only column, `Power rating (derived)`, on Pipeline and Land Sites. It matches the header by name. It does not write row 10 or the quarantined pipeline row.

Power points use the same Assumptions share table, `A88:B98`, times the power weight in `B79`:

| Rating | Share | Points |
| --- | --- | --- |
| Strong | 100% | 15 |
| OK | 60% | 9 |
| Weak | 20% | 3 |
| Unknown | 50% | 7.5 |

The formula change is `scripts/power-points-formula.ts`. Dry run is the default. Apply needs the confirm phrase `power-points-derived`. A human runs that workflow. It is not applied from a pull request.

`scripts/power-points-report.ts` is a dry run. It lists old power points, new power points, and the score delta. In CI the log is counts only. It does not print site names, notes, addresses, or prices.

### Rubric

Layer A, substation distance and high-voltage line distance, stays Unknown for points. An OSM-only row stays Unknown.

Strong, before the Phoenix and Miami cap:

- A Verified utility letter, capacity study, or bill showing room for at least 1.7 MW on site.
- Or a Las Vegas NV Energy hosting-map read (source `utility hosting map`, or text that names NV Energy or DRP) whose Layer B frontage is at least 1.7 MW, Estimated or Verified.

Phoenix and Miami cap at OK. A result that would have been Strong in those markets is stored as OK.

OK:

- Sourced 3-phase service on site, Layer C, Claimed or Verified, with amps, volts, and phase, even under 1.7 MW.
- Or frontage hosting from 1.0 MW up to, and not including, 1.7 MW. A frontage of at least 1.7 MW that is not Strong is also OK.
- Or nearby hosting of at least 1.7 MW when frontage is missing or lower.

Weak:

- Layer B frontage and nearby are both under 1 MW. A recorded 0 counts.
- Or a sourced single-phase service, or a small service such as 240 V at 200 A or less, when Layer B is not already OK or Strong.

Unknown:

- No Layer B read and no complete Layer C. Complete Layer C is amps, volts, and phase, or a will-serve figure in MW.
- An incomplete Layer C stays Unknown.

Volts such as `277/480` and `480/277` use 480, the line-to-line value. Three-phase MW is √3 × volts × amps / 1,000,000. 800 A at 480 V 3-phase is about 665 kW, which is OK, not Strong. About 2,000 A at 480 V 3-phase is the 1.7 MW reference.

The score breakdown's Power row shows the copied workbook points, such as `Power 7.5/15`, and the derived reason, for example `Strong: NV Energy DRP frontage 2.1 MW, Estimated`. The rubric sentence is not repeated under the score.
