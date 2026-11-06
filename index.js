"use strict";
const electron = require("electron");
const node_fs = require("node:fs");
const node_path = require("node:path");
const zod = require("zod");
const node_crypto = require("node:crypto");
const node_dgram = require("node:dgram");
const node_os = require("node:os");
const node_child_process = require("node:child_process");
const QRCode = require("qrcode");
const node_http = require("node:http");
const ws = require("ws");
const PROTOCOL_VERSION = 1;
const CONFIG_SCHEMA_VERSION = 1;
const DEFAULT_HTTP_PORT = 47654;
const DISCOVERY_PORT = 47655;
const DISCOVERY_MAGIC = "PHONEDECK";
const ALIASES = {
  CONTROL: "CTRL",
  CTRL: "CTRL",
  CMD: "WIN",
  COMMAND: "WIN",
  META: "WIN",
  SUPER: "WIN",
  WIN: "WIN",
  WINDOWS: "WIN",
  ESCAPE: "ESC",
  ESC: "ESC",
  RETURN: "ENTER",
  ENTER: "ENTER",
  DEL: "DELETE",
  DELETE: "DELETE",
  INS: "INSERT",
  INSERT: "INSERT",
  PAGEUP: "PGUP",
  PAGEDOWN: "PGDN",
  PGUP: "PGUP",
  PGDN: "PGDN",
  SPACEBAR: "SPACE",
  SPACE: "SPACE",
  " ": "SPACE",
  ARROWUP: "UP",
  ARROWDOWN: "DOWN",
  ARROWLEFT: "LEFT",
  ARROWRIGHT: "RIGHT",
  UP: "UP",
  DOWN: "DOWN",
  LEFT: "LEFT",
  RIGHT: "RIGHT",
  PRINTSCREEN: "PRINTSCREEN",
  PRTSC: "PRINTSCREEN",
  PRINT: "PRINTSCREEN",
  CAPSLOCK: "CAPSLOCK",
  CAPS: "CAPSLOCK",
  NUMLOCK: "NUMLOCK",
  SCROLLLOCK: "SCROLLLOCK",
  CONTEXTMENU: "MENU",
  APPS: "MENU",
  MENU: "MENU",
  BACKQUOTE: "`",
  BACKSLASH: "\\",
  SLASH: "/",
  COMMA: ",",
  PERIOD: ".",
  SEMICOLON: ";",
  QUOTE: "'",
  BRACKETLEFT: "[",
  BRACKETRIGHT: "]",
  MINUS: "-",
  EQUAL: "=",
  PLUS: "+",
  ASTERISK: "*",
  TAB: "TAB",
  BACKSPACE: "BACKSPACE",
  HOME: "HOME",
  END: "END",
  PAUSE: "PAUSE",
  SCROLL: "SCROLLLOCK",
  SHIFT: "SHIFT",
  ALT: "ALT",
  OPTION: "ALT"
};
const NAMED = /* @__PURE__ */ new Set([
  "TAB",
  "ENTER",
  "ESC",
  "SPACE",
  "BACKSPACE",
  "DELETE",
  "INSERT",
  "HOME",
  "END",
  "PGUP",
  "PGDN",
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "PRINTSCREEN",
  "CAPSLOCK",
  "NUMLOCK",
  "SCROLLLOCK",
  "PAUSE",
  "MENU",
  "SHIFT",
  "CTRL",
  "ALT",
  "WIN"
]);
const PUNCTUATION = /* @__PURE__ */ new Set(["`", "\\", "/", ",", ".", ";", "'", "[", "]", "-", "=", "+", "*"]);
const MODIFIER_ORDER = ["CTRL", "ALT", "SHIFT", "WIN"];
function normalizeKey(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Empty key name");
  const upper = trimmed.toUpperCase();
  const alias = ALIASES[upper];
  if (alias) return alias;
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(upper)) return upper;
  if (/^[A-Z]$/.test(upper)) return upper;
  if (/^[0-9]$/.test(upper)) return upper;
  if (upper === "NUMPAD0") return "NUMPAD0";
  if (/^NUMPAD[0-9]$/.test(upper)) return upper;
  if (NAMED.has(upper)) return upper;
  if (trimmed.length === 1 && PUNCTUATION.has(trimmed)) return trimmed;
  throw new Error(`Unknown key: ${raw}`);
}
function isValidKeyName(raw) {
  try {
    normalizeKey(raw);
    return true;
  } catch {
    return false;
  }
}
function isModifier(key) {
  return MODIFIER_ORDER.includes(key);
}
function normalizeCombo(keys2) {
  if (keys2.length === 0) throw new Error("A shortcut needs at least one key");
  const seen = /* @__PURE__ */ new Set();
  const mods = [];
  const rest = [];
  for (const raw of keys2) {
    const key = normalizeKey(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    if (isModifier(key)) mods.push(key);
    else rest.push(key);
  }
  mods.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [...mods, ...rest];
}
const hexColor = zod.z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Expected a hex color like #12aBef");
const id = zod.z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'IDs may only contain letters, digits, "-" and "_"');
const assetName = zod.z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Invalid asset name");
const overlay = zod.z.number().min(0).max(0.95).optional();
const BackgroundSchema = zod.z.discriminatedUnion("type", [
  zod.z.object({ type: zod.z.literal("color"), color: hexColor, overlay }),
  zod.z.object({
    type: zod.z.literal("gradient"),
    from: hexColor,
    to: hexColor,
    angle: zod.z.number().min(0).max(360).optional(),
    overlay
  }),
  zod.z.object({
    type: zod.z.literal("image"),
    asset: assetName,
    fit: zod.z.enum(["cover", "contain"]),
    overlay
  })
]);
const keys = zod.z.array(zod.z.string().min(1).max(24)).min(1, "A shortcut needs at least one key").max(8).superRefine((value, ctx) => {
  for (const key of value) {
    if (!isValidKeyName(key)) {
      ctx.addIssue({ code: zod.z.ZodIssueCode.custom, message: `Unknown key name: ${key}` });
    }
  }
  try {
    normalizeCombo(value);
  } catch (error) {
    ctx.addIssue({ code: zod.z.ZodIssueCode.custom, message: error.message });
  }
});
const holdMs = zod.z.number().int().min(0).max(5e3).optional();
const perCharMs = zod.z.number().int().min(0).max(1e3).optional();
const MacroStepSchema = zod.z.discriminatedUnion("type", [
  zod.z.object({ type: zod.z.literal("hotkey"), keys, holdMs }),
  zod.z.object({ type: zod.z.literal("text"), text: zod.z.string().max(5e3), perCharMs }),
  zod.z.object({ type: zod.z.literal("delay"), ms: zod.z.number().int().min(0).max(6e4) }),
  zod.z.object({
    type: zod.z.literal("media"),
    key: zod.z.enum(["playpause", "next", "prev", "stop", "volumeup", "volumedown", "mute"])
  }),
  zod.z.object({
    type: zod.z.literal("mouse"),
    button: zod.z.enum(["left", "right", "middle"]),
    action: zod.z.enum(["click", "down", "up"]),
    x: zod.z.number().int().min(-1e5).max(1e5).optional(),
    y: zod.z.number().int().min(-1e5).max(1e5).optional()
  })
]);
const ActionSchema = zod.z.union([
  zod.z.object({ type: zod.z.literal("hotkey"), keys, holdMs }),
  zod.z.object({ type: zod.z.literal("text"), text: zod.z.string().max(1e4), perCharMs }),
  zod.z.object({ type: zod.z.literal("macro"), steps: zod.z.array(MacroStepSchema).max(300) }),
  zod.z.object({
    type: zod.z.literal("launch"),
    path: zod.z.string().min(1).max(4096),
    args: zod.z.array(zod.z.string().max(2048)).max(32).optional()
  }),
  zod.z.object({ type: zod.z.literal("url"), url: zod.z.string().min(1).max(2048) }),
  zod.z.object({
    type: zod.z.literal("command"),
    command: zod.z.string().min(1).max(4e3),
    cwd: zod.z.string().max(4096).optional(),
    hidden: zod.z.boolean().optional()
  }),
  zod.z.object({
    type: zod.z.literal("media"),
    key: zod.z.enum(["playpause", "next", "prev", "stop", "volumeup", "volumedown", "mute"])
  }),
  zod.z.object({ type: zod.z.literal("delay"), ms: zod.z.number().int().min(0).max(6e4) }),
  zod.z.object({
    type: zod.z.literal("page"),
    direction: zod.z.enum(["next", "prev", "goto"]),
    pageId: id.optional()
  })
]);
const GridSchema = zod.z.object({
  columns: zod.z.number().int().min(1).max(10),
  rows: zod.z.number().int().min(1).max(10),
  gap: zod.z.number().int().min(0).max(60),
  padding: zod.z.number().int().min(0).max(80)
});
const ThemeSchema = zod.z.object({
  background: BackgroundSchema,
  buttonBackground: BackgroundSchema,
  textColor: hexColor,
  accentColor: hexColor,
  fontSize: zod.z.number().int().min(8).max(48),
  buttonRadius: zod.z.number().int().min(0).max(120)
});
const ButtonSchema = zod.z.object({
  id,
  slot: zod.z.number().int().min(0).max(99),
  label: zod.z.string().max(60),
  sublabel: zod.z.string().max(60).optional(),
  icon: zod.z.string().max(32).optional(),
  background: BackgroundSchema.optional(),
  textColor: hexColor.optional(),
  actions: zod.z.array(ActionSchema).max(16)
});
const PageSchema = zod.z.object({
  id,
  name: zod.z.string().min(1).max(60),
  background: BackgroundSchema.optional(),
  buttons: zod.z.array(ButtonSchema).max(100)
});
const ProfileSchema = zod.z.object({
  id,
  name: zod.z.string().min(1).max(60),
  grid: GridSchema,
  theme: ThemeSchema,
  pages: zod.z.array(PageSchema).min(1).max(20),
  defaultPageId: id
});
const DeckConfigSchema = zod.z.object({
  schemaVersion: zod.z.literal(CONFIG_SCHEMA_VERSION),
  updatedAt: zod.z.string().min(1).max(64),
  serverName: zod.z.string().min(1).max(80),
  defaultProfileId: id,
  profiles: zod.z.array(ProfileSchema).min(1).max(20)
}).superRefine((config, ctx) => {
  const profileIds = /* @__PURE__ */ new Set();
  for (const profile of config.profiles) {
    if (profileIds.has(profile.id)) {
      ctx.addIssue({ code: zod.z.ZodIssueCode.custom, message: `Duplicate profile id: ${profile.id}` });
    }
    profileIds.add(profile.id);
    const capacity = profile.grid.columns * profile.grid.rows;
    const pageIds = /* @__PURE__ */ new Set();
    for (const page of profile.pages) {
      if (pageIds.has(page.id)) {
        ctx.addIssue({ code: zod.z.ZodIssueCode.custom, message: `Duplicate page id in ${profile.name}: ${page.id}` });
      }
      pageIds.add(page.id);
      const slots = /* @__PURE__ */ new Set();
      const buttonIds = /* @__PURE__ */ new Set();
      for (const button of page.buttons) {
        if (button.slot >= capacity) {
          ctx.addIssue({
            code: zod.z.ZodIssueCode.custom,
            message: `Button "${button.label}" uses slot ${button.slot}, outside the ${profile.grid.columns}x${profile.grid.rows} grid`
          });
        }
        if (slots.has(button.slot)) {
          ctx.addIssue({ code: zod.z.ZodIssueCode.custom, message: `Two buttons share slot ${button.slot} in page ${page.name}` });
        }
        slots.add(button.slot);
        if (buttonIds.has(button.id)) {
          ctx.addIssue({ code: zod.z.ZodIssueCode.custom, message: `Duplicate button id in page ${page.name}: ${button.id}` });
        }
        buttonIds.add(button.id);
        for (const action of button.actions) {
          if (action.type === "page" && action.direction === "goto" && !action.pageId) {
            ctx.addIssue({
              code: zod.z.ZodIssueCode.custom,
              message: `Button "${button.label}" has a "goto page" action without a page`
            });
          }
        }
      }
    }
    if (!pageIds.has(profile.defaultPageId)) {
      ctx.addIssue({ code: zod.z.ZodIssueCode.custom, message: `Profile ${profile.name} has an unknown default page` });
    }
  }
  if (!profileIds.has(config.defaultProfileId)) {
    ctx.addIssue({ code: zod.z.ZodIssueCode.custom, message: "Unknown default profile" });
  }
});
function validateConfig(input) {
  const parsed = DeckConfigSchema.safeParse(input);
  if (parsed.success) return { ok: true, config: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => {
      const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
  };
}
function parseConfig(input) {
  const result = validateConfig(input);
  if (!result.ok) throw new Error(`Invalid deck config:
${result.errors.join("\n")}`);
  return result.config;
}
function gradient(from, to, angle = 145, overlay2) {
  return { type: "gradient", from, to, angle };
}
const DEFAULT_THEME = {
  background: gradient("#080d19", "#111c33", 160),
  buttonBackground: gradient("#1e293b", "#334155", 145),
  textColor: "#f8fafc",
  accentColor: "#34d399",
  fontSize: 15,
  buttonRadius: 18
};
const DEFAULT_GRID = {
  columns: 5,
  rows: 3,
  gap: 12,
  padding: 14
};
function starter(id2, input) {
  return {
    id: id2,
    slot: input.slot,
    label: input.label,
    sublabel: input.sublabel,
    icon: input.icon,
    background: input.background,
    actions: input.actions
  };
}
function media(key) {
  return { type: "media", key };
}
function hotkey(...keys2) {
  return { type: "hotkey", keys: keys2 };
}
function mainPage() {
  return {
    id: "page-main",
    name: "Main",
    buttons: [
      starter("btn-vol-down", {
        slot: 0,
        label: "Volume down",
        icon: "🔉",
        background: gradient("#0f766e", "#0d9488"),
        actions: [media("volumedown")]
      }),
      starter("btn-mute", {
        slot: 1,
        label: "Mute",
        icon: "🔇",
        background: gradient("#475569", "#1e293b"),
        actions: [media("mute")]
      }),
      starter("btn-vol-up", {
        slot: 2,
        label: "Volume up",
        icon: "🔊",
        background: gradient("#0e7490", "#0891b2"),
        actions: [media("volumeup")]
      }),
      starter("btn-prev", {
        slot: 3,
        label: "Previous",
        icon: "⏮️",
        background: gradient("#4338ca", "#6366f1"),
        actions: [media("prev")]
      }),
      starter("btn-next", {
        slot: 4,
        label: "Next track",
        icon: "⏭️",
        background: gradient("#6d28d9", "#8b5cf6"),
        actions: [media("next")]
      }),
      starter("btn-play", {
        slot: 5,
        label: "Play / pause",
        icon: "⏯️",
        background: gradient("#047857", "#10b981"),
        actions: [media("playpause")]
      }),
      starter("btn-screenshot", {
        slot: 6,
        label: "Screenshot",
        sublabel: "Win + Shift + S",
        icon: "📸",
        background: gradient("#0369a1", "#0ea5e9"),
        actions: [hotkey("WIN", "SHIFT", "S")]
      }),
      starter("btn-taskview", {
        slot: 7,
        label: "Task view",
        sublabel: "Win + Tab",
        icon: "🗂️",
        background: gradient("#1e40af", "#3b82f6"),
        actions: [hotkey("WIN", "TAB")]
      }),
      starter("btn-desktop", {
        slot: 8,
        label: "Show desktop",
        sublabel: "Win + D",
        icon: "🖥️",
        background: gradient("#334155", "#64748b"),
        actions: [hotkey("WIN", "D")]
      }),
      starter("btn-lock", {
        slot: 9,
        label: "Lock PC",
        icon: "🔒",
        background: gradient("#9f1239", "#e11d48"),
        actions: [{ type: "command", command: "rundll32.exe user32.dll,LockWorkStation", hidden: true }]
      }),
      starter("btn-copy", {
        slot: 10,
        label: "Copy",
        sublabel: "Ctrl + C",
        icon: "📋",
        background: gradient("#065f46", "#059669"),
        actions: [hotkey("CTRL", "C")]
      }),
      starter("btn-paste", {
        slot: 11,
        label: "Paste",
        sublabel: "Ctrl + V",
        icon: "📌",
        background: gradient("#7c2d12", "#ea580c"),
        actions: [hotkey("CTRL", "V")]
      }),
      starter("btn-undo", {
        slot: 12,
        label: "Undo",
        sublabel: "Ctrl + Z",
        icon: "↩️",
        background: gradient("#854d0e", "#ca8a04"),
        actions: [hotkey("CTRL", "Z")]
      }),
      starter("btn-youtube", {
        slot: 13,
        label: "YouTube",
        icon: "▶️",
        background: gradient("#b91c1c", "#ef4444"),
        actions: [{ type: "url", url: "https://www.youtube.com" }]
      }),
      starter("btn-media-page", {
        slot: 14,
        label: "Media page",
        sublabel: "Page 2",
        icon: "🎵",
        background: gradient("#7e22ce", "#c026d3"),
        actions: [{ type: "page", direction: "next" }]
      })
    ]
  };
}
function mediaPage() {
  return {
    id: "page-media",
    name: "Media",
    background: gradient("#12081f", "#251040", 160),
    buttons: [
      starter("btn-back-main", {
        slot: 0,
        label: "Back",
        icon: "◀️",
        background: gradient("#312e81", "#4f46e5"),
        actions: [{ type: "page", direction: "prev" }]
      }),
      starter("btn-media-prev", {
        slot: 1,
        label: "Previous",
        icon: "⏮️",
        background: gradient("#4338ca", "#6366f1"),
        actions: [media("prev")]
      }),
      starter("btn-media-play", {
        slot: 2,
        label: "Play / pause",
        icon: "⏯️",
        background: gradient("#047857", "#10b981"),
        actions: [media("playpause")]
      }),
      starter("btn-media-next", {
        slot: 3,
        label: "Next track",
        icon: "⏭️",
        background: gradient("#6d28d9", "#8b5cf6"),
        actions: [media("next")]
      }),
      starter("btn-media-stop", {
        slot: 4,
        label: "Stop",
        icon: "⏹️",
        background: gradient("#7f1d1d", "#dc2626"),
        actions: [media("stop")]
      }),
      starter("btn-media-voldown", {
        slot: 5,
        label: "Volume down",
        icon: "🔉",
        background: gradient("#0f766e", "#0d9488"),
        actions: [media("volumedown")]
      }),
      starter("btn-media-mute", {
        slot: 6,
        label: "Mute",
        icon: "🔇",
        background: gradient("#475569", "#1e293b"),
        actions: [media("mute")]
      }),
      starter("btn-media-volup", {
        slot: 7,
        label: "Volume up",
        icon: "🔊",
        background: gradient("#0e7490", "#0891b2"),
        actions: [media("volumeup")]
      }),
      starter("btn-spotify", {
        slot: 8,
        label: "Spotify",
        icon: "🎧",
        background: gradient("#15803d", "#22c55e"),
        actions: [{ type: "url", url: "https://open.spotify.com" }]
      }),
      starter("btn-ytmusic", {
        slot: 9,
        label: "YT Music",
        icon: "🎶",
        background: gradient("#b91c1c", "#ef4444"),
        actions: [{ type: "url", url: "https://music.youtube.com" }]
      })
    ]
  };
}
function createDefaultConfig(now = /* @__PURE__ */ new Date()) {
  const profile = {
    id: "profile-desktop",
    name: "My PC",
    grid: { ...DEFAULT_GRID },
    theme: structuredClone(DEFAULT_THEME),
    pages: [mainPage(), mediaPage()],
    defaultPageId: "page-main"
  };
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    serverName: "PhoneDeck",
    defaultProfileId: profile.id,
    profiles: [profile]
  };
}
const DEFAULT_HOLD_MS = 35;
const DEFAULT_CHAR_MS = 4;
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
function stepToPlan(step, options) {
  switch (step.type) {
    case "hotkey":
      return {
        kind: "keys",
        keys: normalizeCombo(step.keys),
        holdMs: clamp(step.holdMs ?? options.holdMs ?? DEFAULT_HOLD_MS, 0, 5e3)
      };
    case "text":
      return {
        kind: "text",
        text: step.text,
        perCharMs: clamp(step.perCharMs ?? options.perCharMs ?? DEFAULT_CHAR_MS, 0, 1e3)
      };
    case "delay":
      return { kind: "delay", ms: clamp(step.ms, 0, 6e4) };
    case "media":
      return { kind: "media", key: step.key };
    case "mouse":
      return {
        kind: "mouse",
        button: step.button,
        action: step.action,
        ...step.x !== void 0 ? { x: step.x } : {},
        ...step.y !== void 0 ? { y: step.y } : {}
      };
  }
}
function actionsToPlan(actions, options = {}) {
  const plan = [];
  for (const action of actions) {
    switch (action.type) {
      case "hotkey":
      case "text":
      case "media":
      case "delay":
        plan.push(stepToPlan(action, options));
        break;
      case "macro":
        for (const step of action.steps) plan.push(stepToPlan(step, options));
        break;
      case "launch":
        plan.push({ kind: "launch", path: action.path, args: action.args ?? [] });
        break;
      case "url":
        plan.push({ kind: "url", url: action.url });
        break;
      case "command":
        plan.push({
          kind: "command",
          command: action.command,
          ...action.cwd ? { cwd: action.cwd } : {},
          hidden: action.hidden ?? true
        });
        break;
      case "page":
        plan.push({
          kind: "page",
          direction: action.direction,
          ...action.pageId ? { pageId: action.pageId } : {}
        });
        break;
    }
  }
  return plan;
}
const DeviceInfoSchema = zod.z.object({
  name: zod.z.string().min(1).max(80),
  model: zod.z.string().max(120).optional(),
  appVersion: zod.z.string().max(40).optional()
});
const ClientMessageSchema = zod.z.union([
  zod.z.object({
    type: zod.z.literal("hello"),
    protocol: zod.z.literal(PROTOCOL_VERSION),
    device: DeviceInfoSchema
  }),
  zod.z.object({
    type: zod.z.literal("press"),
    requestId: zod.z.string().min(1).max(64),
    profileId: zod.z.string().min(1).max(64),
    pageId: zod.z.string().min(1).max(64),
    buttonId: zod.z.string().min(1).max(128)
  }),
  zod.z.object({ type: zod.z.literal("ping"), t: zod.z.number().finite() })
]);
function parseClientMessage(input) {
  const parsed = ClientMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }
  return { ok: true, message: parsed.data };
}
function buildPairUri(payload) {
  const host = payload.host.trim();
  if (!host || /\s/.test(host)) throw new Error("Pairing host is required");
  if (!Number.isInteger(payload.port) || payload.port < 1 || payload.port > 65535) {
    throw new Error("Pairing port is invalid");
  }
  if (!payload.token || payload.token.length > 128) throw new Error("Pairing token is invalid");
  const url = new URL("phonedek://pair");
  url.searchParams.set("host", host);
  url.searchParams.set("port", String(payload.port));
  url.searchParams.set("token", payload.token);
  if (payload.name) url.searchParams.set("name", payload.name);
  url.searchParams.set("v", String(PROTOCOL_VERSION));
  return url.toString();
}
function encodeBeacon(beacon) {
  const payload = {
    magic: DISCOVERY_MAGIC,
    protocol: PROTOCOL_VERSION,
    type: "beacon",
    name: beacon.name,
    port: beacon.port,
    version: beacon.version
  };
  return JSON.stringify(payload);
}
function isProbe(input) {
  try {
    const value = JSON.parse(input);
    return value.magic === DISCOVERY_MAGIC && value.type === "discover" && value.protocol === PROTOCOL_VERSION;
  } catch {
    return false;
  }
}
const ALLOWED_EXTENSIONS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const MAX_BYTES = 25 * 1024 * 1024;
const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp"
};
function isSafeAssetName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) && !name.includes("..");
}
class AssetStore {
  dir;
  logger;
  constructor(dir, logger2) {
    this.dir = dir;
    this.logger = logger2;
    node_fs.mkdirSync(this.dir, { recursive: true });
  }
  /** Copy an image into the asset store and return its generated file name. */
  importFile(sourcePath) {
    const extension = node_path.extname(sourcePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error("Only PNG, JPG, WEBP, GIF and BMP images are supported");
    }
    const stats = node_fs.statSync(sourcePath);
    if (!stats.isFile()) throw new Error("The selected path is not a file");
    if (stats.size > MAX_BYTES) throw new Error("Image is larger than 25 MB");
    const name = `${node_crypto.randomUUID()}${extension}`;
    const target = node_path.join(this.dir, name);
    node_fs.copyFileSync(sourcePath, target);
    this.logger?.info(`Imported asset ${name} (${stats.size} bytes)`);
    return name;
  }
  /** Resolve an asset name to an absolute path, refusing path traversal. */
  pathFor(name) {
    if (!isSafeAssetName(name)) return null;
    const base = node_path.resolve(this.dir);
    const candidate = node_path.resolve(base, name);
    if (candidate !== base && !candidate.startsWith(base + node_path.sep)) return null;
    if (!node_fs.existsSync(candidate)) return null;
    return candidate;
  }
  contentType(name) {
    return CONTENT_TYPES[node_path.extname(name).toLowerCase()] ?? "application/octet-stream";
  }
  list() {
    try {
      return node_fs.readdirSync(this.dir).filter((name) => isSafeAssetName(name));
    } catch {
      return [];
    }
  }
}
class ConfigStore {
  file;
  assetsDir;
  config;
  listeners = /* @__PURE__ */ new Set();
  now;
  logger;
  lastError = null;
  constructor(options) {
    this.file = node_path.join(options.dir, "config.json");
    this.assetsDir = node_path.join(options.dir, "assets");
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
    this.logger = options.logger;
    node_fs.mkdirSync(this.assetsDir, { recursive: true });
    this.config = this.readOrCreate();
  }
  get() {
    return this.config;
  }
  getLastError() {
    return this.lastError;
  }
  replace(input) {
    const parsed = parseConfig(input);
    const next = { ...parsed, updatedAt: this.now().toISOString() };
    this.commit(next);
    return next;
  }
  update(mutator) {
    const draft = structuredClone(this.config);
    const returned = mutator(draft);
    const candidate = returned ?? draft;
    const next = parseConfig({ ...candidate, updatedAt: this.now().toISOString() });
    this.commit(next);
    return next;
  }
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  readOrCreate() {
    if (!node_fs.existsSync(this.file)) {
      const config = createDefaultConfig(this.now());
      this.write(config);
      return config;
    }
    const raw = node_fs.readFileSync(this.file, "utf8");
    try {
      return parseConfig(JSON.parse(raw));
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      const backup = node_path.join(node_path.dirname(this.file), `config.corrupt-${Date.now()}.json`);
      try {
        node_fs.copyFileSync(this.file, backup);
      } catch {
      }
      this.logger?.warn(`Config was invalid; backed up to ${backup}. ${this.lastError}`);
      const config = createDefaultConfig(this.now());
      this.write(config);
      return config;
    }
  }
  commit(config) {
    this.write(config);
    this.config = config;
    this.lastError = null;
    for (const listener of this.listeners) {
      try {
        listener(config);
      } catch (error) {
        this.logger?.error("Config listener failed", error);
      }
    }
  }
  write(config) {
    const temp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    node_fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}
`, "utf8");
    node_fs.renameSync(temp, this.file);
  }
}
function ipv4ToNumber(ip) {
  return ip.split(".").reduce((value, part) => (value << 8 | Number(part) & 255) >>> 0, 0);
}
function numberToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => value >>> shift & 255).join(".");
}
function broadcastFor(address, netmask) {
  try {
    const ip = ipv4ToNumber(address);
    const mask = ipv4ToNumber(netmask);
    if (!mask) return null;
    return numberToIpv4(ip & mask | ~mask >>> 0);
  } catch {
    return null;
  }
}
function lanAddresses() {
  const result = [];
  for (const [name, infos] of Object.entries(node_os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      if (info.address.startsWith("169.254.")) continue;
      result.push({
        name,
        address: info.address,
        netmask: info.netmask,
        broadcast: broadcastFor(info.address, info.netmask)
      });
    }
  }
  return result;
}
function primaryLanAddress() {
  const addresses = lanAddresses();
  const preferred = addresses.find((item) => item.address.startsWith("192.168.")) ?? addresses.find((item) => item.address.startsWith("10.")) ?? addresses.find((item) => /^172\.(1[6-9]|2[0-9]|3[01])\./.test(item.address)) ?? addresses.find((item) => !item.address.startsWith("127."));
  return preferred?.address ?? addresses[0]?.address ?? null;
}
function urlsForPort(port) {
  const lan = lanAddresses().map((item) => `http://${item.address}:${port}`);
  return [`http://127.0.0.1:${port}`, ...lan];
}
function pairPayload(host, port, token, name) {
  return {
    host,
    port,
    token,
    name,
    version: PROTOCOL_VERSION
  };
}
class DiscoveryService {
  socket = null;
  timer = null;
  options;
  port;
  constructor(options) {
    this.options = options;
    this.port = options.port ?? DISCOVERY_PORT;
  }
  get running() {
    return this.socket !== null;
  }
  async start() {
    if (this.socket) return true;
    const socket = node_dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;
    await new Promise((resolve, reject) => {
      let settled = false;
      const onError = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      socket.once("error", onError);
      socket.bind(this.port, "0.0.0.0", () => {
        settled = true;
        socket.off("error", onError);
        resolve();
      });
    }).catch((error) => {
      this.options.logger?.warn(`Discovery disabled: ${error.message}`);
      this.socket = null;
      try {
        socket.close();
      } catch {
      }
      return false;
    });
    if (!this.socket) return false;
    try {
      socket.setBroadcast(true);
    } catch (error) {
      this.options.logger?.warn(`Discovery could not enable broadcast: ${error.message}`);
    }
    socket.on("error", (error) => this.options.logger?.warn(`Discovery socket error: ${error.message}`));
    socket.on("message", (message, rinfo) => {
      if (!isProbe(message.toString("utf8"))) return;
      this.sendBeacon(rinfo.address, rinfo.port);
    });
    this.broadcast();
    this.timer = setInterval(() => this.broadcast(), 2500);
    this.timer.unref?.();
    this.options.logger?.info(`Discovery listening on UDP ${this.port}`);
    return true;
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
      }
    }
  }
  beaconPayload() {
    return Buffer.from(
      encodeBeacon({
        name: this.options.getName(),
        port: this.options.getPort(),
        version: this.options.version
      }),
      "utf8"
    );
  }
  broadcast() {
    const socket = this.socket;
    if (!socket) return;
    const payload = this.beaconPayload();
    const targets = /* @__PURE__ */ new Set(["255.255.255.255"]);
    for (const item of lanAddresses()) {
      if (item.broadcast) targets.add(item.broadcast);
    }
    for (const address of targets) {
      try {
        socket.send(payload, 0, payload.length, this.port, address, () => {
        });
      } catch {
      }
    }
  }
  sendBeacon(address, port) {
    const socket = this.socket;
    if (!socket) return;
    const payload = this.beaconPayload();
    try {
      socket.send(payload, 0, payload.length, port, address, () => {
      });
    } catch {
    }
  }
}
const KEYBOARD_KINDS = /* @__PURE__ */ new Set(["keys", "text", "delay", "media", "mouse"]);
class ActionExecutor {
  queue = Promise.resolve();
  keys;
  host;
  logger;
  constructor(keys2, host, logger2) {
    this.keys = keys2;
    this.host = host;
    this.logger = logger2;
  }
  execute(actions, label = "button") {
    const task = this.queue.then(() => this.run(actions, label));
    this.queue = task.then(
      () => void 0,
      () => void 0
    );
    return task;
  }
  async run(actions, label) {
    const plan = actionsToPlan(actions);
    if (plan.length === 0) {
      this.logger?.info(`Pressed "${label}" (no actions)`);
      return { ok: true };
    }
    this.logger?.info(`Pressed "${label}" (${plan.length} step${plan.length === 1 ? "" : "s"})`);
    try {
      for (const step of plan) {
        switch (step.kind) {
          case "launch":
            await this.host.launch(step.path, step.args);
            break;
          case "url":
            await this.host.openUrl(step.url);
            break;
          case "command":
            await this.host.runCommand(step.command, step.cwd, step.hidden);
            break;
          case "page":
            break;
          default:
            if (KEYBOARD_KINDS.has(step.kind)) {
              await this.keys.send(step);
            }
            break;
        }
      }
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.error(`Action for "${label}" failed: ${message}`);
      return { ok: false, error: message };
    }
  }
}
function spawnDetached(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = node_child_process.spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
      detached: true,
      stdio: "ignore",
      windowsHide: options.hidden ?? false
    });
    let spawned = false;
    child.once("error", (error) => {
      if (!spawned) reject(new Error(`Could not start process: ${error.message}`));
    });
    child.once("spawn", () => {
      spawned = true;
      child.unref();
      resolve();
    });
  });
}
function looksLikeShellItem(path) {
  if (/\.(lnk|url)$/i.test(path)) return true;
  try {
    return node_fs.statSync(path).isDirectory();
  } catch {
    return false;
  }
}
function quoteWindows(value) {
  return `"${value.replace(/"/g, '\\"')}"`;
}
function createHostActions(options = {}) {
  const platform = options.platform ?? process.platform;
  const logger2 = options.logger;
  return {
    async launch(path, args) {
      if (!path.trim()) throw new Error("Launch action has no path");
      if (options.openPath && looksLikeShellItem(path)) {
        const error = await options.openPath(path);
        if (error) throw new Error(error);
        logger2?.info(`Opened shell item ${path}`);
        return;
      }
      if (platform === "win32" && /\.(bat|cmd)$/i.test(path)) {
        const commandLine = [quoteWindows(path), ...args.map(quoteWindows)].join(" ");
        await spawnDetached("cmd.exe", ["/d", "/s", "/c", commandLine], { hidden: false });
        logger2?.info(`Launched script ${path}`);
        return;
      }
      await spawnDetached(path, args, { hidden: false });
      logger2?.info(`Launched ${path}${args.length ? ` ${args.join(" ")}` : ""}`);
    },
    async openUrl(url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error(`Invalid URL: ${url}`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only http and https URLs can be opened");
      }
      if (options.openExternal) {
        await options.openExternal(url);
      } else {
        const command = platform === "win32" ? "cmd.exe" : platform === "darwin" ? "open" : "xdg-open";
        const args = platform === "win32" ? ["/d", "/s", "/c", "start", "", url] : [url];
        await spawnDetached(command, args, { hidden: true });
      }
      logger2?.info(`Opened URL ${url}`);
    },
    async runCommand(command, cwd, hidden) {
      if (!command.trim()) throw new Error("Command action is empty");
      if (platform === "win32") {
        await spawnDetached(command, [], { cwd, shell: true, hidden });
      } else {
        await spawnDetached("/bin/sh", ["-c", command], { cwd, hidden });
      }
      logger2?.info(`Ran command: ${command.slice(0, 140)}`);
    }
  };
}
class WindowsKeySender {
  child = null;
  starting = null;
  pending = /* @__PURE__ */ new Map();
  stdoutBuffer = "";
  stderrTail = "";
  nextId = 0;
  helperPath;
  logger;
  disposed = false;
  constructor(helperPath2, logger2) {
    this.helperPath = helperPath2;
    this.logger = logger2;
  }
  async prewarm() {
    try {
      await this.ensureStarted();
    } catch (error) {
      this.logger?.warn(`Keyboard helper failed to start: ${error.message}`);
    }
  }
  async send(step) {
    await this.ensureStarted();
    const child = this.child;
    if (!child) throw new Error("Keyboard helper is not running");
    const id2 = String(++this.nextId);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id2);
        this.logger?.error("Keyboard helper timed out; restarting");
        this.kill();
        reject(new Error("Keyboard helper timed out"));
      }, 3e4);
      this.pending.set(id2, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ id: id2, steps: [step] })}
