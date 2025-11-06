(() => {
  const phraseRotator = document.getElementById("phraseRotator");
  const phraseAnnouncer = document.getElementById("phraseAnnouncer");

  const marketingPhrases = [
    "Turn long-form into shorts",
    "Repurpose live streams",
    "Clip channels 24/7",
  ];
  const rotationInterval = 5000;

  if (!phraseRotator || !marketingPhrases.length) {
    return;
  }

  const ensureRotatorSize = () => {
    const host = phraseRotator.closest(".hero__rotator");
    if (!host) {
      return;
    }

    const phrases = new Set(marketingPhrases);
    const initial = phraseRotator.dataset.initialPhrase;
    if (initial) {
      phrases.add(initial);
    }

    if (!phrases.size) {
      return;
    }

    let maxWidth = 0;
    let maxHeight = 0;
    const measurer = document.createElement("span");
    measurer.className = "hero__rotator-measure";
    host.appendChild(measurer);

    phrases.forEach((text) => {
      measurer.textContent = text;
      const rect = measurer.getBoundingClientRect();
      maxWidth = Math.max(maxWidth, rect.width);
      maxHeight = Math.max(maxHeight, rect.height);
    });

    measurer.remove();

    if (maxWidth) {
      const width = Math.ceil(maxWidth) + 2;
      host.style.setProperty("--hero-rotator-max-width", `${width}px`);
    }

    if (maxHeight) {
      const height = Math.ceil(maxHeight) + 2;
      host.style.setProperty("--hero-rotator-max-height", `${height}px`);
      phraseRotator.style.setProperty(
        "--hero-rotator-max-height",
        `${height}px`
      );
    }
  };

  const setPhraseImmediate = (phrase) => {
    phraseRotator.innerHTML = "";
    const span = document.createElement("span");
    span.className = "hero__rotator-phrase hero__rotator-phrase--current";
    span.textContent = phrase;
    phraseRotator.appendChild(span);
  };

  const animateToPhrase = (phrase) => {
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
  };

  const announcePhrase = (text) => {
    if (phraseAnnouncer) {
      phraseAnnouncer.textContent = `Marketing phrase: ${text}.`;
    }
  };

  ensureRotatorSize();
  if (document.fonts && document.fonts.ready) {
    document.fonts
      .ready.then(() => {
        ensureRotatorSize();
      })
      .catch(() => {});
  }

  let sizeRaf = null;
  window.addEventListener("resize", () => {
    if (sizeRaf) {
      return;
    }
    sizeRaf = window.requestAnimationFrame(() => {
      sizeRaf = null;
      ensureRotatorSize();
    });
  });

  const initialPhrase =
    phraseRotator.dataset.initialPhrase || marketingPhrases[0];
  let currentIndex = Math.max(marketingPhrases.indexOf(initialPhrase), 0);

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
})();
