import {
  Hct,
  SchemeTonalSpot,
  argbFromHex,
  hexFromArgb,
} from "@material/material-color-utilities";

const accent = "#5470ec";
const hct = Hct.fromInt(argbFromHex(accent));

const roles = [
  "primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
  "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
  "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
  "error", "onError", "errorContainer", "onErrorContainer",
  "background", "onBackground",
  "surface", "onSurface",
  "surfaceVariant", "onSurfaceVariant",
  "outline", "outlineVariant",
  "shadow", "scrim",
  "inverseSurface", "inverseOnSurface", "inversePrimary",
  "surfaceDim", "surfaceBright",
  "surfaceContainerLowest", "surfaceContainerLow",
  "surfaceContainer", "surfaceContainerHigh", "surfaceContainerHighest",
  "primaryFixed", "primaryFixedDim", "onPrimaryFixed", "onPrimaryFixedVariant",
];

for (const dark of [false, true]) {
  const scheme = new SchemeTonalSpot(hct, dark, 0.0);
  console.log(`\n===== ${dark ? "DARK" : "LIGHT"} =====`);
  for (const role of roles) {
    try {
      console.log(`${role}: ${hexFromArgb(scheme[role])}`);
    } catch {
      console.log(`${role}: <n/a>`);
    }
  }
}
