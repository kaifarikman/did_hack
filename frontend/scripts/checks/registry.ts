import { consistency } from "./rules/consistency.ts"
import { cssDuplicates } from "./rules/cssDuplicates.ts"
import { cssModules, globalStyles } from "./rules/cssStructure.ts"
import { cssLiterals, cssTokenRefs, cssTransitions } from "./rules/cssValues.ts"
import { fileLength } from "./rules/fileLength.ts"
import { iconAlias } from "./rules/iconAlias.ts"
import { importCycles } from "./rules/importCycles.ts"
import { layers } from "./rules/layers.ts"
import { motionTokens } from "./rules/motionTokens.ts"
import { accentText, hoverGate, motionLibraries, remoteAssets } from "./rules/motionUsage.ts"
import { noComments } from "./rules/noComments.ts"
import { packageSize, packageSubject } from "./rules/packageShape.ts"
import { noSideStripe } from "./rules/sideStripe.ts"
import { cyrillic, jsxText } from "./rules/texts.ts"
import { touchTargets } from "./rules/touchTargets.ts"
import { tsTimings } from "./rules/tsTimings.ts"
import { scaleTokens, signalScope, tokenLayers } from "./rules/unityCss.ts"
import { contrast, surfaceLadder } from "./rules/unityTokens.ts"
import type { Check } from "./types.ts"

export const CHECKS: readonly Check[] = [
  fileLength,
  noComments,
  packageSize,
  packageSubject,
  importCycles,
  layers,
  cyrillic,
  jsxText,
  cssLiterals,
  cssTokenRefs,
  cssModules,
  cssDuplicates,
  cssTransitions,
  scaleTokens,
  tokenLayers,
  signalScope,
  noSideStripe,
  touchTargets,
  contrast,
  surfaceLadder,
  motionTokens,
  consistency,
  iconAlias,
  globalStyles,
  hoverGate,
  tsTimings,
  motionLibraries,
  remoteAssets,
  accentText,
]
