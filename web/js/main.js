document.getElementById("year").textContent = new Date().getFullYear();

const form = document.getElementById("signup");
const statusEl = document.getElementById("status");
const emailEl = document.getElementById("email");
const btn = document.getElementById("submitBtn");
const nav = document.getElementById("topNav");
const navTarget = document.getElementById("navSignupTarget");
const heroSlot = document.getElementById("heroSignupSlot");
const signupWrapper = document.getElementById("signupWrapper");
const sentinel = document.getElementById("signupScrollSentinel");
const phraseRotator = document.getElementById("phraseRotator");
const phraseAnnouncer = document.getElementById("phraseAnnouncer");
const metricsEl = document.getElementById("socialMetrics");
const totalAccountsStat = document.getElementById("totalAccountsStat");
const totalAccountsValue = document.getElementById("totalAccountsValue");

const ENABLE_SOCIAL_PLATFORMS = {
  youtube: true,
  instagram: true,
  tiktok: false,
  facebook: false,
};

function moveSignup(toNav) {
  if (!signupWrapper || !nav || !navTarget || !heroSlot) return;

  heroSlot.classList.toggle("signup-slot--empty", toNav);

  const destination = toNav ? navTarget : heroSlot;
  if (!destination.contains(signupWrapper)) {
    destination.appendChild(signupWrapper);
  }

  if (toNav) {
    nav.classList.add("compact");
    document.body.classList.add("nav-compact");
  } else {
    nav.classList.remove("compact");
    document.body.classList.remove("nav-compact");
  }
}

if (signupWrapper && nav && navTarget && heroSlot && sentinel) {
  const observerCallback = (entries) => {
    const entry = entries[0];
    if (!entry) return;
    moveSignup(!entry.isIntersecting);
  };

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(observerCallback, {
      rootMargin: "-120px 0px 0px 0px",
    });
    observer.observe(sentinel);
  } else {
    const handleScroll = () => {
      const rect = sentinel.getBoundingClientRect();
      moveSignup(rect.top < 100);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
  }
}

function showStatus(kind, text) {
  statusEl.className = "status show " + (kind || "");
  statusEl.textContent = text || "";
}
function hideStatus() {
  statusEl.className = "status";
  statusEl.textContent = "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideStatus(); // no empty box before we have text

  const email = emailEl.value.trim();
  if (!email) return;

  btn.disabled = true;
  showStatus("", "Sending…");

  try {
    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    let data = {};
    try {
      data = await res.json();
    } catch {}

    if (res.ok && data && data.ok) {
      if (data.duplicate) {
        showStatus("info", "You're already on the list.");
      } else {
        showStatus("success", "Welcome aboard — you're on the list!");
        form.reset();
      }
    } else if (res.status === 400 && data && data.error) {
      showStatus("error", data.error); // validation issue (e.g., bad email)
    } else {
      showStatus(
        "error",
        "Something went wrong on our side. Please try again shortly."
      );
    }
  } catch {
    showStatus("error", "Network error. Check your connection and try again.");
  } finally {
    btn.disabled = false;
  }
});

const marketingPhrases = [
  "Turn long-form into shorts",
  "Repurpose live streams",
  "Clip channels 24/7",
];
const rotationInterval = 5000;

function ensureRotatorSize() {
  if (!phraseRotator) return;

  const host = phraseRotator.closest(".hero__rotator");
  if (!host) return;

  const phrases = new Set(marketingPhrases);
  const initial = phraseRotator.dataset.initialPhrase;
  if (initial) {
    phrases.add(initial);
  }

  if (!phrases.size) return;

  let maxWidth = 0;
  let maxHeight = 0;
  const measurer = document.createElement("span");
  measurer.className = "hero__rotator-measure";
  host.appendChild(measurer);

  for (const text of phrases) {
    measurer.textContent = text;
    const rect = measurer.getBoundingClientRect();
    maxWidth = Math.max(maxWidth, rect.width);
    maxHeight = Math.max(maxHeight, rect.height);
  }

  measurer.remove();

  if (maxWidth) {
    const width = Math.ceil(maxWidth) + 2;
    host.style.setProperty("--hero-rotator-max-width", `${width}px`);
  }

  if (maxHeight) {
    const height = Math.ceil(maxHeight) + 2;
    host.style.setProperty("--hero-rotator-max-height", `${height}px`);
    phraseRotator.style.setProperty("--hero-rotator-max-height", `${height}px`);
  }
}
function setPhraseImmediate(phrase) {
  if (!phraseRotator) return;
  phraseRotator.innerHTML = "";
  const span = document.createElement("span");
  span.className = "hero__rotator-phrase hero__rotator-phrase--current";
  span.textContent = phrase;
  phraseRotator.appendChild(span);
}

