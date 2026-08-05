import React from 'react';
import { Toaster as Sonner } from 'sonner';
import { Icons } from '../Icons';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Toast surface for the Sonador Viewer, ported from OHIF v3
 * (`platform/ui-next/src/components/Sonner/Sonner.tsx`).
 *
 * sonner injects its own stylesheet at runtime, so the toast chrome renders correctly independent
 * of the viewer's Tailwind build. The icons below come from the shared OHIF icon set so
 * notifications match the rest of the interface.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      loadingIcon={<Icons.LoadingSpinner />}
      icons={{
        warning: <Icons.StatusWarning />,
        info: <Icons.Info className="text-secondary-foreground" />,
        success: <Icons.StatusSuccess />,
        error: <Icons.StatusError />,
      }}
      theme="dark"
      richColors
      toastOptions={{
        style: {
          width: '430px',
          right: '8px',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
