/** @typedef {import("../../src/baseline/types").Descriptor} Descriptor */
/**
 * @template Pattern
 * @typedef {Pattern extends Descriptor ? Omit<Pattern, "featureId"> : never} DescriptorPattern
 */

// Window operation names require explicit IDL evidence: compat keys do not
// distinguish operations from attributes or event compatibility labels.
// HTML: https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-window-object
// CSSOM: https://drafts.csswg.org/cssom/#extensions-to-the-window-interface
// CSSOM View: https://drafts.csswg.org/cssom-view/#extensions-to-the-window-interface
// Idle callbacks: https://www.w3.org/TR/requestidlecallback/
// Selection: https://w3c.github.io/selection-api/#extensions-to-window
const WINDOW_OPERATIONS = new Set([
  "alert",
  "confirm",
  "prompt",
  "getComputedStyle",
  "matchMedia",
  "postMessage",
  "print",
  "cancelAnimationFrame",
  "requestAnimationFrame",
  "cancelIdleCallback",
  "requestIdleCallback",
  "scroll",
  "scrollBy",
  "scrollTo",
  "getSelection",
  "close",
  "focus",
  "moveBy",
  "moveTo",
  "open",
  "resizeBy",
  "resizeTo",
  "stop",
  // https://wicg.github.io/digital-goods/#extensions-to-the-window-interface
  "getDigitalGoodsService",
  // https://fetch.spec.whatwg.org/#dom-window-fetchlater
  "fetchLater",
  // https://wicg.github.io/file-system-access/#api
  "showDirectoryPicker",
  "showOpenFilePicker",
  "showSaveFilePicker",
  // https://drafts.csswg.org/css-sizing-4/#dom-window-requestresize
  "requestResize",
  // https://wicg.github.io/local-font-access/#font-manager
  "queryLocalFonts",
  // https://www.w3.org/TR/window-management/#api-window-getScreenDetails
  "getScreenDetails",
]);

// Reviewed non-operation compat keys. Keep these separate so a new Window
// member fails generation instead of silently losing its unqualified form.
const WINDOW_ATTRIBUTES = new Set([
  "launchQueue",
  "customElements",
  "locationbar",
  "menubar",
  "personalbar",
  "scrollbars",
  "statusbar",
  "toolbar",
  "cookieStore",
  "devicePixelRatio",
  "documentPictureInPicture",
  "document",
  "fence",
  "history",
  "credentialless",
  "localStorage",
  "sessionStorage",
  "location",
  "navigation",
  "navigator",
  "crashReport",
  "scrollX",
  "scrollY",
  "sharedStorage",
  "speechSynthesis",
  "viewport",
  "visualViewport",
  "closed",
  "frameElement",
  "frames",
  "innerHeight",
  "innerWidth",
  "length",
  "name",
  "opener",
  "outerHeight",
  "outerWidth",
  "parent",
  "screen",
  "screenLeft",
  "screenTop",
  "screenX",
  "screenY",
  "self",
  "top",
  "window",
]);
const WINDOW_EVENTS = new Set([
  "appinstalled_event",
  "beforeinstallprompt_event",
  "beforeunload_event",
  "devicemotion_event",
  "deviceorientation_event",
  "deviceorientationabsolute_event",
  "gamepadconnected_event",
  "gamepaddisconnected_event",
  "hashchange_event",
  "popstate_event",
  "languagechange_event",
  "storage_event",
  "messageerror_event",
  "offline_event",
  "online_event",
  "pagehide_event",
  "pageshow_event",
  "message_event",
  "afterprint_event",
  "beforeprint_event",
  "scrollsnapchange_event",
  "scrollsnapchanging_event",
  "pagereveal_event",
  "pageswap_event",
  "vrdisplayactivate_event",
  "vrdisplayconnect_event",
  "vrdisplaydeactivate_event",
  "vrdisplaydisconnect_event",
  "vrdisplaypresentchange_event",
  "blur_event",
  "error_event",
  "focus_event",
  "load_event",
  "resize_event",
]);