function animateToPhrase(phrase) {
  if (!phraseRotator) return;

  const current = phraseRotator.querySelector(
    ".hero__rotator-phrase--current"
  );

  if (!current) {
    setPhraseImmediate(phrase);
    return;
  }

  if (current.textContent === phrase) {
    return;
  }

  current.classList.remove("hero__rotator-phrase--enter");
  current.classList.add("hero__rotator-phrase--leave");
  current.classList.remove("hero__rotator-phrase--current");

  const next = document.createElement("span");
  next.className = "hero__rotator-phrase hero__rotator-phrase--enter";
  next.textContent = phrase;
  phraseRotator.appendChild(next);

  current.addEventListener(
    "animationend",
    () => {
      current.remove();
    },
    { once: true }
  );

  next.addEventListener(
    "animationend",
    () => {
      next.classList.remove("hero__rotator-phrase--enter");
      next.classList.add("hero__rotator-phrase--current");
    },
    { once: true }
  );
}

function announcePhrase(text) {
  if (phraseAnnouncer) {
    phraseAnnouncer.textContent = `Marketing phrase: ${text}.`;
  }
}

if (phraseRotator && marketingPhrases.length) {
  ensureRotatorSize();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready
      .then(() => {
        ensureRotatorSize();
      })
      .catch(() => {});
  }
  let sizeRaf = null;
  window.addEventListener("resize", () => {
    if (sizeRaf) return;
    sizeRaf = window.requestAnimationFrame(() => {
      sizeRaf = null;
      ensureRotatorSize();
    });
  });

  const initialPhrase =
    phraseRotator.dataset.initialPhrase || marketingPhrases[0];
  let currentIndex = Math.max(
    marketingPhrases.indexOf(initialPhrase),
    0
  );

  setPhraseImmediate(initialPhrase);
  announcePhrase(initialPhrase);

  if (marketingPhrases.length > 1) {
    const rotatePhrase = () => {
      const nextIndex = (currentIndex + 1) % marketingPhrases.length;
      const phrase = marketingPhrases[nextIndex];
      animateToPhrase(phrase);
      announcePhrase(phrase);
      currentIndex = nextIndex;
    };

    setInterval(rotatePhrase, rotationInterval);
  }
}

function formatCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
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
}

function setMetricState(metric, { count, isMock = false, accountCount } = {}) {
  if (!metric || !metric.valueEl) return;

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
}

async function fetchYouTubeSubscribers(channelId, apiKey) {
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
}

async function fetchInstagramFollowers(userId, accessToken) {
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
}

async function fetchFacebookFollowers(pageId, accessToken) {
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
}

function extractCountFromPath(data, path) {
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
}

async function fetchGenericCount(url, jsonPath) {
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
}

function getYouTubeAccounts(config) {
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
}

function getInstagramAccounts(config) {
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
}

function getFacebookAccounts(config) {
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
}

function getTikTokAccounts(config) {
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
      if (typeof entry.followerCount === "number" && Number.isFinite(entry.followerCount)) {
        return { followerCount: entry.followerCount };
      }
      if (typeof entry.followers === "number" && Number.isFinite(entry.followers)) {
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
}

function canLoadPlatform(platform, config) {
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
}

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
        throw new Error(`Invalid count for YouTube channel ${account.channelId}`);
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
        throw new Error(`Invalid count for Instagram user ${account.userId}`);
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
        const count = await fetchGenericCount(account.fetchUrl, account.jsonPath);
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
      const count = await fetchFacebookFollowers(account.pageId, account.accessToken);
      if (!Number.isFinite(count)) {
        throw new Error(`Invalid count for Facebook page ${account.pageId}`);
      }
      total += count;
    }
    return { count: total, accountCount: accounts.length };
  },
};

if (metricsEl) {
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
      fallbackAccounts: Number.isFinite(fallbackAccounts) ? fallbackAccounts : 0,
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
          } catch (err) {
            console.warn(`${platform} metrics unavailable`, err);
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
}
