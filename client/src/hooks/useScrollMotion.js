import { useEffect } from "react";
import { useLocation } from "react-router-dom";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Apple-style scroll reveals: fade + rise as sections enter the viewport.
 * Observes [data-reveal] anywhere in the document, including nodes added later.
 */
export function useScrollReveal() {
  useEffect(() => {
    const reduced = prefersReducedMotion();

    const observer = reduced
      ? null
      : new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              entry.target.classList.add("is-revealed");
              observer.unobserve(entry.target);
            });
          },
          { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
        );

    const watch = () => {
      document.querySelectorAll("[data-reveal]").forEach((node) => {
        if (node.classList.contains("is-revealed")) return;
        if (reduced || !observer) {
          node.classList.add("is-revealed");
          return;
        }
        observer.observe(node);
      });
    };

    watch();
    const mutations = new MutationObserver(watch);
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer?.disconnect();
      mutations.disconnect();
    };
  }, []);
}

/** Gentle hero wallpaper parallax while the hero is still in view. */
export function useHeroParallax() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const media = document.querySelector(".hero-banner-media");
    if (!media) return;

    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y > window.innerHeight * 1.35) return;
        media.style.transform = `translate3d(0, ${Math.round(y * 0.18)}px, 0)`;
      });
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      media.style.transform = "";
    };
  }, [pathname]);
}

/** Tightens the sticky header once the page has left the top. */
export function useHeaderScrollState() {
  useEffect(() => {
    const header = document.querySelector(".site-header");
    if (!header) return;

    const onScroll = () => {
      header.classList.toggle("is-scrolled", window.scrollY > 16);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
}
