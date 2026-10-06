import type { ComponentProps, ReactNode } from "react"
import { useTooltip, type TooltipContent } from "./popover.tsx"

export const IconButton = ({
  label,
  tooltip,
  icon,
  className,
  ...rest
}: Omit<ComponentProps<"button">, "children"> & {
  readonly label: string
  readonly tooltip?: TooltipContent
  readonly icon: ReactNode
}) => {
  const hint = useTooltip(tooltip)
  return (
    <>
      <button
        type="button"
        aria-label={label}
        className={className === undefined ? "icon-button" : `icon-button ${className}`}
        {...rest}
        {...hint.props}
      >
        {icon}
      </button>
      {hint.tooltip}
    </>
  )
}