/** @param {string} prop */
export function classifyWindowMember(prop) {
  if (WINDOW_OPERATIONS.has(prop)) return "operation";
  if (WINDOW_ATTRIBUTES.has(prop)) return "attribute";
  if (WINDOW_EVENTS.has(prop)) return "event";
  return null;
}

// These compat entries describe attributes, despite sharing the _static
// suffix with operations. A call-only descriptor misses ordinary reads.
const STATIC_ATTRIBUTES = new Set([
  // https://www.w3.org/TR/compute-pressure/#the-knownsources-attribute
  "api.PressureObserver.knownSources_static",
  // https://drafts.csswg.org/css-highlight-api-1/#registration
  "api.CSS.highlights_static",
  // https://w3c.github.io/media-source/#dom-mediasource-canconstructindedicatedworker
  "api.MediaSource.canConstructInDedicatedWorker_static",
  // https://notifications.spec.whatwg.org/#api
  "api.Notification.maxActions_static",
  "api.Notification.permission_static",
  // https://drafts.css-houdini.org/css-paint-api-1/#paint-worklet
  "api.CSS.paintWorklet_static",
  // https://w3c.github.io/performance-timeline/#dom-performanceobserver-supportedentrytypes
  "api.PerformanceObserver.supportedEntryTypes_static",
  // https://www.w3.org/TR/push-api/#dom-pushmanager-supportedcontentencodings
  "api.PushManager.supportedContentEncodings_static",
]);

// https://html.spec.whatwg.org/multipage/media.html#dom-audio
// https://html.spec.whatwg.org/multipage/embedded-content.html#dom-image
// https://html.spec.whatwg.org/multipage/form-elements.html#dom-option
export const LEGACY_FACTORY_COMPAT_KEYS = new Map([
  ["api.HTMLAudioElement.Audio", "Audio"],
  ["api.HTMLImageElement.Image", "Image"],
  ["api.HTMLOptionElement.Option", "Option"],
]);

/**
 * Convert an API compat key into supported AST/typed descriptor patterns.
 * Return no pattern for deeper options, values, or behavior subfeatures unless
 * an explicit, auditable rule supports that exact key.
 *
 * @param {string} key
 * @returns {DescriptorPattern<Descriptor>[]}
 */
export function classifyWebApiCompatFeature(key) {
  if (!key.startsWith("api.")) return [];
  // https://html.spec.whatwg.org/multipage/workers.html#dom-sharedworkeroptions-extendedlifetime
  if (key === "api.SharedWorker.SharedWorker.options_extendedLifetime_parameter") {
    return [
      {
        kind: "newWithOptions",
        name: "SharedWorker",
        objectArg: { index: 1, hasKeys: ["extendedLifetime"] },
      },
    ];
  }

  const parts = key.split(".");
  if (parts.length === 2) return [{ kind: "callGlobal", name: parts[1] }];
  if (parts.length !== 3) return [];

  const [, iface, prop] = parts;
  const legacyFactory = LEGACY_FACTORY_COMPAT_KEYS.get(key);
  if (legacyFactory) return [{ kind: "newIdent", name: legacyFactory }];
  if (iface === prop) return [{ kind: "newIdent", name: iface }];
  if (prop.endsWith("_static")) {
    return [
      {
        kind: STATIC_ATTRIBUTES.has(key) ? "staticMember" : "callStatic",
        base: iface,
        prop: prop.slice(0, -"_static".length),
      },
    ];
  }
  if (iface === "Window") {
    const memberKind = classifyWindowMember(prop);
    if (!memberKind) {
      throw new Error(`Unreviewed Window compat key: ${key}; classify it in classify-web-apis.mjs`);
    }
    /** @type {DescriptorPattern<Descriptor>[]} */
    const patterns = [{ kind: "member", base: "window", prop }];
    if (memberKind === "operation") patterns.push({ kind: "callGlobal", name: prop });
    return patterns;
  }
  if (iface === "Navigator") return [{ kind: "member", base: "navigator", prop }];
  if (iface === "CSS") return [{ kind: "callStatic", base: "CSS", prop }];
  return [{ kind: "instanceMember", iface, prop }];
}
