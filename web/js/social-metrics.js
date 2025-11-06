(() => {
  const metricsEl = document.getElementById("socialMetrics");
  const totalAccountsStat = document.getElementById("totalAccountsStat");
  const totalAccountsValue = document.getElementById("totalAccountsValue");

  if (!metricsEl) {
    return;
  }

  const ENABLE_SOCIAL_PLATFORMS = {
    youtube: true,
    instagram: true,
    tiktok: false,
    facebook: false,
  };

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

  const setMetricState = (
    metric,
    { count, isMock = false, accountCount } = {}
  ) => {
    if (!metric || !metric.valueEl) {
      return { accountCount: 0, isMock: true };
    }

    const numeric = Number(count);
    const fallbackCount = Number(metric.fallbackCount);
    let formatted = Number.isFinite(numeric) ? formatCount(numeric) : null;
    let usedFallback = false;

    if (!formatted && Number.isFinite(fallbackCount)) {
      formatted = formatCount(fallbackCount);
      usedFallback = true;
    }

    if (formatted) {
      metric.valueEl.textContent = formatted;
    }

    let resolvedAccounts;
    if (Number.isFinite(accountCount) && accountCount > 0) {
      resolvedAccounts = accountCount;
    } else if (
      Number.isFinite(metric.fallbackAccounts) &&
      metric.fallbackAccounts > 0
    ) {
      resolvedAccounts = metric.fallbackAccounts;
    } else {
      resolvedAccounts = 0;
    }
    metric.currentAccountCount = resolvedAccounts;

    const shouldMarkMock = usedFallback || Boolean(isMock);

    if (shouldMarkMock) {
      metric.element.classList.add("hero__metric--placeholder");
      metric.valueEl.classList.add("hero__metric-value--placeholder");
    } else {
      metric.element.classList.remove("hero__metric--placeholder");
      metric.valueEl.classList.remove("hero__metric-value--placeholder");
    }

    return { accountCount: resolvedAccounts, isMock: shouldMarkMock };
  };

  const fetchYouTubeSubscribers = async (channelId, apiKey) => {
    const params = new URLSearchParams({
      part: "statistics",
      id: channelId,
      key: apiKey,
    });

    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?${params.toString()}`
    );
    if (!res.ok) {
      throw new Error(`YouTube API request failed with ${res.status}`);
    }
    const data = await res.json();
    const stats = data?.items?.[0]?.statistics;
    return stats ? Number(stats.subscriberCount) : null;
  };

  const fetchInstagramFollowers = async (userId, accessToken) => {
    const params = new URLSearchParams({
      fields: "followers_count",
      access_token: accessToken,
    });

    const res = await fetch(
      `https://graph.facebook.com/v17.0/${userId}?${params.toString()}`
    );
    if (!res.ok) {
      throw new Error(`Instagram API request failed with ${res.status}`);
    }
    const data = await res.json();
    return data ? Number(data.followers_count) : null;
  };

  const fetchFacebookFollowers = async (pageId, accessToken) => {
    const params = new URLSearchParams({
      fields: "fan_count",
      access_token: accessToken,
    });

    const res = await fetch(
      `https://graph.facebook.com/v17.0/${pageId}?${params.toString()}`
    );
    if (!res.ok) {
      throw new Error(`Facebook API request failed with ${res.status}`);
    }
    const data = await res.json();
    return data ? Number(data.fan_count) : null;
  };

  const extractCountFromPath = (data, path) => {
    if (typeof path === "string" && path.trim()) {
      const segments = path.split(".").filter(Boolean);
      let current = data;
      for (const segment of segments) {
        if (current == null || typeof current !== "object") {
          return null;
        }
        current = current[segment];
      }
      const value = Number(current);
      return Number.isFinite(value) ? value : null;
    }

    const candidates = [
      data,
      data?.count,
      data?.followers,
      data?.followers_count,
      data?.fan_count,
      data?.subscriberCount,
    ];

    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value)) {
        return value;
      }
    }
    return null;
  };

  const fetchGenericCount = async (url, jsonPath) => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Request failed with ${res.status}`);
    }
    const data = await res.json();
    const value = extractCountFromPath(data, jsonPath);
    if (!Number.isFinite(value)) {
      throw new Error("Follower count missing in response");
    }
    return value;
  };

  const getYouTubeAccounts = (config) => {
    if (!config) return [];
    const raw = Array.isArray(config.accounts)
      ? config.accounts
      : config.channelId
      ? [config.channelId]
      : [];
    return raw
      .map((entry) => {
        if (typeof entry === "string" && entry.trim()) {
          return { channelId: entry.trim() };
        }
        if (entry && typeof entry.channelId === "string" && entry.channelId.trim()) {
          return { channelId: entry.channelId.trim() };
        }
        return null;
      })
      .filter(Boolean);
  };

  const getInstagramAccounts = (config) => {
    if (!config) return [];
    const baseToken =
      typeof config.accessToken === "string" && config.accessToken.trim()
        ? config.accessToken.trim()
        : "";
    const raw = Array.isArray(config.accounts)
      ? config.accounts
      : config.userId
      ? [config.userId]
      : [];
    return raw
      .map((entry) => {
        if (typeof entry === "string" && entry.trim()) {
          return baseToken
            ? { userId: entry.trim(), accessToken: baseToken }
            : null;
        }
        if (entry && typeof entry.userId === "string" && entry.userId.trim()) {
          const token =
            typeof entry.accessToken === "string" && entry.accessToken.trim()
              ? entry.accessToken.trim()
              : baseToken;
          if (!token) {
            return null;
          }
          return { userId: entry.userId.trim(), accessToken: token };
        }
        return null;
      })
      .filter(Boolean);
  };

  const getFacebookAccounts = (config) => {
    if (!config) return [];
    const baseToken =
      typeof config.accessToken === "string" && config.accessToken.trim()
        ? config.accessToken.trim()
        : "";
    const raw = Array.isArray(config.accounts)
      ? config.accounts
      : config.pageId
      ? [config.pageId]
      : [];
    return raw
      .map((entry) => {
        if (typeof entry === "string" && entry.trim()) {
          return baseToken
            ? { pageId: entry.trim(), accessToken: baseToken }
            : null;
        }
        if (entry && typeof entry.pageId === "string" && entry.pageId.trim()) {
          const token =
            typeof entry.accessToken === "string" && entry.accessToken.trim()
              ? entry.accessToken.trim()
              : baseToken;
          if (!token) {
            return null;
          }
          return { pageId: entry.pageId.trim(), accessToken: token };
        }
        return null;
      })
      .filter(Boolean);
  };

  const getTikTokAccounts = (config) => {
    if (!config) return [];
    const raw = Array.isArray(config.accounts) ? config.accounts : [];
    return raw
      .map((entry) => {
        if (entry == null) return null;
        if (typeof entry === "number" && Number.isFinite(entry)) {
          return { followerCount: entry };
        }
        if (typeof entry === "string" && entry.trim()) {
          const num = Number(entry.trim());
          return Number.isFinite(num) ? { followerCount: num } : null;
        }
        if (
          typeof entry.followerCount === "number" &&
          Number.isFinite(entry.followerCount)
        ) {
          return { followerCount: entry.followerCount };
        }
        if (
          typeof entry.followers === "number" && Number.isFinite(entry.followers)
        ) {
          return { followerCount: entry.followers };
        }
        if (typeof entry.fetchUrl === "string" && entry.fetchUrl.trim()) {
          return {
            fetchUrl: entry.fetchUrl.trim(),
            jsonPath:
              typeof entry.jsonPath === "string" && entry.jsonPath.trim()
                ? entry.jsonPath.trim()
                : typeof entry.countPath === "string" && entry.countPath.trim()
                ? entry.countPath.trim()
                : "",
          };
        }
        return null;
      })
      .filter(Boolean);
  };

  const canLoadPlatform = (platform, config) => {
    switch (platform) {
      case "youtube": {
        return (
          config &&
          typeof config.apiKey === "string" &&
          config.apiKey.trim() &&
          getYouTubeAccounts(config).length > 0
        );
      }
      case "instagram": {
        return getInstagramAccounts(config).length > 0;
      }
      case "tiktok": {
        return getTikTokAccounts(config).length > 0;
      }
      case "facebook": {
        return getFacebookAccounts(config).length > 0;
      }
      default:
        return false;
    }
  };

  const PLATFORM_LOADERS = {
    youtube: async (metric, config) => {
      const accounts = getYouTubeAccounts(config);
      if (!accounts.length) {
        throw new Error("No YouTube accounts configured");
      }
      const apiKey = config.apiKey && config.apiKey.trim();
      if (!apiKey) {
        throw new Error("Missing YouTube API key");
      }
      let total = 0;
      for (const account of accounts) {
        const count = await fetchYouTubeSubscribers(account.channelId, apiKey);
        if (!Number.isFinite(count)) {
          throw new Error(
            `Invalid count for YouTube channel ${account.channelId}`
          );
        }
        total += count;
      }
      return { count: total, accountCount: accounts.length };
    },
    instagram: async (metric, config) => {
      const accounts = getInstagramAccounts(config);
      if (!accounts.length) {
        throw new Error("No Instagram accounts configured");
      }
      let total = 0;
      for (const account of accounts) {
        const count = await fetchInstagramFollowers(
          account.userId,
          account.accessToken
        );
        if (!Number.isFinite(count)) {
          throw new Error(
            `Invalid count for Instagram user ${account.userId}`
          );
        }
        total += count;
      }
      return { count: total, accountCount: accounts.length };
    },
    tiktok: async (metric, config) => {
      const accounts = getTikTokAccounts(config);
      if (!accounts.length) {
        throw new Error("No TikTok accounts configured");
      }
      let total = 0;
      for (const account of accounts) {
        if (Number.isFinite(account.followerCount)) {
          total += account.followerCount;
        } else if (account.fetchUrl) {
          const count = await fetchGenericCount(
            account.fetchUrl,
            account.jsonPath
          );
          total += count;
        } else {
          throw new Error("TikTok account missing follower information");
        }
      }
      return { count: total, accountCount: accounts.length };
    },
    facebook: async (metric, config) => {
      const accounts = getFacebookAccounts(config);
      if (!accounts.length) {
        throw new Error("No Facebook pages configured");
      }
      let total = 0;
      for (const account of accounts) {
        const count = await fetchFacebookFollowers(
          account.pageId,
          account.accessToken
        );
        if (!Number.isFinite(count)) {
          throw new Error(
            `Invalid count for Facebook page ${account.pageId}`
          );
        }
        total += count;
      }
      return { count: total, accountCount: accounts.length };
    },
  };

  const metrics = new Map();
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
    };
    metrics.set(platform, metric);
  });

  const socialConfig = window.atroposSocialConfig || {};
  const refreshInterval = Math.max(
    0,
    Number(socialConfig.refreshIntervalMs || 0)
  );

  const updateTotalAccounts = () => {
    if (!totalAccountsStat || !totalAccountsValue) {
      return;
    }

    let total = 0;
    metrics.forEach((metric) => {
      if (metric.element.hidden) return;
      const value = Number(metric.currentAccountCount);
      if (Number.isFinite(value) && value > 0) {
        total += value;
      }
    });

    if (total > 0) {
      const label =
        total === 1
          ? "1 total account"
          : `${total.toLocaleString()} total accounts`;
      totalAccountsValue.textContent = label;
      totalAccountsStat.hidden = false;
    } else {
      totalAccountsValue.textContent = "";
      totalAccountsStat.hidden = true;
    }
  };

  const enabledPlatforms = [];
  metrics.forEach((metric, platform) => {
    const enabled = ENABLE_SOCIAL_PLATFORMS[platform] !== false;
    metric.element.hidden = !enabled;
    if (!enabled) {
      metric.currentAccountCount = 0;
      return;
    }
    enabledPlatforms.push(platform);
    setMetricState(metric, {
      count: metric.fallbackCount,
      isMock: true,
      accountCount: metric.fallbackAccounts,
    });
  });

  updateTotalAccounts();

  const activePlatforms = enabledPlatforms.filter((platform) =>
    canLoadPlatform(platform, socialConfig[platform])
  );

  if (activePlatforms.length) {
    const loadAll = async () => {
      await Promise.all(
        activePlatforms.map(async (platform) => {
          const metric = metrics.get(platform);
          const loader = PLATFORM_LOADERS[platform];
          const config = socialConfig[platform];
          if (!metric || !loader || !config) {
            return;
          }
          try {
            const result = await loader(metric, config);
            if (result && Number.isFinite(result.count)) {
              setMetricState(metric, {
                count: result.count,
                isMock: Boolean(result.isMock),
                accountCount: result.accountCount,
              });
            }
          } catch (error) {
            console.warn(`${platform} metrics unavailable`, error);
            setMetricState(metric, {
              count: metric.fallbackCount,
              isMock: true,
              accountCount: metric.fallbackAccounts,
            });
          }
          updateTotalAccounts();
        })
      );
    };

    loadAll();
    if (refreshInterval) {
      setInterval(loadAll, refreshInterval);
    }
  }
})();
