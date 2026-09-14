// 渲染页的受限桥接层：只暴露 request / subscribe，不把 Electron 原始事件对象传给页面。
import { contextBridge, ipcRenderer } from 'electron';
import type { AppEvent, MooseAPI } from '../shared/types';
const api: MooseAPI = {
  // 将类型化业务请求交给主进程，返回可 await 的结果。
  request: (method, params) => ipcRenderer.invoke('moose:request', method, params),
  // 订阅后台事件并返回取消函数；组件卸载时调用以移除监听。
  subscribe(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: AppEvent) => listener(payload);
    ipcRenderer.on('moose:event', handler);
    return () => ipcRenderer.removeListener('moose:event', handler);
  },
};
contextBridge.exposeInMainWorld('moose', api);
