import { LottieEngineError } from "./errors.js";
import type { LottieBezierPath, LottiePoint } from "./types.js";

type Point = Readonly<{ x: number; y: number }>;
type CubicSegment = Readonly<{ start: Point; c1: Point; c2: Point; end: Point }>;
type MutableSubpath = { start: Point; segments: CubicSegment[]; closed: boolean };

export type LottiePathBounds = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

export type ParsedLottieSubpath = Readonly<{
  path: LottieBezierPath;
  bounds: LottiePathBounds;
  segmentCount: number;
}>;

export type ParsedLottiePathData = Readonly<{
  subpaths: readonly ParsedLottieSubpath[];
  segmentCount: number;
}>;

const COMMAND = /^[AaCcHhLlMmQqSsTtVvZz]$/;
const NUMBER_AT_START = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/;
const EPSILON = 1e-9;

function invalid(message: string, details: Readonly<Record<string, unknown>> = {}): LottieEngineError {
  return new LottieEngineError("LOTTIE_PATH_INVALID", message, details);
}

function point(x: number, y: number): Point {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw invalid("SVG path coordinates must be finite.", { x, y });
  return Object.freeze({ x, y });
}

function samePoint(left: Point, right: Point): boolean {
  return Math.abs(left.x - right.x) <= EPSILON && Math.abs(left.y - right.y) <= EPSILON;
}

function tokens(source: string): readonly string[] {
  const result: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    const character = source[offset]!;
    if (/\s|,/.test(character)) {
      offset += 1;
      continue;
    }
    if (COMMAND.test(character)) {
      result.push(character);
      offset += 1;
      continue;
    }
    const match = source.slice(offset).match(NUMBER_AT_START);
    if (!match) {
      throw invalid("SVG path data contains an unsupported token.", {
        offset,
        excerpt: source.slice(offset, offset + 24),
      });
    }
    result.push(match[0]);
    offset += match[0].length;
  }
  return Object.freeze(result);
}

function line(start: Point, end: Point): CubicSegment {
  return Object.freeze({ start, c1: start, c2: end, end });
}

function cubic(start: Point, c1: Point, c2: Point, end: Point): CubicSegment {
  return Object.freeze({ start, c1, c2, end });
}

function reflect(control: Point | null, around: Point): Point {
  return control ? point(2 * around.x - control.x, 2 * around.y - control.y) : around;
}

function quadraticAsCubic(start: Point, control: Point, end: Point): CubicSegment {
  return cubic(
    start,
    point(start.x + (2 / 3) * (control.x - start.x), start.y + (2 / 3) * (control.y - start.y)),
    point(end.x + (2 / 3) * (control.x - end.x), end.y + (2 / 3) * (control.y - end.y)),
    end,
  );
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (length <= EPSILON) return 0;
  const angle = Math.acos(Math.min(1, Math.max(-1, dot / length)));
  return ux * vy - uy * vx < 0 ? -angle : angle;
}

