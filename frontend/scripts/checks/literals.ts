const NAMED_COLORS = [
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue",
  "blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk",
  "crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki",
  "darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen",
  "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue",
  "dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite",
  "gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki",
  "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan",
  "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen",
  "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen",
  "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen",
  "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream",
  "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid",
  "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum",
  "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown",
  "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen",
  "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen",
].join(" ")

export const LITERAL_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["hex color", /#[0-9a-f]{3,8}\b/i],
  ["color function", /\b(rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix|color)\(/],
  [
    "named color",
    new RegExp(`(?<![\\w-])(${NAMED_COLORS.replaceAll(" ", "|")})(?![\\w-])`, "i"),
  ],
  ["duration", /(?<![\w-])\d*\.?\d+m?s(?![\w-])/],
  [
    "easing",
    /cubic-bezier\(|steps\(|(?<![\w-])(ease|ease-in|ease-out|ease-in-out|linear)(?![\w-])/,
  ],
]

export function literalKinds(value: string): string[] {
  return LITERAL_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([name]) => name)
}
