import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/utils/cn";
import { soundManager, type SoundName } from "@/utils/soundManager";

/**
 * The one button. PrimaryButton / SecondaryButton etc. are variants of this,
 * so every button in the app shares size, radius, focus and press feedback.
 */
export const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[background-color,box-shadow,transform,color] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary-deep text-white hover:bg-primary shadow-[0_6px_16px_-8px_rgb(22_53_42/0.6)]",
        accent: "bg-accent text-primary-deep hover:brightness-95",
        secondary: "bg-surface text-ink shadow-inset hover:bg-secondary/60",
        soft: "bg-secondary text-primary-deep hover:bg-secondary/70",
        ghost: "text-ink-soft hover:bg-ink/5 hover:text-ink",
        danger: "bg-[#A3301F] text-white hover:bg-[#8c2819]",
        link: "text-primary underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        sm: "h-9 rounded-xl px-3.5 text-sm [&_svg]:size-4",
        md: "h-11 rounded-2xl px-5 text-sm [&_svg]:size-[18px]",
        lg: "h-14 rounded-2xl px-7 text-base [&_svg]:size-5",
        icon: "size-10 rounded-full [&_svg]:size-[18px]",
        iconSm: "size-8 rounded-full [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
  /** Sound to play on click; pass null for silence. */
  sound?: SoundName | null;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, sound = "click", onClick, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      onClick={(e) => {
        if (sound) soundManager.play(sound);
        onClick?.(e);
      }}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export const PrimaryButton = forwardRef<HTMLButtonElement, ButtonProps>((p, r) => <Button ref={r} variant="primary" {...p} />);
PrimaryButton.displayName = "PrimaryButton";
export const SecondaryButton = forwardRef<HTMLButtonElement, ButtonProps>((p, r) => <Button ref={r} variant="secondary" {...p} />);
SecondaryButton.displayName = "SecondaryButton";
