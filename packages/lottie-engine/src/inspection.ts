import {
  LOTTIE_CONTRACT_VERSION,
  MAX_LOTTIE_CANVAS_DIMENSION,
  MAX_LOTTIE_FRAME_RATE,
  MIN_LOTTIE_FRAME_RATE,
  type LottieFinding,
  type LottieInspection,
} from "./types.js";

type MutableCounts = {
  pathShapeCount: number;
  fillShapeCount: number;
  strokeShapeCount: number;
  animatedPropertyCount: number;
  expressionCount: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finding(
  code: string,
  severity: LottieFinding["severity"],
  message: string,
  layerName?: string,
): LottieFinding {
  return Object.freeze({
    code,
    severity,
    message,
    ...(layerName ? { layerName } : {}),
  });
}

function numericVector(
  value: unknown,
  minimumLength = 1,
): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length >= minimumLength &&
    value.every(
      (item) => typeof item === "number" && Number.isFinite(item),
    )
  );
}

function countExpressions(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce(
      (total, item) => total + countExpressions(item),
      0,
    );
  }
  const object = record(value);
  if (!object) return 0;
  let total =
    typeof object.x === "string" && object.x.trim().length > 0 ? 1 : 0;
  for (const [key, item] of Object.entries(object)) {
    if (key !== "x") total += countExpressions(item);
  }
  return total;
}

function inspectEasing(
  value: unknown,
  findings: LottieFinding[],
  layerName: string,
  path: string,
): void {
  const object = record(value);
  if (
    !object ||
    !numericVector(object.x) ||
    !numericVector(object.y) ||
    object.x.length !== object.y.length
  ) {
    findings.push(
      finding(
        "LOTTIE_KEYFRAME_EASING_INVALID",
        "error",
        `${path} must contain equally sized numeric x and y arrays.`,
        layerName,
      ),
    );
  }
}

function inspectProperty(
  value: unknown,
  findings: LottieFinding[],
  counts: MutableCounts,
  layerName: string,
  path: string,
  expectedStaticLength?: number,
): void {
  const property = record(value);
  if (!property || (property.a !== 0 && property.a !== 1)) {
    findings.push(
      finding(
        "LOTTIE_PROPERTY_INVALID",
        "error",
        `${path} must be a Lottie property with a equal to 0 or 1.`,
        layerName,
      ),
    );
    return;
  }

  if (property.a === 0) {
    const staticValue = property.k;
    const valid =
      expectedStaticLength === undefined
        ? finiteNumber(staticValue) !== null || numericVector(staticValue)
        : numericVector(staticValue, expectedStaticLength) &&
          staticValue.length === expectedStaticLength;
    if (!valid) {
      findings.push(
        finding(
          "LOTTIE_STATIC_PROPERTY_INVALID",
          "error",
          `${path} contains an invalid static value.`,
          layerName,
        ),
      );
    }
    return;
  }

  counts.animatedPropertyCount += 1;
  if (!Array.isArray(property.k) || property.k.length < 2) {
    findings.push(
      finding(
        "LOTTIE_KEYFRAMES_INVALID",
        "error",
        `${path} must contain at least two keyframes.`,
        layerName,
      ),
    );
    return;
  }

  const keyframes = property.k as unknown[];
  let previousTime = Number.NEGATIVE_INFINITY;
  keyframes.forEach((rawKeyframe, index) => {
    const keyframe = record(rawKeyframe);
    const time = finiteNumber(keyframe?.t);
    if (!keyframe || time === null || !numericVector(keyframe.s)) {
      findings.push(
        finding(
          "LOTTIE_KEYFRAME_INVALID",
          "error",
          `${path}.k[${index}] requires finite t and numeric s values.`,
          layerName,
        ),
      );
      return;
    }
    if (
      expectedStaticLength !== undefined &&
      keyframe.s.length !== expectedStaticLength
    ) {
      findings.push(
        finding(
          "LOTTIE_KEYFRAME_CARDINALITY_INVALID",
          "error",
          `${path}.k[${index}].s must contain ${expectedStaticLength} values.`,
          layerName,
        ),
      );
    }
    if (time < previousTime) {
      findings.push(
        finding(
          "LOTTIE_KEYFRAME_ORDER_INVALID",
          "error",
          `${path} keyframes must use ascending frame times.`,
          layerName,
        ),
      );
    }
    previousTime = time;
    if (Object.prototype.hasOwnProperty.call(keyframe, "e")) {
      findings.push(
        finding(
          "LOTTIE_LEGACY_END_VALUE",
          "error",
          `${path}.k[${index}] uses the legacy e keyframe field.`,
          layerName,
        ),
      );
    }
    if (index < keyframes.length - 1 && keyframe.h !== 1) {
      inspectEasing(keyframe.o, findings, layerName, `${path}.k[${index}].o`);
      inspectEasing(keyframe.i, findings, layerName, `${path}.k[${index}].i`);
    }
  });
}

