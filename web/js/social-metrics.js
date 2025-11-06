(() => {
  const metricsEl = document.getElementById("socialMetrics");
  const totalAccountsStat = document.getElementById("totalAccountsStat");
  const totalAccountsValue = document.getElementById("totalAccountsValue");

  if (!metricsEl) {
    return;
  }

  const socialConfig = window.atroposSocialConfig || {};

  const ENABLE_SOCIAL_PLATFORMS = {
    youtube: true,
    instagram: true,
    tiktok: true,
    facebook: true,
  };

  const LOCAL_API_DEFAULT_PORT = 5001;

  const isLocalEnvironment = () => {
    const { protocol, hostname } = window.location;
    if (protocol === "file:") {
      return true;
    }
    if (!hostname) {
      return false;
    }
    const normalized = hostname.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized === "localhost" || normalized === "::1") {
      return true;
    }
    if (normalized.endsWith(".local")) {
      return true;
    }
    return /^127(?:\.[0-9]{1,3}){3}$/.test(normalized);
  };

  const resolveLocalScrapeEndpoint = () => {
    if (!isLocalEnvironment()) {
      return null;
    }

    const override =
      typeof socialConfig.localApiBaseUrl === "string"
        ? socialConfig.localApiBaseUrl.trim()
        : "";
    if (override) {
      const normalized = override.replace(/\/+$/, "");
      if (/^https?:\/\//i.test(normalized)) {
        return `${normalized}/social-metrics/scrape`;
      }
    }

    const portValue = Number(socialConfig.localApiPort);
    const port = Number.isFinite(portValue)
      ? portValue
      : LOCAL_API_DEFAULT_PORT;
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    const hostname =
      (window.location.hostname && window.location.hostname.trim()) ||
      "127.0.0.1";
    const portSegment = port > 0 ? `:${port}` : "";
    return `${protocol}//${hostname}${portSegment}/social-metrics/scrape`;
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
    { count, isMock = false, accountCount, allowFallback = true } = {}
  ) => {
    if (!metric || !metric.valueEl) {
      return { accountCount: 0, isMock: true };
    }

    const numeric = Number(count);
    const fallbackCount = Number(metric.fallbackCount);
    let formatted = Number.isFinite(numeric) ? formatCount(numeric) : null;
    let usedFallback = false;
    let markUnavailable = false;

    if (!formatted && allowFallback && Number.isFinite(fallbackCount)) {
      formatted = formatCount(fallbackCount);
      usedFallback = true;
    }

    if (formatted) {
      metric.valueEl.textContent = formatted;
    } else {
      metric.valueEl.textContent = "N/A";
      markUnavailable = true;
    }

    let resolvedAccounts;
    const canUseFallbackCounts = allowFallback !== false;

    if (Number.isFinite(accountCount) && accountCount > 0) {
      resolvedAccounts = accountCount;
    } else if (
      canUseFallbackCounts &&
      Number.isFinite(metric.fallbackAccounts) &&
      metric.fallbackAccounts > 0
    ) {
      resolvedAccounts = metric.fallbackAccounts;
    } else {
      resolvedAccounts = 0;
    }
    metric.currentAccountCount = resolvedAccounts;

    const shouldMarkMock = markUnavailable || usedFallback || Boolean(isMock);

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
          const channelId = entry.trim();
          const defaultPattern =
            typeof config.scrapePattern === "string" && config.scrapePattern.trim()
              ? config.scrapePattern.trim()
              : null;
          return {
            channelId,
            scrapeUrl: `https://www.youtube.com/channel/${channelId}/about`,
            scrapePattern: defaultPattern,
          };
        }
        if (entry && typeof entry.channelId === "string" && entry.channelId.trim()) {
          const channelId = entry.channelId.trim();
          const explicitUrl =
            typeof entry.scrapeUrl === "string" && entry.scrapeUrl.trim()
              ? entry.scrapeUrl.trim()
              : typeof entry.channelUrl === "string" && entry.channelUrl.trim()
              ? entry.channelUrl.trim()
              : "";
          const defaultUrl = channelId
            ? `https://www.youtube.com/channel/${channelId}/about`
            : "";
          const pattern =
            typeof entry.scrapePattern === "string" && entry.scrapePattern.trim()
              ? entry.scrapePattern.trim()
              : typeof config.scrapePattern === "string" && config.scrapePattern.trim()
              ? config.scrapePattern.trim()
              : null;
          return {
            channelId,
            scrapeUrl: explicitUrl || defaultUrl,
            scrapePattern: pattern,
          };
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
          const trimmed = entry.trim();
          const isNumericId = /^[0-9]+$/.test(trimmed);
          return baseToken
            ? {
                userId: trimmed,
                username: isNumericId ? "" : trimmed,
                accessToken: baseToken,
                scrapeUrl: isNumericId
                  ? ""
                  : `https://www.instagram.com/${trimmed.replace(/^@/, "")}/`,
                scrapePattern:
                  typeof config.scrapePattern === "string" && config.scrapePattern.trim()
                    ? config.scrapePattern.trim()
                    : null,
              }
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
          const username =
            typeof entry.username === "string" && entry.username.trim()
              ? entry.username.trim().replace(/^@/, "")
              : "";
          const profileUrl =
            typeof entry.profileUrl === "string" && entry.profileUrl.trim()
              ? entry.profileUrl.trim()
              : "";
          const scrapePattern =
            typeof entry.scrapePattern === "string" && entry.scrapePattern.trim()
              ? entry.scrapePattern.trim()
              : typeof config.scrapePattern === "string" && config.scrapePattern.trim()
              ? config.scrapePattern.trim()
              : null;
          return {
            userId: entry.userId.trim(),
            username,
            accessToken: token,
            scrapeUrl:
              typeof entry.scrapeUrl === "string" && entry.scrapeUrl.trim()
                ? entry.scrapeUrl.trim()
                : profileUrl
                ? profileUrl
                : username
                ? `https://www.instagram.com/${username}/`
                : "",
            scrapePattern,
          };
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
          const pageId = entry.trim();
          return baseToken
            ? {
                pageId,
                accessToken: baseToken,
                scrapeUrl: `https://www.facebook.com/${pageId}/`,
                scrapePattern:
                  typeof config.scrapePattern === "string" && config.scrapePattern.trim()
                    ? config.scrapePattern.trim()
                    : null,
              }
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
          const pageId = entry.pageId.trim();
          const scrapePattern =
            typeof entry.scrapePattern === "string" && entry.scrapePattern.trim()
              ? entry.scrapePattern.trim()
              : typeof config.scrapePattern === "string" && config.scrapePattern.trim()
              ? config.scrapePattern.trim()
              : null;
          const scrapeUrl =
            typeof entry.scrapeUrl === "string" && entry.scrapeUrl.trim()
              ? entry.scrapeUrl.trim()
              : typeof entry.pageUrl === "string" && entry.pageUrl.trim()
              ? entry.pageUrl.trim()
              : `https://www.facebook.com/${pageId}/`;
          return {
            pageId,
            accessToken: token,
            scrapeUrl,
            scrapePattern,
          };
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

        const normalized = {};

        if (typeof entry === "number" && Number.isFinite(entry)) {
          normalized.followerCount = entry;
        } else if (typeof entry === "string" && entry.trim()) {
          const trimmed = entry.trim();
          const num = Number(trimmed);
          if (Number.isFinite(num)) {
            normalized.followerCount = num;
          } else {
            normalized.scrapeUrl = trimmed;
          }
        } else if (typeof entry === "object") {
          if (
            typeof entry.followerCount === "number" &&
            Number.isFinite(entry.followerCount)
          ) {
            normalized.followerCount = entry.followerCount;
          }

          if (
            typeof entry.followers === "number" &&
            Number.isFinite(entry.followers)
          ) {
            normalized.followerCount = entry.followers;
          }

          if (typeof entry.fetchUrl === "string" && entry.fetchUrl.trim()) {
            normalized.fetchUrl = entry.fetchUrl.trim();
            const pathCandidate =
              (typeof entry.jsonPath === "string" && entry.jsonPath.trim()) ||
              (typeof entry.countPath === "string" && entry.countPath.trim()) ||
              "";
            normalized.jsonPath = pathCandidate;
          }

          if (typeof entry.scrapeUrl === "string" && entry.scrapeUrl.trim()) {
            normalized.scrapeUrl = entry.scrapeUrl.trim();
          }

          if (
            typeof entry.scrapePattern === "string" &&
            entry.scrapePattern.trim()
          ) {
            normalized.scrapePattern = entry.scrapePattern.trim();
          }
        }

        if (
          normalized.scrapePattern == null &&
          typeof config.scrapePattern === "string" &&
          config.scrapePattern.trim()
        ) {
          normalized.scrapePattern = config.scrapePattern.trim();
        }

        if (Object.keys(normalized).length === 0) {
          return null;
        }

        return normalized;
      })
      .filter(Boolean);
  };

  const sanitizePattern = (value) =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  const ensureAbsoluteUrl = (url, domainHint) => {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) {
      return url;
    }
    if (domainHint) {
      const prefix = domainHint.endsWith("/") ? domainHint : `${domainHint}/`;
      return `${prefix}${url.replace(/^\/+/, "")}`;
    }
    return url;
  };

  const ensureSuffix = (url, suffix) => {
    if (!url) return "";
    const normalized = url.endsWith("/") ? url.slice(0, -1) : url;
    const suffixValue = suffix.startsWith("/") ? suffix : `/${suffix}`;
    if (normalized.endsWith(suffixValue)) {
      return normalized;
    }
    return `${normalized}${suffixValue}`;
  };

  const DEFAULT_SCRAPE_PATTERNS = {
    youtube: "(?P<count>[0-9.,KMB]+)\\s+subscribers",
    instagram: '"edge_followed_by"\\s*:\\s*\\{"count"\\s*:\\s*(?P<count>[0-9]+)\\}',
    facebook: '"fan_count"\\s*:\\s*(?P<count>[0-9]+)',
    tiktok: "(?P<count>[0-9.,KMB]+)\\s+Followers",
  };

  const buildScrapePayload = (platform, config) => {
    switch (platform) {
      case "youtube": {
        const accounts = getYouTubeAccounts(config)
          .map((account) => {
            const url = ensureSuffix(
              ensureAbsoluteUrl(account.scrapeUrl, "https://www.youtube.com"),
              "about"
            );
            if (!url) {
              return null;
            }
            const pattern =
              sanitizePattern(account.scrapePattern) || DEFAULT_SCRAPE_PATTERNS.youtube;
            return { url, pattern };
          })
          .filter(Boolean);
        return accounts.length ? { platform, accounts } : null;
      }
      case "instagram": {
        const accounts = getInstagramAccounts(config)
          .map((account) => {
            const url = ensureAbsoluteUrl(
              account.scrapeUrl ||
                (account.username
                  ? `https://www.instagram.com/${account.username}/`
                  : ""),
              "https://www.instagram.com"
            );
            if (!url) {
              return null;
            }
            const pattern =
              sanitizePattern(account.scrapePattern) || DEFAULT_SCRAPE_PATTERNS.instagram;
            return { url, pattern };
          })
          .filter(Boolean);
        return accounts.length ? { platform, accounts } : null;
      }
      case "facebook": {
        const accounts = getFacebookAccounts(config)
          .map((account) => {
            const url = ensureAbsoluteUrl(
              account.scrapeUrl || account.pageUrl || "",
              "https://www.facebook.com"
            );
            if (!url) {
              return null;
            }
            const pattern =
              sanitizePattern(account.scrapePattern) || DEFAULT_SCRAPE_PATTERNS.facebook;
            return { url, pattern };
          })
          .filter(Boolean);
        return accounts.length ? { platform, accounts } : null;
      }
      case "tiktok": {
        const accounts = getTikTokAccounts(config)
          .map((account) => {
            const url = ensureAbsoluteUrl(
              account.scrapeUrl || "",
              "https://www.tiktok.com"
            );
            if (!url) {
              return null;
            }
            const pattern =
              sanitizePattern(account.scrapePattern) || DEFAULT_SCRAPE_PATTERNS.tiktok;
            return { url, pattern };
          })
          .filter(Boolean);
        return accounts.length ? { platform, accounts } : null;
      }
      default:
        return null;
    }
  };

  const tryScrapeFallback = async (platform, config) => {
    const payload = buildScrapePayload(platform, config);
    if (!payload) {
      return null;
    }

    const endpoint = resolveLocalScrapeEndpoint();
    if (!endpoint) {
      return null;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      const message = data?.error || `Scrape fallback failed with ${res.status}`;
      throw new Error(message);
    }

    if (Array.isArray(data?.errors) && data.errors.length) {
      console.warn(`${platform} scrape fallback reported issues`, data.errors);
    }

    const rawCount =
      data && typeof data.count === "number" ? data.count : null;
    const hasValidCount = Number.isFinite(rawCount);
    const finalCount = hasValidCount ? rawCount : Number.NaN;
    const rawAccountCount =
      data && typeof data.accountCount === "number" ? data.accountCount : null;
    const accountCount = Number.isFinite(rawAccountCount)
      ? rawAccountCount
      : hasValidCount
      ? payload.accounts.length
      : 0;

    return {
      count: finalCount,
      accountCount,
      isMock: true,
      allowFallback: hasValidCount,
    };
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

  const markMetricPending = (metric) => {
    if (!metric || !metric.valueEl) {
      return;
    }
    metric.valueEl.textContent = "-";
    metric.element.classList.add("hero__metric--placeholder");
    metric.valueEl.classList.add("hero__metric-value--placeholder");
    metric.currentAccountCount = 0;
  };

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
    markMetricPending(metric);
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

          let resolved = false;

          try {
            const result = await loader(metric, config);
            if (result && Number.isFinite(result.count)) {
              setMetricState(metric, {
                count: result.count,
                isMock: Boolean(result.isMock),
                accountCount: result.accountCount,
              });
              resolved = true;
            } else if (result) {
              console.warn(
                `${platform} metrics invalid`,
                result
              );
            }
          } catch (error) {
            console.warn(`${platform} metrics unavailable`, error);
          }

          if (!resolved) {
            try {
              const fallbackResult = await tryScrapeFallback(platform, config);
              if (fallbackResult) {
                setMetricState(metric, fallbackResult);
                resolved = true;
              }
            } catch (scrapeError) {
              console.warn(`${platform} scrape fallback failed`, scrapeError);
            }
          }

          if (!resolved) {
            setMetricState(metric, {
              count: Number.NaN,
              isMock: true,
              accountCount: 0,
              allowFallback: false,
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
