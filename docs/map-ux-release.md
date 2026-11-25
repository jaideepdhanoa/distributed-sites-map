# Market map and parcel review release plan

The reviewer can open a market, inspect nearby sites, choose two for comparison and return to the same map extent. Use the existing desktop and phone browser runs with the review fixture.

| Step | Implementation | Release evidence |
| --- | --- | --- |
| Reconcile the shortlist | Use the complete catalog for cross-market coordinates. Derive the mapped and missing counts from the filtered shortlist. Keep a record with missing coordinates in the list. | Check multiple markets, a filtered pipeline, missing coordinates and the IDs behind the missing-location action. |
| Orient the reviewer | Start first-time visitors on Streets. Preserve manual basemap choices. Label national markets, fit them around the scope panel and keep roads, cities and the service area legible. | Capture All markets at desktop and phone widths. Enter Phoenix from its market label. |
| Explain the map | Give Pipeline and Explore their own key and include enabled context. Name the selected pin, keep price labels from overlapping and move the census link explanation into the preview. | Verify the key after switching workspaces and toggling overlays. |
| Inspect and compare | Prioritize a sourced land or capacity figure and the next check. Keep satellite imagery and evidence accessible. Group parcel tools on phones. Add sites to the existing comparison directly from their preview. | Enter two nearby pins from the map, compare them, close the matrix and check the camera, selected scope and filters. |
| Recover | On a renderer failure, display the filtered shortlist immediately with Retry map. | Disable graphics, open a record, compare records and retry. Verify that the URL and selection survive. |
| Release | Run type, unit, control and browser checks, review desktop and phone captures, then squash-merge and verify the production deployment. | Retain the CI run and captures on the pull request. |
