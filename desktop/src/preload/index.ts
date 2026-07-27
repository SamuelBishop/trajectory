import { contextBridge, ipcRenderer } from "electron";

import type { DesktopApi, SendMessageInput } from "../shared/types";

const api: DesktopApi = {
  listConversations: () => ipcRenderer.invoke("chat:list"),
  getConversation: (id: string) => ipcRenderer.invoke("chat:get", id),
  createConversation: () => ipcRenderer.invoke("chat:create"),
  deleteConversation: (id: string) => ipcRenderer.invoke("chat:delete", id),
  sendMessage: (input: SendMessageInput) =>
    ipcRenderer.invoke("chat:send", input),
};

contextBridge.exposeInMainWorld("trajectory", api);
