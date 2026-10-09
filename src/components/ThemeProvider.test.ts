// @vitest-environment jsdom
import React, { act } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider, ThemeScope, useTheme } from "./ThemeProvider";

function ThemeReadout() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return React.createElement(React.Fragment, null,
    React.createElement("output", { "aria-label": "Current theme" }, `${preference}:${resolvedTheme}`),
    React.createElement("button", { onClick: () => setPreference("high-contrast"), type: "button" }, "Set high contrast"),
    React.createElement("button", { onClick: () => setPreference("light"), type: "button" }, "Set light"),
  );
}

let systemPreference = "dark";
let systemListeners: Array<() => void> = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  document.cookie = "moviedb-theme=; Max-Age=0; Path=/";
  systemPreference = "dark";
  systemListeners = [];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      get matches() { return systemPreference === "light"; },
      addEventListener: (_type: string, listener: () => void) => systemListeners.push(listener),
      removeEventListener: (_type: string, listener: () => void) => { systemListeners = systemListeners.filter((item) => item !== listener); },
    }),
  });
});

afterEach(() => cleanup());

describe("ThemeProvider", () => {
  it("switches themes and persists the selection in localStorage and a cookie", () => {
    render(React.createElement(ThemeProvider, { initialPreference: "dark" }, React.createElement(ThemeReadout)));
    expect(screen.getByRole("status", { name: "Current theme" }).textContent).toBe("dark:dark");

    fireEvent.click(screen.getByRole("button", { name: "Set high contrast" }));
    expect(screen.getByRole("status", { name: "Current theme" }).textContent).toBe("high-contrast:high-contrast");
    expect(document.documentElement.dataset.theme).toBe("high-contrast");
    expect(localStorage.getItem("moviedb-theme")).toBe("high-contrast");
    expect(document.cookie).toContain("moviedb-theme=high-contrast");
  });

  it("restores a valid stored preference over the server-rendered default", () => {
    localStorage.setItem("moviedb-theme", "light");
    render(React.createElement(ThemeProvider, { initialPreference: "dark" }, React.createElement(ThemeReadout)));

    expect(screen.getByRole("status", { name: "Current theme" }).textContent).toBe("light:light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("tracks system changes and supports scoped route overrides", () => {
    render(React.createElement(ThemeProvider, { initialPreference: "system" }, React.createElement(ThemeScope, { preference: "light" }, React.createElement(ThemeReadout))));
    expect(screen.getByRole("status", { name: "Current theme" }).textContent).toBe("light:light");
    expect(document.querySelector('[data-theme="light"]')).toBeTruthy();

    cleanup();
    render(React.createElement(ThemeProvider, { initialPreference: "system" }, React.createElement(ThemeReadout)));
    systemPreference = "light";
    act(() => systemListeners.forEach((listener) => listener()));
    expect(screen.getByRole("status", { name: "Current theme" }).textContent).toBe("system:light");
  });
});
