"use client";

import type { ToasterProps } from "sonner";

import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";
import { Toaster as Sonner } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Sonner injects its CSS at runtime AFTER our <link>'d styles, so
          // its `[data-sonner-toaster][data-sonner-theme='dark'] [data-description]`
          // rule (specificity 0,3,0) would beat any equal-specificity override
          // we'd write. The `!` modifier compiles to `!important` and wins
          // regardless. Title already inherits popover-foreground correctly;
          // only the description needs this.
          description: "text-muted-foreground!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
