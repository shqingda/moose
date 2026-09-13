import { contextBridge, ipcRenderer } from 'electron';
import type { AppEvent, MooseAPI } from '../shared/types';
const api: MooseAPI = {
  request: (method, params) => ipcRenderer.invoke('moose:request', method, params),
  subscribe(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: AppEvent) => listener(payload);
    ipcRenderer.on('moose:event', handler);
    return () => ipcRenderer.removeListener('moose:event', handler);
  },
};
contextBridge.exposeInMainWorld('moose', api);
