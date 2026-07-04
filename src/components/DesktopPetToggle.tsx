"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "chs.desktopPet.enabled";

export function DesktopPetToggle() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(STORAGE_KEY) !== "false");
    } catch {
      /* no-op */
    }
  }, []);

  function update(next: boolean) {
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: String(next) }));
    } catch {
      /* no-op */
    }
  }

  return (
    <label className="desktop-pet-toggle">
      <span>
        <strong>小序陪伴</strong>
        <small>在工作台右下角显示动态桌面小宠物，跟随 agent 状态轻微变化。</small>
      </span>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => update(event.target.checked)}
        aria-label="小序陪伴"
      />
    </label>
  );
}