function arcAsCubics(
  start: Point,
  rawRx: number,
  rawRy: number,
  rotationDegrees: number,
  largeArcFlag: number,
  sweepFlag: number,
  end: Point,
): readonly CubicSegment[] {
  let rx = Math.abs(rawRx);
  let ry = Math.abs(rawRy);
  if (samePoint(start, end)) return Object.freeze([]);
  if (rx <= EPSILON || ry <= EPSILON) return Object.freeze([line(start, end)]);
  if ((largeArcFlag !== 0 && largeArcFlag !== 1) || (sweepFlag !== 0 && sweepFlag !== 1)) {
    throw invalid("SVG arc flags must be 0 or 1.", { largeArcFlag, sweepFlag });
  }

  const phi = ((rotationDegrees % 360) * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const halfDx = (start.x - end.x) / 2;
  const halfDy = (start.y - end.y) / 2;
  const xPrime = cosPhi * halfDx + sinPhi * halfDy;
  const yPrime = -sinPhi * halfDx + cosPhi * halfDy;

  const radiusScale = (xPrime * xPrime) / (rx * rx) + (yPrime * yPrime) / (ry * ry);
  if (radiusScale > 1) {
    const scale = Math.sqrt(radiusScale);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const xPrime2 = xPrime * xPrime;
  const yPrime2 = yPrime * yPrime;
  const denominator = rx2 * yPrime2 + ry2 * xPrime2;
  const numerator = Math.max(0, rx2 * ry2 - denominator);
  const sign = largeArcFlag === sweepFlag ? -1 : 1;
  const coefficient = denominator <= EPSILON ? 0 : sign * Math.sqrt(numerator / denominator);
  const centerXPrime = coefficient * ((rx * yPrime) / ry);
  const centerYPrime = coefficient * (-(ry * xPrime) / rx);
  const centerX = cosPhi * centerXPrime - sinPhi * centerYPrime + (start.x + end.x) / 2;
  const centerY = sinPhi * centerXPrime + cosPhi * centerYPrime + (start.y + end.y) / 2;

  const ux = (xPrime - centerXPrime) / rx;
  const uy = (yPrime - centerYPrime) / ry;
  const vx = (-xPrime - centerXPrime) / rx;
  const vy = (-yPrime - centerYPrime) / ry;
  let startAngle = vectorAngle(1, 0, ux, uy);
  let sweepAngle = vectorAngle(ux, uy, vx, vy);
  if (!sweepFlag && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  if (sweepFlag && sweepAngle < 0) sweepAngle += 2 * Math.PI;

  const segmentCount = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2)));
  const segmentAngle = sweepAngle / segmentCount;
  const segments: CubicSegment[] = [];
  let segmentStart = start;

  const ellipsePoint = (angle: number): Point =>
    point(
      centerX + rx * cosPhi * Math.cos(angle) - ry * sinPhi * Math.sin(angle),
      centerY + rx * sinPhi * Math.cos(angle) + ry * cosPhi * Math.sin(angle),
    );
  const ellipseDerivative = (angle: number): Point =>
    point(
      -rx * cosPhi * Math.sin(angle) - ry * sinPhi * Math.cos(angle),
      -rx * sinPhi * Math.sin(angle) + ry * cosPhi * Math.cos(angle),
    );

  for (let index = 0; index < segmentCount; index += 1) {
    const nextAngle = startAngle + segmentAngle;
    const segmentEnd = index === segmentCount - 1 ? end : ellipsePoint(nextAngle);
    const derivativeStart = ellipseDerivative(startAngle);
    const derivativeEnd = ellipseDerivative(nextAngle);
    const alpha = (4 / 3) * Math.tan(segmentAngle / 4);
    segments.push(cubic(
      segmentStart,
      point(segmentStart.x + alpha * derivativeStart.x, segmentStart.y + alpha * derivativeStart.y),
      point(segmentEnd.x - alpha * derivativeEnd.x, segmentEnd.y - alpha * derivativeEnd.y),
      segmentEnd,
    ));
    segmentStart = segmentEnd;
    startAngle = nextAngle;
  }
  return Object.freeze(segments);
}

function cubicValue(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const oneMinus = 1 - t;
  return oneMinus ** 3 * p0 + 3 * oneMinus ** 2 * t * p1 + 3 * oneMinus * t ** 2 * p2 + t ** 3 * p3;
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): readonly number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 3 * p0 - 6 * p1 + 3 * p2;
  const c = -3 * p0 + 3 * p1;
  const quadratic = 3 * a;
  const linear = 2 * b;
  if (Math.abs(quadratic) <= EPSILON) {
    if (Math.abs(linear) <= EPSILON) return Object.freeze([]);
    const root = -c / linear;
    return Object.freeze(root > 0 && root < 1 ? [root] : []);
  }
  const discriminant = linear * linear - 4 * quadratic * c;
  if (discriminant < -EPSILON) return Object.freeze([]);
  const rootDiscriminant = Math.sqrt(Math.max(0, discriminant));
  const roots = [
    (-linear + rootDiscriminant) / (2 * quadratic),
    (-linear - rootDiscriminant) / (2 * quadratic),
  ].filter((value, index, values) => value > 0 && value < 1 && values.findIndex((other) => Math.abs(other - value) <= EPSILON) === index);
  return Object.freeze(roots);
}

