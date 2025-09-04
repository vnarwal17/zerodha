import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const statusBadgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        success: "bg-success/20 text-success-foreground border border-success/30",
        danger: "bg-destructive/20 text-destructive-foreground border border-destructive/30",
        warning: "bg-warning/20 text-warning-foreground border border-warning/30",
        info: "bg-primary/20 text-primary-foreground border border-primary/30",
        neutral: "bg-muted text-muted-foreground border border-border",
        bull: "bg-bull/20 text-bull-foreground border border-bull/30",
        bear: "bg-bear/20 text-bear-foreground border border-bear/30",
      },
      size: {
        sm: "px-2 py-0.5 text-xs",
        md: "px-2.5 py-0.5 text-xs",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "md",
    },
  }
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statusBadgeVariants> {}

function StatusBadge({ className, variant, size, ...props }: StatusBadgeProps) {
  return (
    <div className={cn(statusBadgeVariants({ variant, size }), className)} {...props} />
  );
}

export { StatusBadge, statusBadgeVariants };