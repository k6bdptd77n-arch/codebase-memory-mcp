"use strict";

// Electron-free window lifecycle. Keeping this tiny makes the most important
// background promise testable without booting a desktop session.
function createBackgroundLifecycle({ app, getWindow, createWindow, platform = process.platform }) {
  let quitting = false;

  const liveWindow = () => {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : null;
  };

  const show = () => {
    const win = liveWindow() || createWindow();
    if (platform === "darwin" && app.dock) app.dock.show();
    if (win.isMinimized?.()) win.restore();
    win.show();
    win.focus();
    return win;
  };

  const hide = () => {
    const win = liveWindow();
    if (win) win.hide();
    if (platform === "darwin" && app.dock) app.dock.hide();
  };

  const toggle = () => {
    const win = liveWindow();
    return win?.isVisible() ? hide() : show();
  };

  const handleWindowClose = (event) => {
    if (quitting) return;
    event.preventDefault();
    hide();
  };

  const markQuitting = () => { quitting = true; };
  const quit = () => { markQuitting(); app.quit(); };

  return { show, hide, toggle, handleWindowClose, markQuitting, quit, isQuitting: () => quitting };
}

module.exports = { createBackgroundLifecycle };
