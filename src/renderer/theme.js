'use strict';

(() => {
  const STORAGE_KEY = 'cleanmark-theme';
  const root = document.documentElement;
  const isTheme = (value) => value === 'light' || value === 'dark';

  let current = 'dark';
  const nativeInitial = window.cleanmark && window.cleanmark.initialTheme;
  if (isTheme(nativeInitial)) {
    current = nativeInitial;
  } else {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isTheme(stored)) current = stored;
    } catch {
      // localStorage 不可用时保持默认深色。
    }
  }

  function apply(theme, persist) {
    if (!isTheme(theme)) return;
    current = theme;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;

    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        // 忽略存储失败，主题在当前会话内仍然生效。
      }
    }

    // 主进程负责同步原生窗口背景、红绿灯外观与持久化文件。
    try {
      window.cleanmark && window.cleanmark.setTheme && window.cleanmark.setTheme(theme);
    } catch {
      // 主进程调用失败不影响页面主题。
    }

    window.dispatchEvent(
      new CustomEvent('cleanmark:themechange', { detail: { theme } })
    );
  }

  apply(current, false);

  window.cleanmarkTheme = {
    get: () => current,
    set: (theme) => apply(theme, true),
    toggle: () => apply(current === 'dark' ? 'light' : 'dark', true),
  };
})();
