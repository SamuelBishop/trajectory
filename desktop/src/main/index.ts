import path from "node:path";

import { app, BrowserWindow } from "electron";

import { registerIpcHandlers } from "./ipc";

function developmentRendererUrl(): string | null {
  const value = process.env.ELECTRON_RENDERER_URL;
  if (app.isPackaged || !value) {
    return null;
  }
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "localhost" && url.hostname !== "127.0.0.1")
  ) {
    throw new Error("Electron development renderer must use a local HTTP URL.");
  }
  return url.toString();
}

function createWindow(): void {
  const window = new BrowserWindow({
    // Wide enough for the rail, a conversation list, an answer, and the
    // evidence beside it — the four columns Chat is designed around. Narrower
    // windows drop the evidence pane rather than squeezing the answer.
    width: 1420,
    height: 860,
    minWidth: 840,
    minHeight: 600,
    backgroundColor: "#11110f",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  const rendererUrl = developmentRendererUrl();
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.setName("Trajectory");

void app.whenReady().then(() => {
  registerIpcHandlers({ createWindow });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
