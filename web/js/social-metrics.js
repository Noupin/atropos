(() => {
  const metricsEl = document.getElementById("socialMetrics");
  const totalAccountsStat = document.getElementById("totalAccountsStat");
  const totalAccountsValue = document.getElementById("totalAccountsValue");
  const totalFollowersStat = document.getElementById("totalFollowersStat");
  const totalFollowersValue = document.getElementById("totalFollowersValue");
  const clipOutputSection = document.getElementById("clipOutputSection");
  const viewSummaryCard = document.querySelector("[data-view-summary]");
  const viewCountPrimary = document.querySelector("[data-view-count-primary]");
  const videoCountPrimary = document.querySelector(
    "[data-video-count-primary]"
  );
  const clipDurationEls = document.querySelectorAll("[data-clip-duration]");

  const CLIP_START_DATE = new Date(Date.UTC(2025, 8, 3));

  const parseFallbackCount = (element, attribute) => {
    if (!element) {
      return null;
    }
    const attr = element.getAttribute(attribute);
    if (attr) {
      const numericAttr = Number(attr);
      if (Number.isFinite(numericAttr) && numericAttr > 0) {
        return Math.round(numericAttr);
      }
    }
    const rawText = element.textContent || "";
    const digitsOnly = rawText.replace(/[^0-9]/g, "");
    if (digitsOnly) {
      const numericText = Number(digitsOnly);
      if (Number.isFinite(numericText) && numericText > 0) {
        return Math.round(numericText);
      }
    }
    return null;
  };

  const viewFallbackCount = parseFallbackCount(
    viewCountPrimary,
    "data-fallback-views"
  );
  const videoFallbackCount = parseFallbackCount(
    videoCountPrimary,
    "data-fallback-videos"
  );

  const formatFullNumber = (value) => {
    const rounded = Math.round(Number(value));
    if (!Number.isFinite(rounded)) {
      return null;
    }
    return rounded.toLocaleString();
  };

  const computeDurationLabel = (startDate) => {
    if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
      return "0 months";
    }
    const now = new Date();
    const startMs = startDate.getTime();
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs) || nowMs <= startMs) {
      return "0 months";
    }
    const diffMs = nowMs - startMs;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    let totalMonths =
      (now.getFullYear() - startDate.getFullYear()) * 12 +
      (now.getMonth() - startDate.getMonth());
    if (now.getDate() < startDate.getDate()) {
      totalMonths -= 1;
    }
    if (totalMonths <= 0) {
      totalMonths = Math.max(Math.round(diffDays / 30), 1);
    }
    const label = totalMonths === 1 ? "month" : "months";
    return `${totalMonths.toLocaleString()} ${label}`;
  };

  const updateClipDurationMetadata = () => {
    if (!(CLIP_START_DATE instanceof Date)) {
      return;
    }
    const duration = computeDurationLabel(CLIP_START_DATE);
    clipDurationEls.forEach((el) => {
      el.textContent = duration;
    });
  };

  const applyHeroViewCount = (countValue, { isMock = false } = {}) => {
    if (!viewCountPrimary) {
      return;
    }
    let resolvedCount = null;
    if (Number.isFinite(countValue) && countValue >= 0) {
      resolvedCount = Math.round(countValue);
    } else if (Number.isFinite(viewFallbackCount) && viewFallbackCount > 0) {
      resolvedCount = viewFallbackCount;
      isMock = true;
    }
    const applyDisplay = (value) => {
      viewCountPrimary.textContent = value;
    };

    const togglePlaceholder = (nextIsMock) => {
      if (viewSummaryCard) {
        viewSummaryCard.classList.toggle(
          "hero__clip-summary--placeholder",
          Boolean(nextIsMock)
        );
      }
    };

    if (resolvedCount !== null) {
      const formatted = formatFullNumber(resolvedCount);
      applyDisplay(formatted || resolvedCount.toString());
      togglePlaceholder(isMock);
    } else {
      applyDisplay("-");
      togglePlaceholder(true);
    }
  };

  const applyVideoCount = (countValue, { isMock = false } = {}) => {
    if (!videoCountPrimary) {
      return;
    }
    let resolvedCount = null;
    if (Number.isFinite(countValue) && countValue >= 0) {
      resolvedCount = Math.round(countValue);
    } else if (Number.isFinite(videoFallbackCount) && videoFallbackCount > 0) {
      resolvedCount = videoFallbackCount;
      isMock = true;
    }

    const applyDisplay = (value) => {
      videoCountPrimary.textContent = value;
    };

    const togglePlaceholder = (nextIsMock) => {
      if (clipOutputSection) {
        clipOutputSection.classList.toggle(
          "clip-output--placeholder",
          Boolean(nextIsMock)
        );
      }
    };

    if (resolvedCount !== null) {
      const formatted = formatFullNumber(resolvedCount);
      applyDisplay(formatted || resolvedCount.toString());
      togglePlaceholder(isMock);
    } else {
      applyDisplay("-");
      togglePlaceholder(true);
    }
  };

  updateClipDurationMetadata();
  applyHeroViewCount(null, { isMock: true });
  applyVideoCount(null, { isMock: true });

  if (!metricsEl) {
    return;
  }

  const ENABLE_SOCIAL_PLATFORMS = {
    youtube: true,
    instagram: true,
    tiktok: true,
    facebook: true,
  };

  const resolveApiBase = () => {
    const explicit =
      typeof window !== "undefined" &&
      typeof window.WEB_API_BASE === "string" &&
      window.WEB_API_BASE.trim();
    if (explicit) {
      return window.WEB_API_BASE.trim().replace(/\/$/, "");
    }
    if (typeof window !== "undefined") {
      const host = window.location.hostname;
      if (host === "localhost" || host === "127.0.0.1") {
        return "http://127.0.0.1:5001/api";
      }
    }
    return "/api";
  };

  const API_BASE = resolveApiBase();
  const ENABLE_MOCKS =
    String(window.WEB_ENABLE_MOCKS || "").toLowerCase() === "true";

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
        return `${parseFloat(scaled).toString()}${suffix}`;
      }
    }
    return Math.round(num).toLocaleString();
  };

  const metrics = new Map();
  const platformState = new Map();

  const getOrCreatePlatformState = (platform) => {
    if (!platformState.has(platform)) {
      platformState.set(platform, {
        handles: new Map(),
        pending: new Set(),
        attempted: false,
      });
    }
    return platformState.get(platform);
  };

  const PLACEHOLDER_TEXT = "-";

  const setMetricState = (
    metric,
    {
      count,
      isMock = false,
      accountCount,
      useFallback = false,
      isLoading = false,
    } = {}
  ) => {
    if (!metric || !metric.valueEl) {
      return { accountCount: 0, isMock: true, displayedCount: null };
    }

    const numericCount = Number(count);
    const fallbackCount = Number(metric.fallbackCount);
    const fallbackAccounts = Number(metric.fallbackAccounts);
    const hasFallbackCount = Number.isFinite(fallbackCount);
    const hasFallbackAccounts = Number.isFinite(fallbackAccounts);

    let displayValue = null;
    let resolvedMock = Boolean(isMock);

    if (!isLoading && Number.isFinite(numericCount) && numericCount >= 0) {
      displayValue = numericCount;
    } else if (!isLoading && useFallback && hasFallbackCount) {
      displayValue = fallbackCount;
      resolvedMock = true;
    }

    if (displayValue !== null) {
      const formatted = formatCount(displayValue);
      metric.valueEl.textContent = formatted || PLACEHOLDER_TEXT;
    } else {
      metric.valueEl.textContent = PLACEHOLDER_TEXT;
      resolvedMock = true;
    }

    let resolvedAccounts;
    const numericAccounts = Number(accountCount);
    if (!isLoading && Number.isFinite(numericAccounts) && numericAccounts > 0) {
      resolvedAccounts = numericAccounts;
    } else if (
      !isLoading &&
      useFallback &&
      hasFallbackAccounts &&
      fallbackAccounts > 0
    ) {
      resolvedAccounts = fallbackAccounts;
    } else {
      resolvedAccounts = 0;
    }
    metric.currentAccountCount = resolvedAccounts;
    metric.currentFollowerCount =
      displayValue !== null && Number.isFinite(displayValue) ? displayValue : 0;

    const shouldShowPlaceholder =
      isLoading || resolvedMock || displayValue === null;

    if (shouldShowPlaceholder) {
      metric.element.classList.add("hero__metric--placeholder");
      metric.valueEl.classList.add("hero__metric-value--placeholder");
    } else {
      metric.element.classList.remove("hero__metric--placeholder");
      metric.valueEl.classList.remove("hero__metric-value--placeholder");
    }

    if (isLoading) {
      metric.element.setAttribute("data-loading", "true");
      metric.valueEl.setAttribute("aria-busy", "true");
    } else {
      metric.element.removeAttribute("data-loading");
      metric.valueEl.removeAttribute("aria-busy");
    }

    return {
      accountCount: resolvedAccounts,
      isMock: shouldShowPlaceholder,
      displayedCount: displayValue,
    };
  };

  const socialConfig = window.atroposSocialConfig || {};
  const refreshInterval = Math.max(
    0,
    Number(socialConfig.refreshIntervalMs || 0)
  );

  const updateAggregateStats = () => {
    let accountsTotal = 0;
    let followersTotal = 0;

    metrics.forEach((metric) => {
      if (metric.element.hidden) return;

      const accountValue = Number(metric.currentAccountCount);
      if (Number.isFinite(accountValue) && accountValue > 0) {
        accountsTotal += accountValue;
      }

      const followerValue = Number(metric.currentFollowerCount);
      if (Number.isFinite(followerValue) && followerValue > 0) {
        followersTotal += followerValue;
      }
    });

    if (totalAccountsStat && totalAccountsValue) {
      if (accountsTotal > 0) {
        const label =
          accountsTotal === 1
            ? "1 total account"
            : `${accountsTotal.toLocaleString()} total accounts`;
        totalAccountsValue.textContent = label;
        totalAccountsStat.hidden = false;
      } else {
        totalAccountsValue.textContent = "";
        totalAccountsStat.hidden = true;
      }
    }

    if (totalFollowersStat && totalFollowersValue) {
      if (followersTotal > 0) {
        const formatted = formatCount(followersTotal);
        const label =
          followersTotal === 1
            ? "1 total follower"
            : `${formatted || followersTotal.toLocaleString()} total followers`;
        totalFollowersValue.textContent = label;
        totalFollowersStat.hidden = false;
      } else {
        totalFollowersValue.textContent = "";
        totalFollowersStat.hidden = true;
      }
    }
  };

  const computeGlobalTotals = (selector) => {
    let countTotal = 0;
    let contributingAccounts = 0;
    let hasRealData = false;

    platformState.forEach((state) => {
      state.handles.forEach((entry) => {
        if (!entry) return;
        const value = selector(entry);
        if (Number.isFinite(value) && value >= 0) {
          countTotal += value;
          contributingAccounts += 1;
          if (!entry.isMock) {
            hasRealData = true;
          }
        }
      });
    });

    return { countTotal, contributingAccounts, hasRealData };
  };

  const updateViewSummary = () => {
    if (!viewCountPrimary) {
      return;
    }
    const { countTotal, contributingAccounts, hasRealData } =
      computeGlobalTotals((entry) => entry.viewCount);
    if (contributingAccounts > 0) {
      applyHeroViewCount(countTotal, { isMock: !hasRealData });
    } else {
      applyHeroViewCount(null, { isMock: true });
    }
  };

  const updateVideoSummary = () => {
    if (!videoCountPrimary) {
      return;
    }
    const { countTotal, contributingAccounts, hasRealData } =
      computeGlobalTotals((entry) => entry.videoCount);
    if (contributingAccounts > 0) {
      applyVideoCount(countTotal, { isMock: !hasRealData });
    } else {
      applyVideoCount(null, { isMock: true });
    }
  };

  const recomputePlatformMetric = (platform) => {
    const metric = metrics.get(platform);
    if (!metric) {
      return;
    }
    const state = platformState.get(platform);
    if (!state) {
      setMetricState(metric, {
        count: null,
        accountCount: 0,
        isMock: true,
        useFallback: false,
        isLoading: false,
      });
      updateAggregateStats();
      return;
    }

    let total = 0;
    let resolvedAccounts = 0;
    let hasReal = false;
    state.handles.forEach((entry) => {
      if (!entry) return;
      if (Number.isFinite(entry.count)) {
        total += entry.count;
        resolvedAccounts += 1;
        if (!entry.isMock) {
          hasReal = true;
        }
      }
    });

    const isLoading = state.pending && state.pending.size > 0;

    const shouldUseFallback =
      !isLoading &&
      ENABLE_MOCKS &&
      state.attempted &&
      resolvedAccounts === 0 &&
      state.handles.size > 0;

    setMetricState(metric, {
      count: !isLoading && resolvedAccounts > 0 ? total : null,
      accountCount: resolvedAccounts,
      isMock: resolvedAccounts > 0 ? !hasReal : true,
      useFallback: shouldUseFallback,
      isLoading,
    });
    updateAggregateStats();
    updateViewSummary();
    updateVideoSummary();
  };

  const requestJson = async (path, searchParams) => {
    const url = new URL(`${API_BASE}${path}`, window.location.origin);
    if (searchParams) {
      const params = new URLSearchParams(searchParams);
      params.forEach((value, key) => {
        url.searchParams.set(key, value);
      });
    }
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Request failed with ${res.status}`);
    }
    return res.json();
  };

  const requestStats = (platform, handles) => {
    const normalized = handles.filter((handle) => handle && handle.trim());
    if (!normalized.length) {
      return Promise.resolve(null);
    }
    const params = { platform };
    let path = "/social/stats";
    if (normalized.length === 1) {
      params.handle = normalized[0];
    } else {
      params.handles = normalized.join(",");
      path = "/social/stats/batch";
    }
    return requestJson(path, params);
  };

  const applyStatsResult = (platform, payload) => {
    if (!payload) return;
    const state = getOrCreatePlatformState(platform);
    const perAccount = Array.isArray(payload.per_account)
      ? payload.per_account
      : [];
    perAccount.forEach((entry) => {
      if (!entry || typeof entry.handle !== "string") return;
      const handle = entry.handle.trim();
      if (!handle) return;
      const numeric = Number(entry.count);
      const rawExtra = entry.extra;
      let viewCount = null;
      let videoCount = null;
      if (rawExtra && typeof rawExtra === "object") {
        const rawViews = rawExtra.views ?? null;
        const numericViews = Number(rawViews);
        if (Number.isFinite(numericViews) && numericViews >= 0) {
          viewCount = numericViews;
        }
        const rawVideos = rawExtra.videos ?? null;
        const numericVideos = Number(rawVideos);
        if (Number.isFinite(numericVideos) && numericVideos >= 0) {
          videoCount = numericVideos;
        }
      }
      const record = {
        count: Number.isFinite(numeric) ? numeric : null,
        viewCount,
        videoCount,
        isMock: Boolean(entry.is_mock),
      };
      state.handles.set(handle, record);
    });
  };

  const normalizeHandles = (handles) => {
    if (!Array.isArray(handles)) {
      return [];
    }
    return handles
      .map((handle) => (typeof handle === "string" ? handle.trim() : ""))
      .filter(Boolean);
  };

  const addHandlesToState = (platform, handles) => {
    const normalized = normalizeHandles(handles);
    if (!normalized.length) {
      return [];
    }
    const state = getOrCreatePlatformState(platform);
    normalized.forEach((handle) => {
      if (!state.handles.has(handle)) {
        state.handles.set(handle, {
          count: null,
          viewCount: null,
          videoCount: null,
          isMock: true,
        });
      }
    });
    return normalized;
  };

  const refreshPlatformStats = (platform) => {
    const metric = metrics.get(platform);
    if (!metric || metric.element.hidden) {
      return;
    }

    const state = getOrCreatePlatformState(platform);
    const handles = Array.from(state.handles.keys());
    if (!handles.length) {
      return;
    }

    state.pending.clear();
    handles.forEach((handle) => state.pending.add(handle));
    recomputePlatformMetric(platform);
    return requestStats(platform, handles)
      .then((payload) => {
        applyStatsResult(platform, payload);
      })
      .catch((error) => {
        console.warn(`${platform} stats unavailable`, error);
      })
      .finally(() => {
        state.attempted = true;
        state.pending.clear();
        recomputePlatformMetric(platform);
      });
  };

  const processConfigPayload = (payload) => {
    if (!payload || typeof payload !== "object") {
      return;
    }

    const platforms = payload.platforms || {};
    const legacyHandles = payload.handles || {};

    Object.entries(platforms).forEach(([platformKey, platformConfig]) => {
      if (typeof platformKey !== "string") {
        return;
      }
      const platform = platformKey.toLowerCase();
      if (!metrics.has(platform)) {
        return;
      }

      const directHandles = normalizeHandles(platformConfig?.handles);
      const fallbackHandles = normalizeHandles(legacyHandles[platformKey]);
      const handlesToUse = directHandles.length ? directHandles : fallbackHandles;

      if (!handlesToUse.length) {
        return;
      }

      addHandlesToState(platform, handlesToUse);
      refreshPlatformStats(platform);
    });
  };

  const loadConfig = async () => {
    try {
      const payload = await requestJson("/social/config");
      processConfigPayload(payload);
    } catch (error) {
      console.warn("social config unavailable", error);
    }
  };

  const configureHandlesFromRuntime = () => {
    const runtimeHandles = window.WEB_SOCIAL_HANDLES;
    if (!runtimeHandles || typeof runtimeHandles !== "object") {
      return;
    }
    Object.entries(runtimeHandles).forEach(([rawPlatform, handles]) => {
      if (!rawPlatform || !Array.isArray(handles)) {
        return;
      }
      const platform = rawPlatform.toLowerCase();
      if (!metrics.has(platform)) {
        return;
      }
      addHandlesToState(platform, handles);
    });
  };

  const refreshAllPlatforms = () => {
    metrics.forEach((metric, platform) => {
      if (metric.element.hidden) {
        return;
      }
      void refreshPlatformStats(platform);
    });
  };

  metricsEl.querySelectorAll(".hero__metric").forEach((el) => {
    const platform = el.dataset.platform;
    if (!platform) return;
    const valueEl = el.querySelector(".hero__metric-value");
    if (!valueEl) return;
    const fallbackCount = Number(el.dataset.fallbackCount);
    const fallbackAccounts = Number(el.dataset.fallbackAccounts);
    const metric = {
      platform,
      element: el,
      valueEl,
      fallbackCount: Number.isFinite(fallbackCount) ? fallbackCount : null,
      fallbackAccounts: Number.isFinite(fallbackAccounts)
        ? fallbackAccounts
        : 0,
      currentAccountCount: 0,
      currentFollowerCount: 0,
    };
    metrics.set(platform, metric);
  });

  const enabledPlatforms = [];
  metrics.forEach((metric, platform) => {
    const enabled = ENABLE_SOCIAL_PLATFORMS[platform] !== false;
    metric.element.hidden = !enabled;
    if (!enabled) {
      metric.currentAccountCount = 0;
      metric.currentFollowerCount = 0;
      return;
    }
    enabledPlatforms.push(platform);
    setMetricState(metric, {
      count: null,
      isMock: true,
      accountCount: 0,
      useFallback: false,
      isLoading: false,
    });
  });

  updateAggregateStats();

  if (!enabledPlatforms.length) {
    return;
  }

  configureHandlesFromRuntime();

  refreshAllPlatforms();
  void loadConfig();
  if (refreshInterval) {
    setInterval(refreshAllPlatforms, refreshInterval);
  }
})();