function inspectBezierPath(
  value: unknown,
  findings: LottieFinding[],
  layerName: string,
  path: string,
): void {
  const shape = record(value);
  if (
    !shape ||
    typeof shape.c !== "boolean" ||
    !Array.isArray(shape.v) ||
    !Array.isArray(shape.i) ||
    !Array.isArray(shape.o)
  ) {
    findings.push(
      finding(
        "LOTTIE_BEZIER_INVALID",
        "error",
        `${path} is not a valid Lottie bezier path.`,
        layerName,
      ),
    );
    return;
  }
  if (
    shape.v.length < 2 ||
    shape.v.length !== shape.i.length ||
    shape.v.length !== shape.o.length
  ) {
    findings.push(
      finding(
        "LOTTIE_BEZIER_CARDINALITY_INVALID",
        "error",
        `${path} vertices and tangent arrays must have equal length of at least two.`,
        layerName,
      ),
    );
    return;
  }
  for (const [field, points] of [
    ["v", shape.v],
    ["i", shape.i],
    ["o", shape.o],
  ] as const) {
    if (
      !points.every(
        (point) => numericVector(point, 2) && point.length === 2,
      )
    ) {
      findings.push(
        finding(
          "LOTTIE_BEZIER_POINT_INVALID",
          "error",
          `${path}.${field} must contain finite two-dimensional points.`,
          layerName,
        ),
      );
    }
  }
}

function inspectShapeTransform(
  shape: Record<string, unknown>,
  findings: LottieFinding[],
  counts: MutableCounts,
  layerName: string,
  path: string,
): void {
  inspectProperty(shape.a, findings, counts, layerName, `${path}.a`, 2);
  inspectProperty(shape.p, findings, counts, layerName, `${path}.p`, 2);
  inspectProperty(shape.s, findings, counts, layerName, `${path}.s`, 2);
  inspectProperty(shape.r, findings, counts, layerName, `${path}.r`);
  inspectProperty(shape.o, findings, counts, layerName, `${path}.o`);
}

function inspectShapes(
  value: unknown,
  findings: LottieFinding[],
  counts: MutableCounts,
  layerName: string,
  path: string,
): void {
  if (!Array.isArray(value)) {
    findings.push(
      finding(
        "LOTTIE_SHAPES_INVALID",
        "error",
        `${path} must be an array.`,
        layerName,
      ),
    );
    return;
  }

  value.forEach((rawShape, index) => {
    const shape = record(rawShape);
    const shapePath = `${path}[${index}]`;
    const type = shape?.ty;
    if (!shape || typeof type !== "string") {
      findings.push(
        finding(
          "LOTTIE_SHAPE_INVALID",
          "error",
          `${shapePath} requires a shape type.`,
          layerName,
        ),
      );
      return;
    }

    if (type === "gr") {
      if (!Array.isArray(shape.it) || shape.it.length < 2) {
        findings.push(
          finding(
            "LOTTIE_GROUP_INVALID",
            "error",
            `${shapePath} must contain shapes and a terminal transform.`,
            layerName,
          ),
        );
        return;
      }
      const terminal = record(shape.it.at(-1));
      if (terminal?.ty !== "tr") {
        findings.push(
          finding(
            "LOTTIE_GROUP_TRANSFORM_MISSING",
            "error",
            `${shapePath} must end with a transform shape.`,
            layerName,
          ),
        );
      }
      inspectShapes(shape.it, findings, counts, layerName, `${shapePath}.it`);
      return;
    }

    if (type === "sh") {
      counts.pathShapeCount += 1;
      const property = record(shape.ks);
      if (!property || property.a !== 0) {
        findings.push(
          finding(
            "LOTTIE_PATH_ANIMATION_UNSUPPORTED",
            "error",
            `${shapePath}.ks must contain static path geometry.`,
            layerName,
          ),
        );
      } else {
        inspectBezierPath(
          property.k,
          findings,
          layerName,
          `${shapePath}.ks.k`,
        );
      }
      return;
    }

    if (type === "fl") {
      counts.fillShapeCount += 1;
      inspectProperty(shape.c, findings, counts, layerName, `${shapePath}.c`, 3);
      inspectProperty(shape.o, findings, counts, layerName, `${shapePath}.o`);
      if (shape.r !== 1 && shape.r !== 2) {
        findings.push(
          finding(
            "LOTTIE_FILL_RULE_INVALID",
            "error",
            `${shapePath}.r must be 1 or 2.`,
            layerName,
          ),
        );
      }
      return;
    }

    if (type === "st") {
      counts.strokeShapeCount += 1;
      inspectProperty(shape.c, findings, counts, layerName, `${shapePath}.c`, 3);
      inspectProperty(shape.o, findings, counts, layerName, `${shapePath}.o`);
      inspectProperty(shape.w, findings, counts, layerName, `${shapePath}.w`);
      if (
        ![1, 2, 3].includes(Number(shape.lc)) ||
        ![1, 2, 3].includes(Number(shape.lj))
      ) {
        findings.push(
          finding(
            "LOTTIE_STROKE_STYLE_INVALID",
            "error",
            `${shapePath} has an unsupported line cap or join.`,
            layerName,
          ),
        );
      }
      return;
    }

    if (type === "tr") {
      inspectShapeTransform(shape, findings, counts, layerName, shapePath);
      return;
    }

    findings.push(
      finding(
        "LOTTIE_SHAPE_UNSUPPORTED",
        "error",
        `${shapePath} uses unsupported shape type ${type}.`,
        layerName,
      ),
    );
  });
}

