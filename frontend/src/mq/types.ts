/**
 * The vocabulary the canonical pages speak.
 *
 * Everything here is family-neutral on purpose. What one broker has and
 * another does not travels in the attribute maps, whose keys are a contract
 * between one driver's Go side and its module under mq/<kind>/.
 */
import type { ComponentType, ReactNode } from "react";
import { MQKind } from "@bindings/model/models";
import type { Capability } from "@bindings/model/models";

export { MQKind };
export type { Capability };

/** A page the canonical set provides. */
export type CanonicalPageId =
  | "home"
  | "destinations"
  | "subscriptions"
  | "messages"
  | "publish"
  | "cluster"
  | "alerts"
  | "access";

/** One column a driver contributes to a canonical table. */
export interface ColumnSpec<T> {
  key: string;
  labelKey: string;
  /** Rendered value. Returning null hides the cell rather than showing "null". */
  render: (item: T) => ReactNode;
  align?: "left" | "right";
  /** Hidden unless the connection declares this capability. */
  requires?: Capability;
}

/** One row a driver contributes to a canonical detail panel. */
export interface FieldSpec<T> {
  key: string;
  labelKey: string;
  render: (item: T) => ReactNode;
  requires?: Capability;
}

/** What a driver adds to one canonical page. */
export interface PageContribution<T> {
  columns?: ColumnSpec<T>[];
  fields?: FieldSpec<T>[];
}

/** An extra navigation entry a driver brings with a page of its own. */
export interface NavContribution {
  id: string;
  labelKey: string;
  page: ComponentType<unknown>;
  /** Which group in the sidebar the entry joins. */
  group: "browse" | "ops";
}
