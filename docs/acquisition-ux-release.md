# Acquisition navigation and site cards

## Delivery plan

1. Add a signed-in Acquisition shortlist destination to the main navigation and keyboard search. Use the canonical all-market commercial view. Label the ordinary pipeline list by market and expose the scope inherited from a list on Selection review.
2. Group Spaces with the map tools. Start with the filtered pipeline sites, provide an explicit way to browse the full catalog, and preserve the selected site and camera when returning. Keep review return links and existing drawing controls. Make Nearby sites respond to phone and desktop widths.
3. Give site records a concise acquisition recommendation, a next step and its owner and review date. Bring section navigation into the first screen. Separate recorded activity and workflow actions from commercial instructions. State which charging option a finding concerns and distinguish a workbook estimate from measured fit. Contain aerial thumbnails in their frames.
4. Exercise the home, search, scoped list, map return and record paths at desktop, tablet and phone sizes using synthetic records. Run the project checks and inspect preview layouts before squash-merge. Verify the same journeys on the signed-in production site after deploy.

The shortlist results redesign is tracked in PR #220. Reuse it when reconciling this release. The changes in this plan affect presentation and navigation. Commercial entries, decisions, access controls and model inputs retain their existing sources.

## Automatic acquisition shortlist

The map, pipeline, acquisition shortlist and charging editor read the same modeled layouts and purchase terms. The system orders them by base cost per completed charge. It uses equal per-stall utilization and includes drawn combinations above 20 stalls. Record a build and power validation for larger footprints.

An open primary acquisition qualifies when a drawn purchase layout has at least four stalls and its base cost is at or below its comparable depot benchmark. Provisional price or use rights can qualify with their validation. Assumed footprints, withdrawn offers, pending drops and parked service routes sit outside the acquisition shortlist. Membership is recalculated from current inputs with no numerical quota. The shortlist orders qualifying sites by base cost. The register supplies evidence, transaction availability, visit plans and follow-up.

The base case uses the modeled utility allowance. The higher-utility case multiplies only that allowance by 1.5. Both use the same purchase terms, layout, operating cash and utilization. Both exclude electricity and utility demand charges. A saved investment downside can change several explicitly entered assumptions and is a separate analysis.

To resume or verify a release, run the acquisition rule and preliminary cost tests in `tests/list`, then the desktop and phone pipeline, shortlist and ledger journeys in `e2e`. The workbook sync's signed-in readback reconciles the commercial register, map, shortlist and editor. Verify shortlist membership and ordering against drawn base-parity cases in the signed-in pipeline after deployment.
