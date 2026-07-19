import type { SegmentLike } from "aws-xray-sdk-core";

export interface Context {
  sourceIp?: string;
  // Captured once, synchronously, at the very top of each handler's context
  // factory - see xray.ts's traced() for why this can't just be looked up
  // ambiently at the point of use.
  xraySegment?: SegmentLike;
}
