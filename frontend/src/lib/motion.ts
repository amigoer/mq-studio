/*
 * Motion's half of the `--mo-*` ladder in tokens.css. CSS transitions read the
 * variables; Motion components read these, so both move on one set of
 * numbers. Keep the two in step.
 *
 * The 界面过渡动画 switch reaches both: the variables collapse to 0s, and
 * `setAnimations` tells Motion to skip straight to each end state.
 */

import { useEffect, useState } from "react";
import { MotionGlobalConfig, type MotionProps } from "motion/react";

export const DURATION = { fast: 0.12, base: 0.18, slow: 0.28 } as const;

export const EASE = {
  standard: [0.32, 0.72, 0, 1],
  out: [0.16, 1, 0.3, 1],
  in: [0.32, 0, 0.67, 0],
} as const;

/** Dropped rather than shortened, so nothing can be caught mid-way. */
export function setAnimations(on: boolean): void {
  MotionGlobalConfig.skipAnimations = !on;
}

/** A page or settings section arriving: a little rise, so it reads as arriving rather than a flash. */
export const viewIn = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DURATION.base, ease: EASE.out },
} satisfies MotionProps;

/**
 * 测试连接's answer, out from the button it answers rather than swapped in
 * place, so a second test with the same answer still visibly got one.
 */
export const probeIn = {
  initial: { opacity: 0, x: -4 },
  animate: { opacity: 1, x: 0 },
  transition: { duration: DURATION.base, ease: EASE.out },
} satisfies MotionProps;

/** The tick or cross inside that answer, landing rather than appearing. */
export const markIn = {
  initial: { scale: 0.4 },
  animate: { scale: 1 },
  transition: { duration: DURATION.base, ease: EASE.out },
} satisfies MotionProps;

/**
 * A block opening to its height and closing back. Dialogs are centred, so a
 * block arriving at full height would jolt the whole form by half of it.
 */
export const reveal = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE.out },
} satisfies MotionProps;

/**
 * The last value seen while `holding` was false, for as long as it is true.
 *
 * For an element that stays mounted and animates out after the state it draws
 * is already gone: without it the content changes first and then leaves.
 * `value` has to keep its identity between renders, or this renders forever.
 */
export function useHeld<T>(value: T, holding: boolean): T {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    if (!holding) setHeld(value);
  }, [holding, value]);
  return holding ? held : value;
}
