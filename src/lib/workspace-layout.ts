import { useCallback, useLayoutEffect, useState } from 'react';
import { useMotionValueEvent, useReducedMotion, useSpring, useTransform } from 'motion/react';
import type { BackgroundPlacement } from '../components/background-tools';

/** One owner for panel placement and interruptible sidebar geometry. */
export function useWorkspaceLayout(reducedMotion: boolean) {
  const reduceMotion = useReducedMotion();
  const [sidebarOpen, setSidebarOpen] = useState(
    () =>
      localStorage.getItem('moose.sidebar') !== 'hidden' &&
      !(window.moose.host === 'web' && matchMedia('(max-width: 760px)').matches),
  );
  const [sidebarParked, setSidebarParked] = useState(() => !sidebarOpen);
  // One interruptible spring keeps the sidebar and toolbar on the same timeline.
  const sidebarProgress = useSpring(sidebarOpen ? 1 : 0, {
    stiffness: 380,
    damping: 39,
    restDelta: 0.0001,
    restSpeed: 0.0001,
  });
  const sidebarWidth = useTransform(sidebarProgress, [0, 1], [0, 264]);
  useLayoutEffect(() => {
    if (sidebarOpen) setSidebarParked(false);
    const target = sidebarOpen ? 1 : 0;
    if (reduceMotion || reducedMotion) {
      sidebarProgress.jump(target);
      if (!sidebarOpen) setSidebarParked(true);
    } else sidebarProgress.set(target);
  }, [sidebarOpen, reduceMotion, reducedMotion, sidebarProgress]);
  useMotionValueEvent(sidebarProgress, 'animationComplete', () => {
    if (sidebarProgress.get() === 0) setSidebarParked(true);
  });
  /** 切换并持久化侧栏展开状态，不改变当前会话。 */
  const toggleSidebar = () =>
    setSidebarOpen((value) => {
      localStorage.setItem('moose.sidebar', value ? 'hidden' : 'visible');
      return !value;
    });
  const [sidePanel, setSidePanel] = useState<'review' | 'files' | null>(null);
  const [dockHost, setDockHost] = useState<HTMLDivElement | null>(null);
  const [dock, setDock] = useState<BackgroundPlacement | null>(null);
  const onDockChange = useCallback((position: BackgroundPlacement | null) => {
    setDock(position);
    if (position === 'right') setSidePanel(null);
  }, []);
  return {
    reduceMotion,
    sidebarOpen,
    setSidebarOpen,
    sidebarParked,
    sidebarProgress,
    sidebarWidth,
    toggleSidebar,
    sidePanel,
    setSidePanel,
    dockHost,
    setDockHost,
    dock,
    onDockChange,
  };
}