function inspectLayerTransform(
  value: unknown,
  findings: LottieFinding[],
  counts: MutableCounts,
  layerName: string,
): void {
  const transform = record(value);
  if (!transform) {
    findings.push(
      finding(
        "LOTTIE_LAYER_TRANSFORM_INVALID",
        "error",
        "Shape layer is missing its transform.",
        layerName,
      ),
    );
    return;
  }
  inspectProperty(transform.a, findings, counts, layerName, "ks.a", 3);
  inspectProperty(transform.p, findings, counts, layerName, "ks.p", 3);
  inspectProperty(transform.s, findings, counts, layerName, "ks.s", 3);
  inspectProperty(transform.r, findings, counts, layerName, "ks.r");
  inspectProperty(transform.o, findings, counts, layerName, "ks.o");
}

export function inspectLottie(input: string | unknown): LottieInspection {
  const findings: LottieFinding[] = [];
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch (error) {
      findings.push(
        finding(
          "LOTTIE_JSON_INVALID",
          "error",
          `Lottie JSON could not be parsed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    }
  }

  const root = record(parsed);
  const width = finiteNumber(root?.w);
  const height = finiteNumber(root?.h);
  const frameRate = finiteNumber(root?.fr);
  const inPoint = finiteNumber(root?.ip);
  const outPoint = finiteNumber(root?.op);
  const contractVersion =
    typeof record(root?.meta)?.contractVersion === "string"
      ? String(record(root?.meta)?.contractVersion)
      : null;
  const layers = Array.isArray(root?.layers) ? root.layers : [];
  const assets = Array.isArray(root?.assets) ? root.assets : [];
  const counts: MutableCounts = {
    pathShapeCount: 0,
    fillShapeCount: 0,
    strokeShapeCount: 0,
    animatedPropertyCount: 0,
    expressionCount: countExpressions(parsed),
  };

  if (!root) {
    findings.push(
      finding(
        "LOTTIE_ROOT_INVALID",
        "error",
        "Lottie input must be a JSON object.",
      ),
    );
  }
  if (contractVersion !== LOTTIE_CONTRACT_VERSION) {
    findings.push(
      finding(
        "LOTTIE_CONTRACT_INVALID",
        "error",
        `EVAVO Lottie contract ${LOTTIE_CONTRACT_VERSION} is required.`,
      ),
    );
  }
  if (
    !Number.isSafeInteger(width) ||
    width === null ||
    width < 1 ||
    width > MAX_LOTTIE_CANVAS_DIMENSION
  ) {
    findings.push(
      finding(
        "LOTTIE_WIDTH_INVALID",
        "error",
        `Lottie width must be an integer from 1 to ${MAX_LOTTIE_CANVAS_DIMENSION}.`,
      ),
    );
  }
  if (
    !Number.isSafeInteger(height) ||
    height === null ||
    height < 1 ||
    height > MAX_LOTTIE_CANVAS_DIMENSION
  ) {
    findings.push(
      finding(
        "LOTTIE_HEIGHT_INVALID",
        "error",
        `Lottie height must be an integer from 1 to ${MAX_LOTTIE_CANVAS_DIMENSION}.`,
      ),
    );
  }
  if (
    frameRate === null ||
    frameRate < MIN_LOTTIE_FRAME_RATE ||
    frameRate > MAX_LOTTIE_FRAME_RATE
  ) {
    findings.push(
      finding(
        "LOTTIE_FRAME_RATE_INVALID",
        "error",
        `Lottie frame rate must be from ${MIN_LOTTIE_FRAME_RATE} to ${MAX_LOTTIE_FRAME_RATE}.`,
      ),
    );
  }
  if (inPoint !== 0 || outPoint === null || outPoint <= 0) {
    findings.push(
      finding(
        "LOTTIE_TIME_RANGE_INVALID",
        "error",
        "Lottie in point must be 0 and out point must be greater than 0.",
      ),
    );
  }
  if (!Array.isArray(root?.layers) || layers.length === 0) {
    findings.push(
      finding(
        "LOTTIE_LAYERS_INVALID",
        "error",
        "Lottie output requires at least one layer.",
      ),
    );
  }
  if (!Array.isArray(root?.assets) || assets.length !== 0) {
    findings.push(
      finding(
        "LOTTIE_ASSETS_UNSUPPORTED",
        "error",
        "Governed Lottie v1 output must not contain assets.",
      ),
    );
  }

  let shapeLayerCount = 0;
  let imageLayerCount = 0;
  let textLayerCount = 0;
  let precompositionLayerCount = 0;
  layers.forEach((rawLayer, index) => {
    const layer = record(rawLayer);
    const type = layer?.ty;
    const layerName =
      typeof layer?.nm === "string" ? layer.nm : `Layer ${index + 1}`;
    if (!layer || typeof type !== "number") {
      findings.push(
        finding(
          "LOTTIE_LAYER_INVALID",
          "error",
          "Every layer requires a numeric type.",
          layerName,
        ),
      );
      return;
    }
    if (type === 4) {
      shapeLayerCount += 1;
      inspectLayerTransform(layer.ks, findings, counts, layerName);
      inspectShapes(layer.shapes, findings, counts, layerName, "shapes");
      if (layer.ip !== 0 || finiteNumber(layer.op) !== outPoint) {
        findings.push(
          finding(
            "LOTTIE_LAYER_TIME_RANGE_INVALID",
            "error",
            "Shape-layer time range must match the composition.",
            layerName,
          ),
        );
      }
    } else {
      if (type === 2) imageLayerCount += 1;
      if (type === 5) textLayerCount += 1;
      if (type === 0) precompositionLayerCount += 1;
      findings.push(
        finding(
          "LOTTIE_LAYER_UNSUPPORTED",
          "error",
          `Layer type ${type} is outside the governed shape-layer subset.`,
          layerName,
        ),
      );
    }
  });

  if (counts.pathShapeCount === 0) {
    findings.push(
      finding(
        "LOTTIE_PATHS_MISSING",
        "error",
        "Lottie output contains no path shapes.",
      ),
    );
  }
  if (counts.animatedPropertyCount === 0) {
    findings.push(
      finding(
        "LOTTIE_MOTION_MISSING",
        "error",
        "Lottie output contains no animated properties.",
      ),
    );
  }
  if (counts.expressionCount > 0) {
    findings.push(
      finding(
        "LOTTIE_EXPRESSIONS_UNSUPPORTED",
        "error",
        "Lottie expressions are not permitted by the governed subset.",
      ),
    );
  }

  return Object.freeze({
    valid: !findings.some((item) => item.severity === "error"),
    contractVersion,
    width,
    height,
    frameRate,
    inPoint,
    outPoint,
    layerCount: layers.length,
    shapeLayerCount,
    pathShapeCount: counts.pathShapeCount,
    fillShapeCount: counts.fillShapeCount,
    strokeShapeCount: counts.strokeShapeCount,
    animatedPropertyCount: counts.animatedPropertyCount,
    expressionCount: counts.expressionCount,
    assetCount: assets.length,
    imageLayerCount,
    textLayerCount,
    precompositionLayerCount,
    findings: Object.freeze(findings),
  });
}
