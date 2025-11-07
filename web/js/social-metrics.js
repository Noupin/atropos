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

  const API_ENDPOINTS = {
    config: "config",
    overview: "overview",
  };

  const normaliseApiRoot = (value) => {
    if (!value) return null;
    try {
      const url = new URL(value, window.location.href);
      url.search = "";
      url.hash = "";
      const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
      url.pathname = path;
      return url;
    } catch (error) {
      console.warn("Ignoring invalid social API base", value, error);
      return null;
    }
  };

  const buildApiRootCandidates = () => {
    const candidates = [];
    const seen = new Set();

    const addCandidate = (url) => {
      if (!url) return;
      const href = url.toString();
      if (seen.has(href)) return;
      seen.add(href);
      candidates.push({ href, origin: url.origin });
    };

    const meta = document.querySelector('meta[name="marketing-api-base-url"]');
    if (meta?.content) {
      addCandidate(normaliseApiRoot(meta.content));
    }

    addCandidate(normaliseApiRoot(`${window.location.origin}/api/social/`));

    const { hostname, protocol } = window.location;
    const isFileProtocol = protocol === "file:";

    const isLocalHostname = (() => {
      if (!hostname) return false;
      if (hostname === "localhost" || hostname === "0.0.0.0") return true;
      if (hostname === "::1" || hostname === "[::1]") return true;
      if (/^127(?:\.\d{1,3}){3}$/.test(hostname)) return true;
      if (/^10(?:\.\d{1,3}){3}$/.test(hostname)) return true;
      if (/^192\.168(?:\.\d{1,3}){2}$/.test(hostname)) return true;
      if (/^172\.(1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}$/.test(hostname)) return true;
      if (hostname.endsWith(".localhost") || hostname.endsWith(".local")) return true;
      if (hostname.endsWith(".test")) return true;
      return false;
    })();

    if (isFileProtocol || isLocalHostname) {
      addCandidate(normaliseApiRoot("http://127.0.0.1:5001/api/social/"));
      addCandidate(normaliseApiRoot("http://localhost:5001/api/social/"));
    }

    return candidates;
  };

  const API_ROOT_CANDIDATES = buildApiRootCandidates();
  let resolvedApiRoot = null;

  const resolveApiRootsInPriorityOrder = () => {
    const ordered = [];
    if (resolvedApiRoot) {
      ordered.push(resolvedApiRoot);
    }
    API_ROOT_CANDIDATES.forEach((candidate) => {
      if (!resolvedApiRoot || candidate.href !== resolvedApiRoot.href) {
        ordered.push(candidate);
      }
    });
    return ordered;
  };

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

    const source = data?.source || "none";
    const rawCount = data?.totals?.count;
    let countValue = null;

    if (typeof rawCount === "number" && Number.isFinite(rawCount)) {
      countValue = rawCount;
    } else if (typeof rawCount === "string" && rawCount.trim() !== "") {
      const parsed = Number(rawCount);
      if (Number.isFinite(parsed)) {
        countValue = parsed;
      }
    }

    const hasCount = typeof countValue === "number" && countValue >= 0;

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

  const fetchApi = async (endpoint) => {
    const segment = typeof endpoint === "string" ? endpoint.replace(/^\/+/, "") : "";
    const candidates = resolveApiRootsInPriorityOrder();
    let lastError = null;

    for (const candidate of candidates) {
      if (!candidate) continue;
      let requestUrl;
      try {
        requestUrl = new URL(segment, candidate.href).toString();
      } catch (error) {
        lastError = error;
        continue;
      }

      const sameOrigin = candidate.origin === window.location.origin;
      try {
        const response = await fetch(requestUrl, {
          credentials: sameOrigin ? "same-origin" : "omit",
        });
        if (!response.ok) {
          lastError = new Error(
            `Request failed with status ${response.status} for ${requestUrl}`,
          );
          continue;
        }
        resolvedApiRoot = candidate;
        return response.json();
      } catch (error) {
        lastError = error;
      }
    }

    const error =
      lastError || new Error(`Unable to reach social metrics API (${segment || ""})`);
    error.endpoint = segment;
    throw error;
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
      const config = await fetchApi(API_ENDPOINTS.config);
      applyConfig(config);
    } catch (error) {
      console.warn("Failed to load social config", error);
    }

    let overview;
    try {
      overview = await fetchApi(API_ENDPOINTS.overview);
    } catch (error) {
      console.warn("Failed to load social stats", error);
      markAllUnavailable();
      return;
    }
    applyOverview(overview);
  };

  initialise();
})();

