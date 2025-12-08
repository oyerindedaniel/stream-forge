import * as React from "react";
import { cn } from "@/lib/utils";

interface LoaderIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

export const LoaderIcon: React.FC<LoaderIconProps> = ({
  className = "",
  size = 24,
  ...props
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("animate-spin", className)}
      {...props}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M12 6l0 -3" />
      <path d="M16.25 7.75l2.15 -2.15" />
      <path d="M18 12l3 0" />
      <path d="M16.25 16.25l2.15 2.15" />
      <path d="M12 18l0 3" />
      <path d="M7.75 16.25l-2.15 2.15" />
      <path d="M6 12l-3 0" />
      <path d="M7.75 7.75l-2.15 -2.15" />
    </svg>
  );
};
