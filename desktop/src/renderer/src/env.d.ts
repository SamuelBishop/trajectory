import type { DesktopApi } from "../../shared/types";

declare global {
  interface Window {
    trajectory: DesktopApi;
  }
}

export {};
