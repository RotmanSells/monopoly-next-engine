"use client";

import { useEffect } from "react";

const SW_PATH = "/sw.js";

export function PwaRegistrar(): null {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker
      .register(SW_PATH, { scope: "/" })
      .catch((error: unknown) => {
        console.error("Service worker registration failed:", error);
      });
  }, []);

  return null;
}
