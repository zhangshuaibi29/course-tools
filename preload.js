const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("courseRadarStore", {
  loadSchedule: () => ipcRenderer.invoke("schedule:load"),
  saveSchedule: (payload) => ipcRenderer.invoke("schedule:save", payload),
  parseScheduleFile: (payload) => ipcRenderer.invoke("schedule:parse-file", payload),
  openAuthorWebsite: () => ipcRenderer.invoke("author:open")
});
