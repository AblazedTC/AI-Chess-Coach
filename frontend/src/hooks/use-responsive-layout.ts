"use client";

import { useSyncExternalStore } from "react";

export type WorkspaceLayout = "three" | "wide" | "narrow";

function subscribe(change: () => void) {
  if (!window.matchMedia) return () => {};
  const queries = [
    window.matchMedia("(min-width: 1280px)"),
    window.matchMedia("(min-width: 1024px)"),
  ];
  queries.forEach((query) => query.addEventListener("change", change));
  return () => queries.forEach((query) => query.removeEventListener("change", change));
}

function snapshot(): WorkspaceLayout {
  if (!window.matchMedia || window.matchMedia("(min-width: 1280px)").matches) return "three";
  return window.matchMedia("(min-width: 1024px)").matches ? "wide" : "narrow";
}

export function useResponsiveLayout() {
  return useSyncExternalStore(subscribe, snapshot, (): WorkspaceLayout => "narrow");
}
