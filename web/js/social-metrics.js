(() => {
  const metricsEl = document.getElementById("socialMetrics");
  if (!metricsEl) {
    return;
  }

  const totalAccountsStat = document.getElementById("totalAccountsStat");
  const totalAccountsValue = document.getElementById("totalAccountsValue");
  const summaryEl = document.getElementById("socialMetricsSummary");
  const summaryValueEl = document.getElementById("socialMetricsTotal");
  const footnoteEl = document.getElementById("socialMetricsFootnote");

  const PLATFORM_ORDER = ["youtube", "instagram", "tiktok", "facebook"];
  const metrics = new Map();
  metricsEl.querySelectorAll(".hero__metric").forEach((element) => {
    const platform = element.dataset.platform;
    if (!platform) return;
    const valueEl = element.querySelector(".hero__metric-value");
    const badgeEl = element.querySelector(".hero__metric-badge");
    const captionEl = element.querySelector(".hero__metric-caption");
    metrics.set(platform, {
      platform,
      element,
      valueEl,
      badgeEl,
      captionEl,
      currentCount: null,
      handleCount: 0,
    });
  });

  const formatCount = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      return null;
    }
    const thresholds = [
      { limit: 1e9, suffix: "B" },
      { limit: 1e6, suffix: "M" },
      { limit: 1e3, suffix: "K" },
    ];
    for (const { limit, suffix } of thresholds) {
      if (num >= limit) {
        const scaled = (num / limit).toFixed(1);
        return `${parseFloat(scaled)}${suffix}`;
      }
    }
    return Math.round(num).toLocaleString();
  };

  const setMetricUnavailable = (metric) => {
    if (!metric) return;
    metric.currentCount = null;
    metric.element.dataset.status = "unavailable";
    metric.element.classList.remove("hero__metric--approximate");
    if (metric.badgeEl) {
      metric.badgeEl.hidden = true;
      metric.badgeEl.removeAttribute("title");
      metric.badgeEl.removeAttribute("aria-label");
    }
    if (metric.valueEl) {
      metric.valueEl.textContent = "—";
    }
  };

  const applyMetricState = (metric, data) => {
    if (!metric) return;

    const source = data?.source;
    const countValue = Number(data?.totals?.count);
    const hasCount = Number.isFinite(countValue) && countValue >= 0;

    if (!hasCount) {
      setMetricUnavailable(metric);
      return { approximate: source === "scrape", unavailable: true };
    }

    metric.currentCount = countValue;
    metric.element.dataset.status = "ready";
    if (metric.valueEl) {
      metric.valueEl.textContent = formatCount(countValue) ?? "—";
    }

    const approximate = source === "scrape";
    if (metric.badgeEl) {
      if (approximate) {
        metric.element.classList.add("hero__metric--approximate");
        metric.badgeEl.hidden = false;
        metric.badgeEl.setAttribute("title", "Approximate via public page");
        metric.badgeEl.setAttribute("aria-label", "Approximate via public page");
      } else {
        metric.element.classList.remove("hero__metric--approximate");
        metric.badgeEl.hidden = true;
        metric.badgeEl.removeAttribute("title");
        metric.badgeEl.removeAttribute("aria-label");
      }
    }

    return { approximate, unavailable: false };
  };

  const updateTotalAccounts = () => {
    if (!totalAccountsStat || !totalAccountsValue) {
      return;
    }
    let total = 0;
    metrics.forEach((metric) => {
      if (metric.element.hidden) return;
      if (Number.isInteger(metric.handleCount) && metric.handleCount > 0) {
        total += metric.handleCount;
      }
    });
    if (total > 0) {
      totalAccountsValue.textContent =
        total === 1 ? "1 total account" : `${total.toLocaleString()} total accounts`;
      totalAccountsStat.hidden = false;
    } else {
      totalAccountsValue.textContent = "";
      totalAccountsStat.hidden = true;
    }
  };

  const updateSummary = (grandTotal) => {
    if (!summaryEl || !summaryValueEl) return;
    if (Number.isFinite(grandTotal) && grandTotal >= 0) {
      summaryValueEl.textContent = formatCount(grandTotal) ?? "—";
      summaryEl.hidden = false;
    } else {
      summaryValueEl.textContent = "—";
      summaryEl.hidden = true;
    }
  };

  const updateFootnote = (shouldShow) => {
    if (!footnoteEl) return;
    footnoteEl.hidden = !shouldShow;
  };

  const markAllUnavailable = () => {
    let anyUnavailable = false;
    metrics.forEach((metric) => {
      if (metric.element.hidden) return;
      setMetricUnavailable(metric);
      anyUnavailable = true;
    });
    updateSummary(null);
    updateFootnote(anyUnavailable);
  };

  const fetchJson = async (url) => {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    return response.json();
  };

  const applyConfig = (config) => {
    if (!config) {
      return;
    }
    const platforms = config.platforms || {};
    PLATFORM_ORDER.forEach((platform) => {
      const metric = metrics.get(platform);
      if (!metric) return;
      const platformConfig = platforms[platform];
      const enabled = platformConfig ? Boolean(platformConfig.enabled) : false;
      metric.element.hidden = !enabled;
      const handles = Array.isArray(platformConfig?.handles)
        ? platformConfig.handles.filter((entry) => typeof entry === "string" && entry.trim())
        : [];
      metric.handleCount = handles.length;
      if (!enabled) {
        metric.element.dataset.status = "unavailable";
      }
    });
    updateTotalAccounts();
  };

  const applyOverview = (overview) => {
    if (!overview || typeof overview !== "object") {
      markAllUnavailable();
      return;
    }
    const results = overview.platforms || {};
    let showFootnote = false;
    PLATFORM_ORDER.forEach((platform) => {
      const metric = metrics.get(platform);
      if (!metric || metric.element.hidden) {
        return;
      }
      const data = results[platform];
      const result = applyMetricState(metric, data);
      if (result?.approximate || result?.unavailable) {
        showFootnote = true;
      }
    });
    const grandTotal = overview.grandTotal;
    if (typeof grandTotal === "number" && Number.isFinite(grandTotal)) {
      updateSummary(grandTotal);
    } else {
      updateSummary(null);
    }
    updateFootnote(showFootnote);
  };

  const initialise = async () => {
    try {
      const config = await fetchJson("/api/social/config");
      applyConfig(config);
    } catch (error) {
      console.warn("Failed to load social config", error);
    }

    let overview;
    try {
      overview = await fetchJson("/api/social/overview");
    } catch (error) {
      console.warn("Failed to load social stats", error);
      markAllUnavailable();
      return;
    }
    applyOverview(overview);
  };

  initialise();
})();