`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id2);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  dispose() {
    this.disposed = true;
    this.kill();
  }
  ensureStarted() {
    if (this.disposed) return Promise.reject(new Error("Keyboard sender was disposed"));
    if (this.child && !this.child.killed) return Promise.resolve();
    if (this.starting) return this.starting;
    if (!node_fs.existsSync(this.helperPath)) {
      return Promise.reject(
        new Error(`Keyboard helper not found at ${this.helperPath}. Reinstall PhoneDeck.`)
      );
    }
    this.starting = new Promise((resolve, reject) => {
      const child = node_child_process.spawn(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          this.helperPath
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
      );
      this.child = child;
      this.stdoutBuffer = "";
      this.stderrTail = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.logger?.error("Keyboard helper startup timed out");
        this.kill();
        reject(new Error("Keyboard helper startup timed out"));
      }, 2e4);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => this.onStdout(chunk, () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        this.stderrTail = (this.stderrTail + chunk).slice(-4e3);
      });
      child.on("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Could not start PowerShell: ${error.message}`));
        }
        this.failAll(new Error(`Keyboard helper error: ${error.message}`));
      });
      child.on("exit", (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(
            new Error(
              `Keyboard helper exited during startup (code ${code ?? "unknown"}). ${this.stderrTail.trim()}`
            )
          );
        }
        if (!this.disposed) {
          this.logger?.warn(`Keyboard helper exited with code ${code ?? "unknown"}`);
        }
        this.child = null;
        this.starting = null;
        this.failAll(new Error("Keyboard helper stopped unexpectedly"));
      });
    }).finally(() => {
      if (!this.child) this.starting = null;
    });
    return this.starting;
  }
  onStdout(chunk, ready) {
    this.stdoutBuffer += chunk;
    for (; ; ) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.logger?.warn(`Unexpected helper output: ${line.slice(0, 200)}`);
        continue;
      }
      if (message.ready) {
        this.logger?.info("Keyboard helper ready");
        ready();
        continue;
      }
      if (!message.id) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve();
      else pending.reject(new Error(message.error ?? "Keyboard helper failed"));
    }
  }
  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  kill() {
    const child = this.child;
    this.child = null;
    this.starting = null;
    if (child && !child.killed) {
      try {
        child.kill();
      } catch {
      }
    }
    this.failAll(new Error("Keyboard helper was stopped"));
  }
}
const LINUX_KEYS = {
  CTRL: "ctrl",
  ALT: "alt",
  SHIFT: "shift",
  WIN: "super",
  ENTER: "Return",
  TAB: "Tab",
  ESC: "Escape",
  SPACE: "space",
  BACKSPACE: "BackSpace",
  DELETE: "Delete",
  INSERT: "Insert",
  HOME: "Home",
  END: "End",
  PGUP: "Prior",
  PGDN: "Next",
  UP: "Up",
  DOWN: "Down",
  LEFT: "Left",
  RIGHT: "Right",
  PRINTSCREEN: "Print",
  CAPSLOCK: "Caps_Lock",
  NUMLOCK: "Num_Lock",
  SCROLLLOCK: "Scroll_Lock",
  PAUSE: "Pause",
  MENU: "Menu",
  ";": "semicolon",
  "=": "equal",
  ",": "comma",
  "-": "minus",
  ".": "period",
  "/": "slash",
  "\\": "backslash",
  "`": "grave",
  "[": "bracketleft",
  "]": "bracketright",
  "'": "apostrophe",
  "+": "plus",
  "*": "asterisk"
};
const LINUX_MEDIA = {
  playpause: "XF86AudioPlay",
  next: "XF86AudioNext",
  prev: "XF86AudioPrev",
  stop: "XF86AudioStop",
  volumeup: "XF86AudioRaiseVolume",
  volumedown: "XF86AudioLowerVolume",
  mute: "XF86AudioMute"
};
const LINUX_MOUSE = { left: "1", middle: "2", right: "3" };
const LINUX_MOUSE_ACTION = {
  click: "click",
  down: "mousedown",
  up: "mouseup"
};
class LinuxKeySender {
  xdotool = false;
  logger;
  constructor(logger2) {
    this.logger = logger2;
    this.xdotool = node_child_process.spawnSync("which", ["xdotool"], { stdio: "ignore" }).status === 0;
    if (!this.xdotool) {
      this.logger?.warn("xdotool is not installed; key actions will fail on this Linux host");
    }
  }
  async send(step) {
    switch (step.kind) {
      case "keys": {
        const combo = step.keys.map((key) => LINUX_KEYS[key] ?? key).join("+");
        await this.run(["key", "--clearmodifiers", "--delay", "12", combo]);
        break;
      }
      case "text":
        await this.run(["type", "--clearmodifiers", "--delay", String(step.perCharMs), "--", step.text]);
        break;
      case "delay":
        await new Promise((resolve) => setTimeout(resolve, step.ms));
        break;
      case "media":
        await this.run(["key", LINUX_MEDIA[step.key]]);
        break;
      case "mouse": {
        if (step.x !== void 0 && step.y !== void 0) {
          await this.run(["mousemove", String(step.x), String(step.y)]);
        }
        await this.run([LINUX_MOUSE_ACTION[step.action], LINUX_MOUSE[step.button]]);
        break;
      }
    }
  }
  run(args) {
    if (!this.xdotool) {
      return Promise.reject(new Error("xdotool is required on Linux. Install it with: sudo apt install xdotool"));
    }
    return new Promise((resolve, reject) => {
      const child = node_child_process.spawn("xdotool", args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-2e3);
      });
      child.on("error", (error) => reject(new Error(`xdotool failed: ${error.message}`)));
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`xdotool exited with ${code}: ${stderr.trim()}`));
      });
    });
  }
}
class UnsupportedKeySender {
  constructor(platform) {
    this.platform = platform;
  }
  platform;
  send(step) {
    if (step.kind === "delay") {
      return new Promise((resolve) => setTimeout(resolve, step.ms));
    }
    return Promise.reject(
      new Error(`Key actions are not implemented on ${this.platform}. PhoneDeck is Windows-first; launch/URL/command actions still work.`)
    );
  }
}
function createKeySender(helperPath2, platform, logger2) {
  if (platform === "win32") return new WindowsKeySender(helperPath2, logger2);
  if (platform === "linux") return new LinuxKeySender(logger2);
  return new UnsupportedKeySender(platform);
}
function format(level, message) {
  return `${(/* @__PURE__ */ new Date()).toISOString()} [${level}] ${message}
`;
}
function createLogger(dir) {
  let logPath = null;
  if (dir) {
    try {
      node_fs.mkdirSync(dir, { recursive: true });
      logPath = node_path.join(dir, "phonedek.log");
      if (node_fs.existsSync(logPath) && node_fs.statSync(logPath).size > 4 * 1024 * 1024) {
        try {
          node_fs.renameSync(logPath, node_path.join(dir, `phonedek-${Date.now()}.log`));
        } catch {
        }
      }
    } catch {
      logPath = null;
    }
  }
  const write = (level, message, error) => {
    const detail = error instanceof Error ? `${message}: ${error.stack ?? error.message}` : error !== void 0 ? `${message}: ${String(error)}` : message;
    const line = format(level, detail);
    if (level === "ERROR") console.error(line.trimEnd());
    else if (level === "WARN") console.warn(line.trimEnd());
    else console.log(line.trimEnd());
    if (!logPath) return;
    try {
      node_fs.appendFileSync(logPath, line, "utf8");
    } catch {
    }
  };
  return {
    logPath,
    info: (message) => write("INFO", message),
    warn: (message) => write("WARN", message),
    error: (message, error) => write("ERROR", message, error)
  };
}
async function createPairInfo(token, port, name, hostOverride) {
  const host = hostOverride ?? primaryLanAddress() ?? "127.0.0.1";
  const payload = pairPayload(host, port, token, name);
  const uri = buildPairUri(payload);
  const qrDataUrl = await QRCode.toDataURL(uri, {
    width: 360,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0b1220", light: "#ffffff" }
  });
  return { host, port, token, name, uri, qrDataUrl, urls: [] };
}
function bearerToken(request, url) {
  const query = url.searchParams.get("token");
  if (query) return query;
  const header = request.headers.authorization;
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}
function tokenMatches(expected, provided) {
  if (!provided) return false;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  try {
    return node_crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}
function remoteAddress(request) {
  const address = request.socket.remoteAddress ?? "unknown";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}
function json(response, status, body, extraHeaders = {}) {
  const payload = `${JSON.stringify(body)}
`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  response.end(payload);
}
async function readJson(request, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}
class DeckServer {
  options;
  token;
  httpServer = null;
  wss = null;
  heartbeat = null;
  clients = /* @__PURE__ */ new Map();
  actualPort = 0;
  constructor(options) {
    this.options = options;
    this.token = options.token;
    this.actualPort = options.port;
  }
  get port() {
    return this.actualPort;
  }
  get running() {
    return this.httpServer !== null;
  }
  get tokenValue() {
    return this.token;
  }
  async start() {
    if (this.httpServer) return this.actualPort;
    const server2 = node_http.createServer((request, response) => {
      this.handleHttp(request, response).catch((error) => {
        this.options.logger?.error("HTTP handler failed", error);
        if (!response.headersSent) json(response, 500, { error: "Internal server error" });
        else response.end();
      });
    });
    const wss = new ws.WebSocketServer({ noServer: true, clientTracking: true });
    this.httpServer = server2;
    this.wss = wss;
    server2.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws") {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      if (!tokenMatches(this.token, bearerToken(request, url))) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws2) => {
        wss.emit("connection", ws2, request);
      });
    });
    wss.on("connection", (ws2, request) => this.handleConnection(ws2, request));
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server2.off("listening", onListening);
        this.httpServer = null;
        this.wss = null;
        reject(error);
      };
      const onListening = () => {
        server2.off("error", onError);
        const address = server2.address();
        this.actualPort = typeof address === "object" && address ? address.port : this.options.port;
        resolve();
      };
      server2.once("error", onError);
      server2.once("listening", onListening);
      server2.listen(this.options.port, "0.0.0.0");
    });
    this.heartbeat = setInterval(() => this.checkHeartbeats(), 3e4);
    this.heartbeat.unref?.();
    this.options.logger?.info(`Deck server listening on 0.0.0.0:${this.actualPort}`);
    return this.actualPort;
  }
  async stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const record of this.clients.values()) {
      try {
        record.ws.close(1001, "Server stopping");
      } catch {
      }
    }
    this.clients.clear();
    this.notifyClients();
    const wss = this.wss;
    const server2 = this.httpServer;
    this.wss = null;
    this.httpServer = null;
    if (wss) {
      await new Promise((resolve) => {
        wss.close(() => resolve());
        setTimeout(resolve, 1e3).unref?.();
      });
    }
    if (server2) {
      await new Promise((resolve) => {
        server2.close(() => resolve());
        setTimeout(resolve, 1e3).unref?.();
      });
    }
    this.options.logger?.info("Deck server stopped");
  }
  setToken(token) {
    this.token = token;
    for (const record of this.clients.values()) {
      try {
        record.ws.close(1008, "Pairing token changed");
      } catch {
      }
    }
  }
  broadcastConfig() {
    const message = { type: "config", config: this.options.getConfig() };
    this.broadcast(message);
  }
  getClients() {
    return [...this.clients.values()].map((record) => ({ ...record.info, device: record.info.device ? { ...record.info.device } : null })).sort((a, b) => a.connectedAt - b.connectedAt);
  }
  handleConnection(ws2, request) {
    const id2 = node_crypto.randomUUID();
    const now = Date.now();
    const info = {
      id: id2,
      address: remoteAddress(request),
      device: null,
      connectedAt: now,
      lastSeenAt: now
    };
    const record = { ws: ws2, info, alive: true, pressTimes: [] };
    this.clients.set(id2, record);
    this.options.logger?.info(`Phone connected from ${info.address}`);
    ws2.on("pong", () => {
      record.alive = true;
    });
    ws2.on("message", (data) => {
      record.alive = true;
      record.info.lastSeenAt = Date.now();
      this.handleClientMessage(record, data.toString()).catch((error) => {
        this.options.logger?.error("WebSocket message failed", error);
        this.send(ws2, { type: "error", code: "INTERNAL", message: "Message handling failed" });
      });
    });
    ws2.on("close", () => {
      this.clients.delete(id2);
      this.notifyClients();
      this.options.logger?.info(`Phone disconnected: ${info.address}`);
    });
    ws2.on("error", (error) => {
      this.options.logger?.warn(`WebSocket error from ${info.address}: ${error.message}`);
    });
    this.send(ws2, {
      type: "hello",
      protocol: PROTOCOL_VERSION,
      serverName: this.options.getServerName(),
      config: this.options.getConfig(),
      serverTime: Date.now()
    });
    this.notifyClients();
  }
  async handleClientMessage(record, raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.send(record.ws, { type: "error", code: "BAD_JSON", message: "Expected a JSON message" });
      return;
    }
    const result = parseClientMessage(parsed);
    if (!result.ok) {
      this.send(record.ws, { type: "error", code: "BAD_MESSAGE", message: result.error });
      return;
    }
    const message = result.message;
    switch (message.type) {
      case "hello":
        record.info.device = { ...message.device };
        this.notifyClients();
        break;
      case "ping":
        this.send(record.ws, { type: "pong", t: message.t });
        break;
      case "press":
        await this.handlePress(record, message);
        break;
    }
  }
  async handlePress(record, message) {
    const now = Date.now();
    record.pressTimes = record.pressTimes.filter((time) => now - time < 1e3);
    if (record.pressTimes.length >= 25) {
      this.send(record.ws, {
        type: "pressResult",
        requestId: message.requestId,
        buttonId: message.buttonId,
        ok: false,
        error: "Too many presses, slow down"
      });
      return;
    }
    record.pressTimes.push(now);
    const config = this.options.getConfig();
    const profile = config.profiles.find((item) => item.id === message.profileId);
    const page = profile?.pages.find((item) => item.id === message.pageId);
    const button = page?.buttons.find((item) => item.id === message.buttonId);
    if (!profile || !page || !button) {
      this.send(record.ws, {
        type: "pressResult",
        requestId: message.requestId,
        buttonId: message.buttonId,
        ok: false,
        error: "Button not found. Refresh the deck."
      });
      return;
    }
    let result;
    try {
      result = await this.options.onPress(record.info, message, { profile, page, button });
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    this.send(record.ws, {
      type: "pressResult",
      requestId: message.requestId,
      buttonId: message.buttonId,
      ok: result.ok,
      ...result.error ? { error: result.error } : {}
    });
  }
  async handleHttp(request, response) {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { ok: true, app: "PhoneDeck" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/info") {
      json(response, 200, {
        app: "PhoneDeck",
        protocol: PROTOCOL_VERSION,
        serverName: this.options.getServerName(),
        version: this.options.version,
        pairingRequired: true
      });
      return;
    }
    if (!tokenMatches(this.token, bearerToken(request, url))) {
      json(response, 401, { error: "Pairing token required" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/config") {
      const body = `${JSON.stringify(this.options.getConfig(), null, 2)}
`;
      const etag = `"${node_crypto.createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304, { ETag: etag, "Cache-Control": "no-store" });
        response.end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
        ETag: etag
      });
      response.end(body);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/press") {
      let body;
      try {
        body = await readJson(request);
      } catch (error) {
        json(response, 400, { error: error instanceof Error ? error.message : "Invalid body" });
        return;
      }
      const parsed = parseClientMessage(body);
      if (!parsed.ok || parsed.message.type !== "press") {
        json(response, 400, { error: parsed.ok ? "Expected a press message" : parsed.error });
        return;
      }
      const message = parsed.message;
      const config = this.options.getConfig();
      const profile = config.profiles.find((item) => item.id === message.profileId);
      const page = profile?.pages.find((item) => item.id === message.pageId);
      const button = page?.buttons.find((item) => item.id === message.buttonId);
      if (!profile || !page || !button) {
        json(response, 404, { ok: false, error: "Button not found" });
        return;
      }
      const client = {
        id: "http",
        address: remoteAddress(request),
        device: null,
        connectedAt: Date.now(),
        lastSeenAt: Date.now()
      };
      const result = await this.options.onPress(client, message, { profile, page, button });
      json(response, result.ok ? 200 : 500, result);
      return;
    }
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/assets/")) {
      const name = decodeURIComponent(url.pathname.slice("/assets/".length));
      const path = this.options.assets.pathFor(name);
      if (!path) {
        json(response, 404, { error: "Asset not found" });
        return;
      }
      response.writeHead(200, {
        "Content-Type": this.options.assets.contentType(name),
        "Cache-Control": "public, max-age=3600"
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      const stream = node_fs.createReadStream(path);
      stream.on("error", () => {
        if (!response.headersSent) json(response, 500, { error: "Could not read asset" });
        else response.end();
      });
      stream.pipe(response);
      return;
    }
    json(response, 404, { error: "Not found" });
  }
  send(ws$1, message) {
    if (ws$1.readyState !== ws.WebSocket.OPEN) return;
    try {
      ws$1.send(JSON.stringify(message));
    } catch (error) {
      this.options.logger?.warn(`Could not send WebSocket message: ${String(error)}`);
    }
  }
  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const record of this.clients.values()) {
      if (record.ws.readyState === ws.WebSocket.OPEN) {
        try {
          record.ws.send(payload);
        } catch {
        }
      }
    }
  }
  notifyClients() {
    this.options.onClientsChanged?.(this.getClients());
  }
  checkHeartbeats() {
    for (const record of this.clients.values()) {
      if (!record.alive) {
        try {
          record.ws.terminate();
        } catch {
        }
        this.clients.delete(record.info.id);
        continue;
      }
      record.alive = false;
      try {
        record.ws.ping();
      } catch {
      }
    }
    this.notifyClients();
  }
}
function createToken() {
  return node_crypto.randomBytes(18).toString("base64url");
}
function defaultSettings() {
  return {
    port: DEFAULT_HTTP_PORT,
    token: createToken(),
    discovery: true,
    launchAtLogin: false
  };
}
function sanitize(input) {
  const defaults = defaultSettings();
  if (!input) return defaults;
  const port = typeof input.port === "number" && Number.isInteger(input.port) && input.port >= 1024 && input.port <= 65535 ? input.port : defaults.port;
  const token = typeof input.token === "string" && input.token.length >= 8 && input.token.length <= 128 ? input.token : defaults.token;
  return {
    port,
    token,
    discovery: typeof input.discovery === "boolean" ? input.discovery : defaults.discovery,
    launchAtLogin: typeof input.launchAtLogin === "boolean" ? input.launchAtLogin : defaults.launchAtLogin
  };
}
class SettingsStore {
  file;
  settings;
  logger;
  constructor(dir, logger2) {
    this.file = node_path.join(dir, "settings.json");
    this.logger = logger2;
    node_fs.mkdirSync(dir, { recursive: true });
    this.settings = this.load();
  }
  get() {
    return { ...this.settings };
  }
  update(patch) {
    this.settings = sanitize({ ...this.settings, ...patch });
    this.write();
    return this.get();
  }
  rotateToken() {
    const token = createToken();
    this.settings = { ...this.settings, token };
    this.write();
    return token;
  }
  load() {
    if (!node_fs.existsSync(this.file)) {
      const settings2 = defaultSettings();
      this.writeValue(settings2);
      return settings2;
    }
    try {
      const parsed = JSON.parse(node_fs.readFileSync(this.file, "utf8"));
      const settings2 = sanitize(parsed);
      this.writeValue(settings2);
      return settings2;
    } catch (error) {
      this.logger?.warn(`settings.json was invalid, regenerating: ${String(error)}`);
      const settings2 = defaultSettings();
      this.writeValue(settings2);
      return settings2;
    }
  }
  write() {
    this.writeValue(this.settings);
  }
  writeValue(settings2) {
    const temp = `${this.file}.${process.pid}.tmp`;
    node_fs.writeFileSync(temp, `${JSON.stringify(settings2, null, 2)}
`, "utf8");
    node_fs.renameSync(temp, this.file);
  }
}
const IPC = {
  getState: "phonedek:get-state",
  saveConfig: "phonedek:save-config",
  importAsset: "phonedek:import-asset",
  pickApplication: "phonedek:pick-application",
  testActions: "phonedek:test-actions",
  setPort: "phonedek:set-port",
  rotateToken: "phonedek:rotate-token",
  setDiscovery: "phonedek:set-discovery",
  setLaunchAtLogin: "phonedek:set-launch-at-login",
  exportConfig: "phonedek:export-config",
  importConfig: "phonedek:import-config",
  openLogs: "phonedek:open-logs",
  openExternal: "phonedek:open-external",
  copyText: "phonedek:copy-text",
  serverInfoEvent: "phonedek:server-info",
  configChangedEvent: "phonedek:config-changed"
};
electron.app.setName("PhoneDeck");
const APP_VERSION = "0.1.0";
let mainWindow = null;
let logger;
let store;
let settings;
let assets;
let server;
let discovery;
let keySender;
let executor;
let serverError = null;
let pairCache = null;
let shuttingDown = false;
function helperPath() {
  return electron.app.isPackaged ? node_path.join(process.resourcesPath, "keyboard-helper.ps1") : node_path.join(electron.app.getAppPath(), "resources", "keyboard-helper.ps1");
}
async function showOpen(options) {
  return mainWindow ? electron.dialog.showOpenDialog(mainWindow, options) : electron.dialog.showOpenDialog(options);
}
async function showSave(options) {
  return mainWindow ? electron.dialog.showSaveDialog(mainWindow, options) : electron.dialog.showSaveDialog(options);
}
async function buildServerInfo() {
  const currentSettings = settings.get();
  const config = store.get();
  const port = server?.port || currentSettings.port;
  let pair = null;
  try {
    const key = `${currentSettings.token}|${port}|${config.serverName}`;
    if (pairCache?.key === key) {
      pair = pairCache.value;
    } else {
      const info = await createPairInfo(currentSettings.token, port, config.serverName);
      pair = {
        host: info.host,
        port: info.port,
        name: info.name,
        uri: info.uri,
        qrDataUrl: info.qrDataUrl
      };
      pairCache = { key, value: pair };
    }
  } catch (error) {
    logger?.warn(`Could not build pairing QR: ${error.message}`);
  }
  return {
    running: server?.running ?? false,
    port,
    urls: urlsForPort(port),
    lanAddresses: lanAddresses().map((item) => item.address),
    token: currentSettings.token,
    pair,
    discovery: discovery?.running ?? false,
    settings: {
      port: currentSettings.port,
      discovery: currentSettings.discovery,
      launchAtLogin: currentSettings.launchAtLogin
    },
    clients: server?.getClients() ?? [],
    error: serverError,
    version: APP_VERSION,
    platform: process.platform,
    configPath: store.file,
    logPath: logger.logPath
  };
}
async function buildState() {
  return {
    config: store.get(),
    server: await buildServerInfo(),
    settings: {
      port: settings.get().port,
      discovery: settings.get().discovery,
      launchAtLogin: settings.get().launchAtLogin
    }
  };
}
async function pushServerInfo() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send(IPC.serverInfoEvent, await buildServerInfo());
  } catch (error) {
    logger.warn(`Could not push server info: ${error.message}`);
  }
}
function friendlyServerError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/EADDRINUSE/i.test(message)) {
    return `Port ${settings.get().port} is already in use. Change the port in Settings or close the other program.`;
  }
  if (/EACCES/i.test(message)) return "Windows denied access to the network port. Try a different port.";
  return message;
}
async function startServer() {
  try {
    await server.start();
    serverError = null;
  } catch (error) {
    serverError = friendlyServerError(error);
    logger.error(`Deck server failed: ${serverError}`);
  }
}
async function restartServer(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return { ok: false, error: "Choose a port between 1024 and 65535" };
  }
  const previous = settings.get().port;
  await server.stop();
  settings.update({ port });
  pairCache = null;
  await startServer();
  if (!server.running) {
    settings.update({ port: previous });
    await startServer();
    pairCache = null;
    await pushServerInfo();
    return { ok: false, error: serverError ?? "Could not start the server on that port", state: await buildState() };
  }
  await pushServerInfo();
  return { ok: true, state: await buildState() };
}
function registerIpc() {
  electron.ipcMain.handle(IPC.getState, async () => buildState());
  electron.ipcMain.handle(IPC.saveConfig, async (_event, input) => {
    const validation = validateConfig(input);
    if (!validation.ok) return { ok: false, errors: validation.errors };
    try {
      const config = store.replace(validation.config);
      return { ok: true, config };
    } catch (error) {
      return { ok: false, errors: [error.message] };
    }
  });
  electron.ipcMain.handle(IPC.importAsset, async () => {
    const result = await showOpen({
      title: "Choose a button background",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }]
    });
    const source = result.filePaths[0];
    if (result.canceled || !source) return { ok: false };
    try {
      return { ok: true, asset: assets.importFile(source) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.pickApplication, async () => {
    const result = await showOpen({
      title: "Choose an application",
      properties: ["openFile"],
      filters: process.platform === "win32" ? [
        { name: "Applications", extensions: ["exe", "lnk", "bat", "cmd"] },
        { name: "All files", extensions: ["*"] }
      ] : [{ name: "All files", extensions: ["*"] }]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  electron.ipcMain.handle(IPC.testActions, async (_event, input) => {
    const parsed = zod.z.array(ActionSchema).max(32).safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
    }
    return executor.execute(parsed.data, "test action");
  });
  electron.ipcMain.handle(IPC.setPort, async (_event, port) => restartServer(port));
  electron.ipcMain.handle(IPC.rotateToken, async () => {
    const token = settings.rotateToken();
    server.setToken(token);
    pairCache = null;
    await pushServerInfo();
    return { ok: true, state: await buildState() };
  });
  electron.ipcMain.handle(IPC.setDiscovery, async (_event, enabled) => {
    settings.update({ discovery: enabled });
    if (enabled) {
      const started = await discovery.start();
      if (!started) {
        await pushServerInfo();
        return { ok: false, error: "Could not start discovery. UDP port 47655 may be in use.", state: await buildState() };
      }
    } else {
      discovery.stop();
    }
    await pushServerInfo();
    return { ok: true, state: await buildState() };
  });
  electron.ipcMain.handle(IPC.setLaunchAtLogin, async (_event, enabled) => {
    settings.update({ launchAtLogin: enabled });
    if (process.platform === "win32" || process.platform === "darwin") {
      try {
        electron.app.setLoginItemSettings({ openAtLogin: enabled });
      } catch (error) {
        logger.warn(`Could not update login item: ${error.message}`);
      }
    }
    await pushServerInfo();
    return { ok: true, state: await buildState() };
  });
  electron.ipcMain.handle(IPC.exportConfig, async () => {
    const result = await showSave({
      title: "Export PhoneDeck configuration",
      defaultPath: "phonedek-config.json",
      filters: [{ name: "PhoneDeck config", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      node_fs.writeFileSync(result.filePath, `${JSON.stringify(store.get(), null, 2)}
`, "utf8");
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.importConfig, async () => {
    const result = await showOpen({
      title: "Import PhoneDeck configuration",
      properties: ["openFile"],
      filters: [{ name: "PhoneDeck config", extensions: ["json"] }]
    });
    const file = result.filePaths[0];
    if (result.canceled || !file) return { ok: false };
    try {
      const parsed = JSON.parse(node_fs.readFileSync(file, "utf8"));
      const validation = validateConfig(parsed);
      if (!validation.ok) return { ok: false, errors: validation.errors };
      const config = store.replace(validation.config);
      mainWindow?.webContents.send(IPC.configChangedEvent, config);
      return { ok: true, config };
    } catch (error) {
      return { ok: false, errors: [error.message] };
    }
  });
  electron.ipcMain.handle(IPC.openLogs, async () => {
    if (logger.logPath && node_fs.existsSync(logger.logPath)) await electron.shell.openPath(logger.logPath);
    else await electron.shell.openPath(electron.app.getPath("userData"));
  });
  electron.ipcMain.handle(IPC.openExternal, async (_event, url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Invalid URL");
    await electron.shell.openExternal(url);
  });
  electron.ipcMain.handle(IPC.copyText, async (_event, text) => {
    electron.clipboard.writeText(String(text).slice(0, 2e4));
  });
}
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: "#070b14",
    show: false,
    title: "PhoneDeck",
    autoHideMenuBar: true,
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void electron.shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const devUrl2 = process.env["ELECTRON_RENDERER_URL"];
    if (devUrl2 && url.startsWith(devUrl2)) return;
    if (url.startsWith("file://")) return;
    event.preventDefault();
  });
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      mainWindow?.webContents.toggleDevTools();
    }
  });
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(node_path.join(__dirname, "../renderer/index.html"));
}
async function bootstrap() {
  const userData = electron.app.getPath("userData");
  logger = createLogger(userData);
  logger.info(`PhoneDeck ${APP_VERSION} starting on ${process.platform} (${process.arch})`);
  logger.info(`Data directory: ${userData}`);
  store = new ConfigStore({ dir: userData, logger });
  if (store.getLastError()) logger.warn(`Config was repaired: ${store.getLastError()}`);
  settings = new SettingsStore(userData, logger);
  assets = new AssetStore(store.assetsDir, logger);
  keySender = createKeySender(helperPath(), process.platform, logger);
  const host = createHostActions({
    platform: process.platform,
    logger,
    openPath: async (path) => electron.shell.openPath(path),
    openExternal: async (url) => electron.shell.openExternal(url)
  });
  executor = new ActionExecutor(keySender, host, logger);
  server = new DeckServer({
    port: settings.get().port,
    token: settings.get().token,
    version: APP_VERSION,
    assets,
    getConfig: () => store.get(),
    getServerName: () => store.get().serverName,
    logger,
    onPress: async (_client, _message, context) => executor.execute(context.button.actions, context.button.label),
    onClientsChanged: () => {
      void pushServerInfo();
    }
  });
  discovery = new DiscoveryService({
    getPort: () => server.port || settings.get().port,
    getName: () => store.get().serverName,
    version: APP_VERSION,
    logger
  });
  store.onChange(() => {
    server.broadcastConfig();
    pairCache = null;
    void pushServerInfo();
  });
  await startServer();
  if (settings.get().discovery) await discovery.start();
  if (process.platform === "win32" && "prewarm" in keySender) {
    void keySender.prewarm();
  }
  registerIpc();
  electron.Menu.setApplicationMenu(null);
  createWindow();
}
const gotLock = electron.app.requestSingleInstanceLock();
if (!gotLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  electron.app.whenReady().then(async () => {
    if (process.platform === "win32") electron.app.setAppUserModelId("com.phonedek.desktop");
    try {
      await bootstrap();
    } catch (error) {
      logger?.error("Startup failed", error);
      electron.dialog.showErrorBox("PhoneDeck could not start", error instanceof Error ? error.message : String(error));
      electron.app.quit();
    }
  });
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  electron.app.on("window-all-closed", () => {
    electron.app.quit();
  });
  electron.app.on("before-quit", (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    shuttingDown = true;
    void (async () => {
      try {
        keySender?.dispose?.();
        discovery?.stop();
        await server?.stop();
      } catch (error) {
        logger?.error("Shutdown failed", error);
      } finally {
        electron.app.quit();
      }
    })();
  });
}
