import { useEffect, useRef } from "react";
import { formatRoute, isSamePage, parseHash, type AppRoute } from "../routes";

/**
 * Keeps the URL and `App.tsx`'s navigation state in step, in both directions.
 *
 * Outbound: whenever the app's own state changes, the hash is rewritten to
 * match. Inbound: whenever the *reader* changes the hash — Back, Forward, or
 * pasting a link into the tab that's already open — `onNavigate` fires with
 * the route they asked for.
 *
 * The loop that shape invites (state writes hash → hash event writes state →
 * …) is cut by remembering the last hash this hook wrote: a `hashchange`
 * carrying that exact string is our own echo, not the reader, and is
 * dropped. Same class of problem as the frame-index echo in
 * `PannableFrameStage` — a channel used to both send and receive needs to
 * recognise its own voice.
 */
export function useHashRoute(route: AppRoute, onNavigate: (route: AppRoute) => void) {
  const writtenRef = useRef<string | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;

  // Outbound. `replaceState` while only the story block changes, `pushState`
  // when the page itself does — see `isSamePage` for why stepping through a
  // story must not fill the history stack.
  useEffect(() => {
    const next = formatRoute(route);
    if (next === window.location.hash) {
      writtenRef.current = next;
      return;
    }
    const previous = parseHash(window.location.hash);
    writtenRef.current = next;
    // `pushState`/`replaceState` rather than assigning `location.hash`, which
    // always pushes and gives no say in the matter.
    const url = `${window.location.pathname}${window.location.search}${next}`;
    if (isSamePage(previous, route)) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }, [route.areaId, route.tab, route.blockId]);

  // Inbound.
  useEffect(() => {
    const onHashChange = () => {
      const raw = window.location.hash;
      if (raw === writtenRef.current) return; // our own echo
      const next = parseHash(raw);
      // A hash that parses to where we already are (a trailing slash, say, or
      // an unknown tab that fell back) would otherwise bounce the app through
      // a no-op state change and immediately rewrite the reader's URL.
      const current = routeRef.current;
      if (next.areaId === current.areaId && next.tab === current.tab && next.blockId === current.blockId) return;
      onNavigate(next);
    };
    // `hashchange` covers Back/Forward across hash-only entries; `popstate`
    // covers the case where some other part of the app has pushed a
    // non-hash entry in between. Listening to both is cheap, and missing
    // either leaves the Back button silently broken.
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onHashChange);
    };
  }, [onNavigate]);
}
