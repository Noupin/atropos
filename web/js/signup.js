(() => {
  const form = document.getElementById("signup");
  const statusEl = document.getElementById("status");
  const emailEl = document.getElementById("email");
  const submitBtn = document.getElementById("submitBtn");
  const nav = document.getElementById("topNav");
  const navTarget = document.getElementById("navSignupTarget");
  const heroSlot = document.getElementById("heroSignupSlot");
  const signupWrapper = document.getElementById("signupWrapper");
  const sentinel = document.getElementById("signupScrollSentinel");

  if (!form || !statusEl || !emailEl || !submitBtn) {
    return;
  }

  const pulseClass = "signup-button--pulse";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
  let isSubmitting = false;

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

  const buildApiUrl = (path) => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return new URL(`${API_BASE}${normalizedPath}`, window.location.origin).toString();
  };

  const isEmailValid = (value) => emailPattern.test(value);

  const updateSubmitState = () => {
    const emailValue = emailEl.value.trim();
    const hasValue = emailValue.length > 0;
    const isValid = isEmailValid(emailValue);
    submitBtn.disabled = isSubmitting || !isValid;
    emailEl.classList.toggle("input-invalid", hasValue && !isValid);
    emailEl.setCustomValidity(
      !hasValue || isValid ? "" : "Enter a valid email address."
    );

    if (submitBtn.disabled) {
      submitBtn.classList.remove(pulseClass);
    }
  };

  const triggerButtonPulse = () => {
    if (submitBtn.disabled) {
      submitBtn.classList.remove(pulseClass);
      return;
    }

    submitBtn.classList.remove(pulseClass);
    // Force a reflow so the animation restarts consistently.
    void submitBtn.offsetWidth;
    submitBtn.classList.add(pulseClass);
  };

  updateSubmitState();
  triggerButtonPulse();
  document.addEventListener("hero:phrase-rotated", triggerButtonPulse);
  emailEl.addEventListener("input", () => {
    updateSubmitState();
    if (!submitBtn.disabled) {
      triggerButtonPulse();
    }
  });

  const toggleNavSignup = (toNav) => {
    if (!signupWrapper || !nav || !navTarget || !heroSlot) {
      return;
    }

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
  };

  if (signupWrapper && nav && navTarget && heroSlot && sentinel) {
    const observerCallback = (entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      toggleNavSignup(!entry.isIntersecting);
    };

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(observerCallback, {
        rootMargin: "-120px 0px 0px 0px",
      });
      observer.observe(sentinel);
    } else {
      const handleScroll = () => {
        const rect = sentinel.getBoundingClientRect();
        toggleNavSignup(rect.top < 100);
      };
      window.addEventListener("scroll", handleScroll, { passive: true });
      handleScroll();
    }
  }

  const showStatus = (kind, text) => {
    statusEl.className = "status show " + (kind || "");
    statusEl.textContent = text || "";
  };

  const hideStatus = () => {
    statusEl.className = "status";
    statusEl.textContent = "";
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideStatus();

    const email = emailEl.value.trim();
    if (!email) {
      return;
    }

    if (!isEmailValid(email)) {
      updateSubmitState();
      showStatus("error", "Enter a valid email address.");
      emailEl.focus();
      if (typeof emailEl.reportValidity === "function") {
        emailEl.reportValidity();
      }
      return;
    }

    isSubmitting = true;
    updateSubmitState();
    showStatus("", "Sending…");

    try {
      const response = await fetch(buildApiUrl("/subscribe"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      let data = {};
      try {
        data = await response.json();
      } catch (error) {
        console.warn("Failed to parse subscribe response", error);
      }

      if (response.ok && data && data.ok) {
        if (data.duplicate) {
          showStatus("info", "You're already on the list.");
        } else {
          showStatus("success", "Welcome aboard — you're on the list!");
          form.reset();
          updateSubmitState();
        }
      } else if (response.status === 400 && data && data.error) {
        showStatus("error", data.error);
      } else {
        showStatus(
          "error",
          "Something went wrong on our side. Please try again shortly."
        );
      }
    } catch (error) {
      console.warn("Signup request failed", error);
      showStatus("error", "Network error. Check your connection and try again.");
    } finally {
      isSubmitting = false;
      updateSubmitState();
      if (!submitBtn.disabled) {
        triggerButtonPulse();
      }
    }
  });
})();
