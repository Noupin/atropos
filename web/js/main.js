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
const youtubeMetricEl = document.getElementById("youtubeMetric");
const instagramMetricEl = document.getElementById("instagramMetric");
const tiktokMetricEl = document.getElementById("tiktokMetric");
const facebookMetricEl = document.getElementById("facebookMetric");

function moveSignup(toNav) {
  if (!signupWrapper || !nav || !navTarget || !heroSlot) return;

  const destination = toNav ? navTarget : heroSlot;
  if (destination.contains(signupWrapper)) return;

  destination.appendChild(signupWrapper);
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

function coerceCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function formatCount(value) {
  const num = coerceCount(value);
  if (num === null) return null;
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

function applyMetric(el, value, fallback) {
  if (!el) return;
  const formatted = formatCount(value);
  if (formatted) {
    el.textContent = formatted;
  } else if (fallback !== undefined && fallback !== null && fallback !== "") {
    el.textContent = fallback;
  }
}

async function fetchYouTubeSubscribers(account = {}, options = {}) {
  const { channelId, apiKey, mockCount } = account;
  const fallback = coerceCount(mockCount ?? options.mockCount);
  if (!channelId || !apiKey) {
    return fallback;
  }

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
  const count = coerceCount(stats?.subscriberCount);
  return count ?? fallback;
}

async function fetchInstagramFollowers(account = {}, options = {}) {
  const { userId, accessToken, mockCount } = account;
  const fallback = coerceCount(mockCount ?? options.mockCount);
  if (!userId || !accessToken) {
    return fallback;
  }

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
  const count = coerceCount(data?.followers_count);
  return count ?? fallback;
}

async function fetchTikTokFollowers(account = {}, options = {}) {
  const { openId, accessToken, mockCount } = account;
  const fallback = coerceCount(mockCount ?? options.mockCount);
  if (!openId || !accessToken) {
    return fallback;
  }

  const params = new URLSearchParams({ fields: "follower_count" });
  const res = await fetch(
    `https://open.tiktokapis.com/v2/user/info/?${params.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ open_id: openId }),
    }
  );
  if (!res.ok) {
    throw new Error(`TikTok API request failed with ${res.status}`);
  }

  const data = await res.json();
  const count = coerceCount(data?.data?.user?.follower_count);
  return count ?? fallback;
}

async function fetchFacebookFollowers(account = {}, options = {}) {
  const { pageId, accessToken, mockCount } = account;
  const fallback = coerceCount(mockCount ?? options.mockCount);
  if (!pageId || !accessToken) {
    return fallback;
  }

  const params = new URLSearchParams({
    fields: "followers_count",
    access_token: accessToken,
  });

  const res = await fetch(
    `https://graph.facebook.com/v17.0/${pageId}?${params.toString()}`
  );
  if (!res.ok) {
    throw new Error(`Facebook API request failed with ${res.status}`);
  }

  const data = await res.json();
  const count = coerceCount(data?.followers_count);
  return count ?? fallback;
}

function normalizePlatformConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object") {
    return { accounts: [], mockCount: null };
  }

  const accounts = [];
  if (Array.isArray(rawConfig.accounts)) {
    for (const account of rawConfig.accounts) {
      if (account && typeof account === "object") {
        accounts.push(account);
      }
    }
  } else {
    const candidate = rawConfig;
    const accountKeys = [
      "channelId",
      "apiKey",
      "userId",
      "accessToken",
      "openId",
      "pageId",
    ];
    const hasAccountField = accountKeys.some(
      (key) => key in candidate && candidate[key]
    );
    if (hasAccountField) {
      accounts.push(candidate);
    }
  }

  const mockCount =
    rawConfig.mockCount !== undefined ? rawConfig.mockCount : null;

  return {
    accounts,
    mockCount,
  };
}

async function fetchPlatformTotal(
  platformKey,
  platformConfig,
  fetcher,
  fallbackValue
) {
  const fallback = coerceCount(
    platformConfig.mockCount !== null && platformConfig.mockCount !== undefined
      ? platformConfig.mockCount
      : fallbackValue
  );

  const accounts = Array.isArray(platformConfig.accounts)
    ? platformConfig.accounts.filter((account) => account && typeof account === "object")
    : [];

  if (!accounts.length) {
    return fallback;
  }

  let total = 0;
  let hasValue = false;

  for (const account of accounts) {
    try {
      const value = await fetcher(account, {
        mockCount:
          account?.mockCount !== undefined && account?.mockCount !== null
            ? account.mockCount
            : platformConfig.mockCount !== null &&
              platformConfig.mockCount !== undefined
            ? platformConfig.mockCount
            : fallback,
      });
      const count = coerceCount(value);
      if (count !== null) {
        total += count;
        hasValue = true;
      }
    } catch (err) {
      console.warn(`${platformKey} metrics unavailable`, err);
    }
  }

  if (hasValue) {
    return total;
  }

  return fallback;
}

if (metricsEl) {
  const dataset = metricsEl.dataset || {};
  const metricElements = {
    youtube: youtubeMetricEl,
    instagram: instagramMetricEl,
    tiktok: tiktokMetricEl,
    facebook: facebookMetricEl,
  };

  for (const [key, element] of Object.entries(metricElements)) {
    if (!element) continue;
    const fallbackValue = dataset[`${key}Fallback`];
    if (fallbackValue !== undefined && fallbackValue !== "") {
      applyMetric(element, coerceCount(fallbackValue), fallbackValue);
    }
  }

  const socialConfig = window.atroposSocialConfig || {};
  const metricsFeatureEnabled = socialConfig.metricsFeatureEnabled !== false;

  if (!metricsFeatureEnabled) {
    metricsEl.hidden = true;
    return;
  }

  metricsEl.hidden = false;

  const refreshInterval = Math.max(
    0,
    Number(socialConfig.refreshIntervalMs || 0)
  );

  const platforms = [
    {
      key: "youtube",
      config: normalizePlatformConfig(socialConfig.youtube),
      element: youtubeMetricEl,
      fetcher: fetchYouTubeSubscribers,
    },
    {
      key: "instagram",
      config: normalizePlatformConfig(socialConfig.instagram),
      element: instagramMetricEl,
      fetcher: fetchInstagramFollowers,
    },
    {
      key: "tiktok",
      config: normalizePlatformConfig(socialConfig.tiktok),
      element: tiktokMetricEl,
      fetcher: fetchTikTokFollowers,
    },
    {
      key: "facebook",
      config: normalizePlatformConfig(socialConfig.facebook),
      element: facebookMetricEl,
      fetcher: fetchFacebookFollowers,
    },
  ];

  const shouldLoad = platforms.some(({ config }) => {
    if (!config) return false;
    const hasAccounts = Array.isArray(config.accounts) && config.accounts.length > 0;
    const hasMock = coerceCount(config.mockCount) !== null;
    return hasAccounts || hasMock;
  });

  if (!shouldLoad) {
    return;
  }

  const loadMetrics = async () => {
    for (const platform of platforms) {
      const { key, config, element, fetcher } = platform;
      if (!element || !config) continue;

      const fallbackValue = dataset[`${key}Fallback`];
      const count = await fetchPlatformTotal(
        key,
        config,
        fetcher,
        fallbackValue
      );
      applyMetric(element, count, element.textContent);
    }
  };

  loadMetrics();
  if (refreshInterval) {
    setInterval(loadMetrics, refreshInterval);
  }
}
