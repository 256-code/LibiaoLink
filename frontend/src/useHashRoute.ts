import { useEffect, useState } from "react";

export type Route = { kind: "list" } | { kind: "project"; id: string };

export function parseHash(hash: string): Route {
  const match = /^#\/project\/([^/]+)$/.exec(hash);
  if (match) {
    return { kind: "project", id: decodeURIComponent(match[1] ?? "") };
  }
  return { kind: "list" };
}

export function openProject(id: string): void {
  window.location.hash = "/project/" + encodeURIComponent(id);
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const handleChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", handleChange);
    return () => {
      window.removeEventListener("hashchange", handleChange);
    };
  }, []);
  return route;
}
