import { animate, motion, useInView, useReducedMotion, type HTMLMotionProps, type Variants } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motionTokens } from "@/config/theme";

/**
 * Motion building blocks. Every animation in the app uses these presets
 * (or motionTokens in src/config/theme.ts) so timing can be tuned centrally.
 */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  enter: { opacity: 1, y: 0, transition: { duration: motionTokens.base, ease: motionTokens.ease } },
  exit: { opacity: 0, y: -6, transition: { duration: motionTokens.fast, ease: motionTokens.ease } },
};

export const staggerParent: Variants = {
  initial: {},
  enter: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
};
export const staggerChild: Variants = {
  initial: { opacity: 0, y: 12 },
  enter: { opacity: 1, y: 0, transition: { duration: motionTokens.slow, ease: motionTokens.ease } },
};

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={pageVariants} initial="initial" animate="enter" exit="exit" className={className}>
      {children}
    </motion.div>
  );
}

export function Stagger({ children, className, ...p }: HTMLMotionProps<"div">) {
  return (
    <motion.div variants={staggerParent} initial="initial" animate="enter" className={className} {...p}>
      {children}
    </motion.div>
  );
}
export function StaggerItem({ children, className, ...p }: HTMLMotionProps<"div">) {
  return (
    <motion.div variants={staggerChild} className={className} {...p}>
      {children}
    </motion.div>
  );
}

/** Animated number count-up (respects reduced motion). */
export function CountUp({ value, decimals = 0, suffix = "", className }: { value: number; decimals?: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, { duration: 0.9, ease: motionTokens.ease, onUpdate: setDisplay });
    return () => controls.stop();
  }, [inView, value, reduce]);
  return (
    <span ref={ref} className={className}>
      {display.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}
