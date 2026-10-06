// Sicurella — design tokens (generado desde tokens.css; mantener en sync).
export const tokens = {
  color: {
    brand: "#008194",
    primary: "#008094",
    primaryHover: "#00707F",
    primaryForeground: "#F5FEFF",
    background: "#FFFFFF",
    foreground: "#020817",
    muted: "#F4F6F6",
    mutedForeground: "#628084",
    secondary: "#F2F7F8",
    secondaryForeground: "#005A66",
    accent: "#F2F7F8",
    accentForeground: "#005A66",
    border: "#E0E9EB",
    input: "#E0E9EB",
    ring: "#008094",
    primarySoft: "rgb(0 128 148 / 0.1)",
    destructive: "#EF4444",
    destructiveForeground: "#F8FAFC",
    success: "#18734B",
    successSoft: "#E8F5EE",
    warning: "#8F5F14",
    warningSoft: "#FDF4E3",
  },
  teal: {
    '50': "#F2FBFC",
    '100': "#DDF4F7",
    '200': "#B6E7EE",
    '300': "#7DD3E0",
    '400': "#33B4C7",
    '500': "#0098AD",
    '600': "#008094",
    '700': "#006B7A",
    '800': "#005A66",
    '900': "#00424B",
    '950': "#002A30",
  },
  font: {
    sans: "\"Figtree\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
    display: "\"Varela Round\", var(--font-sans)",
  },
  radius: {
    md: "calc(var(--radius) - 2px)",
    sm: "calc(var(--radius) - 4px)",
    full: "9999px",
    base: "0.75rem",
  },
  shadow: {
    card: "0 1px 2px rgb(2 8 23 / 0.05)",
    float: "0 10px 30px -10px rgb(2 8 23 / 0.2)",
  },
  tracking: {
    heading: "-0.05em",
  },
} as const;

export type Tokens = typeof tokens;
