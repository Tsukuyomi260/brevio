import * as React from 'react';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[60px] w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none',
        'placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-slate-400',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
