// 补充浏览器 window.moose 的类型声明；实际对象由 preload 的 contextBridge 注入。
import type { MooseAPI } from '../shared/types';
declare global {
  interface Window {
    moose: MooseAPI;
  }
}
