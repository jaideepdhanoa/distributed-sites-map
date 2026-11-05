export const PIN_HOOK = `(() => {
  window.__src = window.__src || {};
  window.__srcGen = window.__srcGen || 0;
  const orig = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (msg, ...rest) {
    try {
      const data = msg && msg.data;
      const geo = data && data.data;
      if (msg && msg.type === "LD" && data && data.source && geo && geo.type === "FeatureCollection" && Array.isArray(geo.features)) {
        window.__src[data.source] = geo.features.map((feature) => {
          const props = (feature && feature.properties) || {};
          return {
            id: props.site_id || props.deal_id || props.listing_id || props.id || "",
            verdict: props.verdict || "",
            network_status: props.network_status || "",
            stage_group: props.stage_group || "",
            kind: props.kind || "",
          };
        });
        if (data.source === "sites" || data.source === "deals" || data.source === "offmarket") window.__srcGen += 1;
      }
    } catch (e) {}
    return orig.call(this, msg, ...rest);
  };
})();`;
