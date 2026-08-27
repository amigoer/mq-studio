/**
 * The driver module registry.
 *
 * A module is what one broker family adds on top of the canonical pages:
 * terminology, the columns and detail fields its pages show, and - only where
 * a canonical page has no counterpart at all - a page of its own.
 *
 * The rule that keeps this from becoming a dumping ground: a driver may
 * replace a canonical page only when that page has no counterpart for the
 * family, or when more than half its primary columns would be driver-specific.
 * Otherwise it contributes columns and fields to the canonical page.
 */
import type { ComponentType } from "react";
import type {
  CanonicalPageId,
  MQKind,
  NavContribution,
  PageContribution,
} from "./types";

export interface MqModule {
  kind: MQKind;
  // The canonical models these describe reach TypeScript only once a bridge
  // method returns them, which happens page by page. Until then a module can
  // still register terminology, pages and navigation.
  destinations?: PageContribution<unknown>;
  subscriptions?: PageContribution<unknown>;
  /** Whole-page replacements. Must satisfy the override rule above. */
  pages?: Partial<Record<CanonicalPageId, ComponentType<unknown>>>;
  /** Extra entries beyond the canonical page set. */
  nav?: NavContribution[];
}

const modules = new Map<MQKind, MqModule>();

/** Registers a family's module. Called once per driver at import time. */
export function registerModule(module: MqModule): void {
  modules.set(module.kind, module);
}

/** The module for a family, or undefined when it contributes nothing. */
export function moduleFor(kind: MQKind | undefined): MqModule | undefined {
  return kind ? modules.get(kind) : undefined;
}

/** Every registered kind, for a driver picker. */
export function registeredKinds(): MQKind[] {
  return [...modules.keys()];
}
