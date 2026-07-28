import { contextBridge, ipcRenderer } from "electron";

import type {
  AppSettings,
  DesktopApi,
  MentorConfigFile,
  SendMessageInput,
  UserConfigFile,
} from "../shared/types";

const api: DesktopApi = {
  listConversations: () => ipcRenderer.invoke("chat:list"),
  getConversation: (id: string) => ipcRenderer.invoke("chat:get", id),
  createConversation: () => ipcRenderer.invoke("chat:create"),
  deleteConversation: (id: string) => ipcRenderer.invoke("chat:delete", id),
  sendMessage: (input: SendMessageInput) =>
    ipcRenderer.invoke("chat:send", input),

  readUserConfig: (file: UserConfigFile) =>
    ipcRenderer.invoke("config:readUser", file),
  writeUserConfig: (file: UserConfigFile, data: unknown) =>
    ipcRenderer.invoke("config:writeUser", file, data),
  writeUserConfigText: (file: UserConfigFile, text: string) =>
    ipcRenderer.invoke("config:writeUserText", file, text),

  listMentors: () => ipcRenderer.invoke("mentors:list"),
  readMentorConfig: (id: string, file: MentorConfigFile) =>
    ipcRenderer.invoke("mentors:read", id, file),
  writeMentorConfig: (id: string, file: MentorConfigFile, data: unknown) =>
    ipcRenderer.invoke("mentors:write", id, file, data),
  writeMentorConfigText: (id: string, file: MentorConfigFile, text: string) =>
    ipcRenderer.invoke("mentors:writeText", id, file, text),
  duplicateMentor: (sourceId: string, targetId: string, name: string) =>
    ipcRenderer.invoke("mentors:duplicate", sourceId, targetId, name),
  deleteMentor: (id: string) => ipcRenderer.invoke("mentors:delete", id),

  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: AppSettings) =>
    ipcRenderer.invoke("settings:save", settings),

  // No `getOpenAiKey`. The renderer can learn that a key exists and can replace
  // or remove it, but no channel returns one ([HC-SECRETS-ENV-ONLY]).
  getSecretStatus: () => ipcRenderer.invoke("secrets:status"),
  setOpenAiKey: (value: string) =>
    ipcRenderer.invoke("secrets:setOpenAi", value),
  clearOpenAiKey: () => ipcRenderer.invoke("secrets:clearOpenAi"),
};

contextBridge.exposeInMainWorld("trajectory", api);
