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

function applyMetric(el, value, fallback) {
  if (!el) return;
  const formatted = formatCount(value);
  if (formatted) {
    el.textContent = formatted;
  } else if (fallback) {
    el.textContent = fallback;
  }
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

if (metricsEl) {
  const youtubeFallback = metricsEl.dataset.youtubeFallback;
  const instagramFallback = metricsEl.dataset.instagramFallback;
  if (youtubeFallback && youtubeMetricEl) {
    applyMetric(youtubeMetricEl, Number(youtubeFallback), youtubeFallback);
  }
  if (instagramFallback && instagramMetricEl) {
    applyMetric(
      instagramMetricEl,
      Number(instagramFallback),
      instagramFallback
    );
  }

  const socialConfig = window.atroposSocialConfig || {};
  const youtubeConfig = socialConfig.youtube || {};
  const instagramConfig = socialConfig.instagram || {};
  const refreshInterval = Math.max(
    0,
    Number(socialConfig.refreshIntervalMs || 0)
  );

  const loadMetrics = async () => {
    try {
      if (youtubeConfig.channelId && youtubeConfig.apiKey && youtubeMetricEl) {
        const count = await fetchYouTubeSubscribers(
          youtubeConfig.channelId,
          youtubeConfig.apiKey
        );
        applyMetric(youtubeMetricEl, count, youtubeMetricEl.textContent);
      }
    } catch (err) {
      console.warn("YouTube metrics unavailable", err);
    }

    try {
      if (
        instagramConfig.userId &&
        instagramConfig.accessToken &&
        instagramMetricEl
      ) {
        const count = await fetchInstagramFollowers(
          instagramConfig.userId,
          instagramConfig.accessToken
        );
        applyMetric(
          instagramMetricEl,
          count,
          instagramMetricEl.textContent
        );
      }
    } catch (err) {
      console.warn("Instagram metrics unavailable", err);
    }
  };

  if (youtubeConfig.channelId || instagramConfig.userId) {
    loadMetrics();
    if (refreshInterval) {
      setInterval(loadMetrics, refreshInterval);
    }
  }
}
