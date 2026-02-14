import { useCallback, useEffect, useMemo, useState } from "react";

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);

  const isIos = useMemo(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(ua);
  }, []);

  const isStandalone = useMemo(() => {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      return;
    }
    if (isIos && !isStandalone) {
      window.alert("On iPhone/iPad: tap Share, then 'Add to Home Screen'.");
    }
  }, [deferredPrompt, isIos, isStandalone]);

  return {
    canInstall: Boolean(deferredPrompt) && !installed,
    showInstallOption: (Boolean(deferredPrompt) || (isIos && !isStandalone)) && !installed,
    installed,
    promptInstall,
  };
}
