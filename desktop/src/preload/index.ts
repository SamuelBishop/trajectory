import { contextBridge, ipcRenderer } from "electron";

import type {
  AppSettings,
  ChatStreamDelta,
  DesktopApi,
  IntegrationPolicyView,
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
  onChatStream: (listener: (delta: ChatStreamDelta) => void) => {
    const channel = "chat:stream";
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      delta: ChatStreamDelta,
    ): void => listener(delta);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },

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

  listBriefings: () => ipcRenderer.invoke("briefing:list"),
  runBriefingNow: () => ipcRenderer.invoke("briefing:runNow"),
  onShowBriefing: (handler: () => void) => {
    const channel = "briefing:show";
    const wrapped = (): void => handler();
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },

  listIntegrations: () => ipcRenderer.invoke("integrations:list"),
  refreshIntegration: (id: string) =>
    ipcRenderer.invoke("integrations:refresh", id),
  saveIntegrationPolicy: (id: string, policy: IntegrationPolicyView) =>
    ipcRenderer.invoke("integrations:savePolicy", id, policy),
  setIntegrationsPaused: (paused: boolean) =>
    ipcRenderer.invoke("integrations:setPaused", paused),
  deleteIntegrationData: (id: string) =>
    ipcRenderer.invoke("integrations:deleteData", id),
  saveGitHubScope: (scope: unknown) =>
    ipcRenderer.invoke("integrations:saveGitHubScope", scope),
  saveNotionScope: (scope: unknown) =>
    ipcRenderer.invoke("integrations:saveNotionScope", scope),
  saveStravaScope: (scope: unknown) =>
    ipcRenderer.invoke("integrations:saveStravaScope", scope),
  openStravaAuthorize: () =>
    ipcRenderer.invoke("integrations:openStravaAuthorize"),
  completeStravaAuthorize: (pasted: string) =>
    ipcRenderer.invoke("integrations:completeStravaAuthorize", pasted),
  saveGoogleSheetsScope: (scope: unknown) =>
    ipcRenderer.invoke("integrations:saveGoogleSheetsScope", scope),
  saveGoogleServiceAccount: (pastedJson: string) =>
    ipcRenderer.invoke("integrations:saveGoogleServiceAccount", pastedJson),
  clearGoogleServiceAccount: () =>
    ipcRenderer.invoke("secrets:clearGoogleServiceAccountKey"),

  // No getter for either credential. The renderer can learn that one exists
  // and can replace or remove it, but no channel returns a value
  // ([HC-SECRETS-ENV-ONLY]).
  getSecretStatus: () => ipcRenderer.invoke("secrets:status"),
  setOpenAiKey: (value: string) =>
    ipcRenderer.invoke("secrets:setOpenAi", value),
  clearOpenAiKey: () => ipcRenderer.invoke("secrets:clearOpenAi"),
  setGithubToken: (value: string) =>
    ipcRenderer.invoke("secrets:setGithubToken", value),
  clearGithubToken: () => ipcRenderer.invoke("secrets:clearGithubToken"),

  // Sign-in is started and observed from here, but the credential it produces
  // is written by the Copilot runtime into the system keychain. No channel
  // carries it ([HC-SECRETS-ENV-ONLY]).
  setGithubActivityToken: (value: string) =>
    ipcRenderer.invoke("secrets:setGithubActivity", value),
  clearGithubActivityToken: () =>
    ipcRenderer.invoke("secrets:clearGithubActivity"),
  setNotionToken: (value: string) => ipcRenderer.invoke("secrets:setNotion", value),
  clearNotionToken: () => ipcRenderer.invoke("secrets:clearNotion"),
  setStravaClientSecret: (value: string) =>
    ipcRenderer.invoke("secrets:setStravaClientSecret", value),
  clearStravaClientSecret: () =>
    ipcRenderer.invoke("secrets:clearStravaClientSecret"),
  setStravaRefreshToken: (value: string) =>
    ipcRenderer.invoke("secrets:setStravaRefreshToken", value),
  clearStravaRefreshToken: () =>
    ipcRenderer.invoke("secrets:clearStravaRefreshToken"),
  startSignIn: () => ipcRenderer.invoke("auth:start"),
  waitForSignIn: () => ipcRenderer.invoke("auth:wait"),
  cancelSignIn: () => ipcRenderer.invoke("auth:cancel"),
  getAuthStatus: () => ipcRenderer.invoke("auth:status"),
};

contextBridge.exposeInMainWorld("trajectory", api);