function segmentBounds(segment: CubicSegment): LottiePathBounds {
  const xs = [segment.start.x, segment.end.x];
  const ys = [segment.start.y, segment.end.y];
  for (const t of cubicExtrema(segment.start.x, segment.c1.x, segment.c2.x, segment.end.x)) {
    xs.push(cubicValue(segment.start.x, segment.c1.x, segment.c2.x, segment.end.x, t));
  }
  for (const t of cubicExtrema(segment.start.y, segment.c1.y, segment.c2.y, segment.end.y)) {
    ys.push(cubicValue(segment.start.y, segment.c1.y, segment.c2.y, segment.end.y, t));
  }
  return Object.freeze({ minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function relativeVector(from: Point, to: Point, precision: number): LottiePoint {
  return Object.freeze([round(to.x - from.x, precision), round(to.y - from.y, precision)]);
}

function absolutePoint(value: Point, offsetX: number, offsetY: number, precision: number): LottiePoint {
  return Object.freeze([round(value.x - offsetX, precision), round(value.y - offsetY, precision)]);
}

function convertSubpath(
  subpath: MutableSubpath,
  offsetX: number,
  offsetY: number,
  precision: number,
): ParsedLottieSubpath {
  if (subpath.segments.length === 0) throw invalid("A Lottie path requires at least one drawable segment.");
  const vertices: LottiePoint[] = [absolutePoint(subpath.segments[0]!.start, offsetX, offsetY, precision)];
  const incoming: LottiePoint[] = [Object.freeze([0, 0])];
  const outgoing: LottiePoint[] = [Object.freeze([0, 0])];
  const firstPoint = subpath.segments[0]!.start;
  let bounds = segmentBounds(subpath.segments[0]!);

  subpath.segments.forEach((segment, segmentIndex) => {
    const startIndex = vertices.length - 1;
    outgoing[startIndex] = relativeVector(segment.start, segment.c1, precision);
    const closesAtStart = subpath.closed && segmentIndex === subpath.segments.length - 1 && samePoint(segment.end, firstPoint);
    if (closesAtStart) {
      incoming[0] = relativeVector(segment.end, segment.c2, precision);
    } else {
      vertices.push(absolutePoint(segment.end, offsetX, offsetY, precision));
      incoming.push(relativeVector(segment.end, segment.c2, precision));
      outgoing.push(Object.freeze([0, 0]));
    }
    if (segmentIndex > 0) {
      const current = segmentBounds(segment);
      bounds = Object.freeze({
        minX: Math.min(bounds.minX, current.minX),
        minY: Math.min(bounds.minY, current.minY),
        maxX: Math.max(bounds.maxX, current.maxX),
        maxY: Math.max(bounds.maxY, current.maxY),
      });
    }
  });

  return Object.freeze({
    path: Object.freeze({ c: subpath.closed, v: Object.freeze(vertices), i: Object.freeze(incoming), o: Object.freeze(outgoing) }),
    bounds: Object.freeze({
      minX: round(bounds.minX - offsetX, precision),
      minY: round(bounds.minY - offsetY, precision),
      maxX: round(bounds.maxX - offsetX, precision),
      maxY: round(bounds.maxY - offsetY, precision),
    }),
    segmentCount: subpath.segments.length,
  });
}

export function parseSvgPathDataToLottie(
  source: string,
  options: Readonly<{ offsetX?: number; offsetY?: number; precision?: number }> = {},
): ParsedLottiePathData {
  const pathTokens = tokens(source);
  if (pathTokens.length === 0) throw invalid("SVG path data is empty.");
  const subpaths: MutableSubpath[] = [];
  let active: MutableSubpath | null = null;
  let current = point(0, 0);
  let command: string | null = null;
  let previousCommand = "";
  let previousCubicControl: Point | null = null;
  let previousQuadraticControl: Point | null = null;
  let index = 0;

  const isCommand = (value: string | undefined): boolean => Boolean(value && COMMAND.test(value));
  const hasNumber = (): boolean => index < pathTokens.length && !isCommand(pathTokens[index]);
  const readNumber = (): number => {
    const value = pathTokens[index];
    if (value === undefined || isCommand(value)) throw invalid("SVG path command is missing numeric parameters.", { index, command });
    index += 1;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw invalid("SVG path contains a non-finite number.", { value, index: index - 1 });
    return parsed;
  };
  const coordinate = (x: number, y: number, relative: boolean): Point =>
    relative ? point(current.x + x, current.y + y) : point(x, y);
  const requireActive = (): MutableSubpath => {
    if (!active) throw invalid("SVG path drawing commands must follow a move command.", { command });
    return active;
  };
  const addSegment = (segment: CubicSegment): void => {
    requireActive().segments.push(segment);
    current = segment.end;
  };
  const resetControls = (): void => {
    previousCubicControl = null;
    previousQuadraticControl = null;
  };

  while (index < pathTokens.length) {
    if (isCommand(pathTokens[index])) {
      command = pathTokens[index]!;
      index += 1;
    } else if (!command) {
      throw invalid("SVG path data must begin with a command.", { index });
    }

    const upper = command!.toUpperCase();
    const relative = command !== upper;
    if (upper === "Z") {
      const target = requireActive();
      if (!samePoint(current, target.start)) addSegment(line(current, target.start));
      target.closed = true;
      current = target.start;
      previousCommand = "Z";
      resetControls();
      command = null;
      continue;
    }

    if (upper === "M") {
      const destination = coordinate(readNumber(), readNumber(), relative);
      active = { start: destination, segments: [], closed: false };
      subpaths.push(active);
      current = destination;
      previousCommand = "M";
      resetControls();
      command = relative ? "l" : "L";
      while (hasNumber()) {
        const end = coordinate(readNumber(), readNumber(), relative);
        addSegment(line(current, end));
        previousCommand = "L";
      }
      continue;
    }

    requireActive();
    if (!hasNumber()) throw invalid("SVG path command is missing parameters.", { command, index });

    if (upper === "L") {
      addSegment(line(current, coordinate(readNumber(), readNumber(), relative)));
      previousCommand = "L";
      resetControls();
    } else if (upper === "H") {
      const x = readNumber();
      addSegment(line(current, point(relative ? current.x + x : x, current.y)));
      previousCommand = "H";
      resetControls();
    } else if (upper === "V") {
      const y = readNumber();
      addSegment(line(current, point(current.x, relative ? current.y + y : y)));
      previousCommand = "V";
      resetControls();
    } else if (upper === "C") {
      const c1 = coordinate(readNumber(), readNumber(), relative);
      const c2 = coordinate(readNumber(), readNumber(), relative);
      const end = coordinate(readNumber(), readNumber(), relative);
      addSegment(cubic(current, c1, c2, end));
      previousCubicControl = c2;
      previousQuadraticControl = null;
      previousCommand = "C";
    } else if (upper === "S") {
      const c1 = previousCommand === "C" || previousCommand === "S" ? reflect(previousCubicControl, current) : current;
      const c2 = coordinate(readNumber(), readNumber(), relative);
      const end = coordinate(readNumber(), readNumber(), relative);
      addSegment(cubic(current, c1, c2, end));
      previousCubicControl = c2;
      previousQuadraticControl = null;
      previousCommand = "S";
    } else if (upper === "Q") {
      const control = coordinate(readNumber(), readNumber(), relative);
      const end = coordinate(readNumber(), readNumber(), relative);
      addSegment(quadraticAsCubic(current, control, end));
      previousQuadraticControl = control;
      previousCubicControl = null;
      previousCommand = "Q";
    } else if (upper === "T") {
      const control = previousCommand === "Q" || previousCommand === "T" ? reflect(previousQuadraticControl, current) : current;
      const end = coordinate(readNumber(), readNumber(), relative);
      addSegment(quadraticAsCubic(current, control, end));
      previousQuadraticControl = control;
      previousCubicControl = null;
      previousCommand = "T";
    } else if (upper === "A") {
      const rx = readNumber();
      const ry = readNumber();
      const rotation = readNumber();
      const largeArcFlag = readNumber();
      const sweepFlag = readNumber();
      const end = coordinate(readNumber(), readNumber(), relative);
      const arcSegments = arcAsCubics(current, rx, ry, rotation, largeArcFlag, sweepFlag, end);
      for (const segment of arcSegments) addSegment(segment);
      current = end;
      previousCommand = "A";
      resetControls();
    } else {
      throw invalid("SVG path command is unsupported.", { command });
    }
  }

  const drawable = subpaths.filter((subpath) => subpath.segments.length > 0);
  if (drawable.length === 0) throw invalid("SVG path data contains no drawable segments.");
  const precision = options.precision ?? 4;
  if (!Number.isSafeInteger(precision) || precision < 0 || precision > 8) {
    throw invalid("Path precision must be an integer from 0 to 8.", { precision });
  }
  const converted = drawable.map((subpath) =>
    convertSubpath(subpath, options.offsetX ?? 0, options.offsetY ?? 0, precision),
  );
  return Object.freeze({
    subpaths: Object.freeze(converted),
    segmentCount: converted.reduce((total, subpath) => total + subpath.segmentCount, 0),
  });
}
